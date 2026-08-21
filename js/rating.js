/**
 * Рейтинг игрока по системе Эло.
 *
 * У каждого уровня сложности — свой постоянный рейтинг. Рейтинг игрока
 * пересчитывается после каждой законченной партии по классической формуле
 * Эло, поэтому победа над более сильным соперником приносит больше очков,
 * а поражение от него отнимает меньше, чем поражение от слабого.
 */

const ChessRating = (function () {

  const STARTING_RATING = 1200;
  const STORAGE_KEY = 'russkie-shahmaty-rating-v2';

  // Разрядная лестница по образцу советской/российской спортивной классификации
  const RANKS = [
    { max: 999,      name: 'III разрядъ' },
    { max: 1199,     name: 'II разрядъ' },
    { max: 1399,     name: 'I разрядъ' },
    { max: 1699,     name: 'Кандидатъ въ мастера спорта' },
    { max: 1999,     name: 'Мастеръ спорта' },
    { max: 2299,     name: 'Международный мастеръ' },
    { max: Infinity, name: 'Гроссмейстеръ' },
  ];

  function rankFor(rating) {
    return RANKS.find((r) => rating <= r.max) || RANKS[RANKS.length - 1];
  }

  /** Рейтинг соперника для выбранного уровня сложности. */
  function opponentRating(levelKey) {
    const level = EngineManager.LEVELS[levelKey];
    return level ? level.rating : 1200;
  }

  function expectedScore(playerRating, opponentElo) {
    return 1 / (1 + Math.pow(10, (opponentElo - playerRating) / 400));
  }

  /** Коэффициент K: новички двигаются быстрее, опытные — плавнее. */
  function kFactor(gamesPlayed, rating) {
    if (gamesPlayed < 20) return 40;
    if (rating >= 2200) return 16;
    return 24;
  }

  /**
   * @param {number} score 1 — победа, 0.5 — ничья, 0 — поражение
   * @returns {number} изменение рейтинга (целое, может быть отрицательным)
   */
  function change(playerRating, opponentElo, score, gamesPlayed) {
    const expected = expectedScore(playerRating, opponentElo);
    const k = kFactor(gamesPlayed, playerRating);
    const delta = k * (score - expected);
    // Не даём изменению «схлопнуться» в ноль: минимум одно очко в нужную сторону
    if (delta > 0) return Math.max(1, Math.round(delta));
    if (delta < 0) return Math.min(-1, Math.round(delta));
    return 0;
  }

  function defaultState() {
    return { rating: STARTING_RATING, games: 0, wins: 0, losses: 0, draws: 0, best: STARTING_RATING, history: [] };
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (typeof parsed.rating !== 'number') return defaultState();
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* хранилище недоступно — не страшно */ }
  }

  /**
   * Применяет результат партии и возвращает подробности изменения.
   * Мутирует и сохраняет переданное состояние.
   */
  function applyResult(state, levelKey, score) {
    const opponentElo = opponentRating(levelKey);
    const before = state.rating;
    const delta = change(before, opponentElo, score, state.games);
    const after = Math.max(100, before + delta);

    state.rating = after;
    state.games += 1;
    if (score === 1) state.wins += 1;
    else if (score === 0) state.losses += 1;
    else state.draws += 1;
    if (after > state.best) state.best = after;
    state.history.push({ r: after, d: delta, lvl: levelKey, s: score, t: Date.now() });
    if (state.history.length > 200) state.history = state.history.slice(-200);

    save(state);
    return { before, after, delta, opponentElo };
  }

  function reset() {
    const fresh = defaultState();
    save(fresh);
    return fresh;
  }

  return {
    STARTING_RATING, RANKS, rankFor, opponentRating,
    change, applyResult, load, save, reset, defaultState, expectedScore,
  };
})();
