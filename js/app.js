/**
 * Русскiя Шахматы — главный управляющий модуль.
 *
 * Связываетъ вмѣстѣ: правила (chess-engine), движокъ (engine-manager),
 * разборъ (analysis), рейтингъ (rating), часы (clock), музыку (music)
 * и игру по сѣти (multiplayer).
 */

(function () {
  'use strict';

  // ============================ СОСТОЯНІЕ ============================

  const PIECE_NAMES = { p: 'пѣшка', n: 'конь', b: 'слонъ', r: 'ладья', q: 'ферзь', k: 'король' };
  const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  let state = ChessEngine.createInitialState();
  let history = [ChessEngine.cloneState(state)];   // позиціи: history[i] — послѣ i ходовъ
  let sanList = [];
  let moveList = [];                                // объекты ходовъ
  let analyses = [];                                // разборъ по ходамъ

  let selected = null;
  let legalForSelected = [];
  let flipped = false;
  let humanColor = 'w';
  let colorChoice = 'w';
  let levelKey = 'club';
  let timeKey = '5+3';
  let mode = 'engine';                              // 'engine' | 'network'
  let engineThinking = false;
  let viewIndex = null;                             // null = живая партія, иначе индексъ позиціи
  let gameFinished = false;
  let ratingApplied = false;
  let generation = 0;
  let clock = null;
  let rating = ChessRating.load();
  let bestMoveArrow = null;
  let liveEvalCp = 0;
  let analysisRunning = false;

  // ============================ DOM ============================

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const arrowLayer = $('arrow-layer');
  const statusEl = $('status-bar');
  const calloutEl = $('move-callout');
  const engineNoteEl = $('engine-note');
  const moveListEl = $('move-list');
  const evalFillEl = $('eval-fill');
  const evalTextEl = $('eval-text');

  // ============================ УТИЛИТЫ ============================

  function pieceSvg(piece, cls) {
    return `<svg class="${cls || 'piece'} piece-${piece[0]}" viewBox="0 0 45 45"><use href="#pc-${piece[1]}"></use></svg>`;
  }

  function ruColor(c) { return c === 'w' ? 'бѣлые' : 'чёрные'; }
  function ruColorCap(c) { return c === 'w' ? 'Бѣлые' : 'Чёрные'; }
  // родительный/винительный падежъ: «ходъ бѣлыхъ», «играете за чёрныхъ»
  function ruColorGen(c) { return c === 'w' ? 'бѣлыхъ' : 'чёрныхъ'; }

  function currentState() {
    return viewIndex === null ? state : history[viewIndex];
  }

  function isLive() { return viewIndex === null || viewIndex === history.length - 1; }

  // ============================ НОТАЦІЯ ============================

  function toSan(before, move, legal, after) {
    if (move.isCastle === 'K') return suffix('O-O', after);
    if (move.isCastle === 'Q') return suffix('O-O-O', after);
    const dest = ChessEngine.squareName(move.to[0], move.to[1]);
    let san;
    if (move.piece[1] === 'p') {
      san = move.captured ? 'abcdefgh'[move.from[1]] + 'x' + dest : dest;
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      const rivals = legal.filter((m) =>
        m.piece === move.piece && m.to[0] === move.to[0] && m.to[1] === move.to[1] &&
        !(m.from[0] === move.from[0] && m.from[1] === move.from[1]));
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((m) => m.from[1] === move.from[1]);
        const sameRank = rivals.some((m) => m.from[0] === move.from[0]);
        if (!sameFile) dis = 'abcdefgh'[move.from[1]];
        else if (!sameRank) dis = String(8 - move.from[0]);
        else dis = ChessEngine.squareName(move.from[0], move.from[1]);
      }
      san = move.piece[1].toUpperCase() + dis + (move.captured ? 'x' : '') + dest;
    }
    return suffix(san, after);
  }

  function suffix(san, after) {
    const st = ChessEngine.getGameStatus(after);
    if (st.over && st.reason === 'checkmate') return san + '#';
    if (!st.over && st.inCheck) return san + '+';
    return san;
  }

  // ============================ ОТРИСОВКА ДОСКИ ============================

  function renderBoard() {
    const view = currentState();
    const frag = document.createDocumentFragment();
    const status = ChessEngine.getGameStatus(view);
    const checkPos = status.inCheck ? findKing(view, view.turn) : null;

    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const r = flipped ? 7 - dr : dr;
        const c = flipped ? 7 - dc : dc;
        const sq = document.createElement('div');
        sq.className = 'square ' + ((r + c) % 2 === 0 ? 'sq-light' : 'sq-dark');
        sq.dataset.r = r; sq.dataset.c = c;

        if (view.lastMove) {
          const { from, to } = view.lastMove;
          if ((from[0] === r && from[1] === c) || (to[0] === r && to[1] === c)) {
            sq.classList.add(viewIndex !== null && !isLive() ? 'review-move' : 'last-move');
          }
        }
        if (checkPos && checkPos[0] === r && checkPos[1] === c) sq.classList.add('check');
        if (selected && selected[0] === r && selected[1] === c) sq.classList.add('selected');

        const piece = view.board[r][c];
        if (piece) sq.innerHTML = pieceSvg(piece);

        if (legalForSelected.some((m) => m.to[0] === r && m.to[1] === c)) {
          const hint = document.createElement('span');
          hint.className = piece ? 'hint-ring' : 'hint-dot';
          sq.appendChild(hint);
        }
        frag.appendChild(sq);
      }
    }

    // Слой стрелокъ сохраняемъ
    boardEl.innerHTML = '';
    boardEl.appendChild(frag);
    boardEl.appendChild(arrowLayer);

    renderLabels();
    renderArrow();
  }

  function renderLabels() {
    const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
    const ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    $('files-label').innerHTML = files.map((f) => `<span>${f}</span>`).join('');
    $('ranks-label').innerHTML = ranks.map((r) => `<span>${r}</span>`).join('');
  }

  function findKing(st, color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (st.board[r][c] === color + 'k') return [r, c];
    }
    return null;
  }

  function renderArrow() {
    arrowLayer.innerHTML = '';
    if (!bestMoveArrow) return;
    const toView = (r, c) => flipped ? [7 - c + 0.5, 7 - r + 0.5] : [c + 0.5, r + 0.5];
    const [x1, y1] = toView(bestMoveArrow.from[0], bestMoveArrow.from[1]);
    const [x2, y2] = toView(bestMoveArrow.to[0], bestMoveArrow.to[1]);
    arrowLayer.innerHTML =
      `<defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto">
         <path d="M0,0 L4,2 L0,4 z" fill="#2e7d32"/></marker></defs>
       <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
             stroke="#2e7d32" stroke-width="0.16" stroke-opacity="0.85"
             stroke-linecap="round" marker-end="url(#ah)"/>`;
  }

  // ============================ ВЗАИМОДѢЙСТВІЕ: КЛИКЪ + ПЕРЕТАСКИВАНІЕ ============================

  let drag = null;

  function squareFromEvent(e) {
    const rect = boardEl.getBoundingClientRect();
    const size = rect.width / 8;
    let dc = Math.floor((e.clientX - rect.left) / size);
    let dr = Math.floor((e.clientY - rect.top) / size);
    if (dc < 0 || dc > 7 || dr < 0 || dr > 7) return null;
    return flipped ? [7 - dr, 7 - dc] : [dr, dc];
  }

  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sq = squareFromEvent(e);
    if (!sq) return;
    const [r, c] = sq;
    const view = currentState();
    const piece = view.board[r][c];

    // Кликъ по подсвѣченной цѣли — завершаемъ ходъ
    if (selected && legalForSelected.some((m) => m.to[0] === r && m.to[1] === c)) {
      const from = selected;
      clearSelection();
      attemptMove(from, [r, c]);
      return;
    }

    if (!piece || !canMovePiece(piece)) { clearSelection(); renderBoard(); return; }

    // Повторный кликъ по выбранной фигурѣ — снять выборъ
    if (selected && selected[0] === r && selected[1] === c) {
      clearSelection(); renderBoard(); return;
    }

    select(r, c);
    renderBoard();

    // Готовимъ возможное перетаскиваніе
    boardEl.setPointerCapture(e.pointerId);
    drag = { from: [r, c], piece, pointerId: e.pointerId, started: false, startX: e.clientX, startY: e.clientY };
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.started && Math.hypot(dx, dy) < 5) return;

    if (!drag.started) {
      drag.started = true;
      const rect = boardEl.getBoundingClientRect();
      const size = rect.width / 8;
      const ghost = document.createElement('div');
      ghost.id = 'drag-ghost';
      ghost.style.width = size + 'px';
      ghost.style.height = size + 'px';
      ghost.innerHTML = pieceSvg(drag.piece, 'piece drag-piece');
      const svg = ghost.querySelector('svg');
      svg.style.width = '100%'; svg.style.height = '100%'; svg.style.pointerEvents = 'none';
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      const src = squareEl(drag.from[0], drag.from[1]);
      if (src) { const p = src.querySelector('.piece'); if (p) p.classList.add('dragging-source'); }
    }

    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';

    document.querySelectorAll('.square.hover-target').forEach((el) => el.classList.remove('hover-target'));
    const target = squareFromEvent(e);
    if (target && legalForSelected.some((m) => m.to[0] === target[0] && m.to[1] === target[1])) {
      const el = squareEl(target[0], target[1]);
      if (el) el.classList.add('hover-target');
    }
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const wasDragging = drag.started;
    const from = drag.from;
    if (drag.ghost) drag.ghost.remove();
    document.querySelectorAll('.square.hover-target').forEach((el) => el.classList.remove('hover-target'));
    document.querySelectorAll('.dragging-source').forEach((el) => el.classList.remove('dragging-source'));
    drag = null;

    if (!wasDragging || !e) return;
    const target = squareFromEvent(e);
    if (!target) { renderBoard(); return; }
    if (target[0] === from[0] && target[1] === from[1]) { renderBoard(); return; }
    if (legalForSelected.some((m) => m.to[0] === target[0] && m.to[1] === target[1])) {
      clearSelection();
      attemptMove(from, target);
    } else {
      renderBoard();
    }
  }

  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', endDrag);

  function squareEl(r, c) {
    return boardEl.querySelector(`.square[data-r="${r}"][data-c="${c}"]`);
  }

  function canMovePiece(piece) {
    if (!isLive() || gameFinished || engineThinking) return false;
    if (mode === 'network' && !Multiplayer.isConnected()) return false;
    if (piece[0] !== state.turn) return false;
    if (mode === 'engine' && state.turn !== humanColor) return false;
    if (mode === 'network' && state.turn !== humanColor) return false;
    return true;
  }

  function select(r, c) {
    selected = [r, c];
    legalForSelected = ChessEngine.generateLegalMoves(state, state.turn)
      .filter((m) => m.from[0] === r && m.from[1] === c);
  }

  function clearSelection() { selected = null; legalForSelected = []; }

  function attemptMove(from, to) {
    const legal = ChessEngine.generateLegalMoves(state, state.turn);
    const candidates = legal.filter((m) =>
      m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1]);
    if (!candidates.length) { renderBoard(); return; }
    if (candidates.length > 1) { askPromotion(candidates, (m) => playMove(m, true)); return; }
    playMove(candidates[0], true);
  }

  function askPromotion(candidates, done) {
    const box = $('promotion-choices');
    box.innerHTML = '';
    const color = candidates[0].piece[0];
    ['q', 'r', 'b', 'n'].forEach((t) => {
      const m = candidates.find((x) => x.promotion === t);
      if (!m) return;
      const btn = document.createElement('button');
      btn.className = 'promotion-choice';
      btn.title = PIECE_NAMES[t];
      btn.innerHTML = pieceSvg(color + t, 'piece');
      btn.onclick = () => { $('promotion-modal').classList.add('hidden'); done(m); };
      box.appendChild(btn);
    });
    $('promotion-modal').classList.remove('hidden');
  }

  // ============================ ХОДЪ ============================

  function playMove(move, fromHuman) {
    const before = state;
    const legalNow = ChessEngine.generateLegalMoves(state, state.turn);
    const after = ChessEngine.applyMove(state, move);
    const san = toSan(before, move, legalNow, after);
    const mover = move.piece[0];

    state = after;
    history.push(ChessEngine.cloneState(state));
    sanList.push(san);
    moveList.push(move);
    analyses.push(null);
    const idx = sanList.length - 1;
    viewIndex = null;
    bestMoveArrow = null;
    clearSelection();

    ScriabinMusic.moveSound(!!move.captured);

    if (clock) clock.press(mover);
    if (mode === 'network' && fromHuman) {
      Multiplayer.send({ type: 'move', uci: ChessEngine.moveToUci(move), clock: clock ? clock.snapshot() : null });
    }

    renderAll();

    const status = ChessEngine.getGameStatus(state);
    if (status.inCheck && !status.over) Maestro.play('check');

    if (status.over) { finishGame(status); return; }

    // Живой разборъ хода — не блокируетъ игру
    liveAnalyseMove(before, move, idx, mover);

    if (mode === 'engine' && state.turn !== humanColor) scheduleEngineMove();
  }

  function scheduleEngineMove() {
    engineThinking = true;
    setStatus(`${ruColorCap(state.turn)} думаютъ…`, 'thinking');
    const gen = generation;
    setTimeout(async () => {
      try {
        const move = await EngineManager.bestMove(state, levelKey);
        if (gen !== generation) return;
        engineThinking = false;
        if (!move) { updateStatus(); return; }
        playMove(move, false);
      } catch (err) {
        engineThinking = false;
        updateStatus();
      }
    }, 220);
  }

  // ============================ ЖИВОЙ РАЗБОРЪ ============================

  async function liveAnalyseMove(before, move, idx, mover) {
    const gen = generation;
    try {
      const evalBefore = await EngineManager.evaluate(before, {
        depth: EngineManager.LIVE_ANALYSIS_DEPTH, multiPV: 2,
      });
      if (gen !== generation) return;
      const evalAfter = await EngineManager.evaluate(history[idx + 1], {
        depth: EngineManager.LIVE_ANALYSIS_DEPTH, multiPV: 1,
      });
      if (gen !== generation || idx >= analyses.length) return;

      const second = evalBefore.lines && evalBefore.lines[1] ? evalBefore.lines[1].cp : null;
      const result = ChessAnalysis.classify({
        evalBefore, evalAfter, playedMove: move,
        bestMove: evalBefore.bestMove, stateBefore: before,
        legalCount: ChessEngine.generateLegalMoves(before, before.turn).length,
        secondBestCp: second,
      });
      analyses[idx] = result;
      liveEvalCp = ChessAnalysis.toCp(evalAfter);
      renderMoves();
      renderEvalBar();
      renderAnalysisPanel();
      announce(result, mover);
    } catch (e) { /* разборъ не критиченъ */ }
  }

  function announce(result, mover) {
    if (!result || result.forced) return;
    if (!['brilliant', 'great', 'blunder'].includes(result.tag)) return;
    const tag = ChessAnalysis.TAGS[result.tag];
    calloutEl.textContent = `${tag.icon}  ${ruColorCap(mover)}: ${tag.name}!`;
    calloutEl.style.background = tag.color + '2e';
    calloutEl.style.borderColor = tag.color;
    calloutEl.style.color = tag.color;
    calloutEl.classList.add('show');
    clearTimeout(announce._t);
    announce._t = setTimeout(() => calloutEl.classList.remove('show'), 2600);
    if (result.tag === 'brilliant') Maestro.play('brilliant');
    else if (result.tag === 'blunder') Maestro.play('blunder');
  }

  // ============================ РАЗБОРЪ ВСЕЙ ПАРТІИ ============================

  async function analyseWholeGame() {
    if (analysisRunning || sanList.length === 0) return;
    analysisRunning = true;
    const gen = generation;
    const btn = $('btn-analyse');
    btn.disabled = true;
    btn.textContent = 'Разбираемъ…';
    $('analyse-progress').classList.add('show');

    const evals = new Array(history.length).fill(null);
    try {
      for (let i = 0; i < history.length; i++) {
        if (gen !== generation) break;
        evals[i] = await EngineManager.evaluate(history[i], {
          depth: EngineManager.ANALYSIS_DEPTH, multiPV: 2,
        });
        $('analyse-fill').style.width = Math.round((i + 1) / history.length * 100) + '%';
      }
      if (gen !== generation) return;

      for (let i = 0; i < sanList.length; i++) {
        const before = history[i];
        const evalBefore = evals[i];
        const evalAfter = evals[i + 1];
        if (!evalBefore || !evalAfter) continue;
        const second = evalBefore.lines && evalBefore.lines[1] ? evalBefore.lines[1].cp : null;
        analyses[i] = ChessAnalysis.classify({
          evalBefore, evalAfter, playedMove: moveList[i],
          bestMove: evalBefore.bestMove, stateBefore: before,
          legalCount: ChessEngine.generateLegalMoves(before, before.turn).length,
          secondBestCp: second,
        });
        analyses[i].evalBefore = evalBefore;
      }
      renderMoves();
      renderAnalysisPanel();
      $('analyse-hint').textContent = 'Разборъ готовъ. Щёлкайте по ходамъ, чтобы пройти партію.';
    } finally {
      analysisRunning = false;
      btn.disabled = false;
      btn.textContent = 'Разобрать партію';
      setTimeout(() => { $('analyse-progress').classList.remove('show'); $('analyse-fill').style.width = '0%'; }, 700);
    }
  }

  // ============================ ПАНЕЛИ ============================

  function renderMoves() {
    moveListEl.innerHTML = '';
    for (let i = 0; i < sanList.length; i += 2) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="move-num">${i / 2 + 1}.</span>`;
      li.appendChild(moveCell(i));
      li.appendChild(moveCell(i + 1));
      moveListEl.appendChild(li);
    }
    const cur = moveListEl.querySelector('.move-cell.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    $('btn-return-live').classList.toggle('hidden', isLive());
    updateNavButtons();
  }

  function moveCell(i) {
    const cell = document.createElement('span');
    cell.className = 'move-cell';
    if (sanList[i] === undefined) { cell.classList.add('empty'); return cell; }
    const activeIdx = viewIndex === null ? history.length - 1 : viewIndex;
    if (activeIdx === i + 1) cell.classList.add('current');

    cell.appendChild(document.createTextNode(sanList[i]));
    const a = analyses[i];
    if (a && !a.forced) {
      const tag = ChessAnalysis.TAGS[a.tag];
      const badge = document.createElement('span');
      badge.className = 'move-tag';
      badge.style.background = tag.color;
      badge.textContent = tag.icon;
      badge.title = `${tag.name} · потеря ${a.loss} с.п.`;
      cell.appendChild(badge);
    }
    cell.onclick = () => gotoIndex(i + 1);
    return cell;
  }

  function renderAnalysisPanel() {
    const white = analyses.filter((_, i) => i % 2 === 0);
    const black = analyses.filter((_, i) => i % 2 === 1);
    const aw = ChessAnalysis.sideAccuracy(white);
    const ab = ChessAnalysis.sideAccuracy(black);
    $('acc-white').textContent = aw === null ? '—' : aw.toFixed(1) + '%';
    $('acc-black').textContent = ab === null ? '—' : ab.toFixed(1) + '%';

    const cw = ChessAnalysis.tagCounts(white);
    const cb = ChessAnalysis.tagCounts(black);
    const rows = ChessAnalysis.TAG_ORDER.filter((t) => t !== 'book' && (cw[t] || cb[t]));
    $('tag-table').innerHTML = rows.length === 0
      ? '<tr><td class="muted">Разборъ ещё не проводился.</td></tr>'
      : rows.map((t) => {
        const tag = ChessAnalysis.TAGS[t];
        return `<tr>
          <td class="tt-name"><span class="tt-icon" style="background:${tag.color}">${tag.icon}</span>${tag.name}</td>
          <td class="tt-count">${cw[t]}</td><td class="tt-count">${cb[t]}</td></tr>`;
      }).join('');
    if (rows.length) {
      $('tag-table').insertAdjacentHTML('afterbegin',
        '<tr><td></td><td class="tt-count">Бѣл.</td><td class="tt-count">Чёр.</td></tr>');
    }
    renderMoveDetail();
  }

  function renderMoveDetail() {
    const box = $('move-detail');
    const idx = (viewIndex === null ? history.length : viewIndex) - 1;
    if (idx < 0 || !sanList[idx]) {
      box.innerHTML = '<p class="muted">Выберите ходъ въ спискѣ ниже.</p>';
      return;
    }
    const a = analyses[idx];
    const mover = idx % 2 === 0 ? 'w' : 'b';
    let html = `<p><b>${Math.floor(idx / 2) + 1}${mover === 'w' ? '.' : '…'} ${sanList[idx]}</b> — ${ruColor(mover)}</p>`;
    if (!a) {
      html += '<p class="muted">Ходъ ещё не разобранъ.</p>';
    } else if (a.forced) {
      html += '<p>Единственный возможный ходъ.</p>';
    } else {
      const tag = ChessAnalysis.TAGS[a.tag];
      html += `<p class="md-tag" style="color:${tag.color}">${tag.icon} ${tag.name}</p>`;
      html += `<p>Потеря: <b>${a.loss}</b> сотыхъ пѣшки</p>`;
      html += `<p>Оцѣнка послѣ хода: <span class="md-eval">${ChessAnalysis.formatEval({ cp: a.cpAfter }, 'w')}</span></p>`;
      if (a.bestMove && !ChessEngine.sameMove(a.bestMove, moveList[idx])) {
        html += `<p class="md-best">Лучше было: ${ChessEngine.moveToUci(a.bestMove)}</p>`;
      }
    }
    box.innerHTML = html;
  }

  function renderEvalBar() {
    const cp = Math.max(-1200, Math.min(1200, liveEvalCp || 0));
    const pct = ChessAnalysis.winPercent(cp);
    evalFillEl.style.height = pct + '%';
    evalTextEl.textContent = ChessAnalysis.formatEval({ cp: liveEvalCp }, 'w');
  }

  function renderCaptured() {
    const view = currentState();
    const counts = { w: {}, b: {} };
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = view.board[r][c];
      if (p) counts[p[0]][p[1]] = (counts[p[0]][p[1]] || 0) + 1;
    }
    const initial = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
    const lost = { w: [], b: [] };
    let score = { w: 0, b: 0 };
    ['w', 'b'].forEach((col) => {
      Object.keys(initial).forEach((t) => {
        const missing = initial[t] - (counts[col][t] || 0);
        for (let i = 0; i < missing; i++) lost[col].push(col + t);
        score[col] += (counts[col][t] || 0) * PIECE_VALUES[t];
      });
    });

    // Внизу — цвѣтъ игрока (или бѣлые, если доска не перевёрнута)
    const bottomColor = flipped ? 'b' : 'w';
    const topColor = ChessEngine.opponent(bottomColor);
    const diff = score[bottomColor] - score[topColor];

    $('captured-bottom').innerHTML = lost[topColor].map((p) => pieceSvg(p, 'mini-piece')).join('');
    $('captured-top').innerHTML = lost[bottomColor].map((p) => pieceSvg(p, 'mini-piece')).join('');
    $('material-bottom').textContent = diff > 0 ? '+' + diff : '';
    $('material-top').textContent = diff < 0 ? '+' + (-diff) : '';

    $('name-bottom').textContent = ruColorCap(bottomColor);
    $('name-top').textContent = ruColorCap(topColor);
    $('badge-bottom').textContent = bottomColor === 'w' ? '◇' : '◆';
    $('badge-top').textContent = topColor === 'w' ? '◇' : '◆';
  }

  function renderClocks() {
    const bottomColor = flipped ? 'b' : 'w';
    const topColor = ChessEngine.opponent(bottomColor);
    const setClock = (el, color) => {
      const node = $(el);
      if (!clock || !clock.enabled) { node.textContent = '—'; node.className = 'clock'; return; }
      node.textContent = Clock.formatClock(clock.remaining[color]);
      node.className = 'clock';
      if (clock.flagged === color) node.classList.add('flagged');
      else if (clock.remaining[color] < 20000) node.classList.add('low');
      if (clock.activeColor === color && !gameFinished) node.classList.add('running');
    };
    setClock('clock-bottom', bottomColor);
    setClock('clock-top', topColor);
    $('strip-bottom').classList.toggle('active', !gameFinished && state.turn === bottomColor);
    $('strip-top').classList.toggle('active', !gameFinished && state.turn === topColor);
  }

  function renderRating() {
    $('rating-value').textContent = rating.rating;
    $('rating-rank').textContent = ChessRating.rankFor(rating.rating).name;
    $('rating-record').textContent = `${rating.wins} побѣдъ · ${rating.draws} ничьихъ · ${rating.losses} пораженій`;
    $('rating-best').textContent = 'Рекордъ: ' + rating.best;
  }

  function renderAll() {
    renderBoard();
    renderMoves();
    renderCaptured();
    renderClocks();
    renderEvalBar();
    renderAnalysisPanel();
    updateStatus();
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status-bar' + (cls ? ' ' + cls : '');
  }

  function updateStatus() {
    if (gameFinished) return;
    if (!isLive()) {
      setStatus(`Просмотръ: ходъ ${viewIndex} изъ ${history.length - 1}`);
      return;
    }
    if (engineThinking) { setStatus(`${ruColorCap(state.turn)} думаютъ…`, 'thinking'); return; }
    if (mode === 'network' && !Multiplayer.isConnected()) { setStatus('Ожиданіе соперника…'); return; }
    const st = ChessEngine.getGameStatus(state);
    if (st.inCheck) setStatus(`Шахъ! Ходъ ${ruColorGen(state.turn)}`, 'check');
    else setStatus(`Ходъ ${ruColorGen(state.turn)}`);
  }

  // ============================ НАВИГАЦІЯ ПО ПАРТІИ ============================

  function gotoIndex(i) {
    const clamped = Math.max(0, Math.min(history.length - 1, i));
    viewIndex = clamped === history.length - 1 ? null : clamped;
    clearSelection();
    bestMoveArrow = null;

    // Показываемъ стрѣлку лучшего хода для просматриваемой позиціи
    const idx = (viewIndex === null ? history.length : viewIndex) - 1;
    const a = analyses[idx];
    if (a && a.bestMove && !ChessEngine.sameMove(a.bestMove, moveList[idx])) {
      bestMoveArrow = a.bestMove;
    }
    renderBoard();
    renderMoves();
    renderCaptured();
    renderMoveDetail();
    updateStatus();
  }

  function updateNavButtons() {
    const idx = viewIndex === null ? history.length - 1 : viewIndex;
    $('nav-first').disabled = idx === 0;
    $('nav-prev').disabled = idx === 0;
    $('nav-next').disabled = idx >= history.length - 1;
    $('nav-last').disabled = idx >= history.length - 1;
  }

  // ============================ КОНЕЦЪ ПАРТІИ ============================

  function finishGame(status, customReason) {
    gameFinished = true;
    engineThinking = false;
    if (clock) clock.stop();

    let title, subtitle, humanScore;
    const reason = customReason || status.reason;

    if (reason === 'checkmate') {
      const whiteWon = status.result === 'white_wins';
      const humanWon = (whiteWon && humanColor === 'w') || (!whiteWon && humanColor === 'b');
      humanScore = humanWon ? 1 : 0;
      title = humanWon ? 'Побѣда!' : 'Пораженіе';
      subtitle = `Матъ. ${ruColorCap(whiteWon ? 'w' : 'b')} побѣждаютъ.`;
    } else if (reason === 'timeout') {
      const loser = status.loser;
      const humanWon = loser !== humanColor;
      humanScore = humanWon ? 1 : 0;
      title = humanWon ? 'Побѣда по времени!' : 'Время вышло';
      subtitle = `У ${ruColorGen(loser)} закончилось время.`;
    } else if (reason === 'resign') {
      const loser = status.loser;
      const humanWon = loser !== humanColor;
      humanScore = humanWon ? 1 : 0;
      title = humanWon ? 'Соперникъ сдался' : 'Вы сдались';
      subtitle = `${ruColorCap(loser)} признаютъ пораженіе.`;
    } else {
      humanScore = 0.5;
      title = 'Ничья';
      subtitle = {
        stalemate: 'Патъ — ходить нечѣмъ.',
        fifty_move: 'Правило пятидесяти ходовъ.',
        repetition: 'Троекратное повтореніе позиціи.',
        insufficient_material: 'Не хватаетъ матеріала для мата.',
        agreement: 'По соглашенію сторонъ.',
      }[reason] || 'Партія завершена вничью.';
    }

    $('over-title').textContent = title;
    $('over-subtitle').textContent = subtitle;

    // Рейтингъ — только за игру противъ машины
    if (mode === 'engine' && !ratingApplied) {
      ratingApplied = true;
      const res = ChessRating.applyResult(rating, levelKey, humanScore);
      const sign = res.delta > 0 ? '+' : '';
      $('over-rating').textContent =
        `Рейтингъ: ${res.before} → ${res.after} (${sign}${res.delta}) · соперникъ ${res.opponentElo} Эло`;
      renderRating();
    } else {
      $('over-rating').textContent = mode === 'network'
        ? 'Партіи по сѣти рейтингъ не измѣняютъ.' : '';
    }

    const musicKey = humanScore === 1 ? 'victory' : humanScore === 0 ? 'defeat' : 'draw';
    const pieceName = Maestro.play(musicKey);
    $('over-music').textContent = pieceName ? '♪ ' + pieceName + ' (' + Maestro.sourceLabel() + ')' : '';
    $('music-now').textContent = pieceName ? '♪ ' + pieceName : '';

    setStatus(title + ' · ' + subtitle);
    renderClocks();
    $('game-over-modal').classList.remove('hidden');
  }

  // ============================ НОВАЯ ПАРТІЯ ============================

  function newGame(opts) {
    const o = opts || {};
    generation++;
    state = ChessEngine.createInitialState();
    history = [ChessEngine.cloneState(state)];
    sanList = []; moveList = []; analyses = [];
    clearSelection();
    viewIndex = null;
    gameFinished = false;
    ratingApplied = false;
    engineThinking = false;
    bestMoveArrow = null;
    liveEvalCp = 0;

    if (o.color) humanColor = o.color;
    else if (mode === 'engine') {
      humanColor = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    }
    flipped = humanColor === 'b';

    if (clock) clock.destroy();
    clock = new Clock.ChessClock(timeKey, {
      onTick: () => renderClocks(),
      onFlag: (color) => finishGame({ loser: color }, 'timeout'),
    });

    $('game-over-modal').classList.add('hidden');
    calloutEl.classList.remove('show');
    $('analyse-hint').textContent = 'Движокъ оцѣнитъ каждый ходъ и укажетъ лучшій.';
    Maestro.stop();
    $('music-now').textContent = '';

    renderAll();

    if (clock.enabled) clock.start('w');
    if (mode === 'engine' && state.turn !== humanColor) scheduleEngineMove();
  }

  function undo() {
    if (engineThinking || mode === 'network') return;
    const steps = (history.length > 2 && state.turn === humanColor) ? 2 : 1;
    for (let i = 0; i < steps && history.length > 1; i++) {
      history.pop(); sanList.pop(); moveList.pop(); analyses.pop();
    }
    generation++;
    state = ChessEngine.cloneState(history[history.length - 1]);
    gameFinished = false;
    ratingApplied = false;
    viewIndex = null;
    clearSelection();
    bestMoveArrow = null;
    $('game-over-modal').classList.add('hidden');
    renderAll();
  }

  async function showHint() {
    if (!isLive() || gameFinished) return;
    setStatus('Ищемъ лучшій ходъ…', 'thinking');
    try {
      const ev = await EngineManager.evaluate(state, { depth: 12, multiPV: 1 });
      if (ev.bestMove) { bestMoveArrow = ev.bestMove; renderArrow(); }
      updateStatus();
    } catch (e) { updateStatus(); }
  }

  // ============================ СѢТЕВАЯ ИГРА ============================

  function setNetStatus(text, cls) {
    const el = $('net-status');
    el.textContent = text;
    el.className = 'net-status' + (cls ? ' ' + cls : '');
  }

  Multiplayer.setHandlers({
    onConnect: (info) => {
      mode = 'network';
      humanColor = info.color;
      flipped = humanColor === 'b';
      setNetStatus('Соединеніе установлено.', 'ok');
      showNetStep('net-live');
      $('net-live-text').textContent = `Вы играете за ${ruColorGen(humanColor)}. Часы и ходы синхронизируются.`;
      newGame({ color: humanColor });
    },
    onDisconnect: () => {
      setNetStatus('Соединеніе разорвано.', 'err');
      showNetStep('net-choose');
      if (mode === 'network' && !gameFinished) {
        setStatus('Соперникъ отключился.');
      }
    },
    onMessage: (msg) => {
      if (msg.type === 'move') {
        const move = ChessEngine.uciToMove(state, msg.uci);
        if (move) {
          playMove(move, false);
          if (msg.clock && clock) clock.applySnapshot(msg.clock);
        }
      } else if (msg.type === 'resign') {
        finishGame({ loser: ChessEngine.opponent(humanColor) }, 'resign');
      } else if (msg.type === 'newgame') {
        humanColor = msg.yourColor || humanColor;
        flipped = humanColor === 'b';
        newGame({ color: humanColor });
      }
    },
  });

  // ============================ СОБЫТІЯ ============================

  function buildLevelButtons() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    Object.keys(EngineManager.LEVELS).forEach((key) => {
      const lvl = EngineManager.LEVELS[key];
      const btn = document.createElement('button');
      btn.className = 'level-btn' + (key === levelKey ? ' active' : '');
      btn.dataset.level = key;
      btn.innerHTML = `${lvl.name}<span class="lvl-elo">≈${lvl.rating} Эло</span>`;
      btn.onclick = () => {
        levelKey = key;
        grid.querySelectorAll('.level-btn').forEach((b) => b.classList.toggle('active', b.dataset.level === key));
      };
      grid.appendChild(btn);
    });
  }

  function buildTimeButtons() {
    const grid = $('time-grid');
    grid.innerHTML = '';
    Clock.TIME_CONTROLS.forEach((tc) => {
      const btn = document.createElement('button');
      btn.className = 'time-btn' + (tc.key === timeKey ? ' active' : '');
      btn.dataset.time = tc.key;
      btn.innerHTML = `${tc.label}${tc.kind ? `<span class="tc-kind">${tc.kind}</span>` : ''}`;
      btn.onclick = () => {
        timeKey = tc.key;
        grid.querySelectorAll('.time-btn').forEach((b) => b.classList.toggle('active', b.dataset.time === tc.key));
      };
      grid.appendChild(btn);
    });
  }

  $('tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) =>
      p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
  };

  $('color-choice').onclick = (e) => {
    const btn = e.target.closest('button[data-color]');
    if (!btn) return;
    colorChoice = btn.dataset.color;
    $('color-choice').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  };

  $('btn-new').onclick = () => { mode = mode === 'network' && Multiplayer.isConnected() ? 'network' : 'engine'; newGame(); };
  $('btn-undo').onclick = undo;
  $('btn-flip').onclick = () => { flipped = !flipped; renderAll(); };
  $('btn-hint').onclick = showHint;
  $('btn-resign').onclick = () => {
    if (gameFinished) return;
    if (!window.confirm('Сдаться въ этой партіи?')) return;
    if (mode === 'network') Multiplayer.send({ type: 'resign' });
    finishGame({ loser: humanColor }, 'resign');
  };

  $('nav-first').onclick = () => gotoIndex(0);
  $('nav-prev').onclick = () => gotoIndex((viewIndex === null ? history.length - 1 : viewIndex) - 1);
  $('nav-next').onclick = () => gotoIndex((viewIndex === null ? history.length - 1 : viewIndex) + 1);
  $('nav-last').onclick = () => gotoIndex(history.length - 1);
  $('btn-return-live').onclick = () => gotoIndex(history.length - 1);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); gotoIndex((viewIndex === null ? history.length - 1 : viewIndex) - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); gotoIndex((viewIndex === null ? history.length - 1 : viewIndex) + 1); }
    else if (e.key === 'Home') { e.preventDefault(); gotoIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); gotoIndex(history.length - 1); }
    else if (e.key === 'f') { flipped = !flipped; renderAll(); }
  });

  $('btn-analyse').onclick = analyseWholeGame;
  $('over-review').onclick = () => {
    $('game-over-modal').classList.add('hidden');
    document.querySelector('.tab[data-tab="review"]').click();
    analyseWholeGame();
  };
  $('over-again').onclick = () => { $('game-over-modal').classList.add('hidden'); newGame(); };
  $('over-close').onclick = () => $('game-over-modal').classList.add('hidden');

  $('rating-reset').onclick = () => {
    if (!window.confirm('Сбросить рейтингъ до 1200 и очистить статистику?')) return;
    rating = ChessRating.reset();
    renderRating();
  };

  // --- Музыка ---
  $('btn-music').onclick = () => {
    const on = !Maestro.isEnabled();
    Maestro.setEnabled(on);
    $('btn-music').textContent = on ? '♪ Музыка: вкл.' : '♪ Музыка: выкл.';
  };
  let soundOn = true;
  $('btn-sound').onclick = () => {
    soundOn = !soundOn;
    $('btn-sound').textContent = soundOn ? '🔔 Звукъ: вкл.' : '🔕 Звукъ: выкл.';
  };
  const origMoveSound = ScriabinMusic.moveSound;
  ScriabinMusic.moveSound = function (cap) { if (soundOn) origMoveSound(cap); };
  $('volume').oninput = (e) => Maestro.setVolume(e.target.value / 100);

  // Свои записи: выбираемъ файлы и раскладываемъ по случаямъ
  function renderMusicSlots(slots) {
    const box = $('music-slots');
    const SRC = { user: 'ваша запись', local: 'файлъ въ папкѣ',
                  commons: 'Викискладъ', synth: 'синтезаторъ' };
    box.innerHTML = (slots || Maestro.describeSlots()).map((s) => `
      <div class="slot">
        <span class="slot-when">${s.label}</span>
        <span class="slot-title" title="${s.title}">${s.title}</span>
        <span class="slot-src slot-${s.source}">${SRC[s.source] || s.source}</span>
      </div>`).join('');
  }
  Maestro.setSlotsHandler(renderMusicSlots);

  $('music-files').onchange = async (e) => {
    const res = await Maestro.importFiles(e.target.files);
    renderMusicSlots(res.slots);
    e.target.value = '';
  };
  $('music-clear').onclick = async () => {
    if (!window.confirm('Убрать свои записи и вернуться къ прежнему источнику?')) return;
    await Maestro.clearUserFiles();
    renderMusicSlots();
  };
  document.addEventListener('pointerdown', () => ScriabinMusic.unlock(), { once: true });

  // --- Сѣть: пошаговый мастеръ ---

  function showNetStep(id) {
    ['net-choose', 'net-host', 'net-guest', 'net-live'].forEach((step) => {
      $(step).classList.toggle('hidden', step !== id);
    });
  }

  $('role-host').onclick = async () => {
    if (!Multiplayer.isSupported()) { setNetStatus('Браузеръ не поддерживаетъ WebRTC.', 'err'); return; }
    showNetStep('net-host');
    $('invite-code').value = '';
    setNetStatus('Готовимъ приглашеніе…', 'wait');
    try {
      const code = await Multiplayer.createInvite(colorChoice);
      $('invite-code').value = code;
      setNetStatus('Кодъ готовъ. Отправьте его другу и ждите отвѣта.', 'wait');
    } catch (e) {
      setNetStatus('Не удалось создать приглашеніе: ' + e.message, 'err');
    }
  };

  $('role-guest').onclick = () => {
    if (!Multiplayer.isSupported()) { setNetStatus('Браузеръ не поддерживаетъ WebRTC.', 'err'); return; }
    showNetStep('net-guest');
    $('guest-step-2').classList.add('hidden');
    $('invite-in').value = '';
    setNetStatus('Вставьте кодъ приглашенія.', '');
  };

  document.querySelectorAll('.net-back').forEach((b) => {
    b.onclick = () => { Multiplayer.close(); showNetStep('net-choose'); setNetStatus('Не подключено', ''); };
  });

  $('btn-accept-answer').onclick = async () => {
    const code = $('answer-in').value.trim();
    if (!code) { setNetStatus('Вставьте кодъ отвѣта.', 'err'); return; }
    setNetStatus('Соединяемся…', 'wait');
    try { await Multiplayer.completeInvite(code); }
    catch (e) { setNetStatus('Невѣрный кодъ отвѣта: ' + e.message, 'err'); }
  };

  $('btn-join').onclick = async () => {
    const code = $('invite-in').value.trim();
    if (!code) { setNetStatus('Вставьте кодъ приглашенія.', 'err'); return; }
    setNetStatus('Читаемъ приглашеніе…', 'wait');
    try {
      const res = await Multiplayer.acceptInvite(code);
      $('answer-code').value = res.code;
      $('guest-step-2').classList.remove('hidden');
      setNetStatus('Отправьте кодъ отвѣта хозяину и ждите.', 'wait');
    } catch (e) {
      setNetStatus('Невѣрный кодъ приглашенія: ' + e.message, 'err');
    }
  };

  $('btn-copy-invite').onclick = () => copyToClipboard($('invite-code').value, 'приглашенія');
  $('btn-copy-answer').onclick = () => copyToClipboard($('answer-code').value, 'отвѣта');
  $('btn-disconnect').onclick = () => {
    Multiplayer.close();
    mode = 'engine';
    showNetStep('net-choose');
    setNetStatus('Отключено.', '');
  };

  function copyToClipboard(text, what) {
    if (!text) { setNetStatus(`Кодъ ${what} ещё не созданъ.`, 'err'); return; }
    const done = () => setNetStatus(`Кодъ ${what} скопированъ.`, 'ok');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { setNetStatus('Скопируйте вручную.', 'err'); }
      ta.remove();
    }
  }

  // ============================ ЗАПУСКЪ ============================

  // ---------- Подсказка при открытіи черезъ file:// ----------

  /**
   * Собираетъ команду для Терминала: переходъ въ папку приложенія и запускъ
   * мѣстнаго сервера. Путь берёмъ изъ адреса страницы, чтобы команду можно
   * было просто скопировать, гдѣ бы папка ни лежала.
   */
  function serverCommand() {
    let dir = '~/Desktop';
    try {
      const path = decodeURIComponent(location.pathname);
      const folder = path.replace(/\/[^/]*$/, '');       // отбрасываемъ index.html
      if (folder) dir = folder.replace(/'/g, "'\\''");
    } catch (e) { /* оставляемъ значеніе по умолчанію */ }
    return `cd '${dir}' && python3 -m http.server 8173`;
  }

  function showFileModeBanner() {
    const banner = $('file-mode-banner');
    const cmd = serverCommand();
    $('fb-command').textContent = cmd;
    banner.classList.remove('hidden');
    $('fb-copy').onclick = () => {
      const done = () => { $('fb-copy').textContent = 'Скопировано ✓'; };
      if (navigator.clipboard) navigator.clipboard.writeText(cmd).then(done, fallback);
      else fallback();
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = cmd; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* скопируютъ руками */ }
        ta.remove();
      }
    };
    $('fb-close').onclick = () => banner.classList.add('hidden');
  }

  // ---------- Полотна Шишкина на заднемъ планѣ ----------

  function describePainting(item) {
    const cap = $('painting-caption');
    if (!item || item.fallback) {
      cap.textContent = 'Задній планъ: рисованный пейзажъ (нѣтъ связи съ Викискладомъ)';
      $('btn-next-painting').classList.add('hidden');
      return;
    }
    const name = (item.title || '').replace(/_/g, ' ');
    cap.textContent = `И. И. Шишкинъ — «${name}»${item.date ? ', ' + item.date : ''}`;
    $('btn-next-painting').classList.remove('hidden');
  }

  $('btn-next-painting').onclick = () => Gallery.next();

  async function boot() {
    buildLevelButtons();
    buildTimeButtons();
    renderRating();
    newGame();

    // Полотна и фонотека грузятся въ фонѣ и не задерживаютъ игру
    Gallery.init(describePainting).catch(() => {});
    Maestro.init().then(() => renderMusicSlots()).catch(() => renderMusicSlots());

    const backend = await EngineManager.init();
    if (backend === 'stockfish') {
      engineNoteEl.textContent = 'Движокъ: Stockfish 18';
    } else {
      engineNoteEl.textContent = 'Движокъ: встроенный (Stockfish не загруженъ)';
      if (location.protocol === 'file:') showFileModeBanner();
    }
    // Первичная оцѣнка позиціи
    try {
      const ev = await EngineManager.evaluate(state, { depth: 10 });
      liveEvalCp = ChessAnalysis.toCp(ev);
      renderEvalBar();
    } catch (e) { /* не критично */ }
  }

  boot();
})();
