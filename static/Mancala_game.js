// ===== Mancala: one 14-slot board, both players sow in the same direction (+1) =====
//   slots 0..5  = bottom row pits, left -> right   (Player B)
//   slot  6     = Player B's store (right)
//   slots 7..12 = top row pits, right -> left       (Player A)
//   slot  13    = Player A's store (left)
// The pit opposite slot p is slot 12 - p.
// Player 0 = A (top row), Player 1 = B (bottom row). A starts.

var images = ["mancalaBase.jpg", "mancalaCol.jpg"]; // [store picture, pit picture]
var STORE_A = 13;
var STORE_B = 6;
var EVAL_DEPTH = 10;      // search depth for the evaluation bar
var AI_DEPTH = 10;        // search depth for the computer player
var vsComputer = false;  // changed by the "Opponent" button; true = computer plays Player B
var online = false;   // true while playing through the server
var myPlayer = 0;     // 0 = A, 1 = B
var board = [];
var current = 0;         // whose turn: 0 = A, 1 = B
var gameOver = false;
var evaluation = 0;

var torA = document.getElementById("100");
var torB = document.getElementById("101");
var winA = document.getElementById("ab");
var winB = document.getElementById("ac");
var draw = document.getElementById("ad");

// ---------- game rules (pure functions, used by the UI and by minimax) ----------

function legalMoves(b, player) {//checks every possiable legal move
    var start = player === 0 ? 7 : 0;//which player is it? where is the first legal move, the first col or the 7th?
    var list = [];//remeberes all the legal moves
    for (var p = start; p < start + 6; p++) {//starts checking for 6 pits, the pits on the player's side
        if (b[p] > 0) list.push(p);//if there are stones in the pit, it's a legal move
    }
    return list;//return all the legal moves
}

// Plays one move on a COPY of the board. Returns { board, extra }.
function applyMove(b, player, pit) {//gets an array (b-the board), which player is playing, and what pit he chose
    var nb = b.slice();//copies the original array
    var myStore = player === 0 ? STORE_A : STORE_B;//remebers my store
    var oppStore = player === 0 ? STORE_B : STORE_A;//opponent's store
    var stones = nb[pit];//how many stones are in the pit?
    var pos = pit;//remebers the pit
    nb[pit] = 0;//set the stones on the clicked pit to 0
    while (stones > 0) {//begins the turn
        pos = (pos + 1) % 14;//advances to the next pit
        if (pos === oppStore) continue;   // never drop a stone in the opponent's store
        nb[pos]++;//adds a stone to the pit 
        stones--;//takes one stone out of the total, (from your hand)
    }
    var extra = false;//will there be an extra turn?
    if (pos === myStore) {//if the last stone landed on the store- an extra move
        extra = true;                      // last stone in own store -> extra turn
    } else {
        var ownPit = player === 0 ? (pos >= 7 && pos <= 12) : (pos >= 0 && pos <= 5);//checks whose the turn then checks if it landed on a pit on the player's side of the board
        if (ownPit && nb[pos] === 1) {     // did it land on an empty pit of your own side
            nb[myStore] += nb[12 - pos] + 1;//adds all the stones on the opposing side plus the stone that landed on the empty pit
            nb[12 - pos] = 0;//sets both the opposit pit and the pit you landed on to 0
            nb[pos] = 0;
        }
    }
    return { board: nb, extra: extra };//returns two values, their labels "board"- for the UPD board and "extra"- wather or not there is an extra move
}

// Who moves next. A player with no stones is skipped.
function nextPlayer(b, player, extra) {//checks who is the next player to make a move
    var next = extra ? player : 1 - player;//checks if there is an extra move, if there is, then the player stays the same player, if not, it's the 2nd player's turn
    //1- player will always be the next player, if it's player A so it will become 1-0=1, if it's player B it will turn into 1-1=0
    if (legalMoves(b, next).length === 0) next = 1 - next;//if there are no legal moves for the player to make, the turn goes to the 2nd player
    return next;//return whose turn it is now
}

// ---------- evaluation + minimax ----------

// Positive = good for A, negative = good for B.
//the process: start with the current turn and plays the first move and first response and so and so until it reaches the depth
//returns a value for the position and then compares it to the next response, for the computer's turn searches for the highest value, for the opponent's the lowest value
//alpha beta- remebers the best value for the computer we found so far, and if in another move, the opponnent has a response thats lower then that, it stops the search for this move, since it's worse for sure
//same for the beta, if the next move for the computer is worse for the opponnet, it stops searching the move.
function evaluate(b) {
    return b[STORE_A] - b[STORE_B];//the evaluation, who has more stones? (since it will check the board for several moves into the future)
}

// A maximizes, B minimizes. An extra turn simply keeps the same player to move.
function minimax(b, player, depth, alpha, beta) {//gets the board, whose turn, min, max
    //if the game is won
    if (b[STORE_A] > 24) return 1000 + depth;    // A won (sooner = better)
    if (b[STORE_B] > 24) return -1000 - depth;   // B won
    var moves = legalMoves(b, player);//an array with all the possiable moves
    if (depth === 0 || moves.length === 0) return evaluate(b);//if we reached the max depth, 
    //(or it's a draw, both players have no move to makke and it's not a win or lose an so it won't return infinite or -inf) the evaluation is as it is

    var best = player === 0 ? -Infinity : Infinity;//checks for the player, if it's the computers turn, assings the max of - inf, if it's the opp's turn, assigns inf
    for (var k = 0; k < moves.length; k++) {//goes through all the possiable moves
        var r = applyMove(b, player, moves[k]);//used the apply move function to evaluate a possiable board(copy of thr board after the move is played)
        var v = minimax(r.board, nextPlayer(r.board, player, r.extra), depth - 1, alpha, beta);//r consists several variables, a board, and is there an extra move
        //v checks the minmax again, for the board after the move was applied, whose turn is that (either an extra move happend or there are no possiable moves for the next player)/\
        //aplha beta for the alpha beta pruning (גיזום) 
        if (player === 0) {//if it's the computer's turn
            if (v > best) best = v;//if the final evaluation is better than the last "best"- rewrite the best
            if (best > alpha) alpha = best;//remebers the best so far,if the current best is better than the last best, rewrite the alpha
        } else {
            if (v < best) best = v;//if it's the opponents turn, if the final evaluation is better for the opponnent than the current best evaluation, rewrite the best
            //(we assume he will pick the best possiable move, so it will go back and forth until it finds the move that favors the opponnet the most)
            //stores B's best move's value
            if (best < beta) beta = best;//if the opponnent found a better move for him than we found on the rest of the search- changge the limit for the alpha beta to be the new worse move
        }
        if (beta <= alpha) break;               //if we found a response that is worse than the best value we have so far(for both ways) stops the search for this move, since we know for sure it's worse for me
    }
    return best;//returns the value we found
}

function bestMove(b, player, depth) {//finds the best move
    var moves = legalMoves(b, player);//lists all the possiable moves
    var bestPit = moves[0];//the best move
    var bestVal = player === 0 ? -Infinity : Infinity;//its value
    for (var k = 0; k < moves.length; k++) {//searches all the moves
        var r = applyMove(b, player, moves[k]);//applies a move
        var v = minimax(r.board, nextPlayer(r.board, player, r.extra), depth - 1, -Infinity, Infinity);//checks all the responses and assignes the value based on the minmax
        if (player === 0 ? v > bestVal : v < bestVal) {//if it's players A's turn(the opponnent) find the move with the highest value, else, the lowest value
            bestVal = v;//the lowest/highest value is the new value
            bestPit = moves[k];//updates the best move
        }
    }
    return bestPit;//returns the best move
}

// ---------- UI ----------

function showBoard() {
    if (online) { sendOnline({ type: "restart" }); return; }   
    board = [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
    current = 0;
    gameOver = false;
    draw.className = "Win";
    winA.className = "Win";
    winB.className = "Win";
    torA.style.display = "block";
    torB.style.display = "block";
    refresh();
}

// Where the stones sit inside a pit (percent of the pit). Up to 6 stones are drawn; the number shows the real count.
var STONE_POS = [
    [],
    [[50, 50]],
    [[36, 50], [64, 50]],
    [[50, 33], [34, 64], [66, 64]],
    [[34, 34], [66, 34], [34, 66], [66, 66]],
    [[34, 32], [66, 32], [50, 50], [34, 68], [66, 68]],
    [[34, 30], [66, 30], [28, 50], [72, 50], [34, 70], [66, 70]]
];

function pitStones(n) {
    var shown = Math.min(n, 6), pos = STONE_POS[shown], html = "";
    for (var k = 0; k < shown; k++) {
        html += "<i class='stone s" + k + "' style='left:" + pos[k][0] + "%;top:" + pos[k][1] + "%'></i>";
    }
    return html;
}

// A store is a tall pill: stones pile up from the bottom, 3 per row, up to 18 drawn.
function storeStones(n) {
    var shown = Math.min(n, 18), html = "";
    for (var k = 0; k < shown; k++) {
        var x = 26 + (k % 3) * 24 + ((k * 7) % 5 - 2);
        var y = 90 - Math.floor(k / 3) * 13 + ((k * 5) % 4 - 2);
        html += "<i class='stone s" + (k % 6) + "' style='left:" + x + "%;top:" + y + "%'></i>";
    }
    return html;
}

function pitHtml(id, n, playable) {
    return "<div class='pit" + (playable ? " playable' role='button' tabindex='0" +
        "' onkeydown=\"if(event.key==='Enter'||event.key===' ')MoveStones(this)\"" : "'") +
        " id='" + id + "' onclick='MoveStones(this)'>" + pitStones(n) + "<b class='count'>" + n + "</b></div>";
}

function storeHtml(cls, id, n) {
    return "<div class='store " + cls + "' id='" + id + "'><b class='count'>" + n + "</b>" + storeStones(n) + "</div>";
}

function render() {
    var canClick = !gameOver && !(vsComputer && current === 1) && !(online && current !== myPlayer);
    var pits = "<div class='pits'>";
    for (var c = 1; c <= 6; c++) {                                        // top row: ids 1..6 -> slots 12..7
        pits += pitHtml(c, board[13 - c], canClick && current === 0 && board[13 - c] > 0);
    }
    for (var d = 0; d < 6; d++) {                                         // bottom row: ids 7..12 -> slots 0..5
        pits += pitHtml(7 + d, board[d], canClick && current === 1 && board[d] > 0);
    }
    pits += "</div>";
    var pct = 50 + 50 * Math.max(-24, Math.min(24, evaluation)) / 24;     // A's share of the evaluation bar
    document.getElementById("aa").innerHTML =
        "<div class='evl'><span>A</span><div class='evlTrack'><div class='evlFill' style='width:" + pct +
        "%'></div></div><span>B</span><em>" + evaluation + "</em></div>" +
        "<div class='board'>" + storeHtml("storeA", 0, board[STORE_A]) + pits +
        storeHtml("storeB", 13, board[STORE_B]) + "</div>" +
        "<div class='belowBoard'><button type='button' class='ghost' onclick='ShowRules()'>Rules</button></div>";
}

function checkGameOver() {
    if (board[STORE_A] > 24) {
        winA.className = "Win-H";
        gameOver = true;
    } else if (board[STORE_B] > 24) {
        winB.className = "Win-H";
        gameOver = true;
    } else if (board[STORE_A] === 24 && board[STORE_B] === 24) {
        draw.className = "Win-H";
        gameOver = true;
    }
}

function refresh() {
    evaluation = minimax(board, current, EVAL_DEPTH, -Infinity, Infinity);
    render();
    torA.className = current === 0 ? "tor" : "notTurn";
    torB.className = current === 1 ? "tor" : "notTurn";
    checkGameOver();
    if (!gameOver && vsComputer && current === 1) {
        setTimeout(function () {
            if (vsComputer && current === 1 && !gameOver) playMove(bestMove(board, 1, AI_DEPTH));
        }, 400);
    }
}

function playMove(pit) {
    if (online) { sendOnline({ type: "move", pit: pit }); return; }
    var r = applyMove(board, current, pit);
    board = r.board;
    current = nextPlayer(board, current, r.extra);
    refresh();
}

function MoveStones(moved) {
    if (gameOver) return;
    if (vsComputer && current === 1) return;
    if (online && current !== myPlayer) return;
    var id = Number(moved.id);
    var pit = id <= 6 ? 13 - id : id - 7;     // html id -> board slot
    var mine = current === 0 ? (pit >= 7 && pit <= 12) : (pit >= 0 && pit <= 5);
    if (!mine || board[pit] === 0) return;
    playMove(pit);
}

// ---------- opponent button (created here, so the HTML file needs no change) ----------

function updateModeButton() {
    document.getElementById("mode").textContent = vsComputer
        ? "Opponent: Computer (click to play 2 players)"
        : "Opponent: Human (click to play against the computer)";
}

function toggleMode() {
    vsComputer = !vsComputer;
    updateModeButton();
    if (board.length > 0 && !gameOver) refresh();   // if it is B's turn, the computer moves now
}

var modeBtn = document.createElement("button");
modeBtn.id = "mode";
modeBtn.className = "Start";
modeBtn.onclick = toggleMode;
var gameDiv = document.getElementById("aa");
gameDiv.parentNode.insertBefore(modeBtn, gameDiv);
updateModeButton();

// ---------- dialog: one reusable popup (replaces alert / prompt) ----------

var modalEl = document.getElementById("modal");
var modalGen = 0;               // changes every time a dialog opens, so a button can tell if its handler opened another one
var modalReturnFocus = null;

function modalNode(tag, text, cls) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
}

// opts.title   : heading text
// opts.body    : a string, a DOM node, or an array of those
// opts.buttons : [{ label, kind: "Start" (gold) | "ghost" (quiet), onClick }]
//                onClick may return false to keep the dialog open.
// opts.focus   : element to focus first (default: the first gold button)
// opts.wide    : true for a wider card (the owner's tables)
function openModal(opts) {
    modalGen++;
    modalReturnFocus = document.activeElement;
    modalEl.firstElementChild.classList.toggle("wide", !!opts.wide);     // wide card, for tables
    document.getElementById("modalTitle").textContent = opts.title || "";

    var body = document.getElementById("modalBody");
    body.textContent = "";
    [].concat(opts.body || []).forEach(function (part) {
        body.appendChild(typeof part === "string" ? modalNode("p", part) : part);
    });

    var actions = document.getElementById("modalActions");
    actions.textContent = "";
    var primary = null;
    (opts.buttons || [{ label: "OK", kind: "Start" }]).forEach(function (spec) {
        var button = modalNode("button", spec.label, spec.kind || "ghost");
        button.type = "button";
        button.onclick = function () {
            var gen = modalGen;
            var result = spec.onClick ? spec.onClick() : undefined;
            if (result !== false && gen === modalGen) closeModal();
        };
        if (!primary && spec.kind === "Start") primary = button;
        actions.appendChild(button);
    });

    modalEl.hidden = false;
    body.parentNode.scrollTop = 0;
    (opts.focus || primary || document.getElementById("modalX")).focus({ preventScroll: true });
}

function closeModal() {
    if (modalEl.hidden) return;
    modalEl.hidden = true;
    if (modalReturnFocus && modalReturnFocus.focus && document.body.contains(modalReturnFocus)) {
        modalReturnFocus.focus();
    }
    modalReturnFocus = null;
}

// Simple message with one OK button.
function showMessage(title, text) {
    openModal({ title: title, body: text, buttons: [{ label: "OK", kind: "Start" }] });
}

document.getElementById("modalX").onclick = closeModal;
modalEl.addEventListener("mousedown", function (event) {
    if (event.target === modalEl) closeModal();        // click on the dark area outside the card
});
document.addEventListener("keydown", function (event) {
    if (modalEl.hidden) return;
    if (event.key === "Escape") { closeModal(); return; }
    if (event.key !== "Tab") return;                   // keep Tab inside the dialog
    var items = modalEl.querySelectorAll("button, input");
    if (items.length === 0) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

// ---------- rules ----------

function ShowRules() {
    function section(title, tag, items) {
        var list = modalNode(tag);
        items.forEach(function (text) { list.appendChild(modalNode("li", text)); });
        return [modalNode("h3", title), list];
    }

    var body = [].concat(
        [modalNode("p", "Two players share 48 stones. Fill your store with more than half of them to win.")],
        section("The board", "ul", [
            "Each player has six pits and one store. Player A plays the top row, with the store on the left. Player B plays the bottom row, with the store on the right.",
            "Every pit starts with 4 stones and both stores start empty. Player A goes first."
        ]),
        section("On your turn", "ol", [
            "Pick one of your own pits that has at least one stone. You can never pick from a store or from your opponent's pits.",
            "Pick up every stone in that pit and drop them one at a time into the pits that follow, moving toward your own store.",
            "Your own store counts as a pit, so drop a stone in it when you pass it. If you still have stones, keep going along your opponent's side, but skip their store.",
            "Your turn ends when your hand is empty. If your last stone lands in a pit that already had stones, you do not pick them up. The turn simply passes."
        ]),
        section("Special moves", "ul", [
            "Extra turn: if your last stone lands in your own store, you play again.",
            "Capture: if your last stone lands in an empty pit on your own side, you take that stone and every stone in the pit opposite it, and put them all in your store."
        ]),
        section("Winning", "ul", [
            "The first player to hold more than half of the stones in their store (25 or more) wins right away.",
            "If both stores end on 24, the game is a draw.",
            "If a player has no stones left in their pits, their turn is skipped and the other player keeps playing."
        ])
    );

    var tip = modalNode("div", null, "tip");
    tip.appendChild(modalNode("strong", "Good to know: "));
    tip.appendChild(document.createTextNode(
        "The bar above the board shows who is ahead (blue is Player A, red is Player B). " +
        "The Opponent button switches between playing a friend on this screen and playing the computer, which plays Player B. " +
        "\"Play online\" lets you play a friend on another device."));
    body.push(tip);

    openModal({
        title: "How to play Mancala",
        body: body,
        buttons: [{ label: "Got it", kind: "Start" }]
    });
}