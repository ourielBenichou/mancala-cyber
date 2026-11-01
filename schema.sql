-- Players. username is unique, including different capital letters (Alex and alex).
-- The password itself is not stored. password_hash is a check value made from it.

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One finished match. result is A, B, or draw.
CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY,
    player_a_id  INTEGER NOT NULL REFERENCES users(id),
    player_b_id  INTEGER NOT NULL REFERENCES users(id),
    score_a      INTEGER NOT NULL,
    score_b      INTEGER NOT NULL,
    result       TEXT NOT NULL CHECK (result IN ('A', 'B', 'draw')),
    played_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Login stays valid after the page is closed, until the player logs out.
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
