CREATE TYPE "public"."slot_status" AS ENUM('available', 'held', 'booked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" "slot_status" DEFAULT 'available' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"held_by_consultation_id" uuid,
	"held_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"specialty" text NOT NULL,
	"qualifications_json" jsonb,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"consultation_fee" numeric(10, 2) NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_doctor_id_doctors_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_slots_doctor_start_status_idx" ON "availability_slots" USING btree ("doctor_id","start_time","status");--> statement-breakpoint
CREATE INDEX "doctors_specialty_idx" ON "doctors" USING btree ("specialty");--> statement-breakpoint
CREATE INDEX "doctors_languages_gin_idx" ON "doctors" USING gin ("languages");