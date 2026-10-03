/**
 * Deletes every row created by audit runs (organizations named e2e-cpn-%, users with email e2e-cpn-%).
 * Only touches rows whose organizationId / userId / email belongs to that test data — never other data.
 * Data is removed directly in MySQL; restart the backend afterwards so its in-memory dbStore matches.
 */
import { closeDb, sql } from '../lib/db';
import { ENV } from '../lib/env';

(async () => {
  const orgs = await sql<{ id: string }>(`SELECT id FROM organizations WHERE name LIKE 'e2e-cpn-%'`);
  const users = await sql<{ id: string }>(`SELECT id FROM users WHERE email LIKE 'e2e-cpn-%'`);
  const orgIds = orgs.map((o) => o.id);
  const userIds = users.map((u) => u.id);
  const cols = await sql<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = ? AND COLUMN_NAME IN ('organizationId','userId','recipientEmail','email')`,
    [ENV.DB.database],
  );
  const report: string[] = [];
  const del = async (table: string, col: string, values: string[]) => {
    if (!values.length) return;
    const [res]: any = await (await import('../lib/db')).db().query(`DELETE FROM \`${table}\` WHERE \`${col}\` IN (?)`, [values]);
    if (res.affectedRows) report.push(`${table}.${col}: ${res.affectedRows}`);
  };
  await (await import('../lib/db')).db().query('SET FOREIGN_KEY_CHECKS=0');
  for (const { TABLE_NAME, COLUMN_NAME } of cols) {
    if (TABLE_NAME === 'organizations' || TABLE_NAME === 'users') continue;
    if (COLUMN_NAME === 'organizationId') await del(TABLE_NAME, COLUMN_NAME, orgIds);
    if (COLUMN_NAME === 'userId') await del(TABLE_NAME, COLUMN_NAME, userIds);
    if (COLUMN_NAME === 'recipientEmail' || (COLUMN_NAME === 'email' && TABLE_NAME !== 'users')) {
      const [res]: any = await (await import('../lib/db')).db().query(`DELETE FROM \`${TABLE_NAME}\` WHERE \`${COLUMN_NAME}\` LIKE 'e2e-cpn-%'`);
      if (res.affectedRows) report.push(`${TABLE_NAME}.${COLUMN_NAME} LIKE e2e-cpn-%: ${res.affectedRows}`);
    }
  }
  await del('organizations', 'id', orgIds);
  await del('users', 'id', userIds);
  await (await import('../lib/db')).db().query('SET FOREIGN_KEY_CHECKS=1');
  console.log(`cleanup: ${orgIds.length} orgs, ${userIds.length} users`);
  console.log(report.join('\n'));
  await closeDb();
})();
