// ---------- online play: talks to server.py over a WebSocket ----------
// Load this AFTER Mancala_game.js. The server owns the game; this file only
// sends your clicks and shows the board the server sends back.

var socket = null;
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
    document.getElementById("aa").innerHTML = "<h2>" + text + "</h2>";
}

function startOnline() {
    var url = socketURL();
    if (!token) {
        alert("Create an account or log in first. Each player needs their own username.");
        return;
    }
    var code = prompt("Enter a room code to join, or leave empty to create a new room:");
    if (code === null) return;                        // cancelled
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
        alert("The server is closed. Double-click start.bat, then try again.");
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
        vsComputer = false;
        myPlayer = msg.you;
        modeBtn.style.display = "none";
        onlineBtn.style.display = "none";
        torA.textContent = "Player A's turn" + (myPlayer === 0 ? " (you)" : "");
        torB.textContent = "Player B's turn" + (myPlayer === 1 ? " (you)" : "");
        showStatus(myPlayer === 0
            ? "Room code: " + msg.room + " - waiting for the other player..."
            : "Joined room " + msg.room);
    } else if (msg.type === "state") {
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
    } else if (msg.type === "left") {
        gameOver = true;
        showStatus("The other player left. Reload the page to start again.");
    } else if (msg.type === "error") {
        alert(msg.message);
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

function postAccount(path, username, password) {
    fetch(api(path), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({username: username, password: password})
    }).then(function (r) { return r.json().then(function (body) { return {ok: r.ok, body: body}; }); })
        .then(function (res) {
            if (!res.ok) {
                alert(res.body.message || "Could not log in");
                return;
            }
            token = res.body.token;
            localStorage.setItem("mancalaToken", token);
            showAccount(res.body);
        })
        .catch(function () {
            alert("The server is closed. Double-click start.bat, then refresh this page.");
        });
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
        hint.textContent = "Log in on both computers. Usernames are unique. Finished games are saved as a win, loss, or draw.";
        account.appendChild(user);
        account.appendChild(pass);
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
        fetch(api("/api/logout"), {method: "POST", headers: authHeaders()});
        token = "";
        localStorage.removeItem("mancalaToken");
        showAccount(null);
    };
    account.appendChild(hello);
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
