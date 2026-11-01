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

function pitHtml(id, n) {
    return "<div class='pit'><img src='" + images[1] + "' class='pitImg' id='" + id +
        "' onclick='MoveStones(this)' /><button class='number'>  " + n + " </button></div>";
}

function storeHtml(cls, id, n) {
    return "<div class='" + cls + "'><button class='number'>  " + n + " </button><img src='" +
        images[0] + "' class='baseImg' id='" + id + "' /></div>";
}

function render() {
    var top = "<div class='row1'>";
    for (var c = 1; c <= 6; c++) top += pitHtml(c, board[13 - c]);       // ids 1..6  -> slots 12..7
    top += "</div>";
    var bottom = "<div class='row2'>";
    for (var d = 0; d < 6; d++) bottom += pitHtml(7 + d, board[d]);      // ids 7..12 -> slots 0..5
    bottom += "</div>";
    document.getElementById("aa").innerHTML =
        "<div class='evl'>evaluation bar=" + evaluation + "</div>" +
        "<div class='board'>" + top +
        storeHtml("base1", 0, board[STORE_A]) +
        storeHtml("base2", 13, board[STORE_B]) +
        bottom + "</div>";
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

var rules = "";
function ShowRules() {

}