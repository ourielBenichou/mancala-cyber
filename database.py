"""Accounts, login sessions, match history, and the owner's controls.

Two places can hold the data:

* Postgres, when the DATABASE_URL environment variable is set. This is what keeps
  accounts alive on Render, because Render wipes the server's own disk every time it
  restarts or redeploys. The database lives somewhere else and is not touched.
* A local SQLite file (mancala.db, tables in schema.sql), when DATABASE_URL is not set.
  This is what you get when you run start.bat on your own computer.

Everything else in the project only calls the functions in this file, so it does not
know or care which one is in use.

The owner account: set OWNER_PASSWORD (and optionally OWNER_USERNAME, default Eliya) in the
server's environment. The password is read from there and never written in the code, so it
does not end up on GitHub. Without OWNER_PASSWORD there is no owner and nobody has admin powers.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
from pathlib import Path

HERE = Path(__file__).parent


def _default_db_path():
    """Where the local SQLite file lives when MANCALA_DB is not set.

    On Windows it goes in %LOCALAPPDATA%, not in the project folder: that folder is often
    inside OneDrive, and OneDrive syncing a database file while it is being written can corrupt it.
    Hosts (Docker sets MANCALA_DB, Render uses Postgres) are not affected by this."""
    base = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and base:
        return Path(base) / "mancala-cyber" / "mancala.db"
    return HERE / "mancala.db"


DB_PATH = Path(os.environ.get("MANCALA_DB", str(_default_db_path())))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_PG = DATABASE_URL != ""

OWNER_USERNAME = os.environ.get("OWNER_USERNAME", "Eliya").strip() or "Eliya"
OWNER_PASSWORD = os.environ.get("OWNER_PASSWORD", "")
OWNER_ENABLED = OWNER_PASSWORD != ""

if USE_PG:
    import psycopg
    from psycopg.rows import dict_row
    INTEGRITY_ERRORS = (psycopg.IntegrityError,)
    # The hosted database closes idle connections (Neon does after a few minutes).
    CONNECTION_ERRORS = (psycopg.OperationalError, psycopg.InterfaceError)
else:
    INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
    CONNECTION_ERRORS = ()

# The same three tables as schema.sql, in Postgres spelling. Dates are kept as text in
# the same "YYYY-MM-DD HH:MM:SS" form SQLite uses, so the page shows them the same way.
_NOW = "(to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))"
PG_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        salt          TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT %s,
        blocked       INTEGER NOT NULL DEFAULT 0
    )""" % _NOW,
    # Alex and alex count as the same name, like COLLATE NOCASE does in SQLite.
    "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))",
    """CREATE TABLE IF NOT EXISTS games (
        id           SERIAL PRIMARY KEY,
        player_a_id  INTEGER NOT NULL REFERENCES users(id),
        player_b_id  INTEGER NOT NULL REFERENCES users(id),
        score_a      INTEGER NOT NULL,
        score_b      INTEGER NOT NULL,
        result       TEXT NOT NULL CHECK (result IN ('A', 'B', 'draw')),
        played_at    TEXT NOT NULL DEFAULT %s
    )""" % _NOW,
    """CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT %s
    )""" % _NOW,
]
# For a database that was created before a column existed (CREATE TABLE IF NOT EXISTS
# does not change a table that is already there).
PG_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0",
]

_lock = threading.Lock()
_conn = None
_announced = False


class AuthError(Exception):
    pass


def connect():
    """Open the database the first time, create the tables if they are missing."""
    global _conn, _announced
    if _conn is None:
        if USE_PG:
            # autocommit: every statement here is a single, complete change, so there is
            # no need to keep a transaction open between requests.
            _conn = psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=15,
                                    autocommit=True)
            for statement in PG_SCHEMA + PG_MIGRATIONS:
                _conn.execute(statement)
            kind = "Postgres (accounts survive restarts)"
        else:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
            columns = [row[1] for row in _conn.execute("PRAGMA table_info(users)")]
            if "blocked" not in columns:
                _conn.execute("ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0")
            _conn.commit()
            kind = "SQLite file %s" % DB_PATH
        if not _announced:
            print("Database: %s" % kind, flush=True)
            _announced = True
    return _conn


def _drop_connection():
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None


def _execute(sql, params=(), result=None, commit=False):
    """Run one statement and hand back what the caller asked for.

    Write the SQL with ? for values; it is converted to %s for Postgres.
    result: None (nothing), "one" (one row or None), "all" (a list of rows),
            or "id" (the id of the row that was just inserted).
    If a hosted database dropped the connection while the server was idle, the
    connection is reopened and the statement is tried once more.
    """
    with _lock:
        for attempt in (1, 2):
            try:
                db = connect()
                text = sql
                if USE_PG:
                    text = sql.replace("?", "%s")
                    if result == "id":
                        text += " RETURNING id"
                cur = db.execute(text, tuple(params))
                if result == "one":
                    out = cur.fetchone()
                elif result == "all":
                    out = cur.fetchall()
                elif result == "id":
                    out = cur.fetchone()["id"] if USE_PG else cur.lastrowid
                else:
                    out = None
                if commit:
                    db.commit()
                return out
            except CONNECTION_ERRORS:
                _drop_connection()
                if attempt == 2:
                    raise
            except Exception:
                if _conn is not None:
                    try:
                        _conn.rollback()
                    except Exception:
                        pass
                raise


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120000).hex()


def _check_username(username):
    username = str(username or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", username):
        raise AuthError("Username must be 3 to 20 letters, numbers, or _")
    return username


def _check_password(password):
    password = str(password or "")
    if len(password) < 4:
        raise AuthError("Password must be at least 4 characters")
    return password


def is_owner(username):
    """True only for the owner's username, and only when an owner password is configured."""
    return OWNER_ENABLED and str(username or "").lower() == OWNER_USERNAME.lower()


def _user(row):
    return {"id": row["id"], "username": row["username"], "is_owner": is_owner(row["username"])}


def ensure_owner():
    """Create the owner account, or reset it to the configured password.

    Runs every time the server starts. If someone already registered the owner's
    username before the owner password was set, that account is taken over: its
    password is replaced and its logins are ended."""
    if not OWNER_ENABLED:
        print("Owner account: off (set OWNER_PASSWORD to turn it on)", flush=True)
        return
    username = _check_username(OWNER_USERNAME)
    password = _check_password(OWNER_PASSWORD)
    row = _execute(
        "SELECT id, password_hash, salt FROM users WHERE lower(username) = lower(?)",
        (username,), result="one",
    )
    if row is None:
        salt = secrets.token_hex(16)
        _execute(
            "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
            (username, _hash(password, salt), salt), commit=True,
        )
        print("Owner account: created '%s'" % username, flush=True)
        return
    if not hmac.compare_digest(_hash(password, row["salt"]), row["password_hash"]):
        salt = secrets.token_hex(16)
        _execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (_hash(password, salt), salt, row["id"]), commit=True,
        )
        _execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],), commit=True)
        print("Owner account: password updated for '%s'" % username, flush=True)
    else:
        print("Owner account: ready ('%s')" % username, flush=True)
    _execute("UPDATE users SET username = ?, blocked = 0 WHERE id = ?", (username, row["id"]), commit=True)


def register(username, password):
    username = _check_username(username)
    password = _check_password(password)
    salt = secrets.token_hex(16)
    try:
        user_id = _execute(
            "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
            (username, _hash(password, salt), salt),
            result="id", commit=True,
        )
    except INTEGRITY_ERRORS:
        raise AuthError("That username is already taken")
    return _open_session(user_id)


def login(username, password):
    username = _check_username(username)
    password = _check_password(password)
    row = _execute(
        "SELECT id, password_hash, salt, blocked FROM users WHERE lower(username) = lower(?)",
        (username,), result="one",
    )
    if row is None or not hmac.compare_digest(_hash(password, row["salt"]), row["password_hash"]):
        raise AuthError("Wrong username or password")
    if row["blocked"]:                      # said only after the password is right
        raise AuthError("This account has been blocked")
    return _open_session(row["id"])


def logout(token):
    _execute("DELETE FROM sessions WHERE token = ?", (str(token or ""),), commit=True)


def _open_session(user_id):
    token = secrets.token_hex(16)
    _execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id), commit=True)
    return token, user_by_id(user_id)


def user_for_token(token):
    if not token:
        return None
    row = _execute(
        """SELECT users.id, users.username
           FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.token = ? AND users.blocked = 0""",
        (str(token),), result="one",
    )
    if row is None:
        return None
    return _user(row)


def user_by_id(user_id):
    row = _execute("SELECT id, username FROM users WHERE id = ?", (user_id,), result="one")
    return _user(row)


def record_game(player_a_id, player_b_id, score_a, score_b):
    if score_a > score_b:
        result = "A"
    elif score_b > score_a:
        result = "B"
    else:
        result = "draw"
    _execute(
        """INSERT INTO games (player_a_id, player_b_id, score_a, score_b, result)
           VALUES (?, ?, ?, ?, ?)""",
        (player_a_id, player_b_id, score_a, score_b, result), commit=True,
    )
    return result


# ---------- games against the computer ----------
# The computer gets one hidden account per difficulty, so a game against it fits the same
# games table (and shows up in the history as "Computer (Hard)"). Nobody can log in as it:
# the names contain spaces and brackets, which register and login never accept.
COMPUTER_LEVELS = {
    "easy": "Computer (Easy)",
    "medium": "Computer (Medium)",
    "hard": "Computer (Hard)",
}


def _computer_id(level):
    name = COMPUTER_LEVELS[level]
    row = _execute("SELECT id FROM users WHERE username = ?", (name,), result="one")
    if row is not None:
        return row["id"]
    try:
        return _execute(
            "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
            (name, "no-login", secrets.token_hex(16)), result="id", commit=True,
        )
    except INTEGRITY_ERRORS:                       # two games finished at the same moment
        return _execute("SELECT id FROM users WHERE username = ?", (name,), result="one")["id"]


def record_computer_game(user_id, level, player_score, computer_score):
    """A finished game against the computer. The player is A, the computer is B."""
    return record_game(user_id, _computer_id(level), player_score, computer_score)


def summary(user_id):
    """Wins, losses, draws, and each past game, from this player's point of view."""
    rows = _execute(
        """SELECT games.played_at, games.score_a, games.score_b, games.result,
                  a.username AS name_a, b.username AS name_b, games.player_a_id
           FROM games
           JOIN users a ON a.id = games.player_a_id
           JOIN users b ON b.id = games.player_b_id
           WHERE games.player_a_id = ? OR games.player_b_id = ?
           ORDER BY games.id DESC""",
        (user_id, user_id), result="all",
    )
    wins = losses = draws = 0
    games = []
    for row in rows:
        mine = row["player_a_id"] == user_id
        opponent = row["name_b"] if mine else row["name_a"]
        my_score = row["score_a"] if mine else row["score_b"]
        opp_score = row["score_b"] if mine else row["score_a"]
        if row["result"] == "draw":
            outcome = "draw"
            draws += 1
        elif (row["result"] == "A" and mine) or (row["result"] == "B" and not mine):
            outcome = "win"
            wins += 1
        else:
            outcome = "loss"
            losses += 1
        games.append({
            "played_at": row["played_at"],
            "opponent": opponent,
            "outcome": outcome,
            "my_score": my_score,
            "opp_score": opp_score,
        })
    return {"wins": wins, "losses": losses, "draws": draws, "games": games}


# ---------- the owner's controls (server.py checks that the caller is the owner) ----------

def get_user(user_id):
    row = _execute("SELECT id, username FROM users WHERE id = ?", (user_id,), result="one")
    return None if row is None else _user(row)


def list_users():
    """Every account, with its record and whether it is blocked."""
    rows = _execute(
        """SELECT u.id, u.username, u.created_at, u.blocked,
                  (SELECT COUNT(*) FROM games g
                    WHERE (g.player_a_id = u.id AND g.result = 'A')
                       OR (g.player_b_id = u.id AND g.result = 'B')) AS wins,
                  (SELECT COUNT(*) FROM games g
                    WHERE (g.player_a_id = u.id AND g.result = 'B')
                       OR (g.player_b_id = u.id AND g.result = 'A')) AS losses,
                  (SELECT COUNT(*) FROM games g
                    WHERE (g.player_a_id = u.id OR g.player_b_id = u.id)
                      AND g.result = 'draw') AS draws
           FROM users u
           WHERE u.username NOT IN (?, ?, ?)
           ORDER BY u.id""",
        tuple(COMPUTER_LEVELS.values()), result="all",
    )
    return [{
        "id": row["id"],
        "username": row["username"],
        "joined": row["created_at"],
        "blocked": bool(row["blocked"]),
        "is_owner": is_owner(row["username"]),
        "wins": int(row["wins"]),
        "losses": int(row["losses"]),
        "draws": int(row["draws"]),
    } for row in rows]


def recent_games(limit=200):
    """The latest finished games between all players, newest first."""
    rows = _execute(
        """SELECT games.id, games.played_at, games.score_a, games.score_b, games.result,
                  a.username AS name_a, b.username AS name_b
           FROM games
           JOIN users a ON a.id = games.player_a_id
           JOIN users b ON b.id = games.player_b_id
           ORDER BY games.id DESC
           LIMIT %d""" % int(limit),
        result="all",
    )
    return [{
        "id": row["id"],
        "played_at": row["played_at"],
        "player_a": row["name_a"],
        "player_b": row["name_b"],
        "score_a": row["score_a"],
        "score_b": row["score_b"],
        "result": row["result"],
    } for row in rows]


def set_blocked(user_id, blocked):
    """Block or unblock a player. Blocking also ends all of their logins."""
    _execute("UPDATE users SET blocked = ? WHERE id = ?", (1 if blocked else 0, user_id), commit=True)
    if blocked:
        _execute("DELETE FROM sessions WHERE user_id = ?", (user_id,), commit=True)


def delete_user(user_id):
    """Delete an account, its logins, and every game it played (that game also
    disappears from the other player's history, because it needs both players)."""
    _execute("DELETE FROM sessions WHERE user_id = ?", (user_id,), commit=True)
    _execute("DELETE FROM games WHERE player_a_id = ? OR player_b_id = ?", (user_id, user_id), commit=True)
    _execute("DELETE FROM users WHERE id = ?", (user_id,), commit=True)
