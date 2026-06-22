import { sql as drizzleSql } from 'drizzle-orm';
import { makeSql, makeDb, schema } from './client.js';

async function main() {
  const sqlClient = makeSql();
  const db = makeDb(sqlClient);

  // idempotency guard — owner table has no RLS, readable without admin GUC
  const existing = await sqlClient`SELECT count(*)::int AS n FROM owner`;
  if (existing[0]!.n > 0) {
    console.log('owner already exists — seed skipped');
    await sqlClient.end();
    return;
  }

  await db.transaction(async (tx) => {
    // Set admin GUC so FORCE RLS WITH CHECK passes for companies, groups, group_memberships
    await tx.execute(drizzleSql`SELECT set_config('app.is_admin','true',true)`);

    // Currencies — no RLS, but onConflictDoNothing for safety
    await tx.insert(schema.currencies).values([
      { code: 'VND', name: 'Vietnamese Dong', minorUnitScale: 0 },
      { code: 'USD', name: 'US Dollar', minorUnitScale: 2 },
    ]).onConflictDoNothing();

    // Owner
    const ownRows = await tx.insert(schema.owner).values({
      name: 'Demo Owner',
      defaultLocale: 'vi',
    }).returning();
    const own = ownRows[0]!;

    // Companies
    const smeRows = await tx.insert(schema.companies).values({
      ownerId: own.id,
      name: 'Công ty TNHH Demo SME',
      mst: '0101234567',
      regime: 'circular_133',
      functionalCurrency: 'VND',
    }).returning();
    const sme = smeRows[0]!;

    const hkdRows = await tx.insert(schema.companies).values({
      ownerId: own.id,
      name: 'Hộ kinh doanh Demo',
      mst: '8101234567',
      regime: 'circular_88',
      functionalCurrency: 'VND',
      householdTier: '200m_1b',
    }).returning();
    const hkd = hkdRows[0]!;

    // Management portfolio group spanning both companies
    const grpRows = await tx.insert(schema.groups).values({
      ownerId: own.id,
      name: 'Danh mục tổng hợp (Portfolio)',
      type: 'MANAGEMENT',
      reportingCurrency: 'VND',
    }).returning();
    const grp = grpRows[0]!;

    await tx.insert(schema.groupMemberships).values([
      { groupId: grp.id, companyId: sme.id },
      { groupId: grp.id, companyId: hkd.id },
    ]);

    // Effective-dated tax rules
    // Note: effectiveTo is EXCLUSIVE — 8% reduced rate through 2026-12-31 => effectiveTo '2027-01-01'
    await tx.insert(schema.taxRules).values([
      {
        ruleType: 'vat_rate',
        value: '10',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        sourceRegulation: 'Law on VAT',
      },
      {
        ruleType: 'vat_rate_reduced',
        value: '8',
        effectiveFrom: '2025-01-01',
        effectiveTo: '2027-01-01',
        sourceRegulation: 'Resolution 204/2025/QH15',
      },
      {
        ruleType: 'input_vat_noncash_threshold',
        value: '5000000',
        effectiveFrom: '2025-07-01',
        effectiveTo: null,
        sourceRegulation: 'Law 48/2024/QH15',
      },
      {
        ruleType: 'household_tier_threshold_exempt',
        value: '200000000',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        sourceRegulation: 'Resolution 198/2025/QH15',
      },
    ]);

    console.log(JSON.stringify({ ownerId: own.id, smeId: sme.id, hkdId: hkd.id, groupId: grp.id }, null, 2));
  });

  await sqlClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
