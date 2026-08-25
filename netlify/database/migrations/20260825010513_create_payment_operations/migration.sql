CREATE TABLE "supplier_payment_method_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"supplier_id" text NOT NULL,
	"payment_method_id" uuid,
	"action" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"supplier_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"pix_key_type" text,
	"pix_key" text,
	"bank_name" text,
	"bank_code" text,
	"agency" text,
	"account" text,
	"account_digit" text,
	"account_type" text,
	"holder_name" text NOT NULL,
	"holder_document" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_operation_mirrors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"external_transfer_id" text NOT NULL UNIQUE,
	"idempotency_key" text NOT NULL,
	"program_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"destination_account_id" text NOT NULL,
	"amount" numeric(14,2) NOT NULL,
	"user_id" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "supplier_payment_methods_supplier_idx" ON "supplier_payment_methods" ("supplier_id");