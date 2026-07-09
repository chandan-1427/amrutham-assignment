import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { payments, consultations, availabilitySlots } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireIdempotencyKey } from '../../lib/idempotency.js';
import { createPaymentIntent, verifyWebhookSignature } from '../../lib/payment-gateway.js';
import { AppError } from '../../lib/errors.js';
import { createPaymentIntentSchema, webhookPayloadSchema } from './schema.js';

const paymentsRoute = new Hono();

paymentsRoute.post('/intent', requireAuth, zValidator('json', createPaymentIntentSchema), async (c) => {
  const authUser = c.get('user');
  const idempotencyKey = requireIdempotencyKey(c);
  const { consultationId } = c.req.valid('json');

  const existingByKey = await db.query.payments.findFirst({ where: eq(payments.idempotencyKey, idempotencyKey) });
  if (existingByKey) return c.json({ payment: existingByKey, checkoutUrl: null });

  const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, consultationId) });
  if (!consultation) throw new AppError(404, 'Consultation not found');
  if (consultation.patientId !== authUser.id) throw new AppError(403, 'Not authorized for this consultation');
  if (consultation.status !== 'pending_payment')
    throw new AppError(409, `Cannot create a payment intent for status ${consultation.status}`);

  const existingForConsultation = await db.query.payments.findFirst({
    where: eq(payments.consultationId, consultationId),
  });
  // checkoutUrl isn't persisted — stub gateway only returns it once, at creation.
  // Real gateway SDKs support re-fetching by providerRef; not modeled here.
  if (existingForConsultation) return c.json({ payment: existingForConsultation, checkoutUrl: null });

  const intent = createPaymentIntent(consultation.feeCharged, consultation.id);
  const [payment] = await db
    .insert(payments)
    .values({
      consultationId: consultation.id,
      providerRef: intent.intentId,
      amount: consultation.feeCharged,
      idempotencyKey,
    })
    .returning();

  return c.json({ payment, checkoutUrl: intent.checkoutUrl }, 201);
});

paymentsRoute.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Webhook-Signature');
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'Invalid webhook signature');
  }

  const parsed = webhookPayloadSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) throw new AppError(400, 'Invalid webhook payload');
  const { providerRef, consultationId, status } = parsed.data;

  const payment = await db.query.payments.findFirst({ where: eq(payments.providerRef, providerRef) });
  if (!payment) throw new AppError(404, 'Unknown payment reference');

  if (payment.status !== 'initiated') {
    return c.json({ received: true, alreadyProcessed: true });
  }

  await db.transaction(async (tx) => {
    if (status === 'confirmed') {
      await tx
        .update(payments)
        .set({ status: 'confirmed', rawWebhookJson: parsed.data, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      await tx
        .update(consultations)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(eq(consultations.id, consultationId));
      await tx
        .update(availabilitySlots)
        .set({ status: 'booked', updatedAt: new Date() })
        .where(eq(availabilitySlots.heldByConsultationId, consultationId));
    } else {
      await tx
        .update(payments)
        .set({ status: 'failed', rawWebhookJson: parsed.data, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      await tx
        .update(consultations)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(consultations.id, consultationId));
      await tx
        .update(availabilitySlots)
        .set({ status: 'available', heldByConsultationId: null, heldUntil: null, updatedAt: new Date() })
        .where(eq(availabilitySlots.heldByConsultationId, consultationId));
    }
  });

  return c.json({ received: true });
});

export default paymentsRoute;