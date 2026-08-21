/**
 * Разбор партии: классификация ходов и точность игры.
 *
 * Оценки берутся у движка (Stockfish, если доступен). Ход сравнивается
 * с лучшим ходом в той же позиции; разница в сантипешках («потеря»)
 * определяет категорию хода.
 *
 * Точность считается по «шансам на победу» — так же, как это делают
 * современные шахматные сайты: важна не сама потеря в пешках, а насколько
 * она изменила вероятность выигрыша.
 */

const ChessAnalysis = (function () {

  const TAGS = {
    brilliant:  { key: 'brilliant',  icon: '‼', name: 'Блестящій',   color: '#1aa89a', weight: 6 },
    great:      { key: 'great',      icon: '!',  name: 'Отличный',    color: '#3679d6', weight: 5 },
    best:       { key: 'best',       icon: '★', name: 'Лучшій ходъ', color: '#2e7d32', weight: 4 },
    good:       { key: 'good',       icon: '✓', name: 'Хорошій',     color: '#68a357', weight: 3 },
    book:       { key: 'book',       icon: '📖', name: 'Дебютъ',      color: '#8d6e4a', weight: 3 },
    inaccuracy: { key: 'inaccuracy', icon: '?!', name: 'Неточность', color: '#d8a026', weight: 2 },
    mistake:    { key: 'mistake',    icon: '?',  name: 'Ошибка',     color: '#e07a1f', weight: 1 },
    blunder:    { key: 'blunder',    icon: '??', name: 'Зѣвокъ',      color: '#c62828', weight: 0 },
  };

  const TAG_ORDER = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

  const MATE_CP = 10000;

  /** Приводит оценку (сантипешки или мат) к единой числовой шкале. */
  function toCp(evaluation) {
    if (!evaluation) return 0;
    if (evaluation.mate !== null && evaluation.mate !== undefined) {
      return evaluation.mate > 0 ? MATE_CP - evaluation.mate * 10 : -MATE_CP - evaluation.mate * 10;
    }
    return evaluation.cp === null || evaluation.cp === undefined ? 0 : evaluation.cp;
  }

  /** Шансы на победу белых (0..100) по оценке в сантипешках. */
  function winPercent(cp) {
    const clamped = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
  }

  /** Точность одного хода (0..100) по падению шансов на победу. */
  function moveAccuracy(winBefore, winAfter) {
    const drop = Math.max(0, winBefore - winAfter);
    const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
    return Math.max(0, Math.min(100, raw));
  }

  /**
   * Классифицирует один ход.
   *
   * @param {object} args
   *   evalBefore  оценка позиции ДО хода (за белых)
   *   evalAfter   оценка позиции ПОСЛЕ хода (за белых)
   *   playedMove  сделанный ход
   *   bestMove    лучший ход по движку в позиции до хода
   *   stateBefore позиция до хода
   *   legalCount  число легальных ходов в позиции до хода
   *   secondBestCp оценка второго по силе хода (за белых), если известна
   */
  function classify(args) {
    const { evalBefore, evalAfter, playedMove, bestMove, stateBefore, legalCount, secondBestCp } = args;
    const mover = stateBefore.turn;
    const sign = mover === 'w' ? 1 : -1;

    const cpBefore = toCp(evalBefore) * sign;   // с точки зрения ходящего
    const cpAfter = toCp(evalAfter) * sign;
    const loss = Math.max(0, cpBefore - cpAfter);

    const winBefore = mover === 'w' ? winPercent(toCp(evalBefore)) : 100 - winPercent(toCp(evalBefore));
    const winAfter = mover === 'w' ? winPercent(toCp(evalAfter)) : 100 - winPercent(toCp(evalAfter));
    const accuracy = moveAccuracy(winBefore, winAfter);

    // Единственный возможный ход — не заслуга и не ошибка
    if (legalCount === 1) {
      return { tag: 'best', forced: true, loss: 0, accuracy: 100, cpAfter: toCp(evalAfter) };
    }

    const isBest = bestMove && ChessEngine.sameMove(playedMove, bestMove);
    let tag;
    if (isBest || loss <= 10) tag = 'best';
    else if (loss <= 40) tag = 'good';
    else if (loss <= 90) tag = 'inaccuracy';
    else if (loss <= 250) tag = 'mistake';
    else tag = 'blunder';

    // «Блестяще»: жертва материала, которая при этом остаётся сильнейшим
    // продолжением и не портит позицию.
    if ((tag === 'best' || tag === 'good') && isSacrifice(stateBefore, playedMove) && cpAfter > -150) {
      tag = 'brilliant';
    } else if (tag === 'best' && isOnlyGoodMove(cpBefore, secondBestCp, sign)) {
      tag = 'great';
    }

    return {
      tag,
      forced: false,
      loss: Math.round(loss),
      accuracy,
      cpAfter: toCp(evalAfter),
      bestMove,
    };
  }

  /** Единственный ход, удерживающий позицию: второй по силе заметно хуже. */
  function isOnlyGoodMove(cpBefore, secondBestCp, sign) {
    if (secondBestCp === null || secondBestCp === undefined) return false;
    const second = secondBestCp * sign;
    return cpBefore - second >= 150;
  }

  /**
   * Ход отдаёт материал: фигура встаёт под бой более дешёвой фигуры
   * (или просто под бой без немедленной компенсации взятием).
   */
  function isSacrifice(stateBefore, move) {
    const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
    const movingValue = VALUES[move.piece[1]];
    if (movingValue < 300) return false;              // пешки не считаем жертвой
    const gained = move.captured ? VALUES[move.captured[1]] : 0;
    if (gained >= movingValue) return false;           // это размен, а не жертва

    const after = ChessEngine.applyMove(stateBefore, move);
    const [tr, tc] = move.to;
    const enemy = ChessEngine.opponent(move.piece[0]);
    const attacked = ChessEngine.isSquareAttacked(after.board, tr, tc, enemy);
    return attacked && (movingValue - gained) >= 200;
  }

  /** Итоговая точность стороны — среднее по точности её ходов. */
  function sideAccuracy(perMove) {
    const valid = perMove.filter((m) => m && typeof m.accuracy === 'number');
    if (valid.length === 0) return null;
    const sum = valid.reduce((acc, m) => acc + m.accuracy, 0);
    return sum / valid.length;
  }

  /** Сводка по категориям ходов для одной стороны. */
  function tagCounts(perMove) {
    const counts = {};
    TAG_ORDER.forEach((t) => { counts[t] = 0; });
    perMove.forEach((m) => {
      if (m && m.tag && counts[m.tag] !== undefined) counts[m.tag] += 1;
    });
    return counts;
  }

  /** Оценка для показа игроку: «+1.4», «−0.7», «мат в 3». */
  function formatEval(evaluation, povColor) {
    if (!evaluation) return '0.0';
    const sign = povColor === 'b' ? -1 : 1;
    if (evaluation.mate !== null && evaluation.mate !== undefined) {
      const m = evaluation.mate * sign;
      return (m > 0 ? '#' : '−#') + Math.abs(m);
    }
    const cp = (evaluation.cp || 0) * sign;
    const pawns = cp / 100;
    const text = Math.abs(pawns).toFixed(1);
    if (pawns > 0.05) return '+' + text;
    if (pawns < -0.05) return '−' + text;
    return '0.0';
  }

  return {
    TAGS, TAG_ORDER, classify, sideAccuracy, tagCounts,
    winPercent, toCp, formatEval, moveAccuracy,
  };
})();
