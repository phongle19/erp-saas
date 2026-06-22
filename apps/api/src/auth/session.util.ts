import type { Request } from 'express';

export interface ResolvedSession {
  userId: string;
  isAdmin: boolean;
  accessibleCompanies: string[];
}

/**
 * STUB — Task 8 replaces this with a real session-cookie lookup
 * (validate the session cookie, load the user, resolve accessible companies).
 *
 * For now there is no session, so every request resolves as anonymous. Combined
 * with the fail-closed RLS policies, an anonymous request can read/write nothing.
 */
export async function resolveSession(_req: Request): Promise<ResolvedSession | null> {
  return null;
}
