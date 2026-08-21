/**
 * Встроенный шахматный движок (запасной, если Stockfish недоступен).
 *
 * Negamax + alpha-beta со следующими улучшениями:
 *   - итеративное углубление с контролем времени
 *   - форсированный поиск взятий (quiescence) — убирает «эффект горизонта»
 *   - таблица транспозиций (Zobrist-хеширование)
 *   - killer-ходы и эвристика истории для сортировки
 *   - нулевой ход (null-move pruning)
 *   - оценка с интерполяцией между дебютом и эндшпилем
 */

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PHASE_WEIGHTS = { p: 0, n: 1, b: 1, r: 2, q: 4, k: 0 };
const TOTAL_PHASE = 24;

const MATE_SCORE = 100000;
const MATE_THRESHOLD = 90000;
// Конечная «бесконечность»: избавляет от арифметики с Infinity в окнах поиска
const INF = 1000000;

// ---------- Таблицы позиционных бонусов (со стороны белых, строка 0 = 8-я горизонталь) ----------

const PAWN_MG = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [98, 134, 61, 95, 68, 126, 34, -11],
  [-6, 7, 26, 31, 65, 56, 25, -20],
  [-14, 13, 6, 21, 23, 12, 17, -23],
  [-27, -2, -5, 12, 17, 6, 10, -25],
  [-26, -4, -4, -10, 3, 3, 33, -12],
  [-35, -1, -20, -23, -15, 24, 38, -22],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const PAWN_EG = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [178, 173, 158, 134, 147, 132, 165, 187],
  [94, 100, 85, 67, 56, 53, 82, 84],
  [32, 24, 13, 5, -2, 4, 17, 17],
  [13, 9, -3, -7, -7, -8, 3, -1],
  [4, 7, -6, 1, 0, -5, -1, -8],
  [13, 8, 8, 10, 13, 0, 2, -7],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const KNIGHT_MG = [
  [-167, -89, -34, -49, 61, -97, -15, -107],
  [-73, -41, 72, 36, 23, 62, 7, -17],
  [-47, 60, 37, 65, 84, 129, 73, 44],
  [-9, 17, 19, 53, 37, 69, 18, 22],
  [-13, 4, 16, 13, 28, 19, 21, -8],
  [-23, -9, 12, 10, 19, 17, 25, -16],
  [-29, -53, -12, -3, -1, 18, -14, -19],
  [-105, -21, -58, -33, -17, -28, -19, -23],
];
const KNIGHT_EG = [
  [-58, -38, -13, -28, -31, -27, -63, -99],
  [-25, -8, -25, -2, -9, -25, -24, -52],
  [-24, -20, 10, 9, -1, -9, -19, -41],
  [-17, 3, 22, 22, 22, 11, 8, -18],
  [-18, -6, 16, 25, 16, 17, 4, -18],
  [-23, -3, -1, 15, 10, -3, -20, -22],
  [-42, -20, -10, -5, -2, -20, -23, -44],
  [-29, -51, -23, -15, -22, -18, -50, -64],
];
const BISHOP_MG = [
  [-29, 4, -82, -37, -25, -42, 7, -8],
  [-26, 16, -18, -13, 30, 59, 18, -47],
  [-16, 37, 43, 40, 35, 50, 37, -2],
  [-4, 5, 19, 50, 37, 37, 7, -2],
  [-6, 13, 13, 26, 34, 12, 10, 4],
  [0, 15, 15, 15, 14, 27, 18, 10],
  [4, 15, 16, 0, 7, 21, 33, 1],
  [-33, -3, -14, -21, -13, -12, -39, -21],
];
const BISHOP_EG = [
  [-14, -21, -11, -8, -7, -9, -17, -24],
  [-8, -4, 7, -12, -3, -13, -4, -14],
  [2, -8, 0, -1, -2, 6, 0, 4],
  [-3, 9, 12, 9, 14, 10, 3, 2],
  [-6, 3, 13, 19, 7, 10, -3, -9],
  [-12, -3, 8, 10, 13, 3, -7, -15],
  [-14, -18, -7, -1, 4, -9, -15, -27],
  [-23, -9, -23, -5, -9, -16, -5, -17],
];
const ROOK_MG = [
  [32, 42, 32, 51, 63, 9, 31, 43],
  [27, 32, 58, 62, 80, 67, 26, 44],
  [-5, 19, 26, 36, 17, 45, 61, 16],
  [-24, -11, 7, 26, 24, 35, -8, -20],
  [-36, -26, -12, -1, 9, -7, 6, -23],
  [-45, -25, -16, -17, 3, 0, -5, -33],
  [-44, -16, -20, -9, -1, 11, -6, -71],
  [-19, -13, 1, 17, 16, 7, -37, -26],
];
const ROOK_EG = [
  [13, 10, 18, 15, 12, 12, 8, 5],
  [11, 13, 13, 11, -3, 3, 8, 3],
  [7, 7, 7, 5, 4, -3, -5, -3],
  [4, 3, 13, 1, 2, 1, -1, 2],
  [3, 5, 8, 4, -5, -6, -8, -11],
  [-4, 0, -5, -1, -7, -12, -8, -16],
  [-6, -6, 0, 2, -9, -9, -11, -3],
  [-9, 2, 3, -1, -5, -13, 4, -20],
];
const QUEEN_MG = [
  [-28, 0, 29, 12, 59, 44, 43, 45],
  [-24, -39, -5, 1, -16, 57, 28, 54],
  [-13, -17, 7, 8, 29, 56, 47, 57],
  [-27, -27, -16, -16, -1, 17, -2, 1],
  [-9, -26, -9, -10, -2, -4, 3, -3],
  [-14, 2, -11, -2, -5, 2, 14, 5],
  [-35, -8, 11, 2, 8, 15, -3, 1],
  [-1, -18, -9, 10, -15, -25, -31, -50],
];
const QUEEN_EG = [
  [-9, 22, 22, 27, 27, 19, 10, 20],
  [-17, 20, 32, 41, 58, 25, 30, 0],
  [-20, 6, 9, 49, 47, 35, 19, 9],
  [3, 22, 24, 45, 57, 40, 57, 36],
  [-18, 28, 19, 47, 31, 34, 39, 23],
  [-16, -27, 15, 6, 9, 17, 10, 5],
  [-22, -23, -30, -16, -16, -23, -36, -32],
  [-33, -28, -22, -43, -5, -32, -20, -41],
];
const KING_MG = [
  [-65, 23, 16, -15, -56, -34, 2, 13],
  [29, -1, -20, -7, -8, -4, -38, -29],
  [-9, 24, 2, -16, -20, 6, 22, -22],
  [-17, -20, -12, -27, -30, -25, -14, -36],
  [-49, -1, -27, -39, -46, -44, -33, -51],
  [-14, -14, -22, -46, -44, -30, -15, -27],
  [1, 7, -8, -64, -43, -16, 9, 8],
  [-15, 36, 12, -54, 8, -28, 24, 14],
];
const KING_EG = [
  [-74, -35, -18, -18, -11, 15, 4, -17],
  [-12, 17, 14, 17, 17, 38, 23, 11],
  [10, 17, 23, 15, 20, 45, 44, 13],
  [-8, 22, 24, 27, 26, 33, 26, 3],
  [-18, -4, 21, 24, 27, 23, 9, -11],
  [-19, -3, 11, 21, 23, 16, 7, -9],
  [-27, -11, 4, 13, 14, 4, -5, -17],
  [-53, -34, -21, -11, -28, -14, -24, -43],
];

const TABLES_MG = { p: PAWN_MG, n: KNIGHT_MG, b: BISHOP_MG, r: ROOK_MG, q: QUEEN_MG, k: KING_MG };
const TABLES_EG = { p: PAWN_EG, n: KNIGHT_EG, b: BISHOP_EG, r: ROOK_EG, q: QUEEN_EG, k: KING_EG };

// ---------- Zobrist-хеширование ----------

function makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

const PIECE_INDEX = { wp: 0, wn: 1, wb: 2, wr: 3, wq: 4, wk: 5, bp: 6, bn: 7, bb: 8, br: 9, bq: 10, bk: 11 };
const ZOBRIST = (function () {
  const rand = makeRandom(0x9e3779b9);
  const pieces = [];
  for (let p = 0; p < 12; p++) {
    pieces[p] = [];
    for (let sq = 0; sq < 64; sq++) pieces[p][sq] = [rand(), rand()];
  }
  const castling = [];
  for (let i = 0; i < 16; i++) castling[i] = [rand(), rand()];
  const epFile = [];
  for (let i = 0; i < 8; i++) epFile[i] = [rand(), rand()];
  return { pieces, castling, epFile, side: [rand(), rand()] };
})();

function hashState(state) {
  let h0 = 0, h1 = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const z = ZOBRIST.pieces[PIECE_INDEX[p]][r * 8 + c];
      h0 ^= z[0]; h1 ^= z[1];
    }
  }
  const cIdx = (state.castling.wK ? 1 : 0) | (state.castling.wQ ? 2 : 0) |
    (state.castling.bK ? 4 : 0) | (state.castling.bQ ? 8 : 0);
  h0 ^= ZOBRIST.castling[cIdx][0]; h1 ^= ZOBRIST.castling[cIdx][1];
  if (state.epSquare) {
    h0 ^= ZOBRIST.epFile[state.epSquare[1]][0];
    h1 ^= ZOBRIST.epFile[state.epSquare[1]][1];
  }
  if (state.turn === 'b') { h0 ^= ZOBRIST.side[0]; h1 ^= ZOBRIST.side[1]; }
  // Числовой ключ (~53 значащих бита) — заметно быстрее строкового
  return (h0 >>> 0) * 4294967296 + (h1 >>> 0);
}

// ---------- Оценка позиции ----------

function gamePhase(board) {
  let phase = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) phase += PHASE_WEIGHTS[p[1]];
    }
  }
  return Math.min(phase, TOTAL_PHASE);
}

function evaluateBoard(state) {
  const board = state.board;
  let mg = 0, eg = 0;
  const pawnFiles = { w: new Array(8).fill(0), b: new Array(8).fill(0) };
  const bishops = { w: 0, b: 0 };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const color = p[0], type = p[1];
      const row = color === 'w' ? r : 7 - r;
      const base = PIECE_VALUES[type];
      const vMg = base + TABLES_MG[type][row][c];
      const vEg = base + TABLES_EG[type][row][c];
      if (color === 'w') { mg += vMg; eg += vEg; } else { mg -= vMg; eg -= vEg; }
      if (type === 'p') pawnFiles[color][c] += 1;
      if (type === 'b') bishops[color] += 1;
    }
  }

  // Пара слонов
  if (bishops.w >= 2) { mg += 30; eg += 45; }
  if (bishops.b >= 2) { mg -= 30; eg -= 45; }

  // Сдвоенные и изолированные пешки
  for (let c = 0; c < 8; c++) {
    for (const color of ['w', 'b']) {
      const count = pawnFiles[color][c];
      if (count === 0) continue;
      const sign = color === 'w' ? 1 : -1;
      if (count > 1) { mg -= sign * 18 * (count - 1); eg -= sign * 28 * (count - 1); }
      const left = c > 0 ? pawnFiles[color][c - 1] : 0;
      const right = c < 7 ? pawnFiles[color][c + 1] : 0;
      if (left === 0 && right === 0) { mg -= sign * 16; eg -= sign * 22; }
    }
  }

  const phase = gamePhase(board);
  return Math.round((mg * phase + eg * (TOTAL_PHASE - phase)) / TOTAL_PHASE);
}

// ---------- Сортировка ходов ----------

function scoreMove(move, ttMove, killers, history, ply) {
  if (ttMove && ChessEngine.sameMove(move, ttMove)) return 1000000;
  if (move.captured) {
    // MVV-LVA: бьём ценное дешёвым
    return 100000 + PIECE_VALUES[move.captured[1]] * 10 - PIECE_VALUES[move.piece[1]];
  }
  if (move.promotion) return 90000 + PIECE_VALUES[move.promotion];
  const k = killers[ply];
  if (k) {
    if (k[0] && ChessEngine.sameMove(move, k[0])) return 80000;
    if (k[1] && ChessEngine.sameMove(move, k[1])) return 79000;
  }
  const key = move.piece + move.to[0] + ',' + move.to[1];
  return history[key] || 0;
}

function orderMoves(moves, ttMove, killers, history, ply) {
  const scored = moves.map((m) => ({ m, s: scoreMove(m, ttMove, killers, history, ply) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

// ---------- Поиск ----------

function createSearchContext(timeLimitMs) {
  return {
    tt: new Map(),
    killers: [],
    history: {},
    nodes: 0,
    deadline: timeLimitMs ? Date.now() + timeLimitMs : null,
    aborted: false,
  };
}

function timeUp(ctx) {
  if (ctx.aborted) return true;
  if (ctx.deadline && (ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) {
    ctx.aborted = true;
    return true;
  }
  return false;
}

/** Поиск только взятий и превращений — стабилизирует оценку. */
function quiescence(state, alpha, beta, ctx, ply) {
  ctx.nodes++;
  if (timeUp(ctx)) return 0;

  const sign = state.turn === 'w' ? 1 : -1;
  const standPat = sign * evaluateBoard(state);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const moves = ChessEngine.generateLegalMoves(state, state.turn)
    .filter((m) => m.captured || m.promotion);

  if (moves.length === 0) return alpha;

  const ordered = orderMoves(moves, null, ctx.killers, ctx.history, ply);
  for (const move of ordered) {
    // Delta pruning: безнадёжно проигрышные взятия отбрасываем
    if (move.captured && standPat + PIECE_VALUES[move.captured[1]] + 200 < alpha) continue;
    const next = ChessEngine.applyMove(state, move);
    const score = -quiescence(next, -beta, -alpha, ctx, ply + 1);
    if (timeUp(ctx)) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, ctx, ply, allowNull) {
  ctx.nodes++;
  if (timeUp(ctx)) return 0;

  const alphaOrig = alpha;
  const key = hashState(state);
  const entry = ctx.tt.get(key);
  let ttMove = null;
  if (entry) {
    ttMove = entry.move;
    if (entry.depth >= depth) {
      if (entry.flag === 'exact') return entry.score;
      if (entry.flag === 'lower' && entry.score > alpha) alpha = entry.score;
      else if (entry.flag === 'upper' && entry.score < beta) beta = entry.score;
      if (alpha >= beta) return entry.score;
    }
  }

  const moves = ChessEngine.generateLegalMoves(state, state.turn);
  const inCheck = ChessEngine.isInCheck(state, state.turn);

  if (moves.length === 0) {
    return inCheck ? -MATE_SCORE + ply : 0; // мат или пат
  }
  if (state.halfmove >= 100) return 0;

  if (depth <= 0) return quiescence(state, alpha, beta, ctx, ply);

  // Null-move pruning: пропускаем ход и смотрим, держится ли позиция
  if (allowNull && !inCheck && depth >= 3 && gamePhase(state.board) > 6) {
    const nullState = ChessEngine.cloneState(state);
    nullState.turn = ChessEngine.opponent(state.turn);
    nullState.epSquare = null;
    const R = depth > 6 ? 3 : 2;
    const score = -negamax(nullState, depth - 1 - R, -beta, -beta + 1, ctx, ply + 1, false);
    if (timeUp(ctx)) return 0;
    if (score >= beta) return beta;
  }

  const ordered = orderMoves(moves, ttMove, ctx.killers, ctx.history, ply);
  let best = -INF;
  let bestMove = null;

  for (let i = 0; i < ordered.length; i++) {
    const move = ordered[i];
    const next = ChessEngine.applyMove(state, move);

    let score;
    const givesCheck = ChessEngine.isInCheck(next, next.turn);
    let ext = givesCheck ? 1 : 0;

    if (i === 0) {
      score = -negamax(next, depth - 1 + ext, -beta, -alpha, ctx, ply + 1, true);
    } else {
      // Late move reduction для тихих ходов в конце списка
      let reduction = 0;
      if (depth >= 3 && i >= 4 && !move.captured && !move.promotion && !givesCheck && !inCheck) {
        reduction = 1;
      }
      score = -negamax(next, depth - 1 - reduction + ext, -alpha - 1, -alpha, ctx, ply + 1, true);
      if (score > alpha && score < beta) {
        score = -negamax(next, depth - 1 + ext, -beta, -alpha, ctx, ply + 1, true);
      }
    }
    if (timeUp(ctx)) return 0;

    if (score > best) { best = score; bestMove = move; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!move.captured) {
        if (!ctx.killers[ply]) ctx.killers[ply] = [null, null];
        if (!ChessEngine.sameMove(ctx.killers[ply][0], move)) {
          ctx.killers[ply][1] = ctx.killers[ply][0];
          ctx.killers[ply][0] = move;
        }
        const hKey = move.piece + move.to[0] + ',' + move.to[1];
        ctx.history[hKey] = (ctx.history[hKey] || 0) + depth * depth;
      }
      break;
    }
  }

  const flag = best <= alphaOrig ? 'upper' : best >= beta ? 'lower' : 'exact';
  if (ctx.tt.size < 400000) {
    ctx.tt.set(key, { depth, score: best, flag, move: bestMove });
  }
  return best;
}

/**
 * Итеративное углубление. Возвращает лучший ход и оценку в сантипешках
 * с точки зрения стороны, которая ходит.
 */
function search(state, options) {
  const opts = options || {};
  const maxDepth = opts.depth || 6;
  const ctx = createSearchContext(opts.timeMs || 2000);

  const rootMoves = ChessEngine.generateLegalMoves(state, state.turn);
  if (rootMoves.length === 0) return null;

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let reachedDepth = 0;
  let bestLine = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    const beta = INF;
    let iterBest = null;
    let iterScore = -INF;
    const scoredRoot = [];

    const ordered = orderMoves(rootMoves, bestMove, ctx.killers, ctx.history, 0);
    for (const move of ordered) {
      const next = ChessEngine.applyMove(state, move);
      const score = -negamax(next, depth - 1, -beta, -alpha, ctx, 1, true);
      if (ctx.aborted) break;
      scoredRoot.push({ move, score });
      if (score > iterScore) { iterScore = score; iterBest = move; }
      if (score > alpha) alpha = score;
    }

    if (ctx.aborted) break;
    if (iterBest) {
      bestMove = iterBest;
      bestScore = iterScore;
      reachedDepth = depth;
      bestLine = scoredRoot.sort((a, b) => b.score - a.score);
    }
    // Найден форсированный мат — дальше искать незачем
    if (Math.abs(bestScore) > MATE_THRESHOLD) break;
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: reachedDepth,
    nodes: ctx.nodes,
    rootScores: bestLine,
    mate: Math.abs(bestScore) > MATE_THRESHOLD
      ? Math.sign(bestScore) * Math.ceil((MATE_SCORE - Math.abs(bestScore)) / 2)
      : null,
  };
}

const NativeEngine = { search, evaluateBoard, PIECE_VALUES, MATE_THRESHOLD, MATE_SCORE };
