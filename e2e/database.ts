// The server under test and the tests share this database. Same Postgres as the integration tests
// (host port 5433, docker-compose.yml and the CI service container), a different database.
export const E2E_DATABASE = process.env.E2E_DATABASE ?? "suburi_e2e";
if (!/^[a-z][a-z0-9_]*$/.test(E2E_DATABASE)) throw new Error("E2E_DATABASE must be a lowercase SQL identifier");
export const E2E_URL = `postgresql://suburi:suburi@localhost:5433/${E2E_DATABASE}`;


// The e2e server's OpenAI (e2e/mock-openai.ts). Its port is fixed because the server reads the URL
// once, at boot.
export const MOCK_OPENAI_PORT = 3199;
export const MOCK_OPENAI_BASE_URL = `http://localhost:${MOCK_OPENAI_PORT}/v1`;

// The e2e server's S3 (e2e/mock-s3.ts), fixed for the same reason. The browser PUTs to it directly,
// as it would to the bucket, so it answers CORS for the server's origin.
export const MOCK_S3_PORT = 3198;
export const MOCK_S3_ENDPOINT = `http://localhost:${MOCK_S3_PORT}`;

// The server's CRON_SECRET under test. Not a real one: no deployed environment holds it.
export const E2E_CRON_SECRET = "e2e-cron-secret-not-a-real-one";
