import { pgTable, uuid, text, unique } from 'drizzle-orm/pg-core';
import { accountType } from './enums';
import { companies } from './companies';
import { groups } from './groups';

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
  },
  (t) => ({ uq: unique('coa_company_code_uq').on(t.companyId, t.code) }),
);

export const groupChartOfAccounts = pgTable(
  'group_chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
  },
  (t) => ({ uq: unique('group_coa_code_uq').on(t.groupId, t.code) }),
);

export const coaMappings = pgTable(
  'coa_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyAccountId: uuid('company_account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'cascade' }),
    groupAccountId: uuid('group_account_id').notNull().references(() => groupChartOfAccounts.id, { onDelete: 'cascade' }),
  },
  (t) => ({ uq: unique('coa_mapping_uq').on(t.companyAccountId, t.groupAccountId) }),
);
