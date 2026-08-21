/**
 * Minimal but complete chess rules engine.
 * Board layout: 8x8 array, row 0 = rank 8 (top/black side), row 7 = rank 1 (bottom/white side), col 0 = file a.
 * Pieces are two-char strings: color ('w'/'b') + type ('p','n','b','r','q','k'). Empty = null.
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function squareName(r, c) {
  return FILES[c] + (8 - r);
}

function initialBoard() {
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const board = new Array(8);
  board[0] = back.map((t) => 'b' + t);
  board[1] = new Array(8).fill('bp');
  for (let r = 2; r <= 5; r++) board[r] = new Array(8).fill(null);
  board[6] = new Array(8).fill('wp');
  board[7] = back.map((t) => 'w' + t);
  return board;
}

function createInitialState() {
  return {
    board: initialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epSquare: null,
    halfmove: 0,
    fullmove: 1,
    posHistory: [],
    lastMove: null,
  };
}

function cloneState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    castling: { ...state.castling },
    epSquare: state.epSquare ? [state.epSquare[0], state.epSquare[1]] : null,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    posHistory: state.posHistory.slice(),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function opponent(color) {
  return color === 'w' ? 'b' : 'w';
}

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const QUEEN_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);

function isSquareAttacked(board, r, c, byColor) {
  // Pawns
  if (byColor === 'w') {
    if (inBounds(r + 1, c - 1) && board[r + 1][c - 1] === 'wp') return true;
    if (inBounds(r + 1, c + 1) && board[r + 1][c + 1] === 'wp') return true;
  } else {
    if (inBounds(r - 1, c - 1) && board[r - 1][c - 1] === 'bp') return true;
    if (inBounds(r - 1, c + 1) && board[r - 1][c + 1] === 'bp') return true;
  }
  // Knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'n') return true;
  }
  // King
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'k') return true;
  }
  // Sliding: bishop/queen
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p[0] === byColor && (p[1] === 'b' || p[1] === 'q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  // Sliding: rook/queen
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (p[0] === byColor && (p[1] === 'r' || p[1] === 'q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === color + 'k') return [r, c];
    }
  }
  return null;
}

function isInCheck(state, color) {
  const kingPos = findKing(state.board, color);
  if (!kingPos) return false;
  return isSquareAttacked(state.board, kingPos[0], kingPos[1], opponent(color));
}

function generatePseudoMoves(state, color) {
  const { board } = state;
  const moves = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece[0] !== color) continue;
      const type = piece[1];

      if (type === 'p') {
        const dir = color === 'w' ? -1 : 1;
        const startRow = color === 'w' ? 6 : 1;
        const promoRow = color === 'w' ? 0 : 7;
        const oneStep = r + dir;

        if (inBounds(oneStep, c) && !board[oneStep][c]) {
          if (oneStep === promoRow) {
            for (const promo of ['q', 'r', 'b', 'n']) {
              moves.push({ from: [r, c], to: [oneStep, c], piece, promotion: promo, captured: null });
            }
          } else {
            moves.push({ from: [r, c], to: [oneStep, c], piece, captured: null });
          }
          const twoStep = r + 2 * dir;
          if (r === startRow && !board[twoStep][c]) {
            moves.push({ from: [r, c], to: [twoStep, c], piece, captured: null, isDoublePawnPush: true });
          }
        }
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (!inBounds(oneStep, nc)) continue;
          const target = board[oneStep][nc];
          if (target && target[0] !== color) {
            if (oneStep === promoRow) {
              for (const promo of ['q', 'r', 'b', 'n']) {
                moves.push({ from: [r, c], to: [oneStep, nc], piece, promotion: promo, captured: target });
              }
            } else {
              moves.push({ from: [r, c], to: [oneStep, nc], piece, captured: target });
            }
          } else if (state.epSquare && state.epSquare[0] === oneStep && state.epSquare[1] === nc) {
            moves.push({ from: [r, c], to: [oneStep, nc], piece, captured: board[r][nc], isEnPassant: true });
          }
        }
      } else if (type === 'n') {
        for (const [dr, dc] of KNIGHT_OFFSETS) {
          const nr = r + dr, nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target || target[0] !== color) {
            moves.push({ from: [r, c], to: [nr, nc], piece, captured: target });
          }
        }
      } else if (type === 'k') {
        for (const [dr, dc] of KING_OFFSETS) {
          const nr = r + dr, nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target || target[0] !== color) {
            moves.push({ from: [r, c], to: [nr, nc], piece, captured: target });
          }
        }
        // Castling
        const homeRow = color === 'w' ? 7 : 0;
        if (r === homeRow && c === 4) {
          const kSide = color === 'w' ? state.castling.wK : state.castling.bK;
          const qSide = color === 'w' ? state.castling.wQ : state.castling.bQ;
          const enemy = opponent(color);
          if (kSide && !board[homeRow][5] && !board[homeRow][6] &&
              !isSquareAttacked(board, homeRow, 4, enemy) &&
              !isSquareAttacked(board, homeRow, 5, enemy) &&
              !isSquareAttacked(board, homeRow, 6, enemy)) {
            moves.push({ from: [r, c], to: [homeRow, 6], piece, captured: null, isCastle: 'K' });
          }
          if (qSide && !board[homeRow][3] && !board[homeRow][2] && !board[homeRow][1] &&
              !isSquareAttacked(board, homeRow, 4, enemy) &&
              !isSquareAttacked(board, homeRow, 3, enemy) &&
              !isSquareAttacked(board, homeRow, 2, enemy)) {
            moves.push({ from: [r, c], to: [homeRow, 2], piece, captured: null, isCastle: 'Q' });
          }
        }
      } else {
        const dirs = type === 'b' ? BISHOP_DIRS : type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
        for (const [dr, dc] of dirs) {
          let nr = r + dr, nc = c + dc;
          while (inBounds(nr, nc)) {
            const target = board[nr][nc];
            if (!target) {
              moves.push({ from: [r, c], to: [nr, nc], piece, captured: null });
            } else {
              if (target[0] !== color) {
                moves.push({ from: [r, c], to: [nr, nc], piece, captured: target });
              }
              break;
            }
            nr += dr; nc += dc;
          }
        }
      }
    }
  }
  return moves;
}

function applyMove(state, move) {
  const next = cloneState(state);
  const { board } = next;
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = move.piece;
  const color = piece[0];

  next.epSquare = null;

  if (move.isEnPassant) {
    board[fr][tc] = null; // captured pawn sits beside the destination
  }

  board[fr][fc] = null;
  board[tr][tc] = move.promotion ? color + move.promotion : piece;

  if (move.isCastle === 'K') {
    const homeRow = color === 'w' ? 7 : 0;
    board[homeRow][5] = board[homeRow][7];
    board[homeRow][7] = null;
  } else if (move.isCastle === 'Q') {
    const homeRow = color === 'w' ? 7 : 0;
    board[homeRow][3] = board[homeRow][0];
    board[homeRow][0] = null;
  }

  if (move.isDoublePawnPush) {
    next.epSquare = [(fr + tr) / 2, fc];
  }

  if (piece[1] === 'k') {
    if (color === 'w') { next.castling.wK = false; next.castling.wQ = false; }
    else { next.castling.bK = false; next.castling.bQ = false; }
  }
  if (piece[1] === 'r') {
    if (color === 'w' && fr === 7 && fc === 0) next.castling.wQ = false;
    if (color === 'w' && fr === 7 && fc === 7) next.castling.wK = false;
    if (color === 'b' && fr === 0 && fc === 0) next.castling.bQ = false;
    if (color === 'b' && fr === 0 && fc === 7) next.castling.bK = false;
  }
  // If a rook is captured on its home square, remove castling rights
  if (tr === 7 && tc === 0) next.castling.wQ = false;
  if (tr === 7 && tc === 7) next.castling.wK = false;
  if (tr === 0 && tc === 0) next.castling.bQ = false;
  if (tr === 0 && tc === 7) next.castling.bK = false;

  if (piece[1] === 'p' || move.captured) {
    next.halfmove = 0;
  } else {
    next.halfmove += 1;
  }

  if (color === 'b') next.fullmove += 1;
  next.turn = opponent(color);
  next.lastMove = { from: move.from, to: move.to };
  next.posHistory.push(positionKey(next));
  return next;
}

function positionKey(state) {
  const b = state.board.map((row) => row.map((p) => p || '.').join('')).join('/');
  const c = state.castling;
  const ep = state.epSquare ? state.epSquare.join(',') : '-';
  return `${b}|${state.turn}|${c.wK ? 1 : 0}${c.wQ ? 1 : 0}${c.bK ? 1 : 0}${c.bQ ? 1 : 0}|${ep}`;
}

/**
 * Filter pseudo-legal moves down to legal ones.
 * Uses in-place make/unmake on the board array (no state cloning) — legality
 * only depends on whether the mover's own king ends up attacked, and castling
 * path safety is already validated during pseudo-move generation.
 */
function generateLegalMoves(state, color) {
  const pseudo = generatePseudoMoves(state, color);
  const board = state.board;
  const legal = [];

  for (const move of pseudo) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    const moved = board[fr][fc];
    const captured = board[tr][tc];

    // Make
    board[fr][fc] = null;
    board[tr][tc] = move.promotion ? color + move.promotion : moved;
    let epCapturedSquare = null;
    let epCapturedPiece = null;
    if (move.isEnPassant) {
      epCapturedSquare = [fr, tc];
      epCapturedPiece = board[fr][tc];
      board[fr][tc] = null;
    }

    const kingPos = moved[1] === 'k' ? [tr, tc] : findKing(board, color);
    const safe = kingPos ? !isSquareAttacked(board, kingPos[0], kingPos[1], opponent(color)) : true;

    // Unmake
    board[fr][fc] = moved;
    board[tr][tc] = captured;
    if (epCapturedSquare) board[epCapturedSquare[0]][epCapturedSquare[1]] = epCapturedPiece;

    if (safe) legal.push(move);
  }
  return legal;
}

function countRepetitions(state) {
  if (state.posHistory.length === 0) return 0;
  const key = state.posHistory[state.posHistory.length - 1];
  let count = 0;
  for (const k of state.posHistory) if (k === key) count++;
  return count;
}

function hasInsufficientMaterial(state) {
  const pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && p[1] !== 'k') pieces.push(p);
    }
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0][1] === 'n' || pieces[0][1] === 'b')) return true;
  if (pieces.length === 2 && pieces.every((p) => p[1] === 'b')) {
    // same-color bishops only -> still technically insufficient in the common case; approximate
    return true;
  }
  return false;
}

function getGameStatus(state) {
  const legalMoves = generateLegalMoves(state, state.turn);
  const inCheck = isInCheck(state, state.turn);

  if (legalMoves.length === 0) {
    if (inCheck) {
      return { over: true, result: state.turn === 'w' ? 'black_wins' : 'white_wins', reason: 'checkmate' };
    }
    return { over: true, result: 'draw', reason: 'stalemate' };
  }
  if (state.halfmove >= 100) {
    return { over: true, result: 'draw', reason: 'fifty_move' };
  }
  if (countRepetitions(state) >= 3) {
    return { over: true, result: 'draw', reason: 'repetition' };
  }
  if (hasInsufficientMaterial(state)) {
    return { over: true, result: 'draw', reason: 'insufficient_material' };
  }
  return { over: false, inCheck, legalMoves };
}

// ---------- FEN / UCI interop (for talking to Stockfish) ----------

const FEN_PIECE = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

function toFEN(state) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const letter = FEN_PIECE[p[1]];
      row += p[0] === 'w' ? letter.toUpperCase() : letter;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const placement = rows.join('/');

  let castle = '';
  if (state.castling.wK) castle += 'K';
  if (state.castling.wQ) castle += 'Q';
  if (state.castling.bK) castle += 'k';
  if (state.castling.bQ) castle += 'q';
  if (!castle) castle = '-';

  const ep = state.epSquare ? squareName(state.epSquare[0], state.epSquare[1]) : '-';
  return `${placement} ${state.turn} ${castle} ${ep} ${state.halfmove} ${state.fullmove}`;
}

function moveToUci(move) {
  return squareName(move.from[0], move.from[1]) +
    squareName(move.to[0], move.to[1]) +
    (move.promotion || '');
}

function parseSquare(name) {
  return [8 - parseInt(name[1], 10), name.charCodeAt(0) - 97];
}

/** Find the legal move object matching a UCI string like "e2e4" or "e7e8q". */
function uciToMove(state, uci) {
  if (!uci || uci.length < 4) return null;
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const promotion = uci.length > 4 ? uci[4].toLowerCase() : null;
  const legal = generateLegalMoves(state, state.turn);
  return legal.find((m) =>
    m.from[0] === from[0] && m.from[1] === from[1] &&
    m.to[0] === to[0] && m.to[1] === to[1] &&
    (m.promotion || null) === promotion) || null;
}

function sameMove(a, b) {
  if (!a || !b) return false;
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] &&
    a.to[0] === b.to[0] && a.to[1] === b.to[1] &&
    (a.promotion || null) === (b.promotion || null);
}

// Exported API
const ChessEngine = {
  createInitialState,
  cloneState,
  applyMove,
  generateLegalMoves,
  isInCheck,
  isSquareAttacked,
  getGameStatus,
  squareName,
  parseSquare,
  opponent,
  toFEN,
  moveToUci,
  uciToMove,
  sameMove,
  positionKey,
};
