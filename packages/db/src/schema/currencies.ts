import { pgTable, text, integer } from 'drizzle-orm/pg-core';

export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  minorUnitScale: integer('minor_unit_scale').notNull(),
});
