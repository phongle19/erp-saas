import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { makeDb, schema } from '@erp/db';

// Separate connection: session lookup runs BEFORE the request tx/GUCs are set.
// Do NOT use currentTx() here — that context does not exist yet.
const db = makeDb();

export interface ResolvedSession {
  userId: string;
  isAdmin: boolean;
  accessibleCompanies: string[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function resolveSession(req: Request): Promise<ResolvedSession | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (req as any).cookies?.['sid'] as string | undefined;
  if (!raw) return null;

  const id = hashToken(raw);
  const now = new Date();

  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now)))
    .limit(1);

  const s = rows[0];
  if (!s) return null;

  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, s.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) return null;

  const grants = await db
    .select()
    .from(schema.companyAccess)
    .where(eq(schema.companyAccess.userId, user.id));

  return {
    userId: user.id,
    isAdmin: user.isAdmin,
    accessibleCompanies: grants.map((g) => g.companyId),
  };
}
