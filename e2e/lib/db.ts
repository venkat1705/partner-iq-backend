import mysql from 'mysql2/promise';
import { ENV } from './env';

let pool: mysql.Pool | undefined;
export function db() {
  pool ??= mysql.createPool({ ...ENV.DB, connectionLimit: 5, timezone: 'Z', dateStrings: false, multipleStatements: false });
  return pool;
}
/** Runs a parameterised query and returns rows. */
export async function sql<T = any>(query: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await db().query(query, params);
  return rows as T[];
}
export async function sqlOne<T = any>(query: string, params: unknown[] = []): Promise<T | undefined> {
  return (await sql<T>(query, params))[0];
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
/** Polls until fn() returns truthy (dbStore writes land in MySQL asynchronously). */
export async function eventually<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  } while (Date.now() < end);
  return last!;
}
