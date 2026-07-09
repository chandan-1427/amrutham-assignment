CREATE TYPE "public"."consultation_status" AS ENUM('pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'confirmed', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"status" "consultation_status" DEFAULT 'pending_payment' NOT NULL,
	"idempotency_key" text NOT NULL,
	"fee_charged" numeric(10, 2) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"idempotency_key" text NOT NULL,
	"raw_webhook_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_unique" UNIQUE("provider_ref"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_doctor_id_doctors_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultations_patient_scheduled_idx" ON "consultations" USING btree ("patient_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "consultations_doctor_scheduled_idx" ON "consultations" USING btree ("doctor_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "payments_consultation_idx" ON "payments" USING btree ("consultation_id");--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_held_by_consultation_id_consultations_id_fk" FOREIGN KEY ("held_by_consultation_id") REFERENCES "public"."consultations"("id") ON DELETE no action ON UPDATE no action;