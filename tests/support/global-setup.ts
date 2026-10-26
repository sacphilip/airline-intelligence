import { createRequire } from 'module';
import path from 'path';

/**
 * Seeds the users the real-backend tests log in as (e.g. TC-011-15).
 * Runs after the webServers are up, so the backend has already created the `users` table.
 * Existing rows are left alone (ON CONFLICT DO NOTHING): a local account keeps its password.
 */
export const TEST_USERS = [
  { email: 'alice@example.com', password: 'password123', firstName: 'Alice' },
];

export default async function globalSetup() {
  // pg and bcryptjs are backend dependencies; the root test project doesn't install them.
  const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
  let pg: any, bcrypt: any;
  try {
    pg = backendRequire('pg');
    bcrypt = backendRequire('bcryptjs');
  } catch {
    console.warn('[global-setup] backend/node_modules missing (npm ci --prefix backend) — test users not seeded');
    return;
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://flight_tracker:flight_tracker@localhost:5432/flight_tracker',
  });
  await client.connect();
  try {
    for (const u of TEST_USERS) {
      const res = await client.query(
        'INSERT INTO users (email, password_hash, first_name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [u.email, bcrypt.hashSync(u.password, 10), u.firstName],
      );
      console.log(`[global-setup] ${u.email}: ${res.rowCount ? 'created' : 'already exists'}`);
    }
  } finally {
    await client.end();
  }
}
