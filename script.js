// --- DEKLARASI STATE GLOBAL ---
let board = null;
let game = new Chess();
let stockfish;
let currentAppMode = 'home';
let gameElo = 1500;

// Variabel Analisis
let analysisHistory = [];
let currentAnalysisIndex = -1;
let evalCache = {}; // Menyimpan hasil evaluasi per langkah

// --- KAMUS PEMBUKAAN (OPENING DICTIONARY) ---
const openingBook = {
    "e4": "B00: King's Pawn Game",
    "d4": "A40: Queen's Pawn Game",
    "c4": "A10: English Opening",
    "e4 e5": "C20: King's Pawn Game",
    "e4 c5": "B20: Sicilian Defense",
    "e4 e6": "C00: French Defense",
    "e4 c6": "B10: Caro-Kann Defense",
    "d4 d5": "D00: Queen's Pawn Game",
    "d4 Nf6": "A45: Indian Defense",
    "e4 e5 Nf3": "C40: King's Knight Opening",
    "e4 e5 Nf3 Nc6": "C44: King's Knight Opening",
    "e4 e5 Nf3 Nc6 Bc4": "C50: Italian Game",
    "e4 e5 Nf3 Nc6 Bc4 Bc5": "C50: Italian Game, Giuoco Piano",
    "e4 e5 Nf3 Nc6 Bc4 Nf6": "C55: Two Knights Defense",
    "e4 e5 Nf3 Nc6 Bb5": "C60: Ruy Lopez",
    "e4 e5 Nf3 Nc6 d4": "C44: Scotch Game",
    "d4 d5 c4": "D06: Queen's Gambit"
};

// --- INISIALISASI DOM ---
const viewHome = document.getElementById('view-home');
const viewSetup = document.getElementById('view-setup');
const viewBoardArea = document.getElementById('view-board-area');
const panelIngame = document.getElementById('panel-ingame');
const panelAnalysis = document.getElementById('panel-analysis');
const openingHeader = document.getElementById('opening-header');
const openingNameText = document.getElementById('opening-name-text');
const evalBarHorizontal = document.getElementById('eval-bar-horizontal');
const evalFillHorizontal = document.getElementById('eval-fill-horizontal');
const evalTextHorizontal = document.getElementById('eval-text-horizontal');
const matchListEl = document.getElementById('match-list');
const logBox = document.getElementById('analysis-log');
const canvas = document.getElementById('arrowCanvas');
const ctx = canvas.getContext('2d');

document.getElementById('btn-goto-setup').addEventListener('click', showSetupScreen);
document.getElementById('btn-cancel-setup').addEventListener('click', showHomeScreen);
document.getElementById('btn-start-game').addEventListener('click', startNewGame);
document.getElementById('btn-resign').addEventListener('click', handleResign);
document.getElementById('btn-back-home').addEventListener('click', showHomeScreen);
document.getElementById('btn-prev-move').addEventListener('click', analysisPrevMove);
document.getElementById('btn-next-move').addEventListener('click', analysisNextMove);
document.getElementById('btn-best-move').addEventListener('click', showBestMoveArrow);

// --- INISIALISASI STOCKFISH ---
try {
    const workerScript = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
    stockfish = new Worker(URL.createObjectURL(new Blob([workerScript], { type: 'application/javascript' })));
} catch (e) {
    stockfish = new Worker('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
}

// Router Pesan Stockfish (Khusus In-Game)
stockfish.onmessage = function(event) {
    const line = event.data;
    if (currentAppMode === 'game' && line.startsWith('bestmove')) {
        const bestMove = line.split(' ')[1];
        if (bestMove && bestMove !== '(none)') {
            game.move({ from: bestMove.substring(0, 2), to: bestMove.substring(2, 4), promotion: 'q' });
            board.position(game.fen());
            checkGameEnd();
        }
    }
};

// --- FUNGSI ROUTING SPA ---
function hideAllViews() {
    viewHome.classList.add('hidden'); viewSetup.classList.add('hidden');
    viewBoardArea.classList.add('hidden'); panelIngame.classList.add('hidden');
    panelAnalysis.classList.add('hidden'); openingHeader.classList.add('hidden');
}

function showHomeScreen() {
    currentAppMode = 'home'; hideAllViews(); viewHome.classList.remove('hidden'); renderMatchHistory();
}

function showSetupScreen() {
    hideAllViews(); viewSetup.classList.remove('hidden');
}

function enterGameMode() {
    currentAppMode = 'game'; hideAllViews();
    viewBoardArea.classList.remove('hidden'); panelIngame.classList.remove('hidden');
    evalBarHorizontal.classList.add('hidden'); // Sembunyikan bar saat main agar tidak curang
    if (board) board.resize(); syncCanvasSize();
}

function enterAnalysisMode(matchData) {
    currentAppMode = 'analysis'; hideAllViews();
    viewBoardArea.classList.remove('hidden'); panelAnalysis.classList.remove('hidden');
    openingHeader.classList.remove('hidden'); evalBarHorizontal.classList.remove('hidden');
    if (board) board.resize(); syncCanvasSize();
    setupAnalysisBoard(matchData);
}

// --- LOCAL STORAGE ---
function getMatches() { return JSON.parse(localStorage.getItem('chess_history')) || []; }
function saveMatch(result) {
    const matches = getMatches();
    matches.unshift({ id: Date.now(), date: new Date().toLocaleDateString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}), elo: gameElo, pgn: game.pgn(), result: result });
    localStorage.setItem('chess_history', JSON.stringify(matches));
}

function renderMatchHistory() {
    matchListEl.innerHTML = '';
    const matches = getMatches();
    if(matches.length === 0) return matchListEl.innerHTML = '<div class="empty-state">Belum ada pertandingan.</div>';
    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = `match-item ${m.result === 'Menang' ? 'win' : (m.result === 'Kalah' ? 'loss' : 'draw')}`;
        item.innerHTML = `<div><div class="match-item-info">vs Bot ELO ${m.elo} - <strong>${m.result}</strong></div><div class="match-item-date">${m.date}</div></div><div>▶ Analisis</div>`;
        item.addEventListener('click', () => enterAnalysisMode(m));
        matchListEl.appendChild(item);
    });
}

// --- LOGIKA GAME ---
document.getElementById('elo-slider').addEventListener('input', function() {
    document.getElementById('elo-display').innerText = this.value;
    gameElo = parseInt(this.value);
});

function startNewGame() {
    game.reset(); board.start(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    enterGameMode();
}

function makeBotMove() {
    if (game.game_over()) return;
    
    // Blunder Manusiawi untuk ELO Rendah
    if (gameElo < 1000 && Math.random() < ((1000 - gameElo) / 1000)) {
        let moves = game.moves({ verbose: true });
        if (moves.length > 0) {
            let rm = moves[Math.floor(Math.random() * moves.length)];
            game.move({ from: rm.from, to: rm.to, promotion: 'q' });
            board.position(game.fen()); checkGameEnd(); return;
        }
    }
    
    stockfish.postMessage('uci');
    stockfish.postMessage('setoption name UCI_LimitStrength value true');
    stockfish.postMessage('setoption name UCI_Elo value ' + Math.max(1100, gameElo));
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth ' + (gameElo < 1500 ? 2 : (gameElo <= 2200 ? 6 : 12)));
}

function checkGameEnd() {
    if (game.in_checkmate()) {
        let res = game.turn() === 'w' ? 'Kalah' : 'Menang';
        alert(`Skakmat! Anda ${res}.`); saveMatch(res); showHomeScreen();
    } else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
        alert('Seri (Draw).'); saveMatch('Seri'); showHomeScreen();
    }
}

function handleResign() {
    if (confirm("Menyerah?")) { saveMatch('Kalah'); showHomeScreen(); }
}

function onDragStart(s, p) { if (currentAppMode !== 'game' || game.game_over() || p.search(/^b/) !== -1) return false; }
function onDrop(s, t) {
    if (currentAppMode !== 'game') return 'snapback';
    let m = game.move({ from: s, to: t, promotion: 'q' });
    if (m === null) return 'snapback';
    checkGameEnd(); window.setTimeout(makeBotMove, 250);
}
function onSnapEnd() { if (currentAppMode === 'game') board.position(game.fen()); }

// --- LOGIKA ANALISIS ENGINE ON-THE-FLY ---

function getOpeningName(historyArr) {
    let sanStr = historyArr.map(m => m.san).join(" ");
    let found = "Posisi Standar";
    for (let seq in openingBook) { if (sanStr.startsWith(seq)) found = openingBook[seq]; }
    return found;
}

// Fungsi Panggil Stockfish Async (Dibungkus Promise)
function evaluatePositionAsync(fen, depth) {
    return new Promise(resolve => {
        let currentCp = 0; let bestMove = '';
        const tempHandler = function(e) {
            const line = e.data;
            if (line.includes('score cp')) {
                const match = line.match(/score cp (-?\d+)/);
                if (match) currentCp = parseInt(match[1]);
            } else if (line.includes('score mate')) {
                const match = line.match(/score mate (-?\d+)/);
                if (match) currentCp = parseInt(match[1]) > 0 ? 10000 : -10000;
            }
            if (line.startsWith('bestmove')) {
                bestMove = line.split(' ')[1];
                stockfish.removeEventListener('message', tempHandler);
                resolve({ cp: currentCp, bestMove: bestMove });
            }
        };
        stockfish.addEventListener('message', tempHandler);
        stockfish.postMessage('position fen ' + fen);
        stockfish.postMessage('go depth ' + depth);
    });
}

function updateEvalBarUI(cp, depth) {
    let clamped = Math.max(-1000, Math.min(1000, cp));
    let percent = 50 + (clamped / 20); // 0cp = 50%, 1000cp = 100%
    evalFillHorizontal.style.width = percent + '%';
    
    let displayTxt = (cp / 100).toFixed(2);
    if (cp > 0) displayTxt = "+" + displayTxt;
    evalTextHorizontal.innerText = `${displayTxt} (kedalaman: ${depth})`;
}

function renderSquareBadge(square, text, cssClass) {
    $('.move-badge').remove(); // Hapus badge lama
    const squareEl = $('#board .square-' + square);
    if (squareEl.length > 0) {
        squareEl.append(`<div class="move-badge ${cssClass}">${text}</div>`);
    }
}

async function analyzeCurrentStep() {
    if (currentAnalysisIndex < 0) {
        openingNameText.innerText = "Posisi Awal";
        updateEvalBarUI(0, 0); $('.move-badge').remove(); ctx.clearRect(0,0,canvas.width,canvas.height);
        return;
    }

    const moveIndex = currentAnalysisIndex;
    const move = analysisHistory[moveIndex];
    const isWhite = move.color === 'w';
    
    // Update Opening Name
    const currentHist = game.history({verbose: true});
    openingNameText.innerText = getOpeningName(currentHist);
    evalTextHorizontal.innerText = "Menganalisis...";
    ctx.clearRect(0,0,canvas.width,canvas.height); // Hapus panah

    // Gunakan Cache jika sudah dianalisis sebelumnya
    if (!evalCache[moveIndex]) {
        // Dapatkan FEN sebelum langkah ini terjadi
        let movePlayed = game.undo(); 
        let fenBefore = game.fen();
        game.move(movePlayed); // Kembalikan state

        let fenAfter = game.fen();

        // Evaluasi Sebelum
        let resBefore = await evaluatePositionAsync(fenBefore, 10);
        let cpBefore = isWhite ? resBefore.cp : -resBefore.cp;

        // Evaluasi Sesudah
        let resAfter = await evaluatePositionAsync(fenAfter, 10);
        let cpAfter = !isWhite ? resAfter.cp : -resAfter.cp; // Relatif ke sudut pandang mesin

        let delta = isWhite ? (cpAfter - cpBefore) : (cpBefore - cpAfter);
        
        let classification = "book"; let bText = "🕮"; let bClass = "badge-book";

        // Logic Kategori (Mirip Screenshot)
        if (moveIndex >= 6) { // Keluar dari teori dasar
            if (delta >= -10) { bText = "★"; bClass = "badge-best"; }
            else if (delta >= -25) { bText = "✓"; bClass = "badge-excellent"; }
            else if (delta >= -50) { bText = "ok"; bClass = "badge-good"; }
            else if (delta >= -100) { bText = "?!"; bClass = "badge-inaccuracy"; }
            else if (delta >= -300) { bText = "?"; bClass = "badge-mistake"; }
            else { bText = "??"; bClass = "badge-blunder"; }
        }

        evalCache[moveIndex] = {
            cpFinal: cpAfter,
            bText: bText,
            bClass: bClass,
            recommendedMove: resBefore.bestMove
        };
    }

    // Terapkan UI jika user belum berpindah langkah saat proses async selesai
    if (currentAnalysisIndex === moveIndex) {
        const data = evalCache[moveIndex];
        updateEvalBarUI(data.cpFinal, 10);
        renderSquareBadge(move.to, data.bText, data.bClass);
    }
}

// --- NAVIGASI ANALISIS ---
function setupAnalysisBoard(matchData) {
    const tempAnalyzer = new Chess();
    tempAnalyzer.load_pgn(matchData.pgn);
    analysisHistory = tempAnalyzer.history({ verbose: true });
    
    game.reset(); board.position(game.fen());
    currentAnalysisIndex = -1; evalCache = {};
    
    logBox.innerHTML = '';
    analysisHistory.forEach((m, i) => {
        const isWhite = i % 2 === 0;
        const stepNum = Math.floor(i / 2) + 1;
        const div = document.createElement('div');
        div.className = 'log-item'; div.id = `log-move-${i}`;
        div.innerText = isWhite ? `${stepNum}. ${m.san}` : `${stepNum}... ${m.san}`;
        div.addEventListener('click', () => jumpToAnalysisMove(i));
        logBox.appendChild(div);
    });
    analyzeCurrentStep();
}

function syncAnalysisUI() {
    board.position(game.fen());
    document.querySelectorAll('.log-item').forEach(el => el.classList.remove('active'));
    if (currentAnalysisIndex >= 0) {
        const activeLog = document.getElementById(`log-move-${currentAnalysisIndex}`);
        if (activeLog) { activeLog.classList.add('active'); activeLog.scrollIntoView({behavior: "smooth", block: "nearest"}); }
    }
    analyzeCurrentStep(); // Trigger Engine AI
}

function analysisNextMove() {
    if (currentAnalysisIndex < analysisHistory.length - 1) {
        currentAnalysisIndex++;
        game.move(analysisHistory[currentAnalysisIndex].san);
        syncAnalysisUI();
    }
}

function analysisPrevMove() {
    if (currentAnalysisIndex >= 0) {
        game.undo();
        currentAnalysisIndex--;
        syncAnalysisUI();
    }
}

function jumpToAnalysisMove(target) {
    if (target === currentAnalysisIndex) return;
    while (currentAnalysisIndex < target) { currentAnalysisIndex++; game.move(analysisHistory[currentAnalysisIndex].san); }
    while (currentAnalysisIndex > target) { game.undo(); currentAnalysisIndex--; }
    syncAnalysisUI();
}

// --- GAMBAR PANAH ---
window.addEventListener('resize', syncCanvasSize);
function syncCanvasSize() {
    const bEl = document.getElementById('board');
    if (bEl.clientWidth > 0) { canvas.width = bEl.clientWidth; canvas.height = bEl.clientHeight; }
}

function showBestMoveArrow() {
    if (currentAnalysisIndex < 0 || !evalCache[currentAnalysisIndex]) return;
    const bestM = evalCache[currentAnalysisIndex].recommendedMove;
    if (bestM && bestM !== '(none)') drawArrow(bestM.substring(0, 2), bestM.substring(2, 4));
}

function drawArrow(fromSq, toSq) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sqSize = canvas.width / 8;
    const getC = (sq) => ({ x: (sq.charCodeAt(0)-97 + 0.5)*sqSize, y: (8-parseInt(sq[1]) + 0.5)*sqSize });
    const p1 = getC(fromSq), p2 = getC(toSq), head = sqSize * 0.3, ang = Math.atan2(p2.y-p1.y, p2.x-p1.x);
    
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(66, 135, 245, 0.7)'; ctx.lineWidth = sqSize * 0.15; ctx.lineCap = 'round'; ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - head*Math.cos(ang - Math.PI/6), p2.y - head*Math.sin(ang - Math.PI/6));
    ctx.lineTo(p2.x - head*Math.cos(ang + Math.PI/6), p2.y - head*Math.sin(ang + Math.PI/6));
    ctx.lineTo(p2.x, p2.y);
    ctx.fillStyle = 'rgba(66, 135, 245, 0.9)'; ctx.fill();
}

// Config Papan
board = Chessboard('board', {
    draggable: true, position: 'start', onDragStart: onDragStart, onDrop: onDrop, onSnapEnd: onSnapEnd,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
});
showHomeScreen();
