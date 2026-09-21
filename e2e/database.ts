// The server under test and the tests share this database. Same Postgres as the integration tests
// (host port 5433, docker-compose.yml and the CI service container), a different database.
export const E2E_DATABASE = "suburi_e2e";
export const E2E_URL = `postgresql://suburi:suburi@localhost:5433/${E2E_DATABASE}`;


// The e2e server's OpenAI (e2e/mock-openai.ts). Its port is fixed because the server reads the URL
// once, at boot.
export const MOCK_OPENAI_PORT = 3199;
export const MOCK_OPENAI_BASE_URL = `http://localhost:${MOCK_OPENAI_PORT}/v1`;
