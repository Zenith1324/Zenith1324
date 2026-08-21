/**
 * Музыкальное сопровождение — Александр Николаевич Скрябин (1871–1915).
 *
 * Произведения Скрябина находятся в общественном достоянии. Здесь они не
 * воспроизводятся записями, а синтезируются в Web Audio по нотным данным —
 * это авторские переложения характерных фрагментов:
 *
 *   Победа   — «Поэма экстаза», соч. 54: заключительная апофеозная кода до мажор
 *   Поражение — Этюд ре-диез минор, соч. 8 № 12 («Патетический»)
 *   Ничья    — Прелюдия ми минор, соч. 11 № 4 (Lento)
 *   Блестящий ход — восходящий взлёт в духе прелюдий соч. 11
 *   Зевок    — «прометеев» (мистический) аккорд Скрябина: до–фа♯–си♭–ми–ля–ре
 */

const ScriabinMusic = (function () {
  let ctx = null;
  let masterGain = null;
  let reverbNode = null;
  let enabled = true;
  let volume = 0.5;
  let activeNodes = [];
  let currentPieceName = null;
  let stopTimer = null;

  // ---------- Инициализация звукового графа ----------

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();

    masterGain = ctx.createGain();
    masterGain.gain.value = volume;

    // Простая «зальная» реверберация: импульсная характеристика из шума
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = makeImpulseResponse(2.6, 2.2);

    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    const dry = ctx.createGain();
    dry.gain.value = 0.85;

    masterGain.connect(dry);
    dry.connect(ctx.destination);
    masterGain.connect(reverbNode);
    reverbNode.connect(wet);
    wet.connect(ctx.destination);

    return ctx;
  }

  function makeImpulseResponse(seconds, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ---------- Голоса (тембры) ----------

  /** Фортепианный тембр: несколько затухающих обертонов. */
  function playPiano(midi, startTime, duration, velocity) {
    const freq = midiToFreq(midi);
    const partials = [
      { mult: 1, gain: 1.0, type: 'triangle' },
      { mult: 2, gain: 0.32, type: 'sine' },
      { mult: 3, gain: 0.14, type: 'sine' },
      { mult: 4.01, gain: 0.06, type: 'sine' },
    ];
    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = p.type;
      osc.frequency.value = freq * p.mult;

      const peak = velocity * p.gain * 0.28;
      const decay = duration * (p.mult === 1 ? 1.0 : 0.6);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(decay, 0.12));

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + Math.max(decay, 0.12) + 0.05);
      activeNodes.push(osc, gain);
    });
  }

  /** Медный (духовой) тембр для симфонических кульминаций. */
  function playBrass(midi, startTime, duration, velocity) {
    const freq = midiToFreq(midi);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc2.type = 'sawtooth';
    osc2.frequency.value = freq * 1.005; // лёгкая расстройка — «хор» инструментов

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 2, startTime);
    filter.frequency.linearRampToValueAtTime(freq * 6, startTime + 0.12);
    filter.frequency.linearRampToValueAtTime(freq * 3, startTime + duration);
    filter.Q.value = 1.2;

    const peak = velocity * 0.16;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), startTime + 0.07);
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), startTime + duration * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.1);

    osc.connect(filter); osc2.connect(filter);
    filter.connect(gain); gain.connect(masterGain);
    osc.start(startTime); osc2.start(startTime);
    osc.stop(startTime + duration + 0.15); osc2.stop(startTime + duration + 0.15);
    activeNodes.push(osc, osc2, filter, gain);
  }

  /** Струнный тембр: мягкая атака и вибрато. */
  function playStrings(midi, startTime, duration, velocity) {
    const freq = midiToFreq(midi);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(freq * 5, 5200);

    vibrato.frequency.value = 5.2;
    vibratoGain.gain.value = freq * 0.006;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const peak = velocity * 0.11;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), startTime + 0.22);
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), startTime + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.25);

    osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
    osc.start(startTime); vibrato.start(startTime);
    osc.stop(startTime + duration + 0.3); vibrato.stop(startTime + duration + 0.3);
    activeNodes.push(osc, gain, filter, vibrato, vibratoGain);
  }

  const VOICES = { piano: playPiano, brass: playBrass, strings: playStrings };

  // ---------- Нотный материал ----------
  // Ноты: [midi, начало (доли), длительность (доли), громкость, голос]

  const N = (m, t, d, v, voice) => ({ m, t, d, v: v === undefined ? 0.8 : v, voice: voice || 'piano' });

  /**
   * «Поэма экстаза», соч. 54 — заключительная кода.
   * Восходящая фанфара трубы, затем сияющие аккорды до мажор с добавленной
   * секстой и ноной — характерная скрябинская «светящаяся» гармония.
   */
  function poemOfEcstasy() {
    const notes = [];
    // Фанфара трубы: до–ми–соль–до
    const fanfare = [60, 64, 67, 72];
    fanfare.forEach((m, i) => {
      notes.push(N(m, i * 0.28, 0.34, 0.9, 'brass'));
    });
    notes.push(N(76, 1.12, 0.5, 1.0, 'brass'));

    // Апофеоз: широкие аккорды до мажор (с секстой и ноной)
    const chordTimes = [1.7, 2.7, 3.7];
    const chordShapes = [
      [36, 48, 55, 60, 64, 67, 72],
      [36, 48, 55, 60, 64, 69, 72, 76],  // с секстой (ля)
      [36, 43, 48, 55, 60, 64, 67, 72, 79],
    ];
    chordTimes.forEach((t, ci) => {
      chordShapes[ci].forEach((m) => {
        notes.push(N(m, t, 1.15, 0.85, 'brass'));
        notes.push(N(m, t, 1.4, 0.5, 'strings'));
      });
    });

    // Финальный удар — до мажор во всю ширину
    [24, 36, 48, 60, 64, 67, 72, 76, 84].forEach((m) => {
      notes.push(N(m, 4.9, 2.6, 1.0, 'brass'));
      notes.push(N(m, 4.9, 3.0, 0.6, 'strings'));
    });
    return { notes, tempo: 100, name: '«Поэма экстаза», соч. 54' };
  }

  /**
   * Этюд ре-диез минор, соч. 8 № 12 («Патетический»).
   * Бурные октавы правой руки, широкие скачки левой, трагический характер.
   */
  function etudeOp8No12() {
    const notes = [];
    // Левая рука: тяжёлые октавные скачки (ре-диез = 63)
    const bassPattern = [
      [39, 0], [51, 0.25], [46, 0.5], [51, 0.75],
      [39, 1.0], [51, 1.25], [46, 1.5], [51, 1.75],
      [37, 2.0], [49, 2.25], [44, 2.5], [49, 2.75],
      [39, 3.0], [51, 3.25], [46, 3.5], [51, 3.75],
    ];
    bassPattern.forEach(([m, t]) => {
      notes.push(N(m, t, 0.3, 0.75));
      notes.push(N(m - 12, t, 0.3, 0.6));
    });

    // Правая рука: страстная тема октавами, пунктирный ритм
    const theme = [
      [75, 0.0, 0.45], [77, 0.5, 0.2], [78, 0.75, 0.7],
      [75, 1.5, 0.25], [73, 1.75, 0.25],
      [70, 2.0, 0.7], [68, 2.75, 0.25],
      [70, 3.0, 0.45], [73, 3.5, 0.2], [75, 3.75, 0.25],
    ];
    theme.forEach(([m, t, d]) => {
      notes.push(N(m, t, d, 0.95));
      notes.push(N(m + 12, t, d, 0.7));   // октавное удвоение
      notes.push(N(m - 12, t, d, 0.45));
    });

    // Нисходящий трагический ответ
    const descent = [[75, 4.0], [73, 4.3], [70, 4.6], [68, 4.9], [66, 5.2], [63, 5.5]];
    descent.forEach(([m, t]) => {
      notes.push(N(m, t, 0.42, 0.85));
      notes.push(N(m - 12, t, 0.42, 0.6));
    });

    // Заключительный минорный аккорд
    [39, 51, 58, 63, 66, 70].forEach((m) => notes.push(N(m, 6.0, 2.0, 0.9)));
    return { notes, tempo: 108, name: 'Этюд соч. 8 № 12' };
  }

  /** Прелюдия ми минор, соч. 11 № 4 — Lento, меланхолическая. */
  function preludeOp11No4() {
    const notes = [];
    // Левая рука: широкие арпеджио триолями
    const arp = [40, 47, 52, 55, 52, 47];
    for (let bar = 0; bar < 4; bar++) {
      const shift = bar === 2 ? -2 : 0; // лёгкая смена гармонии
      arp.forEach((m, i) => {
        notes.push(N(m + shift, bar * 1.5 + i * 0.25, 0.5, 0.4));
      });
    }
    // Правая рука: «вздыхающая» мелодия с задержаниями
    const melody = [
      [71, 0.0, 1.1], [72, 1.1, 0.4], [71, 1.5, 1.0],
      [69, 2.5, 0.5], [67, 3.0, 1.2],
      [66, 4.2, 0.5], [64, 4.7, 1.3],
    ];
    melody.forEach(([m, t, d]) => notes.push(N(m, t, d, 0.75)));
    [40, 52, 55, 59, 64].forEach((m) => notes.push(N(m, 6.0, 2.2, 0.55)));
    return { notes, tempo: 60, name: 'Прелюдия соч. 11 № 4' };
  }

  /** Короткий восходящий взлёт — для блестящего хода. */
  function flourish() {
    const notes = [];
    const scale = [64, 67, 71, 74, 76, 79, 83, 86];
    scale.forEach((m, i) => notes.push(N(m, i * 0.075, 0.4, 0.7)));
    [64, 71, 76, 79, 83].forEach((m) => notes.push(N(m, 0.62, 1.2, 0.75)));
    return { notes, tempo: 120, name: 'Взлёт' };
  }

  /** «Прометеев» (мистический) аккорд — для зевка. */
  function mysticChord() {
    const notes = [];
    // до – фа♯ – си♭ – ми – ля – ре
    [48, 54, 58, 64, 69, 74].forEach((m, i) => {
      notes.push(N(m, i * 0.02, 1.6, 0.7));
    });
    notes.push(N(36, 0, 1.8, 0.8));
    return { notes, tempo: 90, name: 'Мистический аккорд' };
  }

  /** Короткий тревожный акцент — для шаха. */
  function checkStab() {
    return { notes: [N(57, 0, 0.35, 0.6), N(63, 0, 0.35, 0.6), N(69, 0.06, 0.4, 0.5)], tempo: 120, name: 'Шах' };
  }

  const PIECES = {
    victory: poemOfEcstasy,
    defeat: etudeOp8No12,
    draw: preludeOp11No4,
    brilliant: flourish,
    blunder: mysticChord,
    check: checkStab,
  };

  // ---------- Воспроизведение ----------

  function stop() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    activeNodes.forEach((node) => {
      try {
        if (node.stop) node.stop();
        node.disconnect();
      } catch (e) { /* уже остановлен */ }
    });
    activeNodes = [];
    currentPieceName = null;
  }

  function play(pieceKey) {
    if (!enabled) return null;
    const builder = PIECES[pieceKey];
    if (!builder) return null;
    if (!ensureContext()) return null;
    if (ctx.state === 'suspended') ctx.resume();

    stop();
    const piece = builder();
    const beat = 60 / piece.tempo;
    const start = ctx.currentTime + 0.06;
    let end = 0;

    piece.notes.forEach((note) => {
      const voice = VOICES[note.voice] || playPiano;
      const t = start + note.t * beat;
      const d = note.d * beat;
      voice(note.m, t, d, note.v);
      end = Math.max(end, note.t * beat + d);
    });

    currentPieceName = piece.name;
    stopTimer = setTimeout(() => { activeNodes = []; currentPieceName = null; }, (end + 1.2) * 1000);
    return piece.name;
  }

  // Короткие служебные звуки хода — синтезируются отдельно от музыки
  function moveSound(isCapture) {
    if (!enabled || !ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isCapture ? 'square' : 'sine';
    osc.frequency.value = isCapture ? 180 : 420;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(isCapture ? 0.06 : 0.045, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (isCapture ? 0.18 : 0.1));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) stop();
  }
  function isEnabled() { return enabled; }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = volume;
  }
  function getVolume() { return volume; }
  function nowPlaying() { return currentPieceName; }
  function unlock() {
    if (ensureContext() && ctx.state === 'suspended') ctx.resume();
  }

  return { play, stop, moveSound, setEnabled, isEnabled, setVolume, getVolume, nowPlaying, unlock, PIECES };
})();
