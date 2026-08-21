/**
 * Elo-style rating system for the player.
 * Each difficulty level is pinned to a fixed opponent rating; the player's
 * own rating moves after every finished game using the standard Elo formula,
 * so beating a stronger opponent gains more than beating a weaker one, and
 * losing to a stronger opponent costs less than losing to a weaker one.
 */

const DIFFICULTY_ELO = {
  novice: 800,
  amateur: 1200,
  club: 1600,
  master: 2000,
};

const STARTING_RATING = 1200;
const STORAGE_KEY = 'ru-chess-rating-v1';

// Loosely modeled on the Soviet/Russian sport-category ladder.
const RANK_TITLES = [
  { max: 999, ru: 'III разряд', en: 'Category III' },
  { max: 1199, ru: 'II разряд', en: 'Category II' },
  { max: 1399, ru: 'I разряд', en: 'Category I' },
  { max: 1599, ru: 'Кандидат в мастера спорта', en: 'Candidate Master' },
  { max: 1899, ru: 'Мастер спорта', en: 'Master' },
  { max: Infinity, ru: 'Гроссмейстер', en: 'Grandmaster' },
];

function getRankTitle(rating) {
  return RANK_TITLES.find((tier) => rating <= tier.max) || RANK_TITLES[RANK_TITLES.length - 1];
}

function expectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function kFactor(gamesPlayed) {
  return gamesPlayed < 20 ? 40 : 20;
}

/** score: 1 = win, 0.5 = draw, 0 = loss (from the player's perspective) */
function computeRatingChange(playerRating, opponentRating, score, gamesPlayed) {
  const expected = expectedScore(playerRating, opponentRating);
  const k = kFactor(gamesPlayed);
  return Math.round(k * (score - expected));
}

function defaultRatingState() {
  return { rating: STARTING_RATING, gamesPlayed: 0, wins: 0, losses: 0, draws: 0 };
}

function loadRatingState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRatingState();
    const parsed = JSON.parse(raw);
    if (typeof parsed.rating !== 'number') return defaultRatingState();
    return { ...defaultRatingState(), ...parsed };
  } catch (e) {
    return defaultRatingState();
  }
}

function saveRatingState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage unavailable, ignore */ }
}

const ChessRating = {
  DIFFICULTY_ELO,
  STARTING_RATING,
  getRankTitle,
  computeRatingChange,
  defaultRatingState,
  loadRatingState,
  saveRatingState,
};
