"""Accounts, login sessions, and match history.

Two places can hold the data:

* Postgres, when the DATABASE_URL environment variable is set. This is what keeps
  accounts alive on Render, because Render wipes the server's own disk every time it
  restarts or redeploys. The database lives somewhere else and is not touched.
* A local SQLite file (mancala.db, tables in schema.sql), when DATABASE_URL is not set.
  This is what you get when you run start.bat on your own computer.

Everything else in the project only calls the functions in this file, so it does not
know or care which one is in use.
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
DB_PATH = Path(os.environ.get("MANCALA_DB", str(HERE / "mancala.db")))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_PG = DATABASE_URL != ""

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
        created_at    TEXT NOT NULL DEFAULT %s
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
            for statement in PG_SCHEMA:
                _conn.execute(statement)
            kind = "Postgres (accounts survive restarts)"
        else:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
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
        "SELECT id, password_hash, salt FROM users WHERE lower(username) = lower(?)",
        (username,), result="one",
    )
    if row is None or not hmac.compare_digest(_hash(password, row["salt"]), row["password_hash"]):
        raise AuthError("Wrong username or password")
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
           WHERE sessions.token = ?""",
        (str(token),), result="one",
    )
    if row is None:
        return None
    return {"id": row["id"], "username": row["username"]}


def user_by_id(user_id):
    row = _execute("SELECT id, username FROM users WHERE id = ?", (user_id,), result="one")
    return {"id": row["id"], "username": row["username"]}


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
