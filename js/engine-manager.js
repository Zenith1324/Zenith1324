/**
 * Единый интерфейс к шахматному движку.
 *
 * Предпочитает Stockfish 18 (WASM, однопоточная «лёгкая» сборка). Если Worker
 * недоступен — например, страница открыта напрямую через file:// — прозрачно
 * переключается на встроенный движок (engine-native.js).
 *
 * Все методы асинхронные и возвращают оценку в сантипешках с точки зрения БЕЛЫХ.
 */

const STOCKFISH_URL = 'vendor/stockfish/stockfish-18-lite-single.js';

// ---------- Уровни сложности ----------
// elo:   значение UCI_Elo для Stockfish (null = без ограничения силы)
// skill: Skill Level 0..20, используется когда elo слишком низок для движка
// depth: глубина для встроенного запасного движка
// blunder: вероятность намеренно случайного хода (только для самых слабых)
const LEVELS = {
  novice:   { name: 'Новичок',        rating: 800,  skill: 0,  elo: null, movetime: 50,   depth: 1, blunder: 0.30 },
  amateur:  { name: 'Любитель',       rating: 1200, skill: 2,  elo: null, movetime: 100,  depth: 2, blunder: 0.12 },
  club:     { name: 'Клубный игрок',  rating: 1600, skill: 6,  elo: 1600, movetime: 200,  depth: 4, blunder: 0.03 },
  candidate:{ name: 'Кандидат в мастера', rating: 1900, skill: 11, elo: 1900, movetime: 350, depth: 5, blunder: 0 },
  master:   { name: 'Гроссмейстер',   rating: 2400, skill: 17, elo: 2400, movetime: 800,  depth: 6, blunder: 0 },
  champion: { name: 'Чемпион мира',   rating: 2850, skill: 20, elo: null, movetime: 2000, depth: 7, blunder: 0 },
};

const ANALYSIS_DEPTH = 14;
const LIVE_ANALYSIS_DEPTH = 11;

// ---------- UCI-клиент поверх Web Worker ----------

class UciEngine {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.ready = false;
    this.queue = Promise.resolve(); // сериализация команд: движок обрабатывает один поиск за раз
    this.listeners = [];
    this.options = {};
  }

  async start() {
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
      this.listeners.forEach((fn) => fn(line));
    };
    this.worker.onerror = (e) => {
      this.listeners.forEach((fn) => fn('__error__ ' + (e.message || 'worker error')));
    };
    this.send('uci');
    await this.waitFor((l) => l.trim() === 'uciok', 20000);
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.waitFor((l) => l.trim() === 'readyok', 20000);
    this.ready = true;
  }

  send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Таймаут ожидания ответа движка'));
      }, timeoutMs || 30000);
      const listener = (line) => {
        if (line.startsWith('__error__')) {
          cleanup();
          reject(new Error(line));
          return;
        }
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((f) => f !== listener);
      };
      this.listeners.push(listener);
    });
  }

  setOption(name, value) {
    const key = name + '=' + value;
    if (this.options[name] === value) return;
    this.options[name] = value;
    this.send(`setoption name ${name} value ${value}`);
  }

  /**
   * Запускает поиск и возвращает { bestmove, lines: [{ multipv, cp, mate, pv }] }.
   * Оценки — с точки зрения стороны, которая ходит.
   */
  analyse({ fen, depth, movetime, multiPV, skill, elo }) {
    const task = () => new Promise((resolve, reject) => {
      const lines = new Map();
      let settled = false;

      const listener = (line) => {
        if (line.startsWith('__error__')) { finish(() => reject(new Error(line))); return; }

        if (line.startsWith('info ') && line.includes(' pv ')) {
          const mp = /multipv (\d+)/.exec(line);
          const cp = /score cp (-?\d+)/.exec(line);
          const mate = /score mate (-?\d+)/.exec(line);
          const pv = / pv (.+)$/.exec(line);
          const d = /depth (\d+)/.exec(line);
          if (!pv) return;
          const idx = mp ? parseInt(mp[1], 10) : 1;
          lines.set(idx, {
            multipv: idx,
            depth: d ? parseInt(d[1], 10) : 0,
            cp: cp ? parseInt(cp[1], 10) : null,
            mate: mate ? parseInt(mate[1], 10) : null,
            pv: pv[1].trim().split(/\s+/),
          });
        } else if (line.startsWith('bestmove')) {
          const best = line.split(/\s+/)[1];
          finish(() => resolve({
            bestmove: best === '(none)' ? null : best,
            lines: Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv),
          }));
        }
      };

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        this.listeners = this.listeners.filter((f) => f !== listener);
        clearTimeout(guard);
        fn();
      };

      const guard = setTimeout(() => finish(() => reject(new Error('Таймаут поиска'))), 60000);
      this.listeners.push(listener);

      this.setOption('MultiPV', multiPV || 1);
      if (elo) {
        this.setOption('UCI_LimitStrength', 'true');
        this.setOption('UCI_Elo', elo);
      } else {
        this.setOption('UCI_LimitStrength', 'false');
      }
      this.setOption('Skill Level', typeof skill === 'number' ? skill : 20);

      this.send('position fen ' + fen);
      const goCmd = movetime ? `go movetime ${movetime}` : `go depth ${depth || 12}`;
      this.send(goCmd);
    });

    // Гарантируем, что одновременно идёт только один поиск
    const chained = this.queue.then(task, task);
    this.queue = chained.catch(() => {});
    return chained;
  }

  destroy() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.ready = false;
  }
}

// ---------- Менеджер ----------

const EngineManager = (function () {
  let uci = null;
  let backend = 'native';
  let initPromise = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        if (typeof Worker === 'undefined') throw new Error('Worker недоступен');
        const engine = new UciEngine(STOCKFISH_URL);
        await engine.start();
        uci = engine;
        backend = 'stockfish';
      } catch (err) {
        uci = null;
        backend = 'native';
      }
      return backend;
    })();
    return initPromise;
  }

  function getBackend() { return backend; }

  /** Преобразует оценку «за того, кто ходит» в оценку «за белых». */
  function toWhitePov(state, cp, mate) {
    const sign = state.turn === 'w' ? 1 : -1;
    return {
      cp: cp === null || cp === undefined ? null : cp * sign,
      mate: mate === null || mate === undefined ? null : mate * sign,
    };
  }

  /** Ход движка для игры на заданном уровне. */
  async function bestMove(state, levelKey) {
    const cfg = LEVELS[levelKey] || LEVELS.amateur;
    const status = ChessEngine.getGameStatus(state);
    if (status.over) return null;

    // Слабые уровни иногда «зевают» — так они играют человечнее
    if (cfg.blunder && Math.random() < cfg.blunder) {
      const moves = status.legalMoves;
      return moves[Math.floor(Math.random() * moves.length)];
    }

    if (backend === 'stockfish' && uci) {
      try {
        const res = await uci.analyse({
          fen: ChessEngine.toFEN(state),
          movetime: cfg.movetime,
          multiPV: 1,
          skill: cfg.skill,
          elo: cfg.elo,
        });
        const move = res.bestmove ? ChessEngine.uciToMove(state, res.bestmove) : null;
        if (move) return move;
      } catch (e) {
        // падаем на встроенный движок
      }
    }

    const result = NativeEngine.search(state, {
      depth: cfg.depth,
      timeMs: Math.max(cfg.movetime, 400),
    });
    return result ? result.move : null;
  }

  /**
   * Оценка позиции. Возвращает { cp, mate, bestMove, lines } с точки зрения БЕЛЫХ
   * (cp > 0 — лучше у белых).
   */
  async function evaluate(state, options) {
    const opts = options || {};
    const depth = opts.depth || ANALYSIS_DEPTH;
    const status = ChessEngine.getGameStatus(state);

    if (status.over) {
      let cp = 0;
      if (status.reason === 'checkmate') {
        cp = status.result === 'white_wins' ? 100000 : -100000;
      }
      return { cp, mate: null, bestMove: null, lines: [], terminal: status };
    }

    if (backend === 'stockfish' && uci) {
      try {
        const res = await uci.analyse({
          fen: ChessEngine.toFEN(state),
          depth,
          multiPV: opts.multiPV || 1,
          skill: 20,
          elo: null,
        });
        const top = res.lines[0];
        const pov = top ? toWhitePov(state, top.cp, top.mate) : { cp: 0, mate: null };
        return {
          cp: pov.cp,
          mate: pov.mate,
          bestMove: res.bestmove ? ChessEngine.uciToMove(state, res.bestmove) : null,
          bestUci: res.bestmove,
          lines: res.lines.map((l) => {
            const p = toWhitePov(state, l.cp, l.mate);
            return { ...l, cp: p.cp, mate: p.mate, move: ChessEngine.uciToMove(state, l.pv[0]) };
          }),
        };
      } catch (e) {
        // падаем на встроенный движок
      }
    }

    const nativeDepth = Math.min(depth, 5);
    const result = NativeEngine.search(state, { depth: nativeDepth, timeMs: opts.timeMs || 900 });
    if (!result) return { cp: 0, mate: null, bestMove: null, lines: [] };
    const sign = state.turn === 'w' ? 1 : -1;
    return {
      cp: result.mate === null ? result.score * sign : null,
      mate: result.mate === null ? null : result.mate * sign,
      bestMove: result.move,
      bestUci: result.move ? ChessEngine.moveToUci(result.move) : null,
      lines: (result.rootScores || []).slice(0, opts.multiPV || 1).map((rs, i) => ({
        multipv: i + 1,
        cp: rs.score * sign,
        mate: null,
        move: rs.move,
        pv: [ChessEngine.moveToUci(rs.move)],
      })),
    };
  }

  return { init, getBackend, bestMove, evaluate, LEVELS, ANALYSIS_DEPTH, LIVE_ANALYSIS_DEPTH };
})();
