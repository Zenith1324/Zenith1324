/**
 * Оркестровый синтезаторъ — А. Н. Скрябинъ (1871–1915).
 *
 * Это ЗАПАСНОЙ источникъ звука. Если въ «assets/audio/» лежатъ настоящія
 * записи (см. файлъ «МУЗЫКА.command») или ихъ удалось загрузить изъ сѣти,
 * играютъ они; синтезъ включается только когда записей нѣтъ.
 *
 * Чтобы звучало оркестромъ, а не «восьмибитной» игрушкой, здѣсь смоделированы
 * настоящіе оркестровыя группы:
 *   - струнные: 9 расстроенныхъ голосовъ на ноту со СМѢЩЁННЫМИ атаками
 *     (именно разнобой вступленія музыкантовъ даётъ звукъ группы, а не одного
 *     инструмента), мягкое вступленіе, вибрато со случайной фазой у каждаго;
 *   - мѣдь: пила съ резонанснымъ фильтромъ, открывающимся по огибающей,
 *     и лёгкимъ «подъѣздомъ» высоты въ атакѣ;
 *   - литавры: тонъ + шумовой ударъ съ быстрымъ затуханіемъ;
 *   - деревянные духовые: треугольникъ съ призвукомъ дыханія;
 *   - зальная реверберація длиной около четырёхъ секундъ.
 */

const ScriabinMusic = (function () {
  let ctx = null;
  let master = null;
  let wetGain = null;
  let enabled = true;
  let volume = 0.55;
  let voices = [];
  let currentName = null;
  let cleanupTimer = null;

  // ---------- Звуковой графъ ----------

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = volume;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.28;

    const reverb = ctx.createConvolver();
    reverb.buffer = hallImpulse(4.0, 2.6);
    wetGain = ctx.createGain();
    wetGain.gain.value = 0.42;
    const dry = ctx.createGain();
    dry.gain.value = 0.8;

    master.connect(dry); dry.connect(compressor);
    master.connect(reverb); reverb.connect(wetGain); wetGain.connect(compressor);
    compressor.connect(ctx.destination);
    return ctx;
  }

  /** Импульсная характеристика концертнаго зала. */
  function hallImpulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // ранніе отраженія + диффузный хвостъ
        const early = i < rate * 0.08 ? (Math.random() * 2 - 1) * 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) + early * Math.pow(1 - t, 8);
      }
    }
    return buf;
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const track = (...nodes) => { voices.push(...nodes); };

  // ---------- Оркестровыя группы ----------

  /**
   * Струнная группа. Секретъ «живого» звука — 9 голосовъ, у каждаго своя
   * расстройка, своя задержка вступленія и своя фаза вибрато.
   */
  function strings(midi, t0, dur, vel, pan) {
    const f = mtof(midi);
    const COUNT = 9;
    const bus = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(f * 2.2, 1800), t0);
    filter.frequency.linearRampToValueAtTime(Math.min(f * 6, 6500), t0 + dur * 0.35);
    filter.Q.value = 0.6;
    panner.pan.value = pan === undefined ? 0 : pan;

    const peak = Math.max(vel * 0.052, 0.0002);
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.exponentialRampToValueAtTime(peak, t0 + 0.28);          // смычокъ входитъ медленно
    bus.gain.setValueAtTime(peak, t0 + Math.max(dur * 0.72, 0.3));
    bus.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.55);

    bus.connect(filter); filter.connect(panner); panner.connect(master);
    track(bus, filter, panner);

    for (let i = 0; i < COUNT; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const detune = (i - (COUNT - 1) / 2) * 5.5 + (Math.random() - 0.5) * 4;
      const delay = Math.random() * 0.045;                            // разнобой вступленія
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;

      const vib = ctx.createOscillator();
      const vibAmt = ctx.createGain();
      vib.frequency.value = 4.6 + Math.random() * 1.5;
      vib.type = 'sine';
      vibAmt.gain.value = 3.2 + Math.random() * 2.4;                  // въ центахъ
      vib.connect(vibAmt); vibAmt.connect(osc.detune);

      g.gain.value = 1 / COUNT;
      osc.connect(g); g.connect(bus);
      osc.start(t0 + delay); vib.start(t0 + delay);
      osc.stop(t0 + dur + 0.7); vib.stop(t0 + dur + 0.7);
      track(osc, g, vib, vibAmt);
    }
  }

  /** Мѣдная группа: труба/валторна съ раскрывающимся фильтромъ. */
  function brass(midi, t0, dur, vel, pan) {
    const f = mtof(midi);
    const bus = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan === undefined ? 0 : pan;

    filter.type = 'lowpass';
    filter.Q.value = 4.5;
    filter.frequency.setValueAtTime(f * 1.2, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.min(f * 8, 9000), t0 + 0.13);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 200), t0 + dur);

    const peak = Math.max(vel * 0.058, 0.0002);
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.exponentialRampToValueAtTime(peak, t0 + 0.075);
    bus.gain.setValueAtTime(peak, t0 + Math.max(dur * 0.78, 0.2));
    bus.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.34);

    bus.connect(filter); filter.connect(panner); panner.connect(master);
    track(bus, filter, panner);

    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.detune.value = (i - 1) * 7;
      // лёгкій «подъѣздъ» къ ноте — характерная атака мѣди
      osc.frequency.setValueAtTime(f * 0.978, t0);
      osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.055);
      g.gain.value = 0.34;
      osc.connect(g); g.connect(bus);
      osc.start(t0); osc.stop(t0 + dur + 0.4);
      track(osc, g);
    }
  }

  /** Деревянные духовые: мягкій тонъ съ призвукомъ дыханія. */
  function woodwind(midi, t0, dur, vel, pan) {
    const f = mtof(midi);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan === undefined ? 0 : pan;
    osc.type = 'triangle';
    osc.frequency.value = f;

    const peak = Math.max(vel * 0.07, 0.0002);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.09);
    g.gain.setValueAtTime(peak, t0 + Math.max(dur * 0.75, 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
    osc.connect(g); g.connect(panner); panner.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.3);

    // дыханіе
    const air = ctx.createBufferSource();
    const airG = ctx.createGain();
    const airF = ctx.createBiquadFilter();
    air.buffer = noiseBuffer(Math.min(dur + 0.3, 3));
    airF.type = 'bandpass'; airF.frequency.value = f * 2.5; airF.Q.value = 1.4;
    airG.gain.setValueAtTime(0.0001, t0);
    airG.gain.exponentialRampToValueAtTime(vel * 0.008, t0 + 0.06);
    airG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    air.connect(airF); airF.connect(airG); airG.connect(panner);
    air.start(t0); air.stop(t0 + dur + 0.3);
    track(osc, g, panner, air, airG, airF);
  }

  /** Литавры: низкій тонъ плюсъ шумовой ударъ. */
  function timpani(midi, t0, vel) {
    const f = mtof(midi);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.5, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.08);
    g.gain.setValueAtTime(Math.max(vel * 0.3, 0.0002), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + 1.6);

    const hit = ctx.createBufferSource();
    const hg = ctx.createGain();
    const hf = ctx.createBiquadFilter();
    hit.buffer = noiseBuffer(0.3);
    hf.type = 'lowpass'; hf.frequency.value = 320;
    hg.gain.setValueAtTime(vel * 0.14, t0);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    hit.connect(hf); hf.connect(hg); hg.connect(master);
    hit.start(t0); hit.stop(t0 + 0.3);
    track(osc, g, hit, hg, hf);
  }

  /** Роялевый тонъ — для камерныхъ пьесъ (этюдъ, прелюдія). */
  function piano(midi, t0, dur, vel, pan) {
    const f = mtof(midi);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan === undefined ? 0 : pan;
    panner.connect(master);
    track(panner);

    const partials = [
      { m: 1,     a: 1.0,  d: 1.0 },
      { m: 2.001, a: 0.42, d: 0.7 },
      { m: 3.003, a: 0.19, d: 0.5 },
      { m: 4.01,  a: 0.11, d: 0.38 },
      { m: 5.02,  a: 0.05, d: 0.3 },
    ];
    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = p.m === 1 ? 'triangle' : 'sine';
      osc.frequency.value = f * p.m;
      const peak = Math.max(vel * p.a * 0.075, 0.0002);
      const decay = Math.max(dur * p.d, 0.16);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g); g.connect(panner);
      osc.start(t0); osc.stop(t0 + decay + 0.06);
      track(osc, g);
    });

    // ударъ молоточка
    const th = ctx.createBufferSource();
    const tg = ctx.createGain();
    const tf = ctx.createBiquadFilter();
    th.buffer = noiseBuffer(0.06);
    tf.type = 'bandpass'; tf.frequency.value = f * 4; tf.Q.value = 0.8;
    tg.gain.setValueAtTime(vel * 0.02, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    th.connect(tf); tf.connect(tg); tg.connect(panner);
    th.start(t0); th.stop(t0 + 0.07);
    track(th, tg, tf);
  }

  const VOICES = { strings, brass, woodwind, timpani, piano };

  // ---------- Нотный матеріалъ ----------
  // N(нота, доля, длительность, громкость, группа, панорама)
  const N = (m, t, d, v, voice, pan) =>
    ({ m, t, d, v: v === undefined ? 0.8 : v, voice: voice || 'strings', pan: pan || 0 });

  /**
   * «Поэма экстаза», соч. 54 — заключительный апофеозъ до мажоръ.
   * Фанфара трубы, затѣмъ сіяющіе аккорды всего оркестра съ добавленной
   * секстой и ноной, литавры на сильныхъ доляхъ.
   */
  function poemOfEcstasy() {
    const n = [];
    // Фанфара трубъ
    [[60, 0], [64, 0.3], [67, 0.6], [72, 0.9]].forEach(([m, t]) =>
      n.push(N(m, t, 0.38, 0.95, 'brass', -0.2)));
    n.push(N(76, 1.25, 0.62, 1.0, 'brass', 0.2));
    n.push(N(79, 1.25, 0.62, 0.8, 'brass', -0.25));
    n.push(N(36, 1.25, 0.5, 0.9, 'timpani'));

    // Три нарастающихъ аккорда
    const chords = [
      { t: 2.0, notes: [36, 48, 55, 60, 64, 67, 72], v: 0.75 },
      { t: 3.1, notes: [36, 48, 55, 60, 64, 69, 72, 76], v: 0.85 },  // + секста
      { t: 4.2, notes: [31, 43, 50, 59, 62, 67, 74, 79], v: 0.9 },   // доминанта
    ];
    chords.forEach((ch, i) => {
      ch.notes.forEach((m, j) => {
        const pan = ((j / ch.notes.length) - 0.5) * 0.7;
        n.push(N(m, ch.t, 1.25, ch.v, 'strings', pan));
        if (m >= 55) n.push(N(m, ch.t, 1.1, ch.v * 0.8, 'brass', -pan));
        if (m <= 48) n.push(N(m, ch.t, 1.2, ch.v * 0.7, 'woodwind', pan));
      });
      n.push(N(ch.notes[0], ch.t, 0.5, 0.7 + i * 0.1, 'timpani'));
    });

    // Апофеозъ — до мажоръ во всю ширину оркестра
    const final = [24, 36, 43, 48, 55, 60, 64, 67, 72, 76, 79, 84];
    final.forEach((m, j) => {
      const pan = ((j / final.length) - 0.5) * 0.8;
      n.push(N(m, 5.5, 3.4, 0.9, 'strings', pan));
      if (m >= 48) n.push(N(m, 5.5, 3.2, 0.85, 'brass', -pan * 0.6));
      if (m >= 60) n.push(N(m, 5.5, 3.0, 0.6, 'woodwind', pan));
    });
    [5.5, 6.05, 6.6, 7.3, 8.1].forEach((t, i) => n.push(N(36, t, 0.5, 0.95 - i * 0.08, 'timpani')));

    return { notes: n, tempo: 92, name: '«Поэма экстаза», соч. 54 — кода' };
  }

  /** Этюдъ ре-діезъ миноръ, соч. 8 № 12 («Патетическій»). */
  function etudeOp8No12() {
    const n = [];
    const bass = [
      [39, 0], [51, 0.25], [46, 0.5], [51, 0.75],
      [39, 1.0], [51, 1.25], [46, 1.5], [51, 1.75],
      [37, 2.0], [49, 2.25], [44, 2.5], [49, 2.75],
      [39, 3.0], [51, 3.25], [46, 3.5], [51, 3.75],
    ];
    bass.forEach(([m, t]) => {
      n.push(N(m, t, 0.32, 0.8, 'piano', -0.35));
      n.push(N(m - 12, t, 0.32, 0.62, 'piano', -0.45));
    });
    const theme = [
      [75, 0.0, 0.45], [77, 0.5, 0.22], [78, 0.75, 0.7],
      [75, 1.5, 0.25], [73, 1.75, 0.25],
      [70, 2.0, 0.7], [68, 2.75, 0.25],
      [70, 3.0, 0.45], [73, 3.5, 0.22], [75, 3.75, 0.25],
    ];
    theme.forEach(([m, t, d]) => {
      n.push(N(m, t, d, 1.0, 'piano', 0.3));
      n.push(N(m + 12, t, d, 0.72, 'piano', 0.4));
      n.push(N(m - 12, t, d, 0.5, 'piano', 0.15));
    });
    [[75, 4.0], [73, 4.3], [70, 4.6], [68, 4.9], [66, 5.2], [63, 5.5]].forEach(([m, t]) => {
      n.push(N(m, t, 0.42, 0.9, 'piano', 0.25));
      n.push(N(m - 12, t, 0.42, 0.62, 'piano', -0.2));
    });
    [39, 51, 58, 63, 66, 70].forEach((m) => n.push(N(m, 6.0, 2.4, 0.95, 'piano')));
    [27, 39].forEach((m) => n.push(N(m, 6.0, 2.4, 0.8, 'piano', -0.4)));
    return { notes: n, tempo: 104, name: 'Этюдъ соч. 8 № 12 «Патетическій»' };
  }

  /** Прелюдія ми миноръ, соч. 11 № 4 — Lento. */
  function preludeOp11No4() {
    const n = [];
    const arp = [40, 47, 52, 55, 52, 47];
    for (let bar = 0; bar < 4; bar++) {
      const shift = bar === 2 ? -2 : 0;
      arp.forEach((m, i) => n.push(N(m + shift, bar * 1.5 + i * 0.25, 0.55, 0.42, 'piano', -0.3)));
    }
    [[71, 0.0, 1.15], [72, 1.15, 0.4], [71, 1.55, 1.0],
     [69, 2.55, 0.5], [67, 3.05, 1.25],
     [66, 4.3, 0.5], [64, 4.8, 1.4]].forEach(([m, t, d]) => {
      n.push(N(m, t, d, 0.8, 'piano', 0.25));
      n.push(N(m, t, d * 1.4, 0.32, 'strings', 0.1));   // лёгкая струнная вуаль
    });
    [40, 52, 55, 59, 64].forEach((m) => n.push(N(m, 6.0, 2.6, 0.6, 'piano')));
    return { notes: n, tempo: 58, name: 'Прелюдія соч. 11 № 4' };
  }

  /** Короткій взлётъ — блестящій ходъ. */
  function flourish() {
    const n = [];
    [64, 67, 71, 74, 76, 79, 83, 86].forEach((m, i) =>
      n.push(N(m, i * 0.07, 0.45, 0.72, 'piano', -0.3 + i * 0.08)));
    [64, 71, 76, 79, 83].forEach((m) => {
      n.push(N(m, 0.6, 1.3, 0.75, 'piano'));
      n.push(N(m, 0.6, 1.6, 0.4, 'strings'));
    });
    return { notes: n, tempo: 120, name: 'Взлётъ' };
  }

  /** «Прометеевъ» (мистическій) аккордъ — зевокъ. */
  function mysticChord() {
    const n = [];
    [48, 54, 58, 64, 69, 74].forEach((m, i) => {
      n.push(N(m, i * 0.025, 2.0, 0.7, 'piano', (i - 2.5) * 0.15));
      n.push(N(m, i * 0.025, 2.4, 0.45, 'strings', (2.5 - i) * 0.15));
    });
    n.push(N(36, 0, 2.4, 0.85, 'piano', -0.3));
    n.push(N(36, 0, 0.5, 0.5, 'timpani'));
    return { notes: n, tempo: 90, name: 'Мистическій аккордъ' };
  }

  /** Тревожный акцентъ — шахъ. */
  function checkStab() {
    return {
      notes: [N(57, 0, 0.4, 0.6, 'brass', -0.2), N(63, 0, 0.4, 0.6, 'brass', 0.2),
              N(69, 0.05, 0.45, 0.5, 'brass', 0)],
      tempo: 120, name: 'Шахъ',
    };
  }

  const PIECES = {
    victory: poemOfEcstasy,
    defeat: etudeOp8No12,
    draw: preludeOp11No4,
    brilliant: flourish,
    blunder: mysticChord,
    check: checkStab,
  };

  // ---------- Воспроизведеніе ----------

  function stop() {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
    voices.forEach((v) => {
      try { if (v.stop) v.stop(); v.disconnect(); } catch (e) { /* уже остановленъ */ }
    });
    voices = [];
    currentName = null;
  }

  function play(key) {
    if (!enabled) return null;
    const build = PIECES[key];
    if (!build || !ensureContext()) return null;
    if (ctx.state === 'suspended') ctx.resume();

    stop();
    const piece = build();
    const beat = 60 / piece.tempo;
    const t0 = ctx.currentTime + 0.08;
    let end = 0;

    piece.notes.forEach((note) => {
      const voice = VOICES[note.voice] || strings;
      const start = t0 + note.t * beat;
      const dur = note.d * beat;
      if (note.voice === 'timpani') voice(note.m, start, note.v);
      else voice(note.m, start, dur, note.v, note.pan);
      end = Math.max(end, note.t * beat + dur);
    });

    currentName = piece.name;
    cleanupTimer = setTimeout(() => { voices = []; currentName = null; }, (end + 2) * 1000);
    return piece.name;
  }

  // ---------- Звуки хода ----------

  function moveSound(isCapture) {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    src.buffer = noiseBuffer(0.12);
    f.type = 'bandpass';
    f.frequency.value = isCapture ? 900 : 1900;
    f.Q.value = isCapture ? 1.1 : 2.2;
    g.gain.setValueAtTime(isCapture ? 0.11 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isCapture ? 0.16 : 0.07));
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + 0.2);

    const thud = ctx.createOscillator();
    const tg = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(isCapture ? 150 : 230, t);
    thud.frequency.exponentialRampToValueAtTime(isCapture ? 70 : 130, t + 0.09);
    tg.gain.setValueAtTime(0.09, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    thud.connect(tg); tg.connect(ctx.destination);
    thud.start(t); thud.stop(t + 0.16);
  }

  function setEnabled(on) { enabled = on; if (!on) stop(); }
  function isEnabled() { return enabled; }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volume;
  }
  function getVolume() { return volume; }
  function nowPlaying() { return currentName; }
  function unlock() { if (ensureContext() && ctx.state === 'suspended') ctx.resume(); }
  function pieceName(key) {
    const build = PIECES[key];
    return build ? build().name : null;
  }

  return { play, stop, moveSound, setEnabled, isEnabled, setVolume, getVolume,
           nowPlaying, unlock, pieceName, PIECES };
})();
