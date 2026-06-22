/**
 * Integration tests for Task 8: auth bootstrap, login, logout, session resolution.
 *
 * Gate: skipped when no DB URL is set. Run with:
 *   TEST_DATABASE_URL=postgres://... pnpm --filter @erp/api test -- test/auth.int.test.ts
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { hashToken } from '../src/auth/session.util.js';
import { makeDb, makeSql, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { truncateAll } from './helpers/make-app.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

// Unique email per test run to allow repeated runs without conflicts.
const runId = randomUUID().slice(0, 8);
const TEST_EMAIL = `admin-${runId}@example.com`;
const TEST_PASSWORD = 'S3cure!passw0rd';
const TEST_DISPLAY_NAME = 'Test Admin';
const TEST_OWNER_NAME = 'Test Owner Corp';

maybe('Auth integration — bootstrap / login / session', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    // Set FIELD_ENCRYPTION_KEY if not already set (64 zeros for test).
    if (!process.env.FIELD_ENCRYPTION_KEY) {
      process.env.FIELD_ENCRYPTION_KEY = '0'.repeat(64);
    }
    // Disable secure cookies in test (no HTTPS).
    process.env.SESSION_COOKIE_SECURE = 'false';

    // Reset to empty so bootstrap (test 1a) sees a virgin system regardless of
    // what earlier test files committed (they run serially, sharing the DB).
    const cleanupSql = makeSql();
    await truncateAll(cleanupSql);
    await cleanupSql.end();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    db = makeDb();
  });

  afterAll(async () => {
    await app?.close();
    // Cleanup: remove test user and sessions so subsequent runs can bootstrap.
    const userRows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, TEST_EMAIL))
      .limit(1);
    if (userRows[0]) {
      // Sessions cascade-delete via FK, so just delete the user.
      await db.delete(schema.users).where(eq(schema.users.id, userRows[0].id));
    }
  });

  it('1a. POST /auth/bootstrap with valid body → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/bootstrap')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        displayName: TEST_DISPLAY_NAME,
        ownerName: TEST_OWNER_NAME,
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('1b. POST /auth/bootstrap a second time → 409 (ConflictException)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/bootstrap')
      .send({
        email: `other-${runId}@example.com`,
        password: TEST_PASSWORD,
        displayName: 'Second',
        ownerName: TEST_OWNER_NAME,
      });
    expect(res.status).toBe(409);
  });

  it('2a. POST /auth/login with wrong password → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('2b. POST /auth/login with correct password → 200 + sets sid cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const cookieHeader = res.headers['set-cookie'] as string[] | string | undefined;
    expect(cookieHeader).toBeTruthy();
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader!];
    const sidCookie = cookies.find((c) => c.startsWith('sid='));
    expect(sidCookie).toBeTruthy();
    expect(sidCookie).toContain('HttpOnly');
    expect(sidCookie).toContain('SameSite=Lax');
  });

  it('3. Session row exists and hashToken(rawCookie) matches its id', async () => {
    // Login to get the raw token.
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);

    const cookieHeader = loginRes.headers['set-cookie'] as string[] | string;
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    const sidCookieStr = cookies.find((c) => c.startsWith('sid='))!;

    // Extract raw token value: sid=<token>; HttpOnly; ...
    const rawToken = sidCookieStr.split(';')[0]!.replace('sid=', '');
    const expectedId = hashToken(rawToken);

    // Verify the session row in DB.
    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, expectedId))
      .limit(1);

    expect(sessionRows.length).toBe(1);
    const session = sessionRows[0]!;
    expect(session.id).toBe(expectedId);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify the user row is admin.
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);
    expect(userRows[0]!.isAdmin).toBe(true);
    expect(userRows[0]!.email).toBe(TEST_EMAIL);
  });

  it('4. POST /auth/logout clears the session', async () => {
    // Login first.
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookieHeader = loginRes.headers['set-cookie'] as string[] | string;
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    const sidCookieStr = cookies.find((c) => c.startsWith('sid='))!;
    const rawToken = sidCookieStr.split(';')[0]!.replace('sid=', '');
    const sessionId = hashToken(rawToken);

    // Confirm session exists.
    const before = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    expect(before.length).toBe(1);

    // Logout.
    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `sid=${rawToken}`);
    expect(logoutRes.status).toBe(200);

    // Session should be deleted.
    const after = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    expect(after.length).toBe(0);
  });
});
