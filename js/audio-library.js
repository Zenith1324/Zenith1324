/**
 * Фонотека — симфоническая музыка А. Н. Скрябина (1872–1915).
 *
 * Порядокъ поиска звука:
 *   1. ВАШИ файлы, выбранные кнопкой «Выбрать свои записи» — хранятся
 *      въ браузерѣ (IndexedDB) и переживаютъ перезапускъ. Самый вѣрный путь.
 *   2. Файлы въ assets/audio/ — кладётъ «МУЗЫКА.command» или вы сами.
 *   3. Викискладъ — записи со свободной лицензіей, прямо изъ браузера.
 *   4. Синтезаторъ (js/music.js) — работаетъ всегда, но это не запись.
 *
 * Отборъ записей СТРОГІЙ: въ имени файла должны быть и фамилія Скрябина,
 * и признакъ нужнаго произведенія. Иначе запись отвергается — лучше честный
 * синтезаторъ, чѣмъ чужая музыка подъ видомъ Скрябина.
 */

const Maestro = (function () {
  const CACHE_KEY = 'scriabin-audio-v3';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const API = 'https://commons.wikimedia.org/w/api.php';

  // Фамилія композитора во всѣхъ ходовыхъ написаніяхъ
  const COMPOSER = [
    'scriabin', 'skriabin', 'skryabin', 'scriabine', 'skrjabin', 'skrjabine',
    'скрябин', 'скрябинъ',
  ];

  /**
   * Что играемъ. Каждое произведеніе описано признаками, по которымъ его
   * можно узнать въ имени файла. Ищемъ строго — сперва main, потомъ alt.
   */
  const WORKS = {
    victory: {
      file: 'victory',
      title: 'Симфонія № 3 «Божественная поэма», ч. III — «Божественная игра»',
      main: ['divine poem', 'divin poeme', 'divin poème', 'божественная поэма',
             'symphony no. 3', 'symphony no 3', 'symphony 3', 'symphonie no 3',
             'sinfonia n. 3', 'op. 43', 'op 43', 'симфония № 3', 'симфония no. 3'],
      alt: {
        title: '«Поэма экстаза», соч. 54',
        keys: ['poem of ecstasy', 'poeme de l extase', "poème de l'extase",
               'poeme de l\'extase', 'extase', 'ecstasy', 'op. 54', 'op 54',
               'поэма экстаза'],
      },
    },
    defeat: {
      file: 'defeat',
      title: 'Симфонія № 3 «Божественная поэма», ч. I — «Борьба»',
      main: ['luttes', 'struggles', 'борьба',
             'symphony no. 3', 'symphony no 3', 'symphony 3', 'op. 43', 'op 43'],
      alt: {
        title: 'Этюдъ соч. 8 № 12 «Патетическій»',
        keys: ['op. 8', 'op 8', 'etude', 'étude', 'patetico', 'pathetique', 'этюд'],
      },
    },
    draw: {
      file: 'draw',
      title: 'Прелюдія соч. 11',
      main: ['op. 11', 'op 11', 'prelude', 'prélude', 'прелюдия', 'прелюдія'],
      alt: {
        title: '«Мечты», соч. 24',
        keys: ['reverie', 'rêverie', 'мечты', 'op. 24', 'op 24'],
      },
    },
  };

  let userSlots = {};      // изъ IndexedDB: { victory: Blob, ... }
  let localSlots = {};     // файлы въ assets/audio/
  let remoteSlots = {};    // Викискладъ
  let objectUrls = {};
  let element = null;
  let source = 'synth';
  let enabled = true;
  let volume = 0.55;
  let currentTitle = null;
  let fadeTimer = null;
  let onSlotsChange = null;

  // ---------- Хранилище своихъ записей (IndexedDB) ----------

  const DB_NAME = 'russkie-shahmaty-audio';
  const STORE = 'tracks';

  function idb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB недоступенъ')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('не открыть хранилище'));
    });
  }

  async function idbPut(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll() {
    const db = await idb();
    const out = {};
    await Promise.all(Object.keys(WORKS).map((key) => new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => { if (req.result) out[key] = req.result; resolve(); };
      req.onerror = () => resolve();
    })));
    return out;
  }

  async function idbClear() {
    const db = await idb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  // ---------- Строгій отборъ ----------

  const lower = (s) => (s || '').toLowerCase();

  function looksLikeScriabin(title) {
    const t = lower(title);
    return COMPOSER.some((c) => t.includes(c));
  }

  /** Подходитъ ли файлъ подъ произведеніе. Композиторъ обязателенъ. */
  function matchesWork(title, keys) {
    const t = lower(title);
    return keys.some((k) => t.includes(k));
  }

  function pickStrict(files, key) {
    const cfg = WORKS[key];
    const byComposer = files.filter((f) => looksLikeScriabin(f.title));
    if (!byComposer.length) return null;

    const main = byComposer.filter((f) => matchesWork(f.title, cfg.main));
    if (main.length) return { file: main[0], title: cfg.title };

    const alt = byComposer.filter((f) => matchesWork(f.title, cfg.alt.keys));
    if (alt.length) return { file: alt[0], title: cfg.alt.title };

    return null;   // ничего честнаго не нашли — пусть играетъ синтезаторъ
  }

  // ---------- Вспомогательное ----------

  function fetchJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') { reject(new Error('file://')); return; }
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error('таймаутъ')); }, timeoutMs || 9000);
      fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((j) => { clearTimeout(timer); resolve(j); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  function probeFile(url) {
    if (location.protocol === 'file:') return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      fetch(url, { method: 'HEAD' })
        .then((r) => { clearTimeout(timer); resolve(r.ok); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
  }

  async function findLocal() {
    const found = {};
    const exts = ['mp3', 'ogg', 'm4a', 'wav', 'opus'];
    for (const key of Object.keys(WORKS)) {
      for (const ext of exts) {
        const url = `assets/audio/${WORKS[key].file}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        if (await probeFile(url)) { found[key] = url; break; }
      }
    }
    return found;
  }

  // ---------- Викискладъ ----------

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d.t || Date.now() - d.t > CACHE_TTL) return null;
      return d.map || null;
    } catch (e) { return null; }
  }
  function writeCache(map) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), map })); }
    catch (e) { /* не страшно */ }
  }

  async function fetchFromCommons() {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*',
      generator: 'search',
      gsrsearch: 'Scriabin filemime:audio',
      gsrnamespace: '6', gsrlimit: '100',
      prop: 'imageinfo', iiprop: 'url|mime|size',
    });
    const data = await fetchJson(API + '?' + params.toString(), 11000);
    const pages = data && data.query && data.query.pages;
    if (!pages) throw new Error('пустой отвѣтъ');

    const files = Object.keys(pages).map((k) => {
      const p = pages[k];
      const info = p.imageinfo && p.imageinfo[0];
      if (!info || !info.url) return null;
      return { url: info.url, title: (p.title || '').replace(/^File:/, ''), size: info.size || 0 };
    }).filter(Boolean);

    const map = {};
    Object.keys(WORKS).forEach((key) => {
      const hit = pickStrict(files, key);
      if (hit) map[key] = { url: hit.file.url, title: hit.title, found: hit.file.title };
    });
    if (!Object.keys(map).length) throw new Error('строгому отбору ничего не подошло');
    return map;
  }

  // ---------- Проигрываніе ----------

  function ensureElement() {
    if (element) return element;
    element = new Audio();
    element.preload = 'none';
    element.volume = volume;
    return element;
  }

  function fadeOutAndStop(ms) {
    if (!element || element.paused) return;
    const startVol = element.volume;
    const steps = 12;
    let i = 0;
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      i++;
      element.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) {
        clearInterval(fadeTimer);
        element.pause();
        element.currentTime = 0;
        element.volume = volume;
      }
    }, Math.max(20, ms / steps));
  }

  function urlFor(key) {
    if (userSlots[key]) {
      if (!objectUrls[key]) objectUrls[key] = URL.createObjectURL(userSlots[key]);
      return { url: objectUrls[key], title: userSlots[key].name || WORKS[key].title, src: 'user', crossOrigin: false };
    }
    if (localSlots[key]) return { url: localSlots[key], title: WORKS[key].title, src: 'local', crossOrigin: false };
    if (remoteSlots[key]) return { url: remoteSlots[key].url, title: remoteSlots[key].title, src: 'commons', crossOrigin: true };
    return null;
  }

  function play(key) {
    if (!enabled) return null;
    if (!WORKS[key]) return ScriabinMusic.play(key);   // короткія реплики — всегда синтезъ

    const pick = urlFor(key);
    if (!pick) {
      currentTitle = ScriabinMusic.play(key);
      source = 'synth';
      return currentTitle;
    }

    try {
      const el = ensureElement();
      ScriabinMusic.stop();
      clearInterval(fadeTimer);
      el.pause();
      if (pick.crossOrigin) el.crossOrigin = 'anonymous'; else el.removeAttribute('crossorigin');
      el.src = pick.url;
      el.volume = volume;
      el.currentTime = 0;
      const p = el.play();
      if (p && p.catch) {
        p.catch(() => { currentTitle = ScriabinMusic.play(key); source = 'synth'; });
      }
      source = pick.src;
      currentTitle = pick.title;
      return currentTitle;
    } catch (e) {
      currentTitle = ScriabinMusic.play(key);
      source = 'synth';
      return currentTitle;
    }
  }

  function stop() {
    fadeOutAndStop(400);
    ScriabinMusic.stop();
    currentTitle = null;
  }

  // ---------- Свои записи ----------

  /**
   * Принимаетъ выбранные пользователемъ файлы. Раскладываетъ по случаямъ:
   * сперва по имени файла (побѣда/поражение/ничья или scriabin-названія),
   * остальное — по порядку въ пустые слоты.
   */
  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /^audio\//.test(f.type) || /\.(mp3|ogg|m4a|wav|opus|flac)$/i.test(f.name));
    if (!files.length) return { added: 0, slots: describeSlots() };

    const hints = {
      victory: ['victory', 'побед', 'экстаз', 'ecstasy', 'extase', 'divine', 'божествен', 'jeu', 'no. 3', 'no 3'],
      defeat: ['defeat', 'пораж', 'lutte', 'борьб', 'etude', 'этюд', 'op. 8', 'op 8', 'tragic'],
      draw: ['draw', 'ничь', 'prelude', 'прелюд', 'reverie', 'мечт', 'op. 11', 'op 11'],
    };

    const taken = {};
    const rest = [];
    files.forEach((f) => {
      const n = lower(f.name);
      const key = Object.keys(hints).find((k) => !taken[k] && hints[k].some((h) => n.includes(h)));
      if (key) taken[key] = f; else rest.push(f);
    });
    Object.keys(WORKS).forEach((k) => {
      if (!taken[k] && rest.length) taken[k] = rest.shift();
    });

    let added = 0;
    for (const key of Object.keys(taken)) {
      // eslint-disable-next-line no-await-in-loop
      await idbPut(key, taken[key]);
      userSlots[key] = taken[key];
      if (objectUrls[key]) { URL.revokeObjectURL(objectUrls[key]); delete objectUrls[key]; }
      added++;
    }
    if (added) source = 'user';
    if (onSlotsChange) onSlotsChange(describeSlots());
    return { added, slots: describeSlots() };
  }

  async function clearUserFiles() {
    await idbClear();
    Object.keys(objectUrls).forEach((k) => URL.revokeObjectURL(objectUrls[k]));
    objectUrls = {};
    userSlots = {};
    source = Object.keys(localSlots).length ? 'local'
      : Object.keys(remoteSlots).length ? 'commons' : 'synth';
    if (onSlotsChange) onSlotsChange(describeSlots());
  }

  /** Что сейчасъ стоитъ на каждый случай — для показа въ интерфейсѣ. */
  function describeSlots() {
    return Object.keys(WORKS).map((key) => {
      const pick = urlFor(key);
      const label = { victory: 'Побѣда', defeat: 'Пораженіе', draw: 'Ничья' }[key];
      return {
        key, label,
        title: pick ? pick.title : WORKS[key].title,
        source: pick ? pick.src : 'synth',
      };
    });
  }

  function setSlotsHandler(fn) { onSlotsChange = fn; }

  // ---------- Прочее ----------

  function setEnabled(on) { enabled = on; ScriabinMusic.setEnabled(on); if (!on) stop(); }
  function isEnabled() { return enabled; }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (element) element.volume = volume;
    ScriabinMusic.setVolume(volume);
  }
  function getSource() { return source; }
  function nowPlaying() { return currentTitle; }
  function sourceLabel() {
    return { user: 'ваша запись', local: 'запись изъ папки',
             commons: 'запись съ Викисклада', synth: 'синтезаторъ' }[source] || 'синтезаторъ';
  }

  async function init() {
    try { userSlots = await idbGetAll(); } catch (e) { userSlots = {}; }
    if (Object.keys(userSlots).length) {
      source = 'user';
      if (onSlotsChange) onSlotsChange(describeSlots());
      return 'user';
    }

    localSlots = await findLocal();
    if (Object.keys(localSlots).length) {
      source = 'local';
      if (onSlotsChange) onSlotsChange(describeSlots());
      return 'local';
    }

    const cached = readCache();
    if (cached) {
      remoteSlots = cached; source = 'commons';
      if (onSlotsChange) onSlotsChange(describeSlots());
      return 'commons';
    }

    try {
      remoteSlots = await fetchFromCommons();
      writeCache(remoteSlots);
      source = 'commons';
      if (onSlotsChange) onSlotsChange(describeSlots());
      return 'commons';
    } catch (e) {
      source = 'synth';
      if (onSlotsChange) onSlotsChange(describeSlots());
      return 'synth';
    }
  }

  return {
    init, play, stop, setEnabled, isEnabled, setVolume,
    getSource, sourceLabel, nowPlaying, describeSlots, setSlotsHandler,
    importFiles, clearUserFiles, WORKS,
    moveSound: (c) => ScriabinMusic.moveSound(c),
  };
})();
