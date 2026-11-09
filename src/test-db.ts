import './test-env';
import { PrismaService } from './prisma/prisma.service';

/**
 * The tests' database: deadline_test on the local Docker Postgres (see docker-compose.yml).
 * `npm test` resets it to the current migrations first. Specs run one file at a time and
 * empty it before each test.
 */
export const prisma = new PrismaService();

const TABLES = [
    'settings',
    'user_prefs',
    'crews',
    'crew_members',
    'crew_allies',
    'crew_invites',
    'runners',
    'runner_photos',
    'downtime_entries',
    'gigs',
    'gig_objectives',
    'gig_slots',
    'gig_reserves',
    'gig_rewards',
    'fixer_ratings',
    'regions',
    'images',
    'stale_objects',
];

export async function emptyDb() {
    await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}
