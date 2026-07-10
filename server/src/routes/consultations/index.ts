import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { consultations, availabilitySlots, doctors, payments } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireIdempotencyKey } from '../../lib/idempotency.js';
import { createPaymentIntent } from '../../lib/payment-gateway.js';
import { AppError } from '../../lib/errors.js';
import { createConsultationSchema, listConsultationsSchema } from './schema.js';
import { requireUuidParam } from '../../lib/params.js';
import { prescriptions } from '../../db/schema.js';
import { encrypt } from '../../lib/encryption.js';
import { env } from '../../config/env.js';
import { createPrescriptionSchema } from '../prescriptions/schema.js';


const consultationsRoute = new Hono();
const HOLD_MINUTES = 10;

const phiKey = Buffer.from(env.PHI_ENCRYPTION_KEY, 'hex');

consultationsRoute.post('/', requireAuth, zValidator('json', createConsultationSchema), async (c) => {
  const authUser = c.get('user');
  if (authUser.role !== 'patient') throw new AppError(403, 'Only patients can book consultations');

  const idempotencyKey = requireIdempotencyKey(c);
  const { slotId } = c.req.valid('json');

  const existing = await db.query.consultations.findFirst({
    where: eq(consultations.idempotencyKey, idempotencyKey),
  });
  if (existing) {
    if (existing.patientId !== authUser.id) throw new AppError(409, 'Idempotency key already used');

    const existingPayment = await db.query.payments.findFirst({
      where: eq(payments.consultationId, existing.id),
    });

    return c.json({
      consultation: existing,
      payment: existingPayment
        ? { id: existingPayment.id, providerRef: existingPayment.providerRef, checkoutUrl: null }
        : null,
    });
  }

  const slot = await db.query.availabilitySlots.findFirst({ where: eq(availabilitySlots.id, slotId) });
  if (!slot) throw new AppError(404, 'Slot not found');
  if (slot.status !== 'available') throw new AppError(409, 'Slot is no longer available');

  const doctor = await db.query.doctors.findFirst({ where: eq(doctors.userId, slot.doctorId) });
  if (!doctor) throw new AppError(404, 'Doctor not found');

  const consultation = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(consultations)
      .values({
        patientId: authUser.id,
        doctorId: slot.doctorId,
        slotId: slot.id,
        idempotencyKey,
        feeCharged: doctor.consultationFee,
        scheduledAt: slot.startTime,
      })
      .returning();

    const held = await tx
      .update(availabilitySlots)
      .set({
        status: 'held',
        heldByConsultationId: created.id,
        heldUntil: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
        version: sql`${availabilitySlots.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(availabilitySlots.id, slot.id),
          eq(availabilitySlots.status, 'available'),
          eq(availabilitySlots.version, slot.version)
        )
      )
      .returning();

    if (held.length === 0) throw new AppError(409, 'Slot is no longer available');
    return created;
  });

  const intent = createPaymentIntent(consultation.feeCharged, consultation.id);
  const [payment] = await db
    .insert(payments)
    .values({
      consultationId: consultation.id,
      providerRef: intent.intentId,
      amount: consultation.feeCharged,
      idempotencyKey: `${idempotencyKey}:payment`,
    })
    .returning();

  return c.json(
    { consultation, payment: { id: payment.id, providerRef: payment.providerRef, checkoutUrl: intent.checkoutUrl } },
    201
  );
});

consultationsRoute.get('/', requireAuth, zValidator('query', listConsultationsSchema), async (c) => {
  const authUser = c.get('user');
  const { limit, offset } = c.req.valid('query');

  const scope =
    authUser.role === 'doctor'
      ? eq(consultations.doctorId, authUser.id)
      : authUser.role === 'admin'
        ? undefined
        : eq(consultations.patientId, authUser.id);

  const rows = await db.query.consultations.findMany({
    where: scope,
    orderBy: (t, { desc }) => [desc(t.scheduledAt)],
    limit,
    offset,
  });

  return c.json(rows);
});

consultationsRoute.get('/:id', requireAuth, async (c) => {
  const authUser = c.get('user');
  const id = requireUuidParam(c, 'id');
  const consultation = await db.query.consultations.findFirst({
    where: eq(consultations.id, id),
  });
  if (!consultation) throw new AppError(404, 'Consultation not found');

  const isParty = authUser.id === consultation.patientId || authUser.id === consultation.doctorId;
  if (!isParty && authUser.role !== 'admin') throw new AppError(403, 'Not authorized to view this consultation');

  return c.json(consultation);
});

consultationsRoute.post('/:id/start', requireAuth, async (c) => {
  const authUser = c.get('user');
  const id = c.req.param('id');
  const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, id) });
  if (!consultation) throw new AppError(404, 'Consultation not found');
  if (authUser.role !== 'doctor' || authUser.id !== consultation.doctorId)
    throw new AppError(403, 'Only the assigned doctor can start this consultation');
  if (consultation.status !== 'confirmed')
    throw new AppError(409, `Cannot start a consultation in status ${consultation.status}`);

  const [updated] = await db
    .update(consultations)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(consultations.id, id))
    .returning();
  return c.json(updated);
});

consultationsRoute.post('/:id/complete', requireAuth, async (c) => {
  const authUser = c.get('user');
  const id = c.req.param('id');
  const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, id) });
  if (!consultation) throw new AppError(404, 'Consultation not found');
  if (authUser.role !== 'doctor' || authUser.id !== consultation.doctorId)
    throw new AppError(403, 'Only the assigned doctor can complete this consultation');
  if (consultation.status !== 'in_progress')
    throw new AppError(409, `Cannot complete a consultation in status ${consultation.status}`);

  const [updated] = await db
    .update(consultations)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(consultations.id, id))
    .returning();
  return c.json(updated);
});

consultationsRoute.post('/:id/no-show', requireAuth, async (c) => {
  const authUser = c.get('user');
  const id = c.req.param('id');
  const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, id) });
  if (!consultation) throw new AppError(404, 'Consultation not found');
  if (authUser.role !== 'doctor' || authUser.id !== consultation.doctorId)
    throw new AppError(403, 'Only the assigned doctor can mark this consultation as no-show');
  if (consultation.status !== 'confirmed')
    throw new AppError(409, `Cannot mark a consultation in status ${consultation.status} as no-show`);

  const [updated] = await db
    .update(consultations)
    .set({ status: 'no_show', updatedAt: new Date() })
    .where(eq(consultations.id, id))
    .returning();
  return c.json(updated);
});

consultationsRoute.post('/:id/cancel', requireAuth, async (c) => {
  const authUser = c.get('user');
  requireIdempotencyKey(c);
  const id = c.req.param('id');

  const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, id) });
  if (!consultation) throw new AppError(404, 'Consultation not found');

  const isParty = authUser.id === consultation.patientId || authUser.id === consultation.doctorId;
  if (!isParty && authUser.role !== 'admin') throw new AppError(403, 'Not authorized to cancel this consultation');

  if (consultation.status === 'cancelled') return c.json(consultation);
  if (!['pending_payment', 'confirmed'].includes(consultation.status)) {
    throw new AppError(409, `Cannot cancel a consultation in status ${consultation.status}`);
  }

  const updated = await db.transaction(async (tx) => {
    const [updatedConsultation] = await tx
      .update(consultations)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(consultations.id, id))
      .returning();

    await tx
      .update(availabilitySlots)
      .set({ status: 'available', heldByConsultationId: null, heldUntil: null, updatedAt: new Date() })
      .where(eq(availabilitySlots.id, consultation.slotId));

    const payment = await tx.query.payments.findFirst({ where: eq(payments.consultationId, id) });
    if (payment?.status === 'confirmed') {
      await tx.update(payments).set({ status: 'refunded', updatedAt: new Date() }).where(eq(payments.id, payment.id));
    }

    return updatedConsultation;
  });

  return c.json(updated);
});

consultationsRoute.post(
  '/:id/prescriptions',
  requireAuth,
  zValidator('json', createPrescriptionSchema),
  async (c) => {
    const authUser = c.get('user');
    const id = requireUuidParam(c, 'id');
    const { notes, medications } = c.req.valid('json');

    const consultation = await db.query.consultations.findFirst({ where: eq(consultations.id, id) });
    if (!consultation) throw new AppError(404, 'Consultation not found');
    if (authUser.role !== 'doctor' || authUser.id !== consultation.doctorId)
      throw new AppError(403, 'Only the assigned doctor can add a prescription');
    if (!['in_progress', 'completed'].includes(consultation.status))
      throw new AppError(409, `Cannot add a prescription for status ${consultation.status}`);

    const existing = await db.query.prescriptions.findFirst({ where: eq(prescriptions.consultationId, id) });
    if (existing) throw new AppError(409, 'A prescription already exists for this consultation');

    const [prescription] = await db
      .insert(prescriptions)
      .values({
        consultationId: id,
        doctorId: authUser.id,
        notesEncrypted: encrypt(notes, phiKey),
        medicationsEncrypted: encrypt(JSON.stringify(medications), phiKey),
      })
      .returning();

    return c.json(
      { id: prescription.id, consultationId: prescription.consultationId, issuedAt: prescription.issuedAt },
      201
    );
  }
);

export default consultationsRoute;