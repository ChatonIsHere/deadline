// Brings the tests' database (deadline_test on the local Docker Postgres) up to the current
// migrations. Run by `npm test` before the specs. It doesn't wipe anything: each test empties
// the tables itself (see src/test-db.ts).
import { execSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://deadline:deadline@localhost:5433/deadline_test';
execSync('npx prisma migrate deploy', {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, DATABASE_URL: url },
});
