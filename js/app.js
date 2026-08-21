(function () {
  'use strict';

  const PIECE_GLYPHS = {
    wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
    bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
  };
  const PIECE_RU_NAMES = {
    p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король',
  };

  const boardEl = document.getElementById('board');
  const statusBarEl = document.getElementById('status-bar');
  const moveListEl = document.getElementById('move-list');
  const capturedWhiteEl = document.getElementById('captured-white');
  const capturedBlackEl = document.getElementById('captured-black');
  const difficultyButtonsEl = document.getElementById('difficulty-buttons');
  const newGameBtn = document.getElementById('new-game-btn');
  const undoBtn = document.getElementById('undo-btn');
  const flipBtn = document.getElementById('flip-btn');
  const colorToggleBtn = document.getElementById('color-toggle-btn');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const promotionModal = document.getElementById('promotion-modal');
  const promotionChoicesEl = document.getElementById('promotion-choices');
  const gameOverModal = document.getElementById('game-over-modal');
  const gameOverTitleEl = document.getElementById('game-over-title');
  const gameOverSubtitleEl = document.getElementById('game-over-subtitle');
  const gameOverCloseBtn = document.getElementById('game-over-close');
  const thinkingIndicatorEl = document.getElementById('thinking-indicator');

  let gameState = ChessEngine.createInitialState();
  let stateHistory = [ChessEngine.cloneState(gameState)];
  let sanHistory = [];
  let selectedSquare = null;
  let legalMovesForSelected = [];
  let boardFlipped = false;
  let humanColor = 'w';
  let difficultyKey = 'amateur';
  let aiThinking = false;
  let soundOn = true;
  let capturedByWhite = [];
  let capturedByBlack = [];

  // ---------- Sound ----------
  let audioCtx = null;
  function playTone(freq, duration, type) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* audio unavailable, ignore */ }
  }
  function playMoveSound(move) {
    if (move.captured) playTone(220, 0.18, 'square');
    else playTone(440, 0.12, 'sine');
  }

  // ---------- SAN notation ----------
  function pieceLetter(type) {
    return type === 'p' ? '' : type.toUpperCase();
  }

  function toSAN(stateBefore, move, legalMovesAtTime, stateAfter) {
    if (move.isCastle === 'K') return appendCheckSuffix('O-O', stateAfter);
    if (move.isCastle === 'Q') return appendCheckSuffix('O-O-O', stateAfter);

    const destination = ChessEngine.squareName(move.to[0], move.to[1]);
    const isCapture = !!move.captured;
    let san = '';

    if (move.piece[1] === 'p') {
      if (isCapture) {
        const fromFile = 'abcdefgh'[move.from[1]];
        san = fromFile + 'x' + destination;
      } else {
        san = destination;
      }
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      const sameTypeMoves = legalMovesAtTime.filter((m) =>
        m.piece === move.piece && m.to[0] === move.to[0] && m.to[1] === move.to[1] &&
        (m.from[0] !== move.from[0] || m.from[1] !== move.from[1]));
      let disambiguation = '';
      if (sameTypeMoves.length > 0) {
        const sameFile = sameTypeMoves.some((m) => m.from[1] === move.from[1]);
        const sameRank = sameTypeMoves.some((m) => m.from[0] === move.from[0]);
        if (!sameFile) disambiguation = 'abcdefgh'[move.from[1]];
        else if (!sameRank) disambiguation = String(8 - move.from[0]);
        else disambiguation = ChessEngine.squareName(move.from[0], move.from[1]);
      }
      san = pieceLetter(move.piece[1]) + disambiguation + (isCapture ? 'x' : '') + destination;
    }
    return appendCheckSuffix(san, stateAfter);
  }

  function appendCheckSuffix(san, stateAfter) {
    const status = ChessEngine.getGameStatus(stateAfter);
    if (status.over && status.reason === 'checkmate') return san + '#';
    if (!status.over && status.inCheck) return san + '+';
    return san;
  }

  // ---------- Rendering ----------
  function squareColorClass(r, c) {
    return (r + c) % 2 === 0 ? 'sq-light' : 'sq-dark';
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    const status = gameState.over ? null : ChessEngine.getGameStatus(gameState);
    const kingInCheckPos = (status && status.inCheck) ? findKingPos(gameState, gameState.turn) : null;

    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const r = boardFlipped ? 7 - displayRow : displayRow;
        const c = boardFlipped ? 7 - displayCol : displayCol;
        const sq = document.createElement('div');
        sq.className = `square ${squareColorClass(r, c)}`;
        sq.dataset.row = String(r);
        sq.dataset.col = String(c);

        if (gameState.lastMove) {
          const { from, to } = gameState.lastMove;
          if ((from[0] === r && from[1] === c) || (to[0] === r && to[1] === c)) {
            sq.classList.add('last-move');
          }
        }
        if (kingInCheckPos && kingInCheckPos[0] === r && kingInCheckPos[1] === c) {
          sq.classList.add('king-check');
        }
        if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c) {
          sq.classList.add('selected');
        }

        const piece = gameState.board[r][c];
        if (piece) {
          const pieceEl = document.createElement('span');
          pieceEl.className = `piece piece-${piece[0]}`;
          pieceEl.textContent = PIECE_GLYPHS[piece];
          pieceEl.draggable = true;
          pieceEl.dataset.row = String(r);
          pieceEl.dataset.col = String(c);
          sq.appendChild(pieceEl);
        }

        const isLegalTarget = legalMovesForSelected.some((m) => m.to[0] === r && m.to[1] === c);
        if (isLegalTarget) {
          const dot = document.createElement('span');
          dot.className = piece ? 'move-hint capture-hint' : 'move-hint';
          sq.appendChild(dot);
        }

        sq.addEventListener('click', () => onSquareClick(r, c));
        sq.addEventListener('dragover', (e) => e.preventDefault());
        sq.addEventListener('drop', (e) => {
          e.preventDefault();
          const fr = Number(e.dataTransfer.getData('text/from-row'));
          const fc = Number(e.dataTransfer.getData('text/from-col'));
          handleMoveAttempt([fr, fc], [r, c]);
        });

        boardEl.appendChild(sq);
      }
    }

    boardEl.querySelectorAll('.piece').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/from-row', el.dataset.row);
        e.dataTransfer.setData('text/from-col', el.dataset.col);
        selectedSquare = [Number(el.dataset.row), Number(el.dataset.col)];
        updateLegalMovesForSelection();
        renderBoard();
      });
    });

    // File/rank labels
    renderLabels();
  }

  function renderLabels() {
    const filesTop = document.getElementById('files-label');
    const ranksLeft = document.getElementById('ranks-label');
    if (!filesTop || !ranksLeft) return;
    const files = boardFlipped ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = boardFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    filesTop.innerHTML = files.map((f) => `<span>${f}</span>`).join('');
    ranksLeft.innerHTML = ranks.map((rr) => `<span>${rr}</span>`).join('');
  }

  function findKingPos(state, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c] === color + 'k') return [r, c];
      }
    }
    return null;
  }

  function updateLegalMovesForSelection() {
    if (!selectedSquare) { legalMovesForSelected = []; return; }
    const [r, c] = selectedSquare;
    const piece = gameState.board[r][c];
    if (!piece || piece[0] !== gameState.turn) { legalMovesForSelected = []; return; }
    const all = ChessEngine.generateLegalMoves(gameState, gameState.turn);
    legalMovesForSelected = all.filter((m) => m.from[0] === r && m.from[1] === c);
  }

  function onSquareClick(r, c) {
    if (aiThinking || isGameOver()) return;
    if (gameState.turn !== humanColor) return;

    const piece = gameState.board[r][c];
    if (selectedSquare) {
      const [sr, sc] = selectedSquare;
      if (sr === r && sc === c) {
        selectedSquare = null;
        legalMovesForSelected = [];
        renderBoard();
        return;
      }
      const canMoveHere = legalMovesForSelected.some((m) => m.to[0] === r && m.to[1] === c);
      if (canMoveHere) {
        handleMoveAttempt([sr, sc], [r, c]);
        return;
      }
      if (piece && piece[0] === gameState.turn) {
        selectedSquare = [r, c];
        updateLegalMovesForSelection();
        renderBoard();
        return;
      }
      selectedSquare = null;
      legalMovesForSelected = [];
      renderBoard();
      return;
    }
    if (piece && piece[0] === gameState.turn) {
      selectedSquare = [r, c];
      updateLegalMovesForSelection();
      renderBoard();
    }
  }

  function handleMoveAttempt(from, to) {
    const all = ChessEngine.generateLegalMoves(gameState, gameState.turn);
    const candidates = all.filter((m) => m.from[0] === from[0] && m.from[1] === from[1] &&
      m.to[0] === to[0] && m.to[1] === to[1]);
    if (candidates.length === 0) {
      selectedSquare = null;
      legalMovesForSelected = [];
      renderBoard();
      return;
    }
    if (candidates.length > 1) {
      showPromotionModal(candidates, (chosen) => commitMove(chosen));
      return;
    }
    commitMove(candidates[0]);
  }

  function commitMove(move) {
    const legalMovesAtTime = ChessEngine.generateLegalMoves(gameState, gameState.turn);
    const stateAfter = ChessEngine.applyMove(gameState, move);
    const san = toSAN(gameState, move, legalMovesAtTime, stateAfter);

    if (move.captured) {
      if (move.piece[0] === 'w') capturedByWhite.push(move.captured);
      else capturedByBlack.push(move.captured);
    }

    gameState = stateAfter;
    stateHistory.push(ChessEngine.cloneState(gameState));
    sanHistory.push(san);
    selectedSquare = null;
    legalMovesForSelected = [];

    playMoveSound(move);
    renderBoard();
    renderMoveList();
    renderCaptured();
    updateStatusBar();

    const status = ChessEngine.getGameStatus(gameState);
    if (status.over) {
      onGameOver(status);
      return;
    }

    if (gameState.turn !== humanColor) {
      scheduleAiMove();
    }
  }

  function scheduleAiMove() {
    aiThinking = true;
    thinkingIndicatorEl.classList.remove('hidden');
    setTimeout(() => {
      const move = ChessAI.pickAiMove(gameState, difficultyKey);
      aiThinking = false;
      thinkingIndicatorEl.classList.add('hidden');
      if (!move) return;
      commitMove(move);
    }, 260);
  }

  function isGameOver() {
    return ChessEngine.getGameStatus(gameState).over;
  }

  // ---------- Promotion modal ----------
  function showPromotionModal(candidates, onChosen) {
    promotionChoicesEl.innerHTML = '';
    const color = candidates[0].piece[0];
    const order = ['q', 'r', 'b', 'n'];
    order.forEach((type) => {
      const move = candidates.find((m) => m.promotion === type);
      if (!move) return;
      const btn = document.createElement('button');
      btn.className = 'promotion-choice';
      btn.innerHTML = `<span class="piece piece-${color}">${PIECE_GLYPHS[color + type]}</span>`;
      btn.title = PIECE_RU_NAMES[type];
      btn.addEventListener('click', () => {
        promotionModal.classList.add('hidden');
        onChosen(move);
      });
      promotionChoicesEl.appendChild(btn);
    });
    promotionModal.classList.remove('hidden');
  }

  // ---------- Move list & captured pieces ----------
  function renderMoveList() {
    moveListEl.innerHTML = '';
    for (let i = 0; i < sanHistory.length; i += 2) {
      const li = document.createElement('li');
      const moveNum = i / 2 + 1;
      const whiteSan = sanHistory[i] || '';
      const blackSan = sanHistory[i + 1] || '';
      li.innerHTML = `<span class="move-num">${moveNum}.</span> <span class="move-san">${whiteSan}</span> <span class="move-san">${blackSan}</span>`;
      moveListEl.appendChild(li);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  function renderCaptured() {
    capturedWhiteEl.innerHTML = capturedByWhite
      .map((p) => `<span class="piece piece-${p[0]} mini">${PIECE_GLYPHS[p]}</span>`).join('');
    capturedBlackEl.innerHTML = capturedByBlack
      .map((p) => `<span class="piece piece-${p[0]} mini">${PIECE_GLYPHS[p]}</span>`).join('');
  }

  // ---------- Status bar ----------
  function updateStatusBar() {
    const status = ChessEngine.getGameStatus(gameState);
    const colorRu = gameState.turn === 'w' ? 'белых' : 'чёрных';
    const colorEn = gameState.turn === 'w' ? 'White' : 'Black';

    if (status.over) {
      statusBarEl.textContent = describeGameOver(status);
      return;
    }
    if (status.inCheck) {
      statusBarEl.textContent = `Шах! Ход ${colorRu} · Check! ${colorEn} to move`;
      statusBarEl.classList.add('status-check');
    } else {
      statusBarEl.textContent = `Ход ${colorRu} · ${colorEn} to move`;
      statusBarEl.classList.remove('status-check');
    }
  }

  function describeGameOver(status) {
    if (status.reason === 'checkmate') {
      const winner = status.result === 'white_wins' ? 'Белые' : 'Чёрные';
      const winnerEn = status.result === 'white_wins' ? 'White' : 'Black';
      return `Мат! ${winner} побеждают · Checkmate! ${winnerEn} wins`;
    }
    if (status.reason === 'stalemate') return 'Пат — ничья · Stalemate — draw';
    if (status.reason === 'fifty_move') return 'Ничья по правилу 50 ходов · Draw (50-move rule)';
    if (status.reason === 'repetition') return 'Ничья повторением позиции · Draw (repetition)';
    if (status.reason === 'insufficient_material') return 'Ничья — недостаточно материала · Draw (insufficient material)';
    return 'Игра окончена · Game over';
  }

  function onGameOver(status) {
    playTone(160, 0.4, 'triangle');
    let title = 'Игра окончена';
    let subtitle = 'Game over';
    if (status.reason === 'checkmate') {
      const humanWon = (status.result === 'white_wins' && humanColor === 'w') ||
        (status.result === 'black_wins' && humanColor === 'b');
      title = humanWon ? 'Победа! Мат сопернику' : 'Поражение — вам поставили мат';
      subtitle = humanWon ? 'Checkmate — you win!' : 'Checkmate — the computer wins';
    } else {
      title = 'Ничья';
      subtitle = describeGameOver(status).split('·')[1] || 'Draw';
    }
    gameOverTitleEl.textContent = title;
    gameOverSubtitleEl.textContent = subtitle;
    gameOverModal.classList.remove('hidden');
  }

  // ---------- Controls ----------
  function newGame() {
    gameState = ChessEngine.createInitialState();
    stateHistory = [ChessEngine.cloneState(gameState)];
    sanHistory = [];
    selectedSquare = null;
    legalMovesForSelected = [];
    capturedByWhite = [];
    capturedByBlack = [];
    aiThinking = false;
    thinkingIndicatorEl.classList.add('hidden');
    gameOverModal.classList.add('hidden');
    renderBoard();
    renderMoveList();
    renderCaptured();
    updateStatusBar();
    if (gameState.turn !== humanColor) {
      scheduleAiMove();
    }
  }

  function undoMove() {
    if (aiThinking) return;
    // Undo both the AI's move and the human's preceding move, so it's the human's turn again.
    const stepsBack = (stateHistory.length > 2 && gameState.turn === humanColor) ? 2 : 1;
    for (let i = 0; i < stepsBack; i++) {
      if (stateHistory.length > 1) {
        stateHistory.pop();
        sanHistory.pop();
      }
    }
    gameState = ChessEngine.cloneState(stateHistory[stateHistory.length - 1]);
    recomputeCapturedFromHistory();
    selectedSquare = null;
    legalMovesForSelected = [];
    gameOverModal.classList.add('hidden');
    renderBoard();
    renderMoveList();
    renderCaptured();
    updateStatusBar();
  }

  function recomputeCapturedFromHistory() {
    // Rebuild captured lists by diffing consecutive board states.
    capturedByWhite = [];
    capturedByBlack = [];
    for (let i = 1; i < stateHistory.length; i++) {
      const prev = stateHistory[i - 1];
      const cur = stateHistory[i];
      const prevCounts = countPieces(prev.board);
      const curCounts = countPieces(cur.board);
      Object.keys(prevCounts).forEach((key) => {
        const diff = prevCounts[key] - (curCounts[key] || 0);
        if (diff > 0) {
          for (let k = 0; k < diff; k++) {
            if (key[0] === 'w') capturedByBlack.push(key);
            else capturedByWhite.push(key);
          }
        }
      });
    }
  }
  function countPieces(board) {
    const counts = {};
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) counts[p] = (counts[p] || 0) + 1;
    }
    return counts;
  }

  function flipBoard() {
    boardFlipped = !boardFlipped;
    renderBoard();
  }

  function toggleColor() {
    if (stateHistory.length > 1) {
      const proceed = window.confirm('Начать новую партию и играть за другой цвет? / Start a new game to switch sides?');
      if (!proceed) return;
    }
    humanColor = humanColor === 'w' ? 'b' : 'w';
    boardFlipped = humanColor === 'b';
    colorToggleBtn.textContent = humanColor === 'w' ? 'Играть за чёрных' : 'Играть за белых';
    newGame();
  }

  function toggleSound() {
    soundOn = !soundOn;
    soundToggleBtn.textContent = soundOn ? '🔔 Звук' : '🔕 Тихо';
    soundToggleBtn.classList.toggle('muted', !soundOn);
  }

  function setDifficulty(key) {
    difficultyKey = key;
    Array.from(difficultyButtonsEl.children).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.level === key);
    });
  }

  // ---------- Wire up events ----------
  difficultyButtonsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-level]');
    if (!btn) return;
    setDifficulty(btn.dataset.level);
  });
  newGameBtn.addEventListener('click', newGame);
  undoBtn.addEventListener('click', undoMove);
  flipBtn.addEventListener('click', flipBoard);
  colorToggleBtn.addEventListener('click', toggleColor);
  soundToggleBtn.addEventListener('click', toggleSound);
  gameOverCloseBtn.addEventListener('click', () => gameOverModal.classList.add('hidden'));

  // ---------- Init ----------
  setDifficulty('amateur');
  renderBoard();
  renderMoveList();
  renderCaptured();
  updateStatusBar();
})();
