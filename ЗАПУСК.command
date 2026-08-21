#!/bin/bash
# Запуск «Русскихъ Шахматъ» на macOS.
# Дважды щёлкните по этому файлу в Finder.
#
# Локальный веб-сервер нужен для того, чтобы заработал движок Stockfish:
# браузеры не разрешают загружать Web Worker и WASM напрямую с file://.

cd "$(dirname "$0")" || exit 1

PORT=8173
while lsof -ti:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "════════════════════════════════════════════"
echo "  РУССКIЯ ШАХМАТЫ"
echo "════════════════════════════════════════════"
echo
echo "  Открываю http://localhost:$PORT"
echo "  Чтобы закончить — закройте это окно"
echo "  или нажмите Control+C."
echo

if command -v python3 >/dev/null 2>&1; then
  ( sleep 1; open "http://localhost:$PORT/index.html" ) &
  python3 -m http.server "$PORT"
else
  echo "Не найден python3. Установите его или откройте index.html напрямую"
  echo "(в этом случае будет работать встроенный движок вместо Stockfish)."
  read -r -p "Нажмите Enter, чтобы закрыть…"
fi
