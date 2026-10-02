# Комплект для личного VPS

Этот каталог готовит будущий запуск; он сам ничего не арендует, не публикует и не авторизует. Нужен Linux VPS с Docker Engine и Docker Compose v2, собственный DNS hostname и разрешённые входящие 80/TCP, 443/TCP; 443/UDP используется Caddy для HTTP/3. SSH оставь доступным только своим способом доступа.

Голосовой транспорт запускается рядом с Next внутри того же контейнера. Caddy направляет `/api/audio/live-stream` на внутренний порт 3001; наружу этот порт не публикуется. Relay требует личную cookie приложения и короткоживущий ключ только для транскрибации, допускает ограниченный набор событий и максимум 8 минут PCM. Постоянный OpenAI API-ключ остаётся на сервере. Модель живого распознавания — `gpt-live-transcribe`, полной записи — `gpt-transcribe`; ответ Sol озвучивается отдельным TTS. Расходы в приложении являются оценкой, а не счётом OpenAI.

После изменения Caddyfile, смонтированного отдельным файлом, пересоздай контейнер Caddy, чтобы новый inode попал в mount: `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --force-recreate caddy`. Одна перезагрузка конфигурации может продолжить читать прежний файл после его замены через архив. Перед обновлением сохрани согласованную SQLite-копию и предыдущий Docker image; том с историей не удаляется.

Для восстановления после перезагрузки VPS Docker daemon должен запускаться вместе с системой. На сервере с systemd проверь `systemctl is-enabled docker`; если служба ещё не включена, администратор выполняет `sudo systemctl enable --now docker`. Политика контейнеров сама по себе не запускает выключенный daemon.

Начальная конфигурация для оценки — 2 vCPU и 4 GB RAM. Это предложение для одного пользователя, не гарантия производительности: размер сборки, длительность ответов и рост аудио нужно проверить. Учебную модель выполняет SIWC через ChatGPT; GPU и установленный Codex на VPS не нужны. Голос использует отдельный платный OpenAI API.

Сначала проверяется реальная авторизация и один запрос Sol локально. Аренда, домен и перенос данных выполняются отдельным следующим этапом. SIWC поддерживает этот способ использования подписки для подлинных OSS-приложений. Подготовка подходящего OSS-релиза включает очистку личных данных и выбранную лицензию; публикация такого релиза — согласованный будущий этап, который сейчас не выполнен.

## Состав

- `Dockerfile`: официальный Node 24, отдельные build/production-dependencies/runtime stages, runtime от пользователя `node` (uid/gid 1000), без Codex.
- `.dockerignore`: сначала запрещает всё, затем разрешает только исходники приложения, публичные ресурсы и необходимые build/CLI-файлы. Личные Markdown-документы, `.data`, `.runtime`, `.env*`, `.git` и локальные зависимости не входят даже в build context.
- `compose.yaml`: приложение и Caddy с `restart: unless-stopped`; наружу опубликованы только порты Caddy. `.data` хранится в постоянном томе `english-training_training_data`, включая SQLite, аудио, аудио-ключ из UI и SIWC.
- `Caddyfile`: доверенный публичный HTTPS для заданного домена; передаёт приложению настроенный `Host`.
- `healthcheck.mjs`: проверяет только `/manifest.webmanifest`, не вызывает модель и личные API. Healthy означает доступный веб-сервер, а не подтверждённую авторизацию/генерацию Sol.

Приложение слушает `0.0.0.0:3000` **внутри** Docker. Порта приложения на хосте нет. Серверный режим требует SIWC, точный HTTPS origin и личный код не короче 32 символов; при неверной конфигурации запуск закрывается. Переменные сервера устанавливаются только при запуске, не при сборке.

## 1. Проверка ChatGPT до аренды

На текущем ПК с установленными зависимостями из корня проекта:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --prepare-vm .data/vm-connection
node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --login --dir .data/vm-connection --port 1455
node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --status --dir .data/vm-connection
node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --probe --dir .data/vm-connection
```

`--prepare-vm` создаёт отдельную идентичность будущего сервера без копирования текущих токенов. Вход открывается вручную по локальной ссылке CLI; callback слушает только `127.0.0.1`. Авторизация требует явного действия владельца. Probe выполняет один реальный запрос и расходует общий лимит подписки. До его успеха не считать облачный мозг проверенным.

После входа staging содержит секретные учётные данные. Не публикуй этот каталог и не включай его в архив исходников. На 1 октября 2026 отдельная staging-идентичность будущего VPS уже авторизована: реальный `--probe` и JSON-запрос через учебный bridge завершились на строгом `gpt-6.1-sol`. Этот факт не подтверждает размещение на Linux: после переноса повтори проверку внутри контейнера. Если каталог не содержит Sol, явный probe всё равно проверяет фиксированную модель настоящим запросом; другая модель не выбирается.

## 2. Конфигурация на будущем VPS

Дальнейшие команды — для Linux VPS, после согласованного создания сервера. В его рабочем каталоге должны лежать только исходники и этот комплект, без файлов текущего ПК `.env.local`, `.runtime` и `.data`.

Скопируй `deploy/.env.example` в `deploy/.env`, закрой доступ другим пользователям и отредактируй приватно:

```sh
umask 077
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Задай:

| Переменная | Значение |
| --- | --- |
| `TRAINING_DOMAIN` | Например `training.example.com`, без схемы, пути и порта |
| `TRAINING_PUBLIC_ORIGIN` | Точно `https://training.example.com` для того же hostname, без пути |
| `TRAINING_ACCESS_CODE` | Собственный случайный код, минимум 32 символа |
| `OPENAI_API_KEY` | Необязательный серверный ключ только для аудио; можно ввести через UI |

`TRAINING_DEPLOYMENT=server`, `TRAINING_BRAIN_AUTH=siwc`, `TRAINING_MANAGED_SERVER=1` и `TRAINING_SIWC_DIR=/app/.data/siwc` зафиксированы в Compose. Менять их для обхода проверки не требуется. Сгенерировать код можно в доверенном локальном терминале: `openssl rand -hex 32`; введи результат в приватный env-файл. Не вставляй код или API-ключ прямо в команды запуска.

DNS A/AAAA записи должны указывать на VPS. Не оставляй AAAA для недоступного IPv6. Caddy автоматически получает и обновляет публичный сертификат; ручная установка сертификата на iPhone не нужна. На этом этапе не запускай Caddy с примерным доменом.

Проверь конфигурацию без печати значений, собери образ и создай том приложения, не запуская сервер:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build app
docker compose --env-file deploy/.env -f deploy/compose.yaml create app
```

Сборка требует доступа к registry/npm и ресурсам шрифта Next.js. Она не требует SIWC credentials и не запускает очередь личных разборов. Runtime содержит только production dependencies; `tsx` нужен явному SIWC CLI.

## 3. Перенос отдельного SIWC подключения

Перенос выполняется владельцем после проверки локального staging и создания VPS, через SSH/SCP либо SFTP. Передаются только созданные для будущего сервера `host.json` и `credentials.json`, а не desktop `auth.json`, каталог Codex или текущая авторизация другого хоста.

На VPS положи эти два файла в закрытый временный каталог вне дерева исходников, например `/srv/training-private/siwc-transfer`, и установи файлам mode 600. Передай их в том через stdin одноразового контейнера от пользователя `node`:

```sh
tar -C /srv/training-private/siwc-transfer -cf - host.json credentials.json | docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm -T --no-deps --entrypoint sh app -c 'set -eu; umask 077; tar --no-same-owner --no-same-permissions -C /app/.data/siwc -xf -; chmod 700 /app/.data/siwc; chmod 600 /app/.data/siwc/host.json /app/.data/siwc/credentials.json'
```

Файлы создаются от uid/gid 1000 без privileged/root helper. Новый именованный том наследует uid/gid 1000 и приватные права каталога из образа. При выборе bind mount вместо именованного тома заранее создай именно выбранный каталог с владельцем 1000:1000 и mode 700; не монтируй весь домашний каталог или дерево исходников.

Проверь metadata и один реальный запрос уже в контейнере:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps app node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --status
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps app node node_modules/tsx/dist/cli.mjs scripts/connect-chatgpt.ts --probe
```

Далее refresh этих credentials выполняет VPS. Не запускай одновременно локальные probe/login для уже переданного подключения: отдельные процессы не должны конкурировать за одну цепочку refresh. После проверенного переноса удали временные копии своим обычным безопасным способом. Личную историю текущего тренажёра можно переносить отдельной согласованной резервной копией; новый сервер не получает её автоматически.

## 4. Запуск и проверка телефона

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Открой настроенный HTTPS-адрес, введи код и проверь состояние подключения. Без кода личные API должны вернуть 401. Неверный Origin должен вернуть 403; сам манифест публичный и не содержит историю. Проверь также, что порт 3000 не доступен извне.

На iPhone открой этот адрес в Safari, проверь микрофон и озвучку, затем «Поделиться» → «На экран Домой» → «Открывать как веб-приложение». Повторно проверь голос после закрытия и запуска из иконки. HTTPS и добавление иконки не обеспечивают автономный offline тренинг: модель, распознавание и озвучка требуют сети; эта версия также не сохраняет незавершённую запись при закрытии страницы.

`init: true` передаёт сигналы процессу Node; `docker compose stop app` отправляет SIGTERM и ждёт до 30 секунд. Незавершённый разбор остаётся в SQLite; очередь восстанавливается после возврата сервера и истечения lease. Healthy не доказывает, что такой разбор уже готов или что лимит ChatGPT доступен. `restart: unless-stopped` восстанавливает сервис после сбоя, но не перезапускает намеренно остановленный контейнер.

## Резервная копия и восстановление

Экспорт JSON из UI не заменяет резервную копию аудио и SIWC. Для согласованной копии сначала останови **все писатели**: основной сервер и любые CLI, работающие с тем же томом. Не копируй только работающий `training.sqlite`, игнорируя WAL.

Из корня проекта на VPS:

```sh
umask 077
mkdir -p ../training-backups
docker compose --env-file deploy/.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm -T --no-deps --entrypoint tar app -C /app/.data -czf - . > ../training-backups/training-backup.tar.gz
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d app
```

Архивирует весь остановленный `.data`, включая имеющиеся SQLite WAL/SHM, аудио и secrets. Используй отдельное имя для каждой копии; сохрани архив и `deploy/.env` в защищённом хранилище, недоступном веб-серверу. Если копирование не удалось, сначала возобнови app и повтори процедуру осознанно. Не выдавай архив за публичный экспорт исходников.

Восстанавливай проверенный архив в **новый пустой** том при остановленном сервере, сохраняя прежний каталог/том до проверки восстановления:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml create app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm -T --no-deps --entrypoint tar app --no-same-owner --no-same-permissions -C /app/.data -xzf - < ../training-backups/training-backup.tar.gz
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

При восстановлении архив извлекается от uid 1000; не подменяй им работающий том. Томы Caddy `/data` и `/config` сохраняются отдельно для сертификатов и конфигурации. Обычное обновление не должно удалять их или том приложения.

## Обновления и ограничения проверки

После получения новой согласованной версии исходников сначала сделай резервную копию, затем `build app` и `up -d`. Пересборка контейнера не сбрасывает `.data`. `docker compose down` оставляет именованные тома; `down -v` удаляет данные и не является командой обновления.

Node `24-bookworm-slim` и Caddy `2-alpine` — официальные обновляемые tags. Перед выпуском зафиксируй протестированные digests и проверяй обновления отдельно. На 2 октября 2026 сборка и запуск проверены на личной Ubuntu 24.04 VM с 2 ядрами/4 ГБ RAM: Docker автозапускается, Caddy получил публичный сертификат, личные API закрыты кодом, а отдельное SIWC-подключение завершило настоящий probe строго на Sol уже в Linux-контейнере. Озвучка и распознавание реальной тестовой записи прошли. Это результат для одного развёртывания, а не гарантия доступа для другой учётной записи или подтверждение физического iPhone. Нативный iOS-клиент и бесплатная подпись описаны в `ios/README.md`; инструкция Safari выше остаётся дополнительным веб-вариантом. Локально доступны `node --check deploy/healthcheck.mjs` и `node --test deploy/kit.test.mjs`.

Основания: [Docker Node image](https://github.com/nodejs/docker-node), [Node container practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md), [Docker build context](https://docs.docker.com/build/concepts/context/), [Compose services](https://docs.docker.com/reference/compose-file/services/), [Caddy Docker Compose](https://caddyserver.com/docs/running#docker-compose), [Caddy reverse proxy and HTTPS](https://caddyserver.com/docs/quick-starts/reverse-proxy), [SIWC sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
