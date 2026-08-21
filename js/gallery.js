/**
 * Картинная галерея — И. И. Шишкинъ (1832–1898).
 *
 * Полотна Шишкина находятся въ общественномъ достояніи и лежатъ на
 * Викискладѣ. Приложеніе запрашиваетъ ихъ у Викисклада прямо изъ браузера
 * и ставитъ на задній планъ. Списокъ кэшируется въ браузерѣ на недѣлю.
 *
 * Порядокъ поиска обоевъ:
 *   1. мѣстный файлъ assets/paintings/*.jpg (если положили вручную)
 *   2. Викискладъ (нуженъ интернетъ)
 *   3. рисованный запасной пейзажъ assets/shishkin-forest.svg
 */

const Gallery = (function () {
  const CACHE_KEY = 'shishkin-gallery-v1';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;   // недѣля
  const API = 'https://commons.wikimedia.org/w/api.php';
  const FALLBACK = 'assets/shishkin-forest.svg';

  // Самыя извѣстныя полотна — ими начинаемъ списокъ, если нашлись
  const PREFERRED = [
    'Рожь', 'Rye', 'Утро в сосновом', 'Morning in a Pine Forest',
    'Корабельная роща', 'Ship Grove', 'Mast-Tree Grove',
    'Дубовая роща', 'Oak Grove', 'Лесные дали', 'Дождь в дубовом лесу',
    'Сосновый бор', 'Pine forest', 'Полдень', 'Зима', 'Winter',
  ];

  let paintings = [];
  let index = 0;
  let current = null;
  let onChange = null;

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.t || Date.now() - data.t > CACHE_TTL) return null;
      if (!Array.isArray(data.items) || !data.items.length) return null;
      return data.items;
    } catch (e) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items })); }
    catch (e) { /* не страшно */ }
  }

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

  /** Тянемъ полотна изъ категоріи Викисклада. */
  async function fetchFromCommons() {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*',
      generator: 'categorymembers',
      gcmtitle: 'Category:Paintings by Ivan Shishkin',
      gcmtype: 'file', gcmlimit: '100',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '2000',
    });
    const data = await fetchJson(API + '?' + params.toString(), 11000);
    const pages = data && data.query && data.query.pages;
    if (!pages) throw new Error('пустой отвѣтъ Викисклада');

    const items = Object.keys(pages).map((k) => {
      const page = pages[k];
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) return null;
      const url = info.thumburl || info.url;
      if (!url || !/\.(jpe?g|png)$/i.test(info.url || '')) return null;
      const meta = info.extmetadata || {};
      const title = (page.title || '').replace(/^File:/, '').replace(/\.(jpe?g|png)$/i, '');
      const date = meta.DateTimeOriginal && stripHtml(meta.DateTimeOriginal.value);
      return { url, title, date: date || '', descriptionUrl: info.descriptionurl || '' };
    }).filter(Boolean);

    if (!items.length) throw new Error('полотна не найдены');

    // Извѣстныя работы — впередъ, остальныя перемѣшиваемъ
    const isPreferred = (it) => PREFERRED.some((p) => it.title.toLowerCase().includes(p.toLowerCase()));
    const top = items.filter(isPreferred);
    const rest = items.filter((it) => !isPreferred(it)).sort(() => Math.random() - 0.5);
    return top.concat(rest).slice(0, 40);
  }

  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').trim().slice(0, 60);
  }

  /** Проверяемъ, есть ли рядомъ мѣстные файлы картинъ. */
  function probeLocal() {
    return new Promise((resolve) => {
      const img = new Image();
      const done = (ok) => resolve(ok ? [{ url: 'assets/paintings/shishkin.jpg', title: 'И. И. Шишкинъ', date: '', local: true }] : null);
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = 'assets/paintings/shishkin.jpg';
      setTimeout(() => done(false), 3000);
    });
  }

  function apply(item) {
    if (!item) return;
    current = item;
    const url = item.url;
    // Тёмная вуаль поверхъ полотна — чтобы фигуры и текстъ читались
    document.body.style.backgroundImage =
      `linear-gradient(rgba(16,11,7,.86), rgba(10,7,4,.92)), url("${url}")`;
    document.body.classList.add('has-painting');
    if (onChange) onChange(item);
  }

  function next() {
    if (paintings.length < 2) return;
    index = (index + 1) % paintings.length;
    apply(paintings[index]);
  }

  function currentPainting() { return current; }

  async function init(handler) {
    onChange = handler;

    const local = await probeLocal();
    if (local) { paintings = local; apply(local[0]); return 'local'; }

    const cached = readCache();
    if (cached) {
      paintings = cached;
      index = Math.floor(Math.random() * paintings.length);
      apply(paintings[index]);
      return 'cache';
    }

    try {
      const items = await fetchFromCommons();
      paintings = items;
      writeCache(items);
      index = Math.floor(Math.random() * paintings.length);
      apply(paintings[index]);
      return 'commons';
    } catch (e) {
      // Остаёмся на рисованномъ пейзажѣ изъ CSS
      if (onChange) onChange({ title: 'рисованный пейзажъ', fallback: true, url: FALLBACK });
      return 'fallback';
    }
  }

  return { init, next, currentPainting };
})();
