CREATE TYPE "public"."journal_status" AS ENUM('draft', 'posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed', 'locked');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('regular', 'special');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"period_no" integer NOT NULL,
	"period_type" "period_type" NOT NULL,
	"purpose" text,
	"name_vi" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "accounting_period_uq" UNIQUE("company_id","fiscal_year","period_no"),
	CONSTRAINT "period_no_positive" CHECK ("accounting_periods"."period_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"entry_no" integer NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"status" "journal_status" DEFAULT 'draft' NOT NULL,
	"reverses_entry_id" uuid,
	"created_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_no_uq" UNIQUE("company_id","fiscal_year","entry_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"ic_counterparty_company_id" uuid,
	"line_memo" text,
	CONSTRAINT "line_amounts_non_negative" CHECK ("journal_lines"."debit_minor" >= 0 AND "journal_lines"."credit_minor" >= 0),
	CONSTRAINT "line_not_both_sides" CHECK (NOT ("journal_lines"."debit_minor" > 0 AND "journal_lines"."credit_minor" > 0))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_year_start_month" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
