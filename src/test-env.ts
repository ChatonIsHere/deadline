// Imported first by specs that load config. The test database is the local Docker one.
Object.assign(process.env, {
    PUBLIC_URL: 'http://localhost:3003',
    DISCORD_TOKEN: 'test',
    DISCORD_CLIENT_SECRET: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://deadline:deadline@localhost:5433/deadline_test',
    // In-memory cache and a temp folder for pictures
    REDIS_URL: '',
    S3_ENDPOINT: '',
});
