// --- DEKLARASI STATE GLOBAL ---
let board = null;
let game = new Chess();
let stockfish;
let currentAppMode = 'home'; // 'home', 'game', 'analysis'
let gameElo = 1500;

// Variabel Khusus Analisis
let analysisHistory = []; // Array langkah
let currentAnalysisIndex = -1; // -1 berarti posisi awal (sebelum langkah pertama)

// --- INISIALISASI DOM ELEMEN ---
// Views
const viewHome = document.getElementById('view-home');
const viewSetup = document.getElementById('view-setup');
const viewBoardArea = document.getElementById('view-board-area');
const panelIngame = document.getElementById('panel-ingame');
const panelAnalysis = document.getElementById('panel-analysis');

// Elemen Home & Setup
const matchListEl = document.getElementById('match-list');
const eloSlider = document.getElementById('elo-slider');
const eloDisplay = document.getElementById('elo-display');

// Buttons
document.getElementById('btn-goto-setup').addEventListener('click', showSetupScreen);
document.getElementById('btn-cancel-setup').addEventListener('click', showHomeScreen);
document.getElementById('btn-start-game').addEventListener('click', startNewGame);
document.getElementById('btn-resign').addEventListener('click', handleResign);
document.getElementById('btn-back-home').addEventListener('click', showHomeScreen);

// Tombol Navigasi Analisis
document.getElementById('btn-prev-move').addEventListener('click', analysisPrevMove);
document.getElementById('btn-next-move').addEventListener('click', analysisNextMove);
document.getElementById('btn-best-move').addEventListener('click', fetchBestMoveAnalysis);

// Canvas
const canvas = document.getElementById('arrowCanvas');
const ctx = canvas.getContext('2d');
const logBox = document.getElementById('analysis-log');

// --- INISIALISASI WEB WORKER STOCKFISH ---
try {
    const workerScript = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    stockfish = new Worker(URL.createObjectURL(blob));
} catch (error) {
    stockfish = new Worker('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
}

// Router Pesan Stockfish
stockfish.onmessage = function(event) {
    const line = event.data;
    
    // Tangkap langkah bot saat bermain
    if (currentAppMode === 'game' && line.startsWith('bestmove')) {
        const bestMove = line.split(' ')[1];
        if (bestMove && bestMove !== '(none)') {
            game.move({
                from: bestMove.substring(0, 2),
                to: bestMove.substring(2, 4),
                promotion: bestMove.length > 4 ? bestMove[4] : 'q'
            });
            board.position(game.fen());
            checkGameEnd();
        }
    }

    // Tangkap langkah analisis saat tombol "Cari Langkah Terbaik" diklik
    if (currentAppMode === 'analysis' && line.startsWith('bestmove')) {
        const bestMove = line.split(' ')[1];
        if (bestMove && bestMove !== '(none)') {
            drawBestMoveArrow(bestMove.substring(0, 2), bestMove.substring(2, 4));
            document.getElementById('btn-best-move').innerText = "💡 Tampilkan Langkah Terbaik";
            document.getElementById('btn-best-move').disabled = false;
        }
    }
};

// --- FUNGSI MANAJEMEN VIEW (SPA ROUTING) ---

function hideAllViews() {
    viewHome.classList.add('hidden');
    viewSetup.classList.add('hidden');
    viewBoardArea.classList.add('hidden');
    panelIngame.classList.add('hidden');
    panelAnalysis.classList.add('hidden');
}

function showHomeScreen() {
    currentAppMode = 'home';
    hideAllViews();
    viewHome.classList.remove('hidden');
    renderMatchHistory();
}

function showSetupScreen() {
    hideAllViews();
    viewSetup.classList.remove('hidden');
}

function enterGameMode() {
    currentAppMode = 'game';
    hideAllViews();
    viewBoardArea.classList.remove('hidden');
    panelIngame.classList.remove('hidden');
    syncCanvasSize();
}

function enterAnalysisMode(matchData) {
    currentAppMode = 'analysis';
    hideAllViews();
    viewBoardArea.classList.remove('hidden');
    panelAnalysis.classList.remove('hidden');
    syncCanvasSize();
    setupAnalysisBoard(matchData);
}

// --- LOGIKA PENYIMPANAN (LOCAL STORAGE) ---

function getMatches() {
    return JSON.parse(localStorage.getItem('chess_history')) || [];
}

function saveMatch(result) {
    const matches = getMatches();
    const matchData = {
        id: Date.now(),
        date: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit' }),
        elo: gameElo,
        pgn: game.pgn(),
        result: result // 'Menang', 'Kalah', 'Seri'
    };
    matches.unshift(matchData); // Tambahkan di paling atas
    localStorage.setItem('chess_history', JSON.stringify(matches));
}

function renderMatchHistory() {
    const matches = getMatches();
    matchListEl.innerHTML = '';
    
    if (matches.length === 0) {
        matchListEl.innerHTML = '<div class="empty-state">Belum ada riwayat pertandingan.</div>';
        return;
    }

    matches.forEach(match => {
        let cssClass = match.result === 'Menang' ? 'win' : (match.result === 'Kalah' ? 'loss' : 'draw');
        
        const item = document.createElement('div');
        item.className = `match-item ${cssClass}`;
        item.innerHTML = `
            <div>
                <div class="match-item-info">vs Bot ELO ${match.elo} - <strong>${match.result}</strong></div>
                <div class="match-item-date">${match.date}</div>
            </div>
            <div>▶ Analisis</div>
        `;
        // Klik list langsung masuk ke Analisis
        item.addEventListener('click', () => enterAnalysisMode(match));
        matchListEl.appendChild(item);
    });
}

// --- LOGIKA IN-GAME ---

eloSlider.addEventListener('input', function() {
    eloDisplay.innerText = this.value;
    gameElo = this.value;
});

function startNewGame() {
    gameElo = parseInt(eloSlider.value);
    game.reset();
    board.start();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    enterGameMode();
}

function makeBotMove() {
    if (game.game_over()) return;
    stockfish.postMessage('uci');
    stockfish.postMessage('setoption name UCI_LimitStrength value true');
    stockfish.postMessage('setoption name UCI_Elo value ' + gameElo);
    stockfish.postMessage('position fen ' + game.fen());
    
    // Otomatisasi depth sesuai Elo agar realistis
    let depth = gameElo < 1000 ? 3 : (gameElo <= 2000 ? 8 : 15);
    stockfish.postMessage('go depth ' + depth);
}

function checkGameEnd() {
    if (game.in_checkmate()) {
        const result = game.turn() === 'w' ? 'Kalah' : 'Menang';
        alert(`Skakmat! Anda ${result}.`);
        saveMatch(result);
        showHomeScreen();
    } else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
        alert('Permainan Seri (Draw).');
        saveMatch('Seri');
        showHomeScreen();
    }
}

function handleResign() {
    if (confirm("Yakin ingin menyerah?")) {
        saveMatch('Kalah');
        alert("Anda menyerah. Game tersimpan.");
        showHomeScreen();
    }
}

// Interaksi Drag & Drop In-Game
function onDragStart(source, piece) {
    if (currentAppMode !== 'game' || game.game_over() || piece.search(/^b/) !== -1) {
        return false;
    }
}

function onDrop(source, target) {
    if (currentAppMode !== 'game') return 'snapback';
    
    let move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    checkGameEnd();
    window.setTimeout(makeBotMove, 250);
}

function onSnapEnd() {
    if (currentAppMode === 'game') board.position(game.fen());
}

// --- LOGIKA ANALISIS (POST-GAME) ---

function setupAnalysisBoard(matchData) {
    // Buat instance game terpisah untuk mengekstrak riwayat tanpa merusak state utama
    const tempAnalyzer = new Chess();
    tempAnalyzer.load_pgn(matchData.pgn);
    analysisHistory = tempAnalyzer.history({ verbose: true });
    
    game.reset(); // Set FEN ke posisi awal standar
    board.position(game.fen());
    currentAnalysisIndex = -1;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderAnalysisLog();
}

function renderAnalysisLog() {
    logBox.innerHTML = '';
    analysisHistory.forEach((move, index) => {
        const isWhite = index % 2 === 0;
        const stepNum = Math.floor(index / 2) + 1;
        const stepText = isWhite ? `${stepNum}. ${move.san}` : `${stepNum}... ${move.san}`;
        
        const div = document.createElement('div');
        div.className = 'log-item';
        div.id = `log-move-${index}`;
        div.innerText = stepText;
        
        // Klik log langsung melompat ke langkah tersebut
        div.addEventListener('click', () => jumpToAnalysisMove(index));
        logBox.appendChild(div);
    });
}

function updateAnalysisUI() {
    board.position(game.fen());
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Hapus panah saat pindah langkah
    
    // Highlight log aktif
    document.querySelectorAll('.log-item').forEach(el => el.classList.remove('active'));
    if (currentAnalysisIndex >= 0) {
        const activeLog = document.getElementById(`log-move-${currentAnalysisIndex}`);
        if (activeLog) {
            activeLog.classList.add('active');
            activeLog.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }
}

function analysisNextMove() {
    if (currentAnalysisIndex < analysisHistory.length - 1) {
        currentAnalysisIndex++;
        game.move(analysisHistory[currentAnalysisIndex].san);
        updateAnalysisUI();
    }
}

function analysisPrevMove() {
    if (currentAnalysisIndex >= 0) {
        game.undo();
        currentAnalysisIndex--;
        updateAnalysisUI();
    }
}

function jumpToAnalysisMove(targetIndex) {
    if (targetIndex === currentAnalysisIndex) return;
    
    // Jika maju
    while (currentAnalysisIndex < targetIndex) {
        currentAnalysisIndex++;
        game.move(analysisHistory[currentAnalysisIndex].san);
    }
    // Jika mundur
    while (currentAnalysisIndex > targetIndex) {
        game.undo();
        currentAnalysisIndex--;
    }
    updateAnalysisUI();
}

function fetchBestMoveAnalysis() {
    if (currentAppMode !== 'analysis') return;
    
    const btn = document.getElementById('btn-best-move');
    btn.innerText = "⏳ Sedang Menghitung...";
    btn.disabled = true;
    
    // Minta Stockfish mencari bestmove di posisi saat ini
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth 12');
}

// --- UTILITAS MENGGAMBAR PANAH CANVAS ---

function syncCanvasSize() {
    const boardEl = document.getElementById('board');
    if (boardEl.clientWidth > 0) {
        canvas.width = boardEl.clientWidth;
        canvas.height = boardEl.clientHeight;
    }
}
window.addEventListener('resize', syncCanvasSize);

function drawBestMoveArrow(fromSquare, toSquare) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sqSize = canvas.width / 8;
    
    const getCoords = (sq) => {
        const file = sq.charCodeAt(0) - 97;
        const rank = 8 - parseInt(sq[1]);
        return { x: (file + 0.5) * sqSize, y: (rank + 0.5) * sqSize };
    };

    const p1 = getCoords(fromSquare);
    const p2 = getCoords(toSquare);
    const headlen = sqSize * 0.3;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(129, 182, 76, 0.7)';
    ctx.lineWidth = sqSize * 0.15;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(p2.x, p2.y);
    ctx.fillStyle = 'rgba(129, 182, 76, 0.9)';
    ctx.fill();
}

// --- INISIALISASI PERTAMA KALI JALAN ---
board = Chessboard('board', {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
});

// Mulai aplikasi dengan merender layar Home
showHomeScreen();
