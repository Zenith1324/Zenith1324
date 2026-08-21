/**
 * Шахматные часы с добавлением времени (инкрементом).
 * Время хранится в миллисекундах; отсчёт идёт по реальным часам,
 * поэтому подвисания вкладки не искажают показания.
 */

const TIME_CONTROLS = [
  { key: 'none', label: 'Без часов', base: null, inc: 0 },
  { key: '1+0',  label: '1+0',  base: 60,   inc: 0, kind: 'Пуля' },
  { key: '3+0',  label: '3+0',  base: 180,  inc: 0, kind: 'Блиц' },
  { key: '3+2',  label: '3+2',  base: 180,  inc: 2, kind: 'Блиц' },
  { key: '5+0',  label: '5+0',  base: 300,  inc: 0, kind: 'Блиц' },
  { key: '5+3',  label: '5+3',  base: 300,  inc: 3, kind: 'Блиц' },
  { key: '10+0', label: '10+0', base: 600,  inc: 0, kind: 'Рапид' },
  { key: '10+5', label: '10+5', base: 600,  inc: 5, kind: 'Рапид' },
];

function getTimeControl(key) {
  return TIME_CONTROLS.find((t) => t.key === key) || TIME_CONTROLS[0];
}

class ChessClock {
  /**
   * @param {string} controlKey ключ контроля времени
   * @param {object} handlers { onTick(remaining), onFlag(color) }
   */
  constructor(controlKey, handlers) {
    const tc = getTimeControl(controlKey);
    this.control = tc;
    this.enabled = tc.base !== null;
    this.baseMs = this.enabled ? tc.base * 1000 : 0;
    this.incMs = tc.inc * 1000;
    this.remaining = { w: this.baseMs, b: this.baseMs };
    this.running = false;
    this.activeColor = null;
    this.lastStamp = 0;
    this.timer = null;
    this.flagged = null;
    this.handlers = handlers || {};
  }

  /** Запускает отсчёт для указанного цвета (или продолжает текущий). */
  start(color) {
    if (!this.enabled || this.flagged) return;
    this.activeColor = color;
    this.lastStamp = Date.now();
    if (!this.running) {
      this.running = true;
      this.timer = setInterval(() => this._tick(), 100);
    }
    this._emit();
  }

  /** Останавливает часы, списывая время, прошедшее с последней отметки. */
  stop() {
    if (this.running) {
      this._drain();
      clearInterval(this.timer);
      this.timer = null;
      this.running = false;
    }
    this._emit();
  }

  /**
   * Ход сделан: списываем прошедшее время, добавляем инкремент
   * и передаём ход другой стороне.
   */
  press(colorThatMoved) {
    if (!this.enabled || this.flagged) return;
    this._drain();
    if (this.remaining[colorThatMoved] > 0) {
      this.remaining[colorThatMoved] += this.incMs;
    }
    this.start(ChessEngine.opponent(colorThatMoved));
  }

  /** Списывает время, прошедшее с последней отметки, у активной стороны. */
  _drain() {
    if (!this.enabled || !this.activeColor) return;
    const now = Date.now();
    const elapsed = now - this.lastStamp;
    this.lastStamp = now;
    if (elapsed <= 0) return;
    this.remaining[this.activeColor] = Math.max(0, this.remaining[this.activeColor] - elapsed);
  }

  _tick() {
    this._drain();
    if (this.activeColor && this.remaining[this.activeColor] <= 0 && !this.flagged) {
      this.flagged = this.activeColor;
      this.stop();
      if (this.handlers.onFlag) this.handlers.onFlag(this.activeColor);
      return;
    }
    this._emit();
  }

  _emit() {
    if (this.handlers.onTick) {
      this.handlers.onTick(this.remaining, this.activeColor);
    }
  }

  /** Полное состояние — для синхронизации по сети. */
  snapshot() {
    return { w: this.remaining.w, b: this.remaining.b, active: this.activeColor };
  }

  applySnapshot(snap) {
    if (!this.enabled || !snap) return;
    this.remaining.w = snap.w;
    this.remaining.b = snap.b;
    this.lastStamp = Date.now();
    this._emit();
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }
}

/** Форматирует миллисекунды как мм:сс, а под конец — с десятыми долями. */
function formatClock(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  if (total < 20000) {
    const tenths = Math.floor((total % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const Clock = { ChessClock, TIME_CONTROLS, getTimeControl, formatClock };
