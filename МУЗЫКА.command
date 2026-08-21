#!/bin/bash
# Загрузка настоящих записей А. Н. Скрябина в assets/audio/.
# Дважды щёлкните по этому файлу в Finder.
#
# Скрипт ищет записи в общественном достоянии на Викискладе и в Архиве
# интернета (archive.org), а не берёт заранее вписанные ссылки — так он
# продолжает работать, даже если конкретные файлы переехали.

cd "$(dirname "$0")" || exit 1
mkdir -p assets/audio

python3 - <<'PYTHON'
# -*- coding: utf-8 -*-
import json, os, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'RusskieShahmaty/1.0 (chess app; contact: local user)'}
OUT = 'assets/audio'

# Что ищем для каждого случая. Первый список — точные слова,
# второй — запасной, если точных совпадений нет.
# Фамилия композитора обязательна — иначе не берём файл вообще.
COMPOSER = ['scriabin', 'skriabin', 'skryabin', 'scriabine', 'skrjabin',
            'skrjabine', 'скрябин']

WANTED = [
    ('victory', 'ПОБЕДА — Симфония № 3, ч. III / «Поэма экстаза»',
     ['divine poem', 'divin poeme', 'божественная поэма', 'jeu divin',
      'symphony no. 3', 'symphony no 3', 'symphony 3', 'symphonie no 3',
      'op. 43', 'op 43'],
     ['poem of ecstasy', "poeme de l'extase", 'poème de l’extase', 'extase',
      'ecstasy', 'op. 54', 'op 54', 'поэма экстаза']),
    ('defeat', 'ПОРАЖЕНИЕ — Симфония № 3, ч. I «Борьба» / Этюд соч. 8 № 12',
     ['luttes', 'struggles', 'борьба', 'symphony no. 3', 'symphony no 3',
      'op. 43', 'op 43'],
     ['op. 8', 'op 8', 'etude', 'étude', 'patetico', 'pathetique', 'этюд']),
    ('draw', 'НИЧЬЯ — Прелюдия соч. 11 / «Мечты» соч. 24',
     ['op. 11', 'op 11', 'prelude', 'prélude', 'прелюдия'],
     ['reverie', 'rêverie', 'мечты', 'op. 24', 'op 24']),
]

def get_json(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))

def commons_files():
    """Аудиозаписи Скрябина на Викискладе."""
    params = urllib.parse.urlencode({
        'action': 'query', 'format': 'json',
        'generator': 'search', 'gsrsearch': 'Scriabin filemime:audio',
        'gsrnamespace': '6', 'gsrlimit': '120',
        'prop': 'imageinfo', 'iiprop': 'url|mime|size',
    })
    data = get_json('https://commons.wikimedia.org/w/api.php?' + params)
    out = []
    for page in (data.get('query', {}).get('pages', {}) or {}).values():
        info = (page.get('imageinfo') or [{}])[0]
        if info.get('url'):
            out.append({'title': page.get('title', '').replace('File:', ''),
                        'url': info['url'], 'size': info.get('size', 0),
                        'where': 'Викисклад'})
    return out

def archive_files():
    """Записи Скрябина в Архиве интернета."""
    q = 'scriabin AND mediatype:(audio)'
    params = urllib.parse.urlencode({
        'q': q, 'fl[]': 'identifier', 'rows': '25', 'page': '1',
        'output': 'json', 'sort[]': 'downloads desc',
    })
    try:
        data = get_json('https://archive.org/advancedsearch.php?' + params)
    except Exception:
        return []
    ids = [d['identifier'] for d in data.get('response', {}).get('docs', []) if d.get('identifier')]
    out = []
    for ident in ids[:12]:
        try:
            meta = get_json('https://archive.org/metadata/%s' % ident, timeout=20)
        except Exception:
            continue
        for f in meta.get('files', []):
            name = f.get('name', '')
            if not name.lower().endswith(('.mp3', '.ogg')):
                continue
            try:
                size = int(f.get('size', 0))
            except (TypeError, ValueError):
                size = 0
            out.append({'title': name,
                        'url': 'https://archive.org/download/%s/%s' % (ident, urllib.parse.quote(name)),
                        'size': size, 'where': 'archive.org'})
    return out

def by_scriabin(files):
    """Только то, где в названии действительно стоит фамилия Скрябина."""
    return [f for f in files if any(c in f['title'].lower() for c in COMPOSER)]


def pick(files, words):
    hits = [f for f in files if any(w in f['title'].lower() for w in words)]
    # предпочитаем файл среднего размера: не обрывок и не часовой концерт
    hits.sort(key=lambda f: abs((f['size'] or 4000000) - 6000000))
    return hits[0] if hits else None

def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r, open(path, 'wb') as fh:
        total = 0
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
            sys.stdout.write('\r      загружено %.1f МБ' % (total / 1048576.0))
            sys.stdout.flush()
    print()
    return total

print('Ищу записи Скрябина…\n')
pool = []
for name, fn in (('Викисклад', commons_files), ('archive.org', archive_files)):
    try:
        got = fn()
        pool.extend(got)
        print('  %-12s найдено файлов: %d' % (name, len(got)))
    except Exception as e:
        print('  %-12s недоступен (%s)' % (name, e))
print()

if not pool:
    print('Ничего не нашлось. Проверьте подключение к интернету.')
    print('Можно положить свои файлы вручную:')
    print('   assets/audio/victory.mp3, defeat.mp3, draw.mp3')
    raise SystemExit(1)

pool = by_scriabin(pool)
print('Из них действительно Скрябин: %d\n' % len(pool))
if not pool:
    print('Записей Скрябина не нашлось. Лучше добавить свои файлы прямо в игре:')
    print('  «Музыка и звукъ» → «Выбрать свои записи…»')
    raise SystemExit(1)

ok = 0
for key, human, words, fallback in WANTED:
    print('%s:' % human)
    choice = pick(pool, words) or pick(pool, fallback)
    if not choice:
        print('   — подходящей записи не нашлось, останется синтезатор\n')
        continue
    ext = '.ogg' if choice['url'].lower().endswith('.ogg') else '.mp3'
    dest = os.path.join(OUT, key + ext)
    print('   %s  (%s)' % (choice['title'][:70], choice['where']))
    try:
        download(choice['url'], dest)
        ok += 1
    except Exception as e:
        print('   не удалось загрузить: %s' % e)
    print()

print('Готово. Загружено записей: %d из %d.' % (ok, len(WANTED)))
if ok:
    print('Перезапустите игру — музыка будет играть настоящими записями.')
PYTHON

echo
read -r -p "Нажмите Enter, чтобы закрыть…"
