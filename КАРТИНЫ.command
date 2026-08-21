#!/bin/bash
# Загрузка полотен И. И. Шишкина в assets/paintings/.
# Дважды щёлкните по этому файлу в Finder.
#
# Приложение и так тянет картины с Викисклада прямо в браузере. Этот скрипт
# нужен, если хочется, чтобы фон работал без интернета.

cd "$(dirname "$0")" || exit 1
mkdir -p assets/paintings

python3 - <<'PYTHON'
# -*- coding: utf-8 -*-
import json, os, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'RusskieShahmaty/1.0 (chess app; contact: local user)'}
OUT = 'assets/paintings'

# Самые известные полотна — их берём в первую очередь
PREFERRED = ['рожь', 'rye', 'утро в сосновом', 'morning in a pine',
             'корабельная роща', 'mast-tree', 'ship grove',
             'дубовая роща', 'oak grove', 'лесные дали', 'сосновый бор',
             'дождь в дубовом', 'полдень', 'зима']

def get_json(url, timeout=25):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))

def commons_paintings():
    params = urllib.parse.urlencode({
        'action': 'query', 'format': 'json',
        'generator': 'categorymembers',
        'gcmtitle': 'Category:Paintings by Ivan Shishkin',
        'gcmtype': 'file', 'gcmlimit': '100',
        'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': '2400',
    })
    data = get_json('https://commons.wikimedia.org/w/api.php?' + params)
    out = []
    for page in (data.get('query', {}).get('pages', {}) or {}).values():
        info = (page.get('imageinfo') or [{}])[0]
        url = info.get('thumburl') or info.get('url')
        orig = info.get('url', '')
        if url and orig.lower().endswith(('.jpg', '.jpeg', '.png')):
            out.append({'title': page.get('title', '').replace('File:', ''), 'url': url})
    return out

def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as fh:
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

print('Ищу полотна Шишкина на Викискладе…\n')
try:
    items = commons_paintings()
except Exception as e:
    print('Викисклад недоступен: %s' % e)
    print('Проверьте подключение к интернету.')
    raise SystemExit(1)

if not items:
    print('Полотна не найдены.')
    raise SystemExit(1)

print('  найдено полотен: %d\n' % len(items))

def score(it):
    t = it['title'].lower()
    for i, p in enumerate(PREFERRED):
        if p in t:
            return i
    return len(PREFERRED)

items.sort(key=score)
chosen = items[:6]

# Первое — главные обои приложения
main = chosen[0]
print('Главное полотно: %s' % main['title'][:70])
download(main['url'], os.path.join(OUT, 'shishkin.jpg'))

for i, it in enumerate(chosen[1:], start=2):
    print('%d. %s' % (i, it['title'][:70]))
    try:
        download(it['url'], os.path.join(OUT, 'shishkin-%d.jpg' % i))
    except Exception as e:
        print('   не удалось: %s' % e)

print('\nГотово. Перезапустите игру — фоном станет настоящая картина.')
PYTHON

echo
read -r -p "Нажмите Enter, чтобы закрыть…"
