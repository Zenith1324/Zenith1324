/**
 * Chess AI: negamax with alpha-beta pruning, piece-square tables,
 * and configurable difficulty (search depth + move randomness).
 */

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Piece-square tables (from white's perspective, row 0 = rank 8).
const PAWN_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const KNIGHT_TABLE = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];
const BISHOP_TABLE = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];
const ROOK_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0],
];
const QUEEN_TABLE = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];
const KING_MIDGAME_TABLE = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

const TABLES = { p: PAWN_TABLE, n: KNIGHT_TABLE, b: BISHOP_TABLE, r: ROOK_TABLE, q: QUEEN_TABLE, k: KING_MIDGAME_TABLE };

function pieceSquareValue(piece, r, c) {
  const type = piece[1];
  const table = TABLES[type];
  const row = piece[0] === 'w' ? r : 7 - r;
  return table[row][c];
}

function evaluateBoard(state) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const value = PIECE_VALUES[p[1]] + pieceSquareValue(p, r, c);
      score += p[0] === 'w' ? value : -value;
    }
  }
  return score; // positive favors white
}

function orderMoves(moves) {
  // Simple MVV-LVA style ordering: captures of valuable pieces first.
  return moves.slice().sort((a, b) => {
    const av = a.captured ? PIECE_VALUES[a.captured[1]] - PIECE_VALUES[a.piece[1]] / 10 : -1000;
    const bv = b.captured ? PIECE_VALUES[b.captured[1]] - PIECE_VALUES[b.piece[1]] / 10 : -1000;
    return bv - av;
  });
}

function negamax(state, depth, alpha, beta, color, deadline) {
  const status = ChessEngine.getGameStatus(state);
  if (status.over) {
    if (status.reason === 'checkmate') return -100000 - depth; // prefer faster mates
    return 0;
  }
  if (depth === 0 || (deadline && performance.now() > deadline)) {
    const evalScore = evaluateBoard(state);
    return color === 'w' ? evalScore : -evalScore;
  }

  const moves = orderMoves(status.legalMoves);
  let best = -Infinity;
  for (const move of moves) {
    const next = ChessEngine.applyMove(state, move);
    const score = -negamax(next, depth - 1, -beta, -alpha, ChessEngine.opponent(color), deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchBestMove(state, depth, timeLimitMs) {
  const color = state.turn;
  const status = ChessEngine.getGameStatus(state);
  if (status.over) return null;
  const moves = orderMoves(status.legalMoves);
  const deadline = timeLimitMs ? performance.now() + timeLimitMs : null;

  let bestMoves = [];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    const next = ChessEngine.applyMove(state, move);
    const score = -negamax(next, depth - 1, -beta, -alpha, ChessEngine.opponent(color), deadline);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
      alpha = Math.max(alpha, bestScore);
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }
  return { move: bestMoves[Math.floor(Math.random() * bestMoves.length)], score: bestScore, candidates: bestMoves };
}

/**
 * Difficulty presets:
 *  - depth: search depth (plies)
 *  - blunderChance: probability the AI picks a random legal move instead of the best one
 *  - topN: pick randomly among the top N moves by shallow evaluation (adds human-like variety)
 */
const DIFFICULTIES = {
  novice: { label: 'Новичок', depth: 1, blunderChance: 0.35, timeLimitMs: 400 },
  amateur: { label: 'Любитель', depth: 2, blunderChance: 0.15, timeLimitMs: 700 },
  club: { label: 'Клубный игрок', depth: 3, blunderChance: 0.04, timeLimitMs: 1200 },
  master: { label: 'Гроссмейстер', depth: 4, blunderChance: 0, timeLimitMs: 2200 },
};

function pickAiMove(state, difficultyKey) {
  const cfg = DIFFICULTIES[difficultyKey] || DIFFICULTIES.amateur;
  const status = ChessEngine.getGameStatus(state);
  if (status.over) return null;

  if (Math.random() < cfg.blunderChance) {
    const moves = status.legalMoves;
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const result = searchBestMove(state, cfg.depth, cfg.timeLimitMs);
  return result ? result.move : null;
}

const ChessAI = { pickAiMove, evaluateBoard, DIFFICULTIES };
