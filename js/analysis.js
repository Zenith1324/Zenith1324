/**
 * Chess.com-style move classification (Brilliant / Great / Best / Good /
 * Inaccuracy / Mistake / Blunder), built on top of ChessAI.analyzePosition.
 * This is a fixed-depth "house engine" pass, independent of the opponent's
 * gameplay difficulty, so classification quality doesn't change with it.
 */

const ANALYSIS_DEPTH = 3;

const MOVE_TAGS = {
  brilliant: { icon: '‼', ru: 'Блестящий', en: 'Brilliant', weight: 100 },
  great: { icon: '!', ru: 'Отличный', en: 'Great', weight: 100 },
  best: { icon: '★', ru: 'Лучший', en: 'Best', weight: 100 },
  good: { icon: '✓', ru: 'Хороший', en: 'Good', weight: 90 },
  inaccuracy: { icon: '?!', ru: 'Неточность', en: 'Inaccuracy', weight: 70 },
  mistake: { icon: '?', ru: 'Ошибка', en: 'Mistake', weight: 45 },
  blunder: { icon: '??', ru: 'Зевок', en: 'Blunder', weight: 20 },
};

function sameMove(a, b) {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] &&
    a.to[0] === b.to[0] && a.to[1] === b.to[1] &&
    (a.promotion || null) === (b.promotion || null);
}

function classifyByLoss(cpLoss) {
  if (cpLoss <= 10) return 'best';
  if (cpLoss <= 25) return 'good';
  if (cpLoss <= 60) return 'inaccuracy';
  if (cpLoss <= 150) return 'mistake';
  return 'blunder';
}

function looksBrilliant(stateBefore, move, analysis) {
  const type = move.piece[1];
  if (type === 'p' || type === 'k') return false;
  if (ChessAI.PIECE_VALUES[type] < 300) return false;
  if (analysis.bestScore < -300) return false; // don't call a lost position "brilliant"

  const stateAfter = ChessEngine.applyMove(stateBefore, move);
  const [tr, tc] = move.to;
  const attacked = ChessEngine.isSquareAttacked(stateAfter.board, tr, tc, ChessEngine.opponent(move.piece[0]));
  return attacked; // a near-best move that hangs a minor+ piece to enemy capture
}

/**
 * Evaluate one played move relative to the best move available in the
 * position it was played from. Returns null if analysis isn't applicable
 * (e.g. no alternative moves existed).
 */
function evaluateMove(stateBefore, playedMove, depth) {
  const status = ChessEngine.getGameStatus(stateBefore);
  if (status.over) return null;
  if (status.legalMoves.length <= 1) {
    return { tag: 'best', cpLoss: 0, forced: true, bestMove: playedMove };
  }

  const analysis = ChessAI.analyzePosition(stateBefore, depth || ANALYSIS_DEPTH);
  const playedEntry = analysis.scored.find((s) => sameMove(s.move, playedMove));
  const playedScore = playedEntry ? playedEntry.score : analysis.secondBestScore;
  const cpLoss = Math.max(0, analysis.bestScore - playedScore);

  let tag = classifyByLoss(cpLoss);
  if (tag === 'best') {
    if (looksBrilliant(stateBefore, playedMove, analysis)) {
      tag = 'brilliant';
    } else if (sameMove(playedMove, analysis.bestMove) && (analysis.bestScore - analysis.secondBestScore) >= 150) {
      tag = 'great';
    }
  }

  return {
    tag,
    cpLoss,
    forced: false,
    bestMove: analysis.bestMove,
    bestScore: analysis.bestScore,
    playedScore,
  };
}

const ChessAnalysis = { evaluateMove, MOVE_TAGS, ANALYSIS_DEPTH };
