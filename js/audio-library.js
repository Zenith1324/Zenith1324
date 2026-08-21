/**
 * Фонотека — настоящія записи А. Н. Скрябина.
 *
 * Порядокъ поиска звука:
 *   1. мѣстные файлы assets/audio/*.mp3 (кладётъ «МУЗЫКА.command» или вы сами)
 *   2. Викискладъ — записи въ общественномъ достояніи, прямо изъ браузера
 *   3. синтезаторъ (js/music.js) — работаетъ всегда, даже безъ сѣти
 *
 * Произведенія Скрябина (ум. 1915) — общественное достояніе. Записи берутся
 * только изъ источниковъ со свободной лицензіей.
 */

const Maestro = (function () {
  const CACHE_KEY = 'scriabin-audio-v1';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const API = 'https://commons.wikimedia.org/w/api.php';

  // Что играемъ въ каждомъ случаѣ и по какимъ словамъ искать запись
  const PROGRAMME = {
    victory: {
      file: 'victory',
      title: '«Поэма экстаза», соч. 54',
      match: ['poem of ecstasy', "poème de l'extase", 'poeme de l extase', 'extase', 'ecstasy', 'op. 54', 'op 54'],
      fallbackMatch: ['symphony', 'symphonie', 'orchestra'],
    },
    defeat: {
      file: 'defeat',
      title: 'Этюдъ соч. 8 № 12 «Патетическій»',
      match: ['op. 8', 'op 8', 'etude', 'étude', 'patetico', 'pathetique'],
      fallbackMatch: ['prelude', 'piano'],
    },
    draw: {
      file: 'draw',
      title: 'Прелюдія соч. 11',
      match: ['op. 11', 'op 11', 'prelude', 'prélude'],
      fallbackMatch: ['piano'],
    },
  };

  let remote = null;          // { victory: url, defeat: url, draw: url }
  let localAvailable = {};    // { victory: 'assets/audio/victory.mp3', ... }
  let element = null;
  let source = 'synth';       // 'local' | 'commons' | 'synth'
  let enabled = true;
  let volume = 0.55;
  let currentTitle = null;
  let fadeTimer = null;

  // ---------- Вспомогательное ----------

  function fetchJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error('таймаутъ')); }, timeoutMs || 9000);
      fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((j) => { clearTimeout(timer); resolve(j); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  /** Есть ли рядомъ файлъ? Проверяемъ HEAD-запросомъ. */
  function probeFile(url) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      fetch(url, { method: 'HEAD' })
        .then((r) => { clearTimeout(timer); resolve(r.ok); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
  }

  async function findLocal() {
    const found = {};
    const exts = ['mp3', 'ogg', 'm4a', 'wav'];
    for (const key of Object.keys(PROGRAMME)) {
      for (const ext of exts) {
        const url = `assets/audio/${PROGRAMME[key].file}.${ext}`;
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
      gsrnamespace: '6',
      gsrlimit: '80',
      prop: 'imageinfo',
      iiprop: 'url|mime|size',
    });
    const data = await fetchJson(API + '?' + params.toString(), 11000);
    const pages = data && data.query && data.query.pages;
    if (!pages) throw new Error('пустой отвѣтъ');

    const files = Object.keys(pages).map((k) => {
      const p = pages[k];
      const info = p.imageinfo && p.imageinfo[0];
      if (!info || !info.url) return null;
      return {
        url: info.url,
        title: (p.title || '').replace(/^File:/, ''),
        size: info.size || 0,
      };
    }).filter(Boolean);

    if (!files.length) throw new Error('записи не найдены');

    const map = {};
    Object.keys(PROGRAMME).forEach((key) => {
      const cfg = PROGRAMME[key];
      const pick = (words) => files.find((f) => {
        const t = f.title.toLowerCase();
        return words.some((w) => t.includes(w));
      });
      const hit = pick(cfg.match) || pick(cfg.fallbackMatch);
      if (hit) map[key] = { url: hit.url, title: hit.title };
    });
    if (!Object.keys(map).length) throw new Error('подходящихъ записей нѣтъ');
    return map;
  }

  // ---------- Проигрываніе ----------

  function ensureElement() {
    if (element) return element;
    element = new Audio();
    element.preload = 'none';
    element.crossOrigin = 'anonymous';
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
    if (localAvailable[key]) return { url: localAvailable[key], title: PROGRAMME[key].title, src: 'local' };
    if (remote && remote[key]) return { url: remote[key].url, title: PROGRAMME[key].title, src: 'commons' };
    return null;
  }

  /**
   * Играетъ подходящую музыку. Для «victory/defeat/draw» пробуетъ настоящую
   * запись; короткія реплики (blunder, brilliant, check) всегда синтезируются.
   */
  function play(key) {
    if (!enabled) return null;

    if (!PROGRAMME[key]) {
      return ScriabinMusic.play(key);   // короткія реплики
    }

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
      el.src = pick.url;
      el.volume = volume;
      el.currentTime = 0;
      const p = el.play();
      if (p && p.catch) {
        p.catch(() => {
          // браузеръ не пустилъ или файлъ не открылся — синтезъ
          currentTitle = ScriabinMusic.play(key);
          source = 'synth';
        });
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

  function setEnabled(on) {
    enabled = on;
    ScriabinMusic.setEnabled(on);
    if (!on) stop();
  }
  function isEnabled() { return enabled; }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (element) element.volume = volume;
    ScriabinMusic.setVolume(volume);
  }

  function getSource() { return source; }
  function nowPlaying() { return currentTitle; }

  /** Человѣческое имя источника — для показа въ интерфейсѣ. */
  function sourceLabel() {
    if (source === 'local') return 'запись';
    if (source === 'commons') return 'запись съ Викисклада';
    return 'синтезаторъ';
  }

  async function init() {
    localAvailable = await findLocal();
    if (Object.keys(localAvailable).length) { source = 'local'; return 'local'; }

    const cached = readCache();
    if (cached) { remote = cached; source = 'commons'; return 'commons'; }

    try {
      const map = await fetchFromCommons();
      remote = map;
      writeCache(map);
      source = 'commons';
      return 'commons';
    } catch (e) {
      source = 'synth';
      return 'synth';
    }
  }

  return { init, play, stop, setEnabled, isEnabled, setVolume,
           getSource, sourceLabel, nowPlaying, moveSound: (c) => ScriabinMusic.moveSound(c) };
})();
