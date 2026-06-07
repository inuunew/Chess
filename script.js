// Konfigurasi Variabel Global
let board = null;
let game = new Chess();
let stockfish;
let isAnalyzing = false;
let engineMessageHandler = null; // Router Pesan AI berdasarkan state

// Inisialisasi Elemen DOM
const statusEl = document.getElementById('game-status');
const eloSlider = document.getElementById('elo-slider');
const eloDisplay = document.getElementById('elo-display');
const evalFill = document.getElementById('eval-fill');
const logBox = document.getElementById('analysis-log');
const btnNewGame = document.getElementById('btn-new-game');
const btnResign = document.getElementById('btn-resign');
const btnAnalyze = document.getElementById('btn-analyze');
const canvas = document.getElementById('arrowCanvas');
const ctx = canvas.getContext('2d');

// Inisialisasi Stockfish Non-Blocking via Web Worker
// Dibungkus secara aman dengan Blob untuk menghindari error Cross-Origin (CORS) di browser modern
// sambil tetap secara murni menggunakan perintah fetch CDN sesuai instruksi Anda.
try {
    const workerScript = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    stockfish = new Worker(URL.createObjectURL(blob));
} catch (error) {
    // Fallback jika API Blob dilarang (meski jarang terjadi) langsung mengeksekusi sesuai perintah
    stockfish = new Worker('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
}

// Set up Global Message Handler untuk Stockfish
stockfish.onmessage = function(event) {
    if (engineMessageHandler) {
        engineMessageHandler(event.data);
    }
};

// Update ELO Display secara Real-Time
eloSlider.addEventListener('input', function() {
    eloDisplay.innerText = this.value;
});

// Sync ukuran Canvas agar persis menutupi Papan Catur
function syncCanvasSize() {
    const boardEl = document.getElementById('board');
    canvas.width = boardEl.clientWidth;
    canvas.height = boardEl.clientHeight;
}
window.addEventListener('resize', syncCanvasSize);

// Fungsi Utama: Menggambar Panah Visual untuk Langkah Terbaik
function drawBestMoveArrow(fromSquare, toSquare) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!fromSquare || !toSquare) return;

    const sqSize = canvas.width / 8;
    
    // Konversi notasi catur (misal 'e2') ke pixel XY
    const getCoords = (sq) => {
        const file = sq.charCodeAt(0) - 97; // 'a' = 0
        const rank = 8 - parseInt(sq[1]);   // '8' = 0
        return {
            x: (file + 0.5) * sqSize,
            y: (rank + 0.5) * sqSize
        };
    };

    const p1 = getCoords(fromSquare);
    const p2 = getCoords(toSquare);

    const headlen = sqSize * 0.3; // proporsi kepala panah
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    // Gambar Garis Panah Transparan Hijau
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(129, 182, 76, 0.7)';
    ctx.lineWidth = sqSize * 0.15;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Gambar Kepala Panah Segitiga
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(p2.x, p2.y);
    ctx.fillStyle = 'rgba(129, 182, 76, 0.9)';
    ctx.fill();
}

// Kalkulasi Visual Eval Bar
function updateEvalBar(absoluteCp) {
    // absoluteCp > 0 artinya Putih unggul. Max threshold cap pada +/- 1000 centipawn (10 poin)
    let clampedCp = Math.max(-1000, Math.min(1000, absoluteCp));
    // Rumus memetakan range [-1000, 1000] ke persen [0%, 100%] => 50 + (clamped / 20)
    let percent = 50 + (clampedCp / 20);
    evalFill.style.height = percent + '%';
}

// Router Pesan Game (Bermain Biasa)
function gameEngineRouter(line) {
    if (isAnalyzing) return; // Ignore jika dalam mode analisis
    
    // Parse Evaluasi Posisi
    if (line.includes('score cp')) {
        const match = line.match(/score cp (-?\d+)/);
        if (match) {
            let cp = parseInt(match[1]);
            // Nilai dari stockfish adalah relatif terhadap pihak yang giliran jalannya
            let absoluteCp = game.turn() === 'b' ? -cp : cp;
            updateEvalBar(absoluteCp);
        }
    } else if (line.includes('score mate')) {
        const match = line.match(/score mate (-?\d+)/);
        if (match) {
            let moves = parseInt(match[1]);
            let absoluteCp = (game.turn() === 'b' ? -moves : moves) > 0 ? 10000 : -10000;
            updateEvalBar(absoluteCp);
        }
    }

    // Eksekusi Langkah Bot
    if (line.startsWith('bestmove')) {
        const bestMove = line.split(' ')[1];
        if (bestMove && bestMove !== '(none)') {
            game.move({
                from: bestMove.substring(0, 2),
                to: bestMove.substring(2, 4),
                promotion: bestMove.length > 4 ? bestMove[4] : 'q'
            });
            board.position(game.fen());
            updateStatus();
        }
    }
}

// Logika Menjalankan Bot Stockfish
function makeBotMove() {
    if (game.game_over()) return;
    
    const elo = parseInt(eloSlider.value);
    
    // Otomatisasi Kedalaman AI Berdasarkan ELO
    let depth = 15;
    if (elo < 1000) depth = 3;
    else if (elo <= 2000) depth = 8;
    
    statusEl.innerText = "Bot Sedang Berpikir...";
    engineMessageHandler = gameEngineRouter;
    
    stockfish.postMessage('uci');
    stockfish.postMessage('setoption name UCI_LimitStrength value true');
    stockfish.postMessage('setoption name UCI_Elo value ' + elo);
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('go depth ' + depth);
}

// Logika Analisis Tunggal Berbasis Promise
function evaluatePosition(fen, depth) {
    return new Promise(resolve => {
        let currentCp = 0;
        let bestMoveResult = '';
        
        engineMessageHandler = function(line) {
            if (line.includes('score cp')) {
                const match = line.match(/score cp (-?\d+)/);
                if (match) currentCp = parseInt(match[1]);
            } else if (line.includes('score mate')) {
                const match = line.match(/score mate (-?\d+)/);
                if (match) currentCp = parseInt(match[1]) > 0 ? 10000 : -10000;
            }
            if (line.startsWith('bestmove')) {
                bestMoveResult = line.split(' ')[1];
                resolve({ cp: currentCp, bestMove: bestMoveResult });
            }
        };

        stockfish.postMessage('position fen ' + fen);
        stockfish.postMessage('go depth ' + depth);
    });
}

// Logika Utama Analisis Pasca-Game
async function startPostGameAnalysis() {
    isAnalyzing = true;
    btnAnalyze.disabled = true;
    btnNewGame.disabled = true;
    logBox.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const history = game.history({ verbose: true });
    if (history.length === 0) {
        logBox.innerHTML = '<p class="placeholder-text">Tidak ada langkah untuk dianalisis.</p>';
        btnNewGame.disabled = false;
        return;
    }

    const tempGame = new Chess();
    let previousAbsoluteCp = 0; // Mulai dari evaluasi seimbang

    for (let i = 0; i < history.length; i++) {
        const move = history[i];
        const isWhiteMove = move.color === 'w';
        
        // Pindahkan game temp ke posisi SEBELUM langkah dimainkan
        statusEl.innerText = `Menganalisis langkah ke-${i + 1}...`;
        board.position(tempGame.fen());
        
        // Dapatkan evaluasi Engine untuk state ini (mencari bestmove)
        const preResult = await evaluatePosition(tempGame.fen(), 10);
        const preAbsoluteCp = isWhiteMove ? preResult.cp : -preResult.cp;
        const recommendedMove = preResult.bestMove;

        // Terapkan langkah yang dimainkan pemain secara historis
        tempGame.move(move.san);
        board.position(tempGame.fen());
        
        // Dapatkan evaluasi Engine SESUDAH langkah dijalankan
        const postResult = await evaluatePosition(tempGame.fen(), 10);
        // postResult.cp didapat dari sudut pandang lawan, maka balikkan tanda logic
        const postAbsoluteCp = !isWhiteMove ? postResult.cp : -postResult.cp;

        updateEvalBar(postAbsoluteCp);

        // Kalkulasi Centipawn Delta (Delta Evaluasi)
        // Jika White jalan, kita mau postAbsoluteCp > preAbsoluteCp (Delta positif = bagus)
        const delta = isWhiteMove ? (postAbsoluteCp - preAbsoluteCp) : (preAbsoluteCp - postAbsoluteCp);
        
        // Klasifikasi Kualitas Langkah
        let classification = "Book/Theory";
        let cssClass = "";
        
        if (i > 4) { // Langkah 1-5 dianggap Opening Book secara generalisasi
            if (delta >= -10) { classification = "Best Move"; cssClass = "excellent"; }
            else if (delta >= -25) { classification = "Excellent"; cssClass = "excellent"; }
            else if (delta >= -50) { classification = "Good"; cssClass = ""; }
            else if (delta >= -100) { classification = "Inaccuracy"; cssClass = "inaccuracy"; }
            else if (delta >= -300) { classification = "Mistake"; cssClass = "mistake"; }
            else { classification = "Blunder (??)"; cssClass = "blunder"; }
        }

        // Parse Koordinat Panah Best Move
        let fromSq = recommendedMove.substring(0, 2);
        let toSq = recommendedMove.substring(2, 4);
        drawBestMoveArrow(fromSq, toSq);

        // Render hasil analisis ke Log HTML
        const logHtml = `
            <div class="log-entry ${cssClass}">
                <strong>Langkah ${Math.floor(i/2) + 1}${isWhiteMove ? '.' : '...'} ${move.san}</strong> 
                — ${classification} <br>
                <span style="font-size: 11px; color: #a1a1a1;">
                    (Evaluasi: ${(postAbsoluteCp/100).toFixed(2)} | Rekomendasi: ${fromSq}-${toSq})
                </span>
            </div>
        `;
        logBox.insertAdjacentHTML('beforeend', logHtml);
        logBox.scrollTop = logBox.scrollHeight;

        // Timeout untuk memperlambat loop (Animasi) agar dapat dilihat Player
        await new Promise(r => setTimeout(r, 1200)); 
    }

    statusEl.innerText = "Analisis Selesai.";
    btnNewGame.disabled = false;
    isAnalyzing = false;
}

// Sistem Papan & Event Validasi Gerak (Drag & Drop)
function onDragStart(source, piece, position, orientation) {
    // Cegah gerak bila game selesai, sedang analisis, atau mencoba gerakkan hitam (bot)
    if (game.game_over() || isAnalyzing || piece.search(/^b/) !== -1) {
        return false;
    }
}

function onDrop(source, target) {
    if (isAnalyzing) return 'snapback';
    
    // Coba eksekusi legalitas move di chess.js
    let move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Simplifikasi: Otomatis promosi jadi Menteri
    });

    // Jika move ilegal (null), kembalikan posisi bidak
    if (move === null) return 'snapback';

    updateStatus();
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Hapus panah jika ada sisa
    
    // Panggil Bot setelah Pemain Selesai Jalan
    window.setTimeout(makeBotMove, 250);
}

function onSnapEnd() {
    if (!isAnalyzing) {
        board.position(game.fen());
    }
}

function updateStatus() {
    let statusHTML = '';
    let moveColor = game.turn() === 'w' ? 'Putih' : 'Hitam';

    if (game.in_checkmate()) {
        statusHTML = `Game Over. ${moveColor} Skakmat!`;
        endGameTrigger();
    } else if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
        statusHTML = 'Game Over. Seri (Draw).';
        endGameTrigger();
    } else {
        statusHTML = `Giliran ${moveColor}`;
        if (game.in_check()) {
            statusHTML += ', ' + moveColor + ' sedang Skak!';
        }
    }
    statusEl.innerText = statusHTML;
}

function endGameTrigger() {
    btnResign.disabled = true;
    btnAnalyze.disabled = false;
}

// Konfigurasi Chessboard.js
const boardConfig = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
};

// Inisialisasi Pertama
board = Chessboard('board', boardConfig);
syncCanvasSize();

// Event Listener Tombol
btnNewGame.addEventListener('click', () => {
    game.reset();
    board.start();
    isAnalyzing = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    logBox.innerHTML = '<p class="placeholder-text">Permainan sedang berlangsung...</p>';
    btnResign.disabled = false;
    btnAnalyze.disabled = true;
    updateEvalBar(0);
    updateStatus();
});

btnResign.addEventListener('click', () => {
    if (game.game_over() || isAnalyzing) return;
    statusEl.innerText = "Anda Menyerah. Game Over.";
    endGameTrigger();
});

btnAnalyze.addEventListener('click', startPostGameAnalysis);
