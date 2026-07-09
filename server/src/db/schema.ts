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
  integer
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { z } from 'zod';

export const userRoleEnum = pgEnum('user_role', ['patient', 'doctor', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected']);
export const slotStatusEnum = pgEnum('slot_status', ['available', 'held', 'booked', 'cancelled']);

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
    heldByConsultationId: uuid('held_by_consultation_id'),
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