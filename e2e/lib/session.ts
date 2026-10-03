import { loginAffiliateUser, loginWorkspaceUser, Session } from './actors';
import { loadFixtures } from './fixtures';

const cache = new Map<string, Session>();
/** Fresh login per worker (access tokens expire after JWT_ACCESS_TTL=30m). */
export async function as(role: string): Promise<Session> {
  const f = loadFixtures();
  const u = f.users[role];
  if (!u) throw new Error(`unknown role ${role}`);
  const hit = cache.get(role);
  if (hit) return hit;
  const s = u.kind === 'affiliate' ? await loginAffiliateUser(u.email) : await loginWorkspaceUser(u.email);
  cache.set(role, s);
  return s;
}
