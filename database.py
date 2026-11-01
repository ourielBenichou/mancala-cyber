"""SQLite accounts and match history. The tables are defined in schema.sql."""
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
_lock = threading.Lock()
_conn = None


class AuthError(Exception):
    pass


def connect():
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
        _conn.commit()
    return _conn


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
    with _lock:
        db = connect()
        try:
            cur = db.execute(
                "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
                (username, _hash(password, salt), salt),
            )
            db.commit()
        except sqlite3.IntegrityError:
            db.rollback()
            raise AuthError("That username is already taken")
        user_id = cur.lastrowid
    return _open_session(user_id)


def login(username, password):
    username = _check_username(username)
    password = _check_password(password)
    with _lock:
        row = connect().execute(
            "SELECT id, password_hash, salt FROM users WHERE username = ? COLLATE NOCASE",
            (username,),
        ).fetchone()
    if row is None or not hmac.compare_digest(_hash(password, row["salt"]), row["password_hash"]):
        raise AuthError("Wrong username or password")
    return _open_session(row["id"])


def logout(token):
    with _lock:
        connect().execute("DELETE FROM sessions WHERE token = ?", (str(token or ""),))
        connect().commit()


def _open_session(user_id):
    token = secrets.token_hex(16)
    with _lock:
        db = connect()
        db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        db.commit()
    return token, user_by_id(user_id)


def user_for_token(token):
    if not token:
        return None
    with _lock:
        row = connect().execute(
            """SELECT users.id, users.username
               FROM sessions JOIN users ON users.id = sessions.user_id
               WHERE sessions.token = ?""",
            (str(token),),
        ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "username": row["username"]}


def user_by_id(user_id):
    with _lock:
        row = connect().execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"id": row["id"], "username": row["username"]}


def record_game(player_a_id, player_b_id, score_a, score_b):
    if score_a > score_b:
        result = "A"
    elif score_b > score_a:
        result = "B"
    else:
        result = "draw"
    with _lock:
        db = connect()
        db.execute(
            """INSERT INTO games (player_a_id, player_b_id, score_a, score_b, result)
               VALUES (?, ?, ?, ?, ?)""",
            (player_a_id, player_b_id, score_a, score_b, result),
        )
        db.commit()
    return result


def summary(user_id):
    """Wins, losses, draws, and each past game, from this player's point of view."""
    with _lock:
        rows = connect().execute(
            """SELECT games.played_at, games.score_a, games.score_b, games.result,
                      a.username AS name_a, b.username AS name_b, games.player_a_id
               FROM games
               JOIN users a ON a.id = games.player_a_id
               JOIN users b ON b.id = games.player_b_id
               WHERE games.player_a_id = ? OR games.player_b_id = ?
               ORDER BY games.id DESC""",
            (user_id, user_id),
        ).fetchall()
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
