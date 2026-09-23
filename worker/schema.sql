-- Banco do Worker (Cloudflare D1). Aplicar com:
--   npx wrangler d1 execute garimpo --remote --file=worker/schema.sql

-- teto diário de chamadas ao Jev: protege o bolso do dono da chave
CREATE TABLE IF NOT EXISTS uso (
  dia TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);

-- faixas do Audius que alguém garimpou e compartilhou: só metadados, o áudio
-- continua vindo do Audius
CREATE TABLE IF NOT EXISTS faixas (
  id       TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  artist   TEXT,
  handle   TEXT,
  duration INTEGER NOT NULL,
  genre    TEXT,
  bpm      REAL NOT NULL,
  camelot  TEXT,
  key      TEXT,
  pilha    TEXT,
  criada   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS faixas_criada ON faixas (criada);
