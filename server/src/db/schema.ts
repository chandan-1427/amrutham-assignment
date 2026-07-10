import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
  date,
  numeric,
  integer,
  type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { z } from 'zod';

export const userRoleEnum = pgEnum('user_role', ['patient', 'doctor', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected']);
export const slotStatusEnum = pgEnum('slot_status', ['available', 'held', 'booked', 'cancelled']);
export const consultationStatusEnum = pgEnum('consultation_status', [
  'pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show',
]);
export const paymentStatusEnum = pgEnum('payment_status', ['initiated', 'confirmed', 'failed', 'refunded']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    phone: varchar('phone', { length: 20 }).unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('patient'),
    mfaSecret: text('mfa_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailLowerUnique: uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
  })
);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name'),
  dob: date('dob'), // stored as ISO date string; using text to sidestep drizzle date-parsing footguns
  gender: text('gender'),
  addressJson: jsonb('address_json'), // jsonb below in raw SQL section — see note
  languagePref: text('language_pref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('refresh_tokens_user_id_idx').on(table.userId),
  })
);

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  dob: z.string().date().optional(),
  gender: z.string().max(50).optional(),
  addressJson: z.record(z.string(), z.unknown()).optional(),
  languagePref: z.string().max(50).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
}));

export const doctors = pgTable(
  'doctors',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    specialty: text('specialty').notNull(),
    qualificationsJson: jsonb('qualifications_json'),
    verificationStatus: verificationStatusEnum('verification_status').notNull().default('pending'),
    consultationFee: numeric('consultation_fee', { precision: 10, scale: 2 }).notNull(),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default('0'),
    ratingCount: integer('rating_count').notNull().default(0),
    languages: text('languages').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    specialtyIdx: index('doctors_specialty_idx').on(table.specialty),
    languagesGinIdx: index('doctors_languages_gin_idx').using('gin', table.languages),
  })
);

export const availabilitySlots = pgTable(
  'availability_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.userId, { onDelete: 'cascade' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: slotStatusEnum('status').notNull().default('available'),
    version: integer('version').notNull().default(0),
    heldByConsultationId: uuid('held_by_consultation_id').references((): AnyPgColumn => consultations.id),
    heldUntil: timestamp('held_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    doctorStartStatusIdx: index('availability_slots_doctor_start_status_idx').on(
      table.doctorId,
      table.startTime,
      table.status
    ),
  })
);

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  user: one(users, {
    fields: [doctors.userId],
    references: [users.id],
  }),
  availabilitySlots: many(availabilitySlots),
}));

export const availabilitySlotsRelations = relations(availabilitySlots, ({ one }) => ({
  doctor: one(doctors, {
    fields: [availabilitySlots.doctorId],
    references: [doctors.userId],
  }),
}));

export const consultations = pgTable(
  'consultations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id').notNull().references(() => users.id),
    doctorId: uuid('doctor_id').notNull().references(() => doctors.userId),
    slotId: uuid('slot_id').notNull().references(() => availabilitySlots.id),
    status: consultationStatusEnum('status').notNull().default('pending_payment'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    feeCharged: numeric('fee_charged', { precision: 10, scale: 2 }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    patientScheduledIdx: index('consultations_patient_scheduled_idx').on(table.patientId, table.scheduledAt),
    doctorScheduledIdx: index('consultations_doctor_scheduled_idx').on(table.doctorId, table.scheduledAt),
  })
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consultationId: uuid('consultation_id').notNull().references(() => consultations.id),
    providerRef: text('provider_ref').notNull().unique(),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    status: paymentStatusEnum('status').notNull().default('initiated'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    rawWebhookJson: jsonb('raw_webhook_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    consultationIdUnique: uniqueIndex('payments_consultation_id_unique').on(table.consultationId),
  })
);

export const consultationsRelations = relations(consultations, ({ one, many }) => ({
  patient: one(users, { fields: [consultations.patientId], references: [users.id] }),
  doctor: one(doctors, { fields: [consultations.doctorId], references: [doctors.userId] }),
  slot: one(availabilitySlots, { fields: [consultations.slotId], references: [availabilitySlots.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  consultation: one(consultations, { fields: [payments.consultationId], references: [consultations.id] }),
}));

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consultationId: uuid('consultation_id').notNull().references(() => consultations.id),
    doctorId: uuid('doctor_id').notNull().references(() => doctors.userId),
    notesEncrypted: text('notes_encrypted').notNull(),
    medicationsEncrypted: text('medications_encrypted').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    consultationIdUnique: uniqueIndex('prescriptions_consultation_id_unique').on(table.consultationId),
  })
);

export const prescriptionsRelations = relations(prescriptions, ({ one }) => ({
  consultation: one(consultations, { fields: [prescriptions.consultationId], references: [consultations.id] }),
}));