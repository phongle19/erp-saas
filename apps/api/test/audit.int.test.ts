import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { schema } from '@erp/db';
import { makeApp, closeApp, type TestApp } from './helpers/make-app.js';
import { seedTwoCompaniesAndUsers } from './helpers/seed-test.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

let app: TestApp;
let adminUserId: string;
let smeId: string;

maybe('audit interceptor — successful mutations are logged in-tx', () => {
  beforeAll(async () => {
    app = await makeApp();
    ({ adminUserId, smeId } = await seedTwoCompaniesAndUsers(app));
  });
  afterAll(async () => {
    await closeApp(app);
  });

  it('records a POST /companies audit row with the admin actor and the new company id', async () => {
    // audit_log has no RLS; query directly via the committed db handle.
    const rows = await app.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, adminUserId),
          eq(schema.auditLog.action, 'POST /companies'),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    // The SME company was created via POST /companies — its id must be captured.
    const forSme = rows.find((r) => r.entityId === smeId);
    expect(forSme).toBeTruthy();
    expect(forSme!.actorUserId).toBe(adminUserId);
    expect(forSme!.entityType).toBe('/companies');
  });

  it('does not log any password material in audit rows', async () => {
    const rows = await app.db.select().from(schema.auditLog);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('S3cure!passw0rd');
  });
});
