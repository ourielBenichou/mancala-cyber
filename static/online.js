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
        roomStarted = true;
        board = msg.board;
        current = msg.current;
        gameOver = false;
        draw.className = "Win";                       // hide old result overlays;
        winA.className = "Win";                       // refresh() shows the right one again
        winB.className = "Win";
        if (msg.names) {
            torA.textContent = "Player A: " + (msg.names[0] || "") + (myPlayer === 0 ? " (you)" : "");
            torB.textContent = "Player B: " + (msg.names[1] || "") + (myPlayer === 1 ? " (you)" : "");
        }
        torA.style.display = "block";
        torB.style.display = "block";
        refresh();
        if (msg.over) loadAccount();
    } else if (msg.type === "kicked") {                 // the owner blocked or removed this account
        leaveRoom();
        token = "";
        localStorage.removeItem("mancalaToken");
        showAccount(null);
        showMessage("Removed from the game", msg.message || "The owner removed you from the game.");
    } else if (msg.type === "left") {
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
        var users = res.body.users;
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
            body: [modalNode("p", users.length + " account" + (users.length === 1 ? "" : "s") + ". Blocking ends a player's logins and stops them from logging in again.", "muted"), wrap],
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

function openAdminHistory(user) {
    adminCall("GET", "/api/admin/users/" + user.id + "/games").then(function (res) {
        if (!res.ok) { adminFail(res); return; }
        var info = res.body;
        var list = modalNode("ul", null, "history");
        (info.games || []).forEach(function (game) {
            list.appendChild(modalNode("li", outcomeWord(game.outcome) + " against " + game.opponent + ", " +
                game.my_score + "-" + game.opp_score + ", " + game.played_at));
        });
        if (!info.games || info.games.length === 0) list.appendChild(modalNode("li", "No finished games yet."));
        openModal({
            title: "History: " + info.username,
            body: [modalNode("p", info.wins + " wins, " + info.losses + " losses, " + info.draws + " draws", "muted"), list],
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
        var list = modalNode("ul", null, "history");
        res.body.games.forEach(function (game) {
            var winner = game.result === "A" ? game.player_a + " won" : game.result === "B" ? game.player_b + " won" : "draw";
            list.appendChild(modalNode("li", game.player_a + " vs " + game.player_b + ", " +
                game.score_a + "-" + game.score_b + " (" + winner + "), " + game.played_at));
        });
        if (res.body.games.length === 0) list.appendChild(modalNode("li", "No finished games yet."));
        openModal({
            title: "All recent games",
            body: [modalNode("p", "The latest 200 finished games, newest first.", "muted"), list],
            buttons: [
                { label: "Close", kind: "ghost" },
                { label: "Back to players", kind: "Start", onClick: function () { openAdmin(); return false; } }
            ]
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
        hint.textContent = "Log in to play online and save your results.";
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
        panel.textContent = "Owner panel";
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
