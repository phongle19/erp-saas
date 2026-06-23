CREATE TYPE "public"."einvoice_provider" AS ENUM('viettel', 'vnpt', 'misa');--> statement-breakpoint
CREATE TYPE "public"."einvoice_status" AS ENUM('pending', 'issued', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('customer', 'vendor', 'both');--> statement-breakpoint
CREATE TYPE "public"."sales_doc_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tax_code" text,
	"partner_type" "partner_type" DEFAULT 'customer' NOT NULL,
	"address" text,
	"email" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_partner_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"receipt_no" integer NOT NULL,
	"receipt_date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"settlement_account_code" text NOT NULL,
	"description" text,
	"status" "sales_doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_receipt_no_uq" UNIQUE("company_id","fiscal_year","receipt_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"line_net_minor" bigint NOT NULL,
	"vat_rule_type" text NOT NULL,
	"vat_rate_pct" integer NOT NULL,
	"vat_minor" bigint NOT NULL,
	"revenue_account_code" text DEFAULT '511' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"invoice_no" integer NOT NULL,
	"invoice_date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"description" text,
	"status" "sales_doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoice_no_uq" UNIQUE("company_id","fiscal_year","invoice_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "einvoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"provider" "einvoice_provider" NOT NULL,
	"mau_so" text,
	"ky_hieu" text,
	"so_hoa_don" text,
	"seller_mst" text,
	"buyer_mst" text,
	"buyer_name" text,
	"buyer_address" text,
	"currency" text DEFAULT 'VND' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"status" "einvoice_status" DEFAULT 'pending' NOT NULL,
	"provider_code" text,
	"gdt_message_id" text,
	"issued_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "einvoice_provider" "einvoice_provider" DEFAULT 'viettel' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
