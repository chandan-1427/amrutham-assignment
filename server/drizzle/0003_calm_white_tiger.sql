DROP INDEX "payments_consultation_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payments_consultation_id_unique" ON "payments" USING btree ("consultation_id");