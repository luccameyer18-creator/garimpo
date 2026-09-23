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

-- trash: faixas que não são música (piada, teste, grito). Cada 👎 ou
-- reprovação do Jev é um voto; com 2+ a faixa some do garimpo de todos
CREATE TABLE IF NOT EXISTS lixo (
  id     TEXT PRIMARY KEY,
  votos  INTEGER NOT NULL DEFAULT 1,
  criada INTEGER NOT NULL
);

-- sugestões e bugs do 💬 do app; só o dono lê (não há rota de leitura)
CREATE TABLE IF NOT EXISTS feedback (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  texto  TEXT NOT NULL,
  nome   TEXT,
  idioma TEXT,
  criada INTEGER NOT NULL
);
