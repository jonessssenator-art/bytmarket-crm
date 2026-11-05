#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Для запуска нужен Node.js 24. Установите его и откройте файл снова.'
  read 'reply?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi
if curl --fail --silent http://127.0.0.1:3000/api/v1/auth/status >/dev/null 2>&1; then
  open http://127.0.0.1:3000
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm run build || exit 1
(sleep 2; open http://127.0.0.1:3000) &
npm start
