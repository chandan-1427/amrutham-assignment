import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { prescriptions, consultations } from '../../db/schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireUuidParam } from '../../lib/params.js';
import { decrypt } from '../../lib/encryption.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { recordAuditLog } from '../../lib/audit.js';

const prescriptionsRoute = new Hono();
const phiKey = Buffer.from(env.PHI_ENCRYPTION_KEY, 'hex');

prescriptionsRoute.get('/:id', requireAuth, async (c) => {
  const authUser = c.get('user');
  const id = requireUuidParam(c, 'id');

  const prescription = await db.query.prescriptions.findFirst({ where: eq(prescriptions.id, id) });
  if (!prescription) throw new AppError(404, 'Prescription not found');

  const consultation = await db.query.consultations.findFirst({
    where: eq(consultations.id, prescription.consultationId),
  });
  if (!consultation) throw new AppError(404, 'Associated consultation not found');

  const isParty = authUser.id === consultation.patientId || authUser.id === consultation.doctorId;
  if (!isParty) throw new AppError(403, 'Not authorized to view this prescription');

  await recordAuditLog(db, {
    actorId: authUser.id,
    entityType: 'prescription',
    entityId: prescription.id,
    action: 'viewed',
  });

  return c.json({
    id: prescription.id,
    consultationId: prescription.consultationId,
    doctorId: prescription.doctorId,
    notes: decrypt(prescription.notesEncrypted, phiKey),
    medications: JSON.parse(decrypt(prescription.medicationsEncrypted, phiKey)),
    issuedAt: prescription.issuedAt,
  });
});

export default prescriptionsRoute;