"""Mancala server: serves the game page and connects two players over a WebSocket.

Install:  py -3 -m pip install fastapi "uvicorn[standard]"
Run:      py -3 server.py
Folder:   server.py next to a folder called "static" that holds index.html,
          Mancala_game.js, online.js and the images.

Same-Wi-Fi play uses http://<this computer's address>:8000.
This network blocks Cloudflare's tunnel port, so other computers use a
free temporary link (https://....free.pinggy.net) instead. No domain to buy.
That link lasts about an hour and dies when this program stops.
"""
import atexit
import os
import random
import re
import socket
import string
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import database
import uvicorn
from fastapi import FastAPI, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

PORT = 8000
PUBLIC_URL = None          # https link other computers can open, once the tunnel is up
SHARE_NOTE = ""            # shown on the page next to the link
tunnel_proc = None
STORE_A, STORE_B = 13, 6
START = [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]

# ---------- the same rules as Mancala_game.js ----------


def legal_moves(b, player):
    start = 7 if player == 0 else 0
    return [p for p in range(start, start + 6) if b[p] > 0]


def apply_move(b, player, pit):
    nb = b[:]                                   # copy, so the old board is untouched
    my_store = STORE_A if player == 0 else STORE_B
    opp_store = STORE_B if player == 0 else STORE_A
    stones, pos = nb[pit], pit
    nb[pit] = 0
    while stones > 0:
        pos = (pos + 1) % 14
        if pos == opp_store:                    # never drop a stone in the opponent's store
            continue
        nb[pos] += 1
        stones -= 1
    extra = pos == my_store
    if not extra:
        own_pit = (7 <= pos <= 12) if player == 0 else (0 <= pos <= 5)
        if own_pit and nb[pos] == 1:            # landed on an empty pit of your own side
            nb[my_store] += nb[12 - pos] + 1
            nb[12 - pos] = 0
            nb[pos] = 0
    return nb, extra


def next_player(b, player, extra):
    nxt = player if extra else 1 - player
    if not legal_moves(b, nxt):                 # a player with no stones is skipped
        nxt = 1 - nxt
    return nxt


def is_over(b):
    return b[STORE_A] > 24 or b[STORE_B] > 24 or (b[STORE_A] == 24 and b[STORE_B] == 24)


# ---------- rooms ----------

rooms = {}   # code -> room dict: board, sockets, user ids, names


def new_code():
    while True:
        code = "".join(random.choices(string.ascii_uppercase, k=4))
        if code not in rooms:
            return code


async def send(ws, message):
    try:
        await ws.send_json(message)
    except Exception:
        pass                                    # that player has probably disconnected


def outcome(board):
    if board[STORE_A] > board[STORE_B]:
        return "A"
    if board[STORE_B] > board[STORE_A]:
        return "B"
    return "draw"


def remember_game(room):
    """Write a finished match once. Both players must be logged in."""
    if room["recorded"] or not is_over(room["board"]) or None in room["user_ids"]:
        return
    database.record_game(
        room["user_ids"][0], room["user_ids"][1],
        room["board"][STORE_A], room["board"][STORE_B],
    )
    room["recorded"] = True


async def broadcast_state(room):
    remember_game(room)
    board = room["board"]
    over = is_over(board)
    message = {
        "type": "state",
        "board": board,
        "current": room["current"],
        "names": room["names"],
        "over": over,
        "result": outcome(board) if over else None,
    }
    for ws in room["players"]:
        if ws is not None:
            await send(ws, message)


# ---------- the web app ----------

app = FastAPI()
# So double-clicking static/index.html can still talk to this server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def game_socket(ws: WebSocket):
    await ws.accept()
    room, me = None, None                       # which room this connection is in, and as A (0) or B (1)
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")

            if kind == "join" and room is None:
                user = database.user_for_token(msg.get("token"))
                if user is None:
                    await send(ws, {"type": "error", "message": "Log in first"})
                    continue
                code = str(msg.get("room") or "").strip().upper()
                if code == "":                  # empty code = create a new room, you are A
                    code = new_code()
                    room = {
                        "code": code, "board": START[:], "current": 0,
                        "players": [ws, None], "user_ids": [user["id"], None],
                        "names": [user["username"], None], "recorded": False,
                    }
                    rooms[code] = room
                    me = 0
                else:                           # otherwise join an existing room as B
                    found = rooms.get(code)
                    if found is None or found["players"][1] is not None:
                        await send(ws, {"type": "error", "message": "Room not found or already full"})
                        continue
                    if found["user_ids"][0] == user["id"]:
                        await send(ws, {"type": "error", "message": "That account is already in this room"})
                        continue
                    found["players"][1] = ws
                    found["user_ids"][1] = user["id"]
                    found["names"][1] = user["username"]
                    room, me = found, 1
                await send(ws, {"type": "joined", "room": room["code"], "you": me, "name": user["username"]})
                if room["players"][1] is not None:      # both players are here: start
                    await broadcast_state(room)

            elif kind == "move" and room is not None and room["players"][1] is not None:
                board, pit = room["board"], msg.get("pit")
                if is_over(board) or me != room["current"] or pit not in legal_moves(board, me):
                    await send(ws, {"type": "error", "message": "Illegal move"})
                    continue
                room["board"], extra = apply_move(board, me, pit)
                room["current"] = next_player(room["board"], me, extra)
                await broadcast_state(room)

            elif kind == "restart" and room is not None and room["players"][1] is not None:
                if is_over(room["board"]):
                    remember_game(room)
                    room["board"], room["current"] = START[:], 0
                    room["recorded"] = False
                    await broadcast_state(room)
    except WebSocketDisconnect:
        pass
    finally:                                    # this player left: tell the other one, close the room
        if room is not None:
            other = room["players"][1 - me]
            if other is not None:
                await send(other, {"type": "left"})
            rooms.pop(room["code"], None)


def bearer_user(authorization: str = Header(default="")):
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    return database.user_for_token(token)


def account_payload(user, token=None):
    body = {"username": user["username"], "is_owner": bool(user.get("is_owner"))}
    body.update(database.summary(user["id"]))
    if token:
        body["token"] = token
    return body


@app.post("/api/register")
def api_register(body: dict):
    try:
        token, user = database.register(body.get("username"), body.get("password"))
    except database.AuthError as error:
        return JSONResponse({"message": str(error)}, status_code=400)
    return account_payload(user, token)


@app.post("/api/login")
def api_login(body: dict):
    try:
        token, user = database.login(body.get("username"), body.get("password"))
    except database.AuthError as error:
        return JSONResponse({"message": str(error)}, status_code=400)
    return account_payload(user, token)


@app.post("/api/logout")
def api_logout(authorization: str = Header(default="")):
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    database.logout(token)
    return {"ok": True}


@app.get("/api/me")
def api_me(authorization: str = Header(default="")):
    user = bearer_user(authorization)
    if user is None:
        return JSONResponse({"message": "Log in first"}, status_code=401)
    return account_payload(user)


# ---------- games against the computer ----------
# The computer plays in the browser, so the browser reports the game when it ends. The server
# does not take the browser's word for the score: it replays the moves with the real rules,
# and only saves a game that followed them and really finished.

last_computer_game = {}     # user id -> moves of the game saved last, so one game is not saved twice


@app.post("/api/computer-game")
def api_computer_game(body: dict, authorization: str = Header(default="")):
    user = bearer_user(authorization)
    if user is None:
        return JSONResponse({"message": "Log in first"}, status_code=401)
    level = body.get("level")
    moves = body.get("moves")
    if (level not in database.COMPUTER_LEVELS or not isinstance(moves, list) or len(moves) > 300
            or not all(type(pit) is int for pit in moves)):
        return JSONResponse({"message": "That is not a game"}, status_code=400)

    board, player = START[:], 0                 # the person is A and starts; the computer is B
    for pit in moves:
        if is_over(board) or pit not in legal_moves(board, player):
            return JSONResponse({"message": "That game did not follow the rules"}, status_code=400)
        board, extra = apply_move(board, player, pit)
        player = next_player(board, player, extra)
    if not is_over(board):
        return JSONResponse({"message": "That game is not finished"}, status_code=400)

    if last_computer_game.get(user["id"]) == moves:
        return {"saved": False}
    result = database.record_computer_game(user["id"], level, board[STORE_A], board[STORE_B])
    last_computer_game[user["id"]] = moves
    return {"saved": True, "result": result}


# ---------- owner only ----------

def owner_or_error(authorization):
    """Returns (owner, None) for the owner, or (None, an error response) for anybody else."""
    user = bearer_user(authorization)
    if user is None:
        return None, JSONResponse({"message": "Log in first"}, status_code=401)
    if not user.get("is_owner"):
        return None, JSONResponse({"message": "Owner only"}, status_code=403)
    return user, None


async def kick_user(user_id, text):
    """Remove a player from any live game. Closing their connection runs the same
    clean-up as leaving: the other player is told, and the room is deleted."""
    for room in list(rooms.values()):
        for seat in (0, 1):
            socket_ = room["players"][seat]
            if socket_ is not None and room["user_ids"][seat] == user_id:
                await send(socket_, {"type": "kicked", "message": text})
                try:
                    await socket_.close()
                except Exception:
                    pass


@app.get("/api/admin/users")
def api_admin_users(authorization: str = Header(default="")):
    owner, error = owner_or_error(authorization)
    if error:
        return error
    return {"users": database.list_users()}


@app.get("/api/admin/users/{user_id}/games")
def api_admin_user_games(user_id: int, authorization: str = Header(default="")):
    owner, error = owner_or_error(authorization)
    if error:
        return error
    target = database.get_user(user_id)
    if target is None:
        return JSONResponse({"message": "No such user"}, status_code=404)
    body = database.summary(user_id)
    body["username"] = target["username"]
    return body


@app.get("/api/admin/games")
def api_admin_games(authorization: str = Header(default="")):
    owner, error = owner_or_error(authorization)
    if error:
        return error
    return {"games": database.recent_games()}


@app.post("/api/admin/users/{user_id}/block")
async def api_admin_block(user_id: int, body: dict, authorization: str = Header(default="")):
    owner, error = owner_or_error(authorization)
    if error:
        return error
    target = database.get_user(user_id)
    if target is None:
        return JSONResponse({"message": "No such user"}, status_code=404)
    if target["is_owner"]:
        return JSONResponse({"message": "The owner account cannot be blocked"}, status_code=400)
    blocked = bool(body.get("blocked"))
    database.set_blocked(user_id, blocked)
    if blocked:
        await kick_user(user_id, "The owner blocked this account.")
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}")
async def api_admin_delete(user_id: int, authorization: str = Header(default="")):
    owner, error = owner_or_error(authorization)
    if error:
        return error
    target = database.get_user(user_id)
    if target is None:
        return JSONResponse({"message": "No such user"}, status_code=404)
    if target["is_owner"]:
        return JSONResponse({"message": "The owner account cannot be deleted"}, status_code=400)
    await kick_user(user_id, "The owner removed this account.")
    database.delete_user(user_id)
    return {"ok": True}


def public_host_url():
    """The address both players should open when this server is hosted online."""
    if os.environ.get("RENDER_EXTERNAL_URL"):
        return os.environ["RENDER_EXTERNAL_URL"].rstrip("/")
    if os.environ.get("FLY_APP_NAME"):
        return "https://%s.fly.dev" % os.environ["FLY_APP_NAME"]
    return None


@app.get("/api/info")
def api_info():
    # The page reads this so the host can copy a link that actually works
    # for the other computer, even if they opened http://127.0.0.1:8000.
    hosted = public_host_url()
    if hosted:
        return JSONResponse(
            {
                "lan": None,
                "public": hosted,
                "note": "Both players open this link.",
            },
            headers={"Cache-Control": "no-store"},
        )
    ips = [ip for ip in lan_ips() if not ip.startswith("127.")]
    return JSONResponse(
        {
            "lan": ("http://%s:%d" % (ips[0], PORT)) if ips else None,
            "public": PUBLIC_URL,
            "note": SHARE_NOTE,
        },
        headers={"Cache-Control": "no-store"},
    )


# Must come AFTER the /ws and /api/info routes, because it matches every other path.
class FreshStaticFiles(StaticFiles):
    """Same as StaticFiles, but tells the browser to re-check the files on every visit.

    Without this a browser may keep showing an old copy of the page after an update. "no-cache" does
    not mean "never store": the browser still asks the server, and gets a tiny 'not modified'
    answer when the file is unchanged."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", FreshStaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")


def lan_ips():
    """IPv4 addresses other computers on this network could try. Skips
    169.254 link-local adapters, which look like real addresses but are not."""
    found = []

    def add(ip):
        if ip and not ip.startswith("169.254.") and ip not in found:
            found.append(ip)

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))        # no data is sent; this just picks the wifi address
        add(s.getsockname()[0])
    except Exception:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except Exception:
        pass
    return found or ["127.0.0.1"]


def allow_windows_firewall():
    """Let other computers reach port 8000. Does nothing if the rule is already
    there, and does nothing if Windows refuses (no administrator)."""
    if os.name != "nt":
        return
    probe = subprocess.run(
        ["netsh", "advfirewall", "firewall", "show", "rule", "name=Mancala"],
        capture_output=True, text=True,
    )
    if probe.returncode == 0 and "8000" in (probe.stdout or ""):
        return
    subprocess.run(
        ["netsh", "advfirewall", "firewall", "add", "rule",
         "name=Mancala", "dir=in", "action=allow", "protocol=TCP",
         "localport=%d" % PORT, "profile=any"],
        capture_output=True, text=True,
    )


def _askpass_env():
    """ssh needs a password program even though Pinggy accepts an empty password."""
    folder = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "mancala-cyber"
    folder.mkdir(parents=True, exist_ok=True)
    ask = folder / "askpass.cmd"
    ask.write_text("@echo off\r\necho.\r\n", encoding="ascii")
    env = os.environ.copy()
    env["SSH_ASKPASS"] = str(ask)
    env["SSH_ASKPASS_REQUIRE"] = "force"
    env["DISPLAY"] = "1"
    return env


def _remember_public_url(line):
    global PUBLIC_URL, SHARE_NOTE
    match = re.search(r"https://[0-9a-zA-Z.-]+\.free\.pinggy\.net", line)
    if match and PUBLIC_URL is None:
        PUBLIC_URL = match.group(0)
        SHARE_NOTE = (
            "Both players must open this same link, then click Continue on the Caution page. "
            "The link lasts about an hour. On this Wi-Fi, computers usually cannot open the 10.x address."
        )
        print("Other computers open:  %s" % PUBLIC_URL, flush=True)
        print(SHARE_NOTE, flush=True)


tunnel_stop = False
tunnel_started = 0.0     # when the current tunnel process was launched


def _public_link_ok():
    if not PUBLIC_URL:
        return True
    try:
        request = urllib.request.Request(PUBLIC_URL, headers={"User-Agent": "mancala-cyber"})
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status < 500
    except Exception:
        return False


def start_public_link():
    """Open a temporary public URL over normal web port 443.
    Cloudflare's own tunnel port is blocked on this network, which is why
    that link showed error 1033."""

    def launch():
        global SHARE_NOTE, tunnel_proc, PUBLIC_URL, tunnel_started
        for _ in range(50):
            try:
                probe = socket.create_connection(("127.0.0.1", PORT), timeout=0.2)
                probe.close()
                break
            except Exception:
                time.sleep(0.2)
        if not shutil_which("ssh"):
            SHARE_NOTE = "OpenSSH is missing, so other computers must use the Wi-Fi address."
            print(SHARE_NOTE, flush=True)
            return

        while not tunnel_stop:
            PUBLIC_URL = None
            tunnel_started = time.time()
            tunnel_proc = subprocess.Popen(
                ["ssh", "-p", "443", "-R0:127.0.0.1:%d" % PORT,
                 "-o", "PreferredAuthentications=password",
                 "-o", "PubkeyAuthentication=no",
                 "-o", "StrictHostKeyChecking=accept-new",
                 "-o", "ServerAliveInterval=30",
                 "-o", "ConnectTimeout=20",
                 "-o", "ExitOnForwardFailure=yes",
                 "free.pinggy.io"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace", env=_askpass_env(),
            )
            for line in tunnel_proc.stdout:
                _remember_public_url(line)
            if tunnel_stop:
                break
            if PUBLIC_URL is None and SHARE_NOTE == "":
                SHARE_NOTE = (
                    "The public link did not start. If the other computer is on this Wi-Fi, "
                    "use the Wi-Fi address above."
                )
                print(SHARE_NOTE, flush=True)
            else:
                print("Public link dropped. Opening a new one...", flush=True)
            time.sleep(2)

    def watch():
        bad = 0
        ticks = 0
        while not tunnel_stop:
            time.sleep(5)
            ticks += 1
            running = tunnel_proc is not None and tunnel_proc.poll() is None
            # A tunnel can connect and then hang before it hands out a link. Restart it
            # instead of waiting forever.
            if PUBLIC_URL is None and running and time.time() - tunnel_started > 45:
                print("The public link is taking too long. Trying again...", flush=True)
                tunnel_proc.terminate()
                continue
            if ticks % 4 != 0:                      # the checks below run every 20 seconds
                continue
            if PUBLIC_URL is None or _public_link_ok():
                bad = 0
                continue
            bad += 1
            if bad >= 2 and running:
                print("The public link stopped answering. Reconnecting...", flush=True)
                tunnel_proc.terminate()
                bad = 0

    threading.Thread(target=launch, daemon=True).start()
    threading.Thread(target=watch, daemon=True).start()


def shutil_which(name):
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(folder) / (name + ".exe")
        if candidate.exists():
            return str(candidate)
    return None


def stop_public_link():
    global tunnel_stop
    tunnel_stop = True
    if tunnel_proc is not None and tunnel_proc.poll() is None:
        tunnel_proc.terminate()


atexit.register(stop_public_link)


if __name__ == "__main__":
    database.connect()
    database.ensure_owner()
    hosted = public_host_url()
    if hosted:
        print("Players open:  %s" % hosted, flush=True)
    else:
        allow_windows_firewall()
        ip = lan_ips()[0]
        print("Players on the same Wi-Fi open:  http://%s:%d" % (ip, PORT), flush=True)
        print("If that address does not open on the other computer, use the link printed below.", flush=True)
        start_public_link()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", PORT)))
