CREATE TYPE "public"."goods_issue_reason" AS ENUM('sale', 'consumption', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('receipt', 'issue');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_cost_minor" bigint DEFAULT 0 NOT NULL,
	"total_cost_minor" bigint NOT NULL,
	"balance_qty_after" bigint NOT NULL,
	"balance_value_after" bigint NOT NULL,
	"source_doc_type" text,
	"source_doc_id" uuid,
	"journal_entry_id" uuid,
	"movement_date" date NOT NULL,
	"period_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'cái' NOT NULL,
	"inventory_account_code" text DEFAULT '156' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_issue_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"cost_minor" bigint NOT NULL,
	"cogs_account_code" text DEFAULT '632' NOT NULL,
	CONSTRAINT "goods_issue_line_no_uq" UNIQUE("issue_id","line_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_no" integer NOT NULL,
	"issue_date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"reason" "goods_issue_reason" DEFAULT 'sale' NOT NULL,
	"description" text,
	"status" "sales_doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"total_cost_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_issue_no_uq" UNIQUE("company_id","fiscal_year","issue_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"line_cost_minor" bigint NOT NULL,
	"vat_rule_type" text NOT NULL,
	"vat_rate_pct" integer NOT NULL,
	"vat_minor" bigint NOT NULL,
	"inventory_account_code" text DEFAULT '156' NOT NULL,
	CONSTRAINT "purchase_invoice_line_no_uq" UNIQUE("invoice_id","line_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"invoice_no" integer NOT NULL,
	"vendor_invoice_no" text,
	"invoice_date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"description" text,
	"non_cash_payment" boolean DEFAULT false NOT NULL,
	"status" "sales_doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_invoice_no_uq" UNIQUE("company_id","fiscal_year","invoice_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"payment_no" integer NOT NULL,
	"payment_date" date NOT NULL,
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
	CONSTRAINT "vendor_payment_no_uq" UNIQUE("company_id","fiscal_year","payment_no")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_issue_id_goods_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."goods_issues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_partner_id_business_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."business_partners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movement_company_material_idx" ON "inventory_movements" USING btree ("company_id","material_id","created_at");