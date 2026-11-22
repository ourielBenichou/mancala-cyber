// ---------- online play: talks to server.py over a WebSocket ----------
// Load this AFTER Mancala_game.js. The server owns the game; this file only
// sends your clicks and shows the board the server sends back.

var socket = null;
var roomStarted = false;      // true once both players are in the room and a board has arrived
var token = localStorage.getItem("mancalaToken") || "";

// Opening index.html from the folder has no address of its own, so it uses
// the server on this computer. A page opened from a link uses that link.
function api(path) {
    if (location.protocol === "file:") return "http://127.0.0.1:8000" + path;
    return path;
}

function socketURL() {
    if (location.protocol === "file:") return "ws://127.0.0.1:8000/ws";
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws";
}

function sendOnline(obj) {
    socket.send(JSON.stringify(obj));
}

function showStatus(text) {
    var area = document.getElementById("aa");
    area.textContent = "";
    var card = document.createElement("div");
    card.className = "waitCard";
    var heading = document.createElement("h2");
    heading.textContent = text;
    card.appendChild(heading);
    area.appendChild(card);
}

// Shown to the player who created the room, until the other player joins.
function showWaiting(roomCode) {
    var area = document.getElementById("aa");
    area.textContent = "";
    var card = document.createElement("div");
    card.className = "waitCard";
    var heading = document.createElement("h2");
    heading.textContent = "Waiting for your opponent";
    var hint = document.createElement("p");
    hint.textContent = "Send this room code to your friend:";
    var codeBox = document.createElement("div");
    codeBox.className = "waitCode";
    codeBox.textContent = roomCode;
    var after = document.createElement("p");
    after.textContent = "The game starts as soon as they join.";
    card.appendChild(heading);
    card.appendChild(hint);
    card.appendChild(codeBox);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        var copy = document.createElement("button");
        copy.type = "button";
        copy.className = "ghost";
        copy.textContent = "Copy code";
        copy.onclick = function () {
            navigator.clipboard.writeText(roomCode).then(function () {
                copy.textContent = "Copied!";
            }, function () {
                copy.textContent = "Copy failed";
            });
        };
        card.appendChild(copy);
    }
    card.appendChild(after);
    var leave = document.createElement("button");
    leave.type = "button";
    leave.className = "ghost";
    leave.textContent = "Leave room";
    leave.onclick = leaveRoom;
    card.appendChild(leave);
    var rules = document.createElement("button");
    rules.type = "button";
    rules.className = "ghost";
    rules.textContent = "Rules";
    rules.onclick = ShowRules;
    card.appendChild(rules);
    area.appendChild(card);
}

// What the start screen looked like before anything replaced it.
var startScreenHtml = gameDiv.innerHTML;

// Give up on a room nobody joined. Closing the socket makes the server delete the
// room, so its code is free again. Then the page goes back to its start screen.
function leaveRoom() {
    var old = socket;
    socket = null;
    online = false;
    roomStarted = false;
    cancelAnimation();
    onlineNames = null;
    if (old) old.close();
    myPlayer = 0;
    torA.textContent = "Player A's turn";
    torB.textContent = "Player B's turn";
    torA.style.display = "none";
    torB.style.display = "none";
    modeBtn.style.display = "";
    updateModeButton();                           // the label and the difficulty button match the mode again
    onlineBtn.style.display = "";
    gameDiv.innerHTML = startScreenHtml;
}

// The "Play online" popup: create a new room, or join a friend's room by code.
function startOnline() {
    if (!token) {
        openModal({
            title: "Log in first",
            body: "Create an account or log in before playing online. Each player needs their own username, and you can do it in the box at the top of the page.",
            buttons: [{ label: "OK", kind: "Start" }]
        });
        return;
    }
    openLobby("");
}

function openLobby(note) {
    var body = [];
    body.push(modalNode("p", "Play a friend on another device. One of you creates a room and shares the code, and the other one joins with it."));

    var label = modalNode("p", "Have a code from a friend?", "sub");
    var input = document.createElement("input");
    input.className = "code";
    input.maxLength = 4;
    input.placeholder = "CODE";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Room code");
    input.oninput = function () { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, ""); };
    body.push(label, input);
    if (note) body.push(modalNode("p", note, "sub"));

    function join() {
        var code = input.value.trim();
        if (code.length === 0) {
            label.textContent = "Type your friend's room code first.";
            input.focus();
            return false;
        }
        connectOnline(code);
    }
    input.onkeydown = function (event) {
        if (event.key === "Enter") { event.preventDefault(); document.getElementById("modalActions").lastChild.click(); }
    };

    openModal({
        title: "Play online",
        body: body,
        buttons: [
            { label: "Cancel", kind: "ghost" },
            { label: "Create a new room", kind: "ghost", onClick: function () { connectOnline(""); } },
            { label: "Join room", kind: "Start", onClick: join }
        ],
        focus: input
    });
}

// Opens the connection. An empty code asks the server for a brand new room.
function connectOnline(code) {
    var url = socketURL();
    if (socket) socket.close();
    var mine = new WebSocket(url);
    socket = mine;
    mine.onopen = function () {
        sendOnline({ type: "join", room: code.trim(), token: token });
        // A quiet ping so the connection stays up while someone is thinking.
        mine._keep = setInterval(function () {
            if (mine.readyState === 1) sendOnline({ type: "ping" });
        }, 25000);
    };
    mine.onmessage = onServerMessage;
    mine.onerror = function () {
        if (socket !== mine || online) return;
        openModal({
            title: "Can't reach the game server",
            body: "The connection failed. If you are running the game on your own computer, start it with start.bat and try again.",
            buttons: [
                { label: "Close", kind: "ghost" },
                { label: "Try again", kind: "Start", onClick: function () { openLobby(""); } }
            ]
        });
    };
    mine.onclose = function () {
        if (mine._keep) clearInterval(mine._keep);
        if (socket === mine && online) showStatus("Connection lost. Reload the page.");
    };
}

// A new board from the server. If it came from a move, the stones are shown travelling first.
function showState(msg) {
    var hadBoard = roomStarted && board.length === 14 && !gameOver;     // there is an earlier board to move from
    roomStarted = true;
    if (msg.names) {
        onlineNames = msg.names;
        torA.textContent = "Player A: " + (msg.names[0] || "") + (myPlayer === 0 ? " (you)" : "");
        torB.textContent = "Player B: " + (msg.names[1] || "") + (myPlayer === 1 ? " (you)" : "");
    }
    torA.style.display = "block";
    torB.style.display = "block";

    function apply() {
        board = msg.board;
        current = msg.current;
        gameOver = false;
        draw.className = "Win";                       // hide old result overlays;
        winA.className = "Win";                       // refresh() shows the right one again
        winB.className = "Win";
        refresh();
        if (msg.over) loadAccount();
    }

    var last = msg.last;
    if (last && hadBoard && typeof last.pit === "number" && (last.player === 0 || last.player === 1)) {
        animateMove(board.slice(), last.player, last.pit, msg.board, apply);
    } else {
        lastMove = null;
        apply();
    }
}

function onServerMessage(event) {
    var msg = JSON.parse(event.data);
    if (msg.type === "joined") {
        online = true;
        roomStarted = false;
        vsComputer = false;
        myPlayer = msg.you;
        modeBtn.style.display = "none";
        updateDifficultyButton();                 // hides the difficulty button too
        onlineBtn.style.display = "none";
        torA.textContent = "Player A's turn" + (myPlayer === 0 ? " (you)" : "");
        torB.textContent = "Player B's turn" + (myPlayer === 1 ? " (you)" : "");
        if (myPlayer === 0) showWaiting(msg.room);
        else showStatus("Joined room " + msg.room);
    } else if (msg.type === "state") {
        afterAnimation(function () { showState(msg); });      // a board that arrives mid-animation waits its turn
    } else if (msg.type === "kicked") {                 // the owner blocked or removed this account
        leaveRoom();
        token = "";
        localStorage.removeItem("mancalaToken");
        showAccount(null);
        showMessage("Removed from the game", msg.message || "The owner removed you from the game.");
    } else if (msg.type === "left") {
        cancelAnimation();
        gameOver = true;
        showStatus("The other player left. Reload the page to start again.");
    } else if (msg.type === "error") {
        if (!online) {                                // could not get into a room
            openModal({
                title: "Couldn't join",
                body: msg.message,
                buttons: [
                    { label: "Close", kind: "ghost" },
                    { label: "Try again", kind: "Start", onClick: function () { openLobby(""); } }
                ]
            });
        } else {
            showMessage("Can't do that", msg.message);
        }
    }
}

var onlineBtn = document.createElement("button");
onlineBtn.className = "Start";
onlineBtn.textContent = "Play online (2 devices)";
onlineBtn.onclick = startOnline;
gameDiv.parentNode.insertBefore(onlineBtn, gameDiv);

// The address other computers should open. School Wi-Fi blocks the plain
// 10.x link, so the server also publishes a public one.
var joinBox = document.createElement("p");
joinBox.className = "welcome";
document.querySelector("main").parentNode.insertBefore(joinBox, document.querySelector("main"));

function addJoinLine(label, url) {
    var line = document.createElement("div");
    line.appendChild(document.createTextNode(label));
    var link = document.createElement("a");
    link.href = url;
    link.textContent = url;
    link.style.color = "#f0c05a";
    line.appendChild(link);
    joinBox.appendChild(line);
}

function showJoinInfo(tries) {
    fetch(api("/api/info")).then(function (r) { return r.json(); }).then(function (info) {
        joinBox.textContent = "";
        // On a hosted server (like Render) the address is the page you are already on,
        // so there is nothing useful to say here.
        var alreadyHere = info.public && !info.lan && info.public.replace(/\/+$/, "") === location.origin;
        joinBox.style.display = alreadyHere ? "none" : "";
        if (alreadyHere) return;
        if (info.public) addJoinLine("Other computers, open: ", info.public);
        if (info.lan) addJoinLine("Same Wi-Fi, open: ", info.lan);
        if (info.note) {
            var note = document.createElement("div");
            note.textContent = info.note;
            joinBox.appendChild(note);
        }
        if (!info.public && tries > 0) {
            var waiting = document.createElement("div");
            waiting.textContent = "Getting a link that works on other computers...";
            joinBox.appendChild(waiting);
            setTimeout(function () { showJoinInfo(tries - 1); }, 1000);
        }
    }).catch(function () {
        joinBox.textContent = "The server is closed. Double-click start.bat, then refresh this page.";
    });
}
showJoinInfo(30);

// ---------- accounts: unique username, password, and past games ----------

var account = document.createElement("div");
account.className = "welcome account";
document.querySelector("main").parentNode.insertBefore(account, document.querySelector("main"));

function authHeaders() {
    var headers = {"Content-Type": "application/json"};
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
}

// Called by Mancala_game.js when a game against the computer ends. The server replays the moves
// to check them and to work out the score, then adds the game to this player's history.
function saveComputerGame(level, moves) {
    if (!token) return;                                 // not logged in: nothing to save
    fetch(api("/api/computer-game"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({level: level, moves: moves})
    }).then(function (r) { if (r.ok) loadAccount(); })   // refresh the record shown at the top
        .catch(function () {});                          // a lost connection must not disturb the game
}

function postAccount(path, username, password) {
    fetch(api(path), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({username: username, password: password})
    }).then(function (r) { return r.json().then(function (body) { return {ok: r.ok, body: body}; }); })
        .then(function (res) {
            if (!res.ok) {
                showMessage("Couldn't log in", res.body.message || "Something went wrong. Please try again.");
                return;
            }
            if (res.body.pending) {                         // a new account: the owner has to say yes first
                showMessage("Waiting for approval", res.body.message);
                return;
            }
            token = res.body.token;
            localStorage.setItem("mancalaToken", token);
            showAccount(res.body);
        })
        .catch(function () {
            showMessage("Can't reach the game server", "If you are running the game on your own computer, start it with start.bat and refresh this page.");
        });
}

// Log out. If you are in an online room, leave it first, so the room does not
// stay open on the server with nobody behind it.
function doLogout() {
    if (online) {
        leaveRoom();
    } else if (socket) {                                // connected but not in a room yet
        var stale = socket;
        socket = null;
        stale.close();
    }
    fetch(api("/api/logout"), {method: "POST", headers: authHeaders()});
    token = "";
    localStorage.removeItem("mancalaToken");
    showAccount(null);
}

// ---------- owner panel: see every player, read their history, block, delete ----------
// The server checks again on every request, so these buttons only work for the owner.

function adminCall(method, path, body) {
    var options = {method: method, headers: authHeaders()};
    if (body !== undefined) options.body = JSON.stringify(body);
    return fetch(api(path), options).then(function (r) {
        return r.json().then(function (data) { return {ok: r.ok, body: data}; });
    });
}

function adminFail(res) {
    showMessage("Owner panel", (res && res.body && res.body.message) || "Something went wrong.");
}

function adminNetworkFail() {
    showMessage("Owner panel", "Could not reach the server.");
}

function outcomeWord(outcome) {
    return outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Draw";
}

function openAdmin() {
    adminCall("GET", "/api/admin/users").then(function (res) {
        if (!res.ok) { adminFail(res); return; }
        var users = res.body.users.slice();
        users.sort(function (a, b) { return (a.approved ? 1 : 0) - (b.approved ? 1 : 0); });   // waiting accounts first (the sort keeps the rest in order)
        var waiting = users.filter(function (user) { return !user.approved; }).length;
        loadAccount();                                  // keeps the "waiting" number on the Owner panel button right
        var table = modalNode("table", null, "adminTable");
        var head = modalNode("tr");
        ["Player", "Record (W-L-D)", "Joined", ""].forEach(function (label) {
            head.appendChild(modalNode("th", label, label === "Joined" ? "joined" : ""));
        });
        table.appendChild(head);

        users.forEach(function (user) {
            var row = modalNode("tr", null, user.blocked ? "isBlocked" : "");
            var nameCell = modalNode("td", null, "name");
            nameCell.appendChild(document.createTextNode(user.username));
            if (user.is_owner) {
                nameCell.appendChild(document.createTextNode(" "));
                nameCell.appendChild(modalNode("span", "owner", "badge owner"));
            }
            if (user.blocked) {
                nameCell.appendChild(document.createTextNode(" "));
                nameCell.appendChild(modalNode("span", "blocked", "badge blocked"));
            }
            if (!user.approved) {
                nameCell.appendChild(document.createTextNode(" "));
                nameCell.appendChild(modalNode("span", "waiting", "badge pending"));
            }
            row.appendChild(nameCell);
            row.appendChild(modalNode("td", user.wins + " - " + user.losses + " - " + user.draws));
            row.appendChild(modalNode("td", String(user.joined || "").slice(0, 10), "joined"));

            var actions = modalNode("td", null, "acts");
            function addButton(label, extraClass, handler) {
                var button = modalNode("button", label, "ghost mini" + (extraClass ? " " + extraClass : ""));
                button.type = "button";
                button.onclick = handler;
                actions.appendChild(button);
            }
            if (!user.approved) {                       // a new account: say yes, or no (no deletes it)
                addButton("Approve", "", function () {
                    adminCall("POST", "/api/admin/users/" + user.id + "/approve")
                        .then(function (r) { if (r.ok) openAdmin(); else adminFail(r); }, adminNetworkFail);
                });
                addButton("Reject", "danger", function () { confirmDelete(user); });
                row.appendChild(actions);
                table.appendChild(row);
                return;
            }
            addButton("History", "", function () { openAdminHistory(user); });
            if (!user.is_owner) {
                addButton(user.blocked ? "Unblock" : "Block", "", function () {
                    adminCall("POST", "/api/admin/users/" + user.id + "/block", {blocked: !user.blocked})
                        .then(function (r) { if (r.ok) openAdmin(); else adminFail(r); }, adminNetworkFail);
                });
                addButton("Delete", "danger", function () { confirmDelete(user); });
            }
            row.appendChild(actions);
            table.appendChild(row);
        });

        var wrap = modalNode("div", null, "tableWrap");
        wrap.appendChild(table);
        openModal({
            title: "Owner panel",
            wide: true,
            body: [modalNode("p", users.length + " account" + (users.length === 1 ? "" : "s") +
                (waiting ? ", " + waiting + " waiting for your approval (at the top)" : "") +
                ". Blocking ends a player's logins and stops them from logging in again.", "muted"), wrap],
            buttons: [
                { label: "Close", kind: "ghost" },
                { label: "Refresh", kind: "ghost", onClick: function () { openAdmin(); return false; } },
                { label: "All recent games", kind: "Start", onClick: function () { openAdminGames(); return false; } }
            ]
        });
    }, adminNetworkFail);
}

function confirmDelete(user) {
    openModal({
        title: "Delete " + user.username + "?",
        body: [
            "This removes the account, and every game this player took part in, which also disappears from their opponents' histories.",
            "It cannot be undone."
        ],
        buttons: [
            { label: "Cancel", kind: "ghost", onClick: function () { openAdmin(); return false; } },
            { label: "Delete account", kind: "Start", onClick: function () {
                adminCall("DELETE", "/api/admin/users/" + user.id)
                    .then(function (r) { if (r.ok) openAdmin(); else adminFail(r); }, adminNetworkFail);
                return false;
            } }
        ]
    });
}

// ---------- owner panel: reading game history ----------

// The database stores times as UTC text ("2026-11-21 17:35:25"); show them in the owner's own time.
function parseDbTime(text) {
    var d = new Date(String(text || "").replace(" ", "T") + "Z");
    return isNaN(d.getTime()) ? null : d;
}

function dayLabel(d) {
    var today = new Date();
    var yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isComputerName(name) {
    return /^Computer \((Easy|Medium|Hard)\)$/.test(String(name));
}

function statTile(value, label, kind) {
    var tile = modalNode("div", null, "stat" + (kind ? " " + kind : ""));
    tile.appendChild(modalNode("b", String(value)));
    tile.appendChild(modalNode("span", label));
    return tile;
}

// A row of small buttons where exactly one is selected. onPick gets the chosen value.
function chipRow(label, options, start, onPick) {
    var row = modalNode("div", null, "chips");
    row.appendChild(modalNode("span", label, "label"));
    var buttons = [];
    options.forEach(function (option) {
        var button = modalNode("button", option[1], "chip" + (option[0] === start ? " on" : ""));
        button.type = "button";
        button.onclick = function () {
            buttons.forEach(function (b) { b.classList.remove("on"); });
            button.classList.add("on");
            onPick(option[0]);
        };
        buttons.push(button);
        row.appendChild(button);
    });
    return row;
}

function tally(games) {
    var t = { win: 0, loss: 0, draw: 0 };
    games.forEach(function (game) { t[game.outcome]++; });
    return t;
}

function recordText(t) {
    return t.win + " won, " + t.loss + " lost, " + t.draw + " drawn";
}

// Adds a "Today" / "Yesterday" / date row whenever the day changes, then calls addRow for the game.
function addGroupedRows(table, columns, games, getTime, addRow) {
    var lastDay = null;
    games.forEach(function (game) {
        var when = parseDbTime(getTime(game));
        var day = when ? dayLabel(when) : "Unknown date";
        if (day !== lastDay) {
            var header = modalNode("tr", null, "dayRow");
            var cell = modalNode("td", day);
            cell.colSpan = columns;
            header.appendChild(cell);
            table.appendChild(header);
            lastDay = day;
        }
        addRow(game, when);
    });
}

function openAdminHistory(user) {
    adminCall("GET", "/api/admin/users/" + user.id + "/games").then(function (res) {
        if (!res.ok) { adminFail(res); return; }
        var info = res.body;
        var games = info.games || [];                 // newest first
        var filter = { result: "all", who: "all" };

        var status = user.blocked ? "blocked" : (user.approved === false ? "waiting for approval" : "active");
        var joined = parseDbTime(user.joined);
        var intro = modalNode("p", "Joined " + (joined ? joined.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "unknown") +
            " \u00b7 " + status, "muted");

        var total = games.length;
        var overall = tally(games);
        var rate = total ? Math.round(100 * overall.win / total) + "%" : "-";
        var tiles = modalNode("div", null, "stats");
        tiles.appendChild(statTile(total, "games"));
        tiles.appendChild(statTile(overall.win, "wins", "win"));
        tiles.appendChild(statTile(overall.loss, "losses", "loss"));
        tiles.appendChild(statTile(overall.draw, "draws"));
        tiles.appendChild(statTile(rate, "win rate"));

        var vsPc = games.filter(function (g) { return isComputerName(g.opponent); });
        var vsPeople = games.filter(function (g) { return !isComputerName(g.opponent); });
        var split = modalNode("div", null, "split");
        [["Against the computer", vsPc], ["Against players", vsPeople]].forEach(function (part) {
            var line = modalNode("span");
            line.appendChild(modalNode("strong", part[0] + " (" + part[1].length + "): "));
            line.appendChild(document.createTextNode(part[1].length ? recordText(tally(part[1])) : "no games"));
            split.appendChild(line);
        });

        var holder = modalNode("div");
        function paint() {
            var shown = games.filter(function (g) {
                if (filter.result !== "all" && g.outcome !== filter.result) return false;
                if (filter.who === "computer" && !isComputerName(g.opponent)) return false;
                if (filter.who === "players" && isComputerName(g.opponent)) return false;
                return true;
            });
            holder.textContent = "";
            if (total === 0) {
                holder.appendChild(modalNode("p", "No finished games yet.", "muted"));
                return;
            }
            holder.appendChild(modalNode("p", "Showing " + shown.length + " of " + total + " games, newest first.", "muted"));
            if (shown.length === 0) return;
            var table = modalNode("table", null, "adminTable");
            var head = modalNode("tr");
            ["Time", "Opponent", "Result", "Score"].forEach(function (label) { head.appendChild(modalNode("th", label)); });
            table.appendChild(head);
            addGroupedRows(table, 4, shown, function (g) { return g.played_at; }, function (game, when) {
                var row = modalNode("tr");
                row.appendChild(modalNode("td", when ? timeLabel(when) : String(game.played_at || ""), "time"));
                var who = modalNode("td");
                who.appendChild(document.createTextNode(game.opponent));
                if (isComputerName(game.opponent)) who.appendChild(modalNode("span", "computer", "tag"));
                row.appendChild(who);
                var result = modalNode("td");
                result.appendChild(modalNode("span", outcomeWord(game.outcome), "res " + game.outcome));
                row.appendChild(result);
                row.appendChild(modalNode("td", game.my_score + " \u2013 " + game.opp_score, "score"));
                table.appendChild(row);
            });
            var wrap = modalNode("div", null, "tableWrap tall");
            wrap.appendChild(table);
            holder.appendChild(wrap);
        }
        paint();

        var chips = [];
        if (total > 0) {
            chips.push(chipRow("Result:", [["all", "All"], ["win", "Wins"], ["loss", "Losses"], ["draw", "Draws"]], "all",
                function (value) { filter.result = value; paint(); }));
            chips.push(chipRow("Against:", [["all", "Everyone"], ["players", "Players"], ["computer", "Computer"]], "all",
                function (value) { filter.who = value; paint(); }));
        }

        openModal({
            title: "History: " + info.username,
            wide: true,
            body: [intro, tiles, split].concat(chips, [holder]),
            buttons: [
                { label: "Close", kind: "ghost" },
                { label: "Back to players", kind: "Start", onClick: function () { openAdmin(); return false; } }
            ]
        });
    }, adminNetworkFail);
}

function openAdminGames() {
    adminCall("GET", "/api/admin/games").then(function (res) {
        if (!res.ok) { adminFail(res); return; }
        var games = res.body.games;                   // newest first
        var filter = { text: "", who: "all" };

        var search = document.createElement("input");
        search.className = "search";
        search.placeholder = "Search a player name";
        search.setAttribute("aria-label", "Search a player name");
        search.oninput = function () { filter.text = search.value.trim().toLowerCase(); paint(); };

        var holder = modalNode("div");
        function paint() {
            var shown = games.filter(function (g) {
                var hasComputer = isComputerName(g.player_a) || isComputerName(g.player_b);
                if (filter.who === "computer" && !hasComputer) return false;
                if (filter.who === "players" && hasComputer) return false;
                if (filter.text && (g.player_a + " " + g.player_b).toLowerCase().indexOf(filter.text) < 0) return false;
                return true;
            });
            holder.textContent = "";
            if (games.length === 0) {
                holder.appendChild(modalNode("p", "No finished games yet.", "muted"));
                return;
            }
            holder.appendChild(modalNode("p", "Showing " + shown.length + " of the latest " + games.length + " games, newest first.", "muted"));
            if (shown.length === 0) return;
            var table = modalNode("table", null, "adminTable");
            var head = modalNode("tr");
            ["Time", "Player A", "Score", "Player B", "Winner"].forEach(function (label) { head.appendChild(modalNode("th", label)); });
            table.appendChild(head);
            addGroupedRows(table, 5, shown, function (g) { return g.played_at; }, function (game, when) {
                var row = modalNode("tr");
                row.appendChild(modalNode("td", when ? timeLabel(when) : String(game.played_at || ""), "time"));
                row.appendChild(modalNode("td", game.player_a));
                row.appendChild(modalNode("td", game.score_a + " \u2013 " + game.score_b, "score"));
                row.appendChild(modalNode("td", game.player_b));
                row.appendChild(modalNode("td", game.result === "A" ? game.player_a : game.result === "B" ? game.player_b : "Draw", "winner"));
                table.appendChild(row);
            });
            var wrap = modalNode("div", null, "tableWrap tall");
            wrap.appendChild(table);
            holder.appendChild(wrap);
        }
        paint();

        openModal({
            title: "All recent games",
            wide: true,
            body: [search, chipRow("Show:", [["all", "All games"], ["players", "Players only"], ["computer", "With the computer"]], "all",
                function (value) { filter.who = value; paint(); }), holder],
            buttons: [
                { label: "Close", kind: "ghost" },
                { label: "Back to players", kind: "Start", onClick: function () { openAdmin(); return false; } }
            ],
            focus: search
        });
    }, adminNetworkFail);
}

// Put an eye button inside a password box. The password is visible only while the eye is held down.
function passwordBox(input) {
    var box = document.createElement("span");
    box.className = "passwrap";
    var eye = document.createElement("button");
    eye.type = "button";                              // so it never submits anything
    eye.className = "eye";
    eye.title = "Hold to show the password";
    eye.setAttribute("aria-label", "Hold to show the password");
    eye.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
        '<circle cx="12" cy="12" r="3"/></svg>';
    function show() { input.type = "text"; eye.classList.add("on"); }
    function hide() { input.type = "password"; eye.classList.remove("on"); }
    eye.addEventListener("pointerdown", function (event) {
        event.preventDefault();                       // keep the cursor in the password box
        show();
    });
    ["pointerup", "pointerleave", "pointercancel", "blur"].forEach(function (name) {
        eye.addEventListener(name, hide);
    });
    eye.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    eye.addEventListener("keydown", function (event) {          // keyboard users: hold Space or Enter
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); show(); }
    });
    eye.addEventListener("keyup", hide);
    box.appendChild(input);
    box.appendChild(eye);
    return box;
}

function showAccount(info) {
    account.textContent = "";
    if (!info || !info.username) {
        var user = document.createElement("input");
        user.placeholder = "Username";
        user.maxLength = 20;
        var pass = document.createElement("input");
        pass.type = "password";
        pass.placeholder = "Password";
        var login = document.createElement("button");
        login.className = "Start";
        login.textContent = "Log in";
        login.onclick = function () { postAccount("/api/login", user.value, pass.value); };
        var create = document.createElement("button");
        create.className = "ghost";
        create.textContent = "Create account";
        create.onclick = function () { postAccount("/api/register", user.value, pass.value); };
        var hint = document.createElement("div");
        hint.textContent = "Log in to play online and save your results. A new account can log in once the owner approves it.";
        account.appendChild(user);
        account.appendChild(passwordBox(pass));
        account.appendChild(document.createElement("br"));
        account.appendChild(login);
        account.appendChild(create);
        account.appendChild(hint);
        return;
    }
    var hello = document.createElement("div");
    hello.textContent = info.username + " — " + info.wins + " wins, " + info.losses + " losses, " + info.draws + " draws";
    var out = document.createElement("button");
    out.className = "ghost";
    out.textContent = "Log out";
    out.onclick = function () {
        if (online && roomStarted && !gameOver) {          // a real game is being played
            openModal({
                title: "Leave the game?",
                body: "You are in the middle of an online game. Logging out will leave the room and end the game for your opponent.",
                buttons: [
                    { label: "Stay", kind: "ghost" },
                    { label: "Log out and leave", kind: "Start", onClick: doLogout }
                ]
            });
        } else {
            doLogout();
        }
    };
    account.appendChild(hello);
    if (info.is_owner) {                                // only the owner account gets this
        var panel = document.createElement("button");
        panel.className = "Start";
        panel.textContent = info.waiting_count ? "Owner panel (" + info.waiting_count + " waiting)" : "Owner panel";
        panel.onclick = openAdmin;
        account.appendChild(panel);
    }
    account.appendChild(out);
    var list = document.createElement("ul");
    list.className = "history";
    (info.games || []).forEach(function (game) {
        var item = document.createElement("li");
        var word = game.outcome === "win" ? "Win" : game.outcome === "loss" ? "Loss" : "Draw";
        item.textContent = word + " against " + game.opponent + ", " + game.my_score + "-" + game.opp_score + ", " + game.played_at;
        list.appendChild(item);
    });
    if (!info.games || info.games.length === 0) {
        var empty = document.createElement("li");
        empty.textContent = "No finished games yet.";
        list.appendChild(empty);
    }
    account.appendChild(list);
}

function loadAccount() {
    if (!token) {
        showAccount(null);
        return;
    }
    fetch(api("/api/me"), {headers: authHeaders()})
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
            if (!info) {
                token = "";
                localStorage.removeItem("mancalaToken");
            }
            showAccount(info);
        })
        .catch(function () { showAccount(null); });
}
loadAccount();
