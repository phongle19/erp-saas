import { pgTable, uuid, text, date } from 'drizzle-orm/pg-core';

export const taxRules = pgTable('tax_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleType: text('rule_type').notNull(),
  value: text('value').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  sourceRegulation: text('source_regulation').notNull(),
  notes: text('notes'),
});
