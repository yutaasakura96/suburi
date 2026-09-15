-- Custom migration: pgvector must exist before questions.embedding uses the vector type.
-- `if not exists` because docs/12-deployment.md §3 step 1 may already have enabled it on Neon.
CREATE EXTENSION IF NOT EXISTS vector;
