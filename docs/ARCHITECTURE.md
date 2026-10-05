# PROD — архитектура

Этот документ фиксирует шесть решений, которые ТЗ (§35) требует зафиксировать до основного кода:

1. архитектура репозитория;
2. доменная модель симуляции;
3. схема миссии;
4. реестр приложений/окон PROD OS;
5. схема сохранения;
6. контракт API.

Всё остальное (контент, UI, деплой) строится поверх этих решений.

---

## 1. Архитектура репозитория

```
/
├─ apps/
│  ├─ web/                 Next.js (App Router, React, TypeScript): PROD OS и все приложения
│  └─ api/                 Laravel: REST API, auth, guest, saves, attempts, knowledge, achievements
├─ packages/
│  ├─ engine/              @prod/engine: детерминированная симуляция + игровая логика (чистый TS, без React)
│  └─ content/             @prod/content: data-driven контент (JSON) + типизированные загрузчики
│     └─ data/
│        ├─ components.json      каталог компонентов архитектуры (capacity, latency, cost, config, rules)
│        ├─ settings.json        «настройки кода» приложения игрока (password hashing, CORS, retries…)
│        ├─ knowledge.json       узлы Knowledge Map + статьи Encyclopedia
│        ├─ achievements.json
│        ├─ npcs.json
│        ├─ attacks.json         сценарии Attack Lab
│        ├─ commands.json        разрешённые (симулируемые) команды Terminal
│        ├─ initial-state.json   стартовый мир кампании
│        └─ missions/act-01.json … act-12.json
├─ docker/                 Dockerfile'ы, Caddyfile, скрипты backup
├─ docs/                   архитектура, dev-гайд Windows, деплой Timeweb/VPS, гайд по контенту
├─ e2e/                    Playwright E2E
├─ docker-compose.yml      поднимает всё одним `docker compose up`
└─ .env.example
```

Принципы:

* **Движок отделён от UI.** `@prod/engine` не знает о React/DOM. Его используют web-клиент и тесты.
  Любое изменение мира — это `GameAction`, который проходит через чистый reducer.
* **Контент отделён от кода.** Миссии, компоненты, статьи, достижения, атаки, команды — JSON в `packages/content/data`.
  Один и тот же JSON грузит web-клиент (lazy, по актам) и Laravel (seeder → таблицы `missions`, `knowledge_nodes`, `achievements`).
* **Реальная и игровая инфраструктура — разные уровни.** Laravel/MySQL/Redis/Caddy обслуживают сам PROD.
  Внутриигровые Nginx/MySQL/Redis/CDN/WAF/Queue/Region — только сущности симуляции; никаких контейнеров для игрока.
* **Local-first сохранение.** Состояние живёт в клиенте, сохраняется локально (IndexedDB/localStorage) и
  синхронизируется с API (guest token или аккаунт). Сервер хранит append-only историю сохранений.

---

## 2. Доменная модель симуляции

### 2.1. Состояние игры (`GameState`)

```
GameState
├─ schemaVersion, seed, clock (игровой день/минута)
├─ company { name, domain }
├─ campaign { currentMissionId, completed{id→summary}, active{phase, evidence, hypothesis, choices, ops, baseline} }
├─ world                       ← всё, что симулируется
│  ├─ nodes[]  { id, type, name, region, pos{x,y}, size, config{}, ip, ports[], publicPorts[], offline }
│  ├─ edges[]  { id, from, to }
│  ├─ regions[]                активные регионы (зоны на изометрической карте)
│  ├─ traffic  { users, baseRps, pattern, spike, regionMix{} }
│  ├─ endpoints[]              функции продукта: method, path, cpuMs, queries[], cache, jobs[], external
│  ├─ tables[]                 логическая схема БД: rows, columns, indexes
│  ├─ app {}                   «настройки кода»: passwordStorage, queryMode, cors, retries, circuitBreaker…
│  ├─ bugs[]                   активные дефекты кода (регрессии, N+1, утечка памяти…), с эффектами
│  ├─ files[]                  файлы проекта (index.html, картинки, .env, backup.sql…)
│  ├─ dns { records[], history }   tls { … }   security { roles, employees, secrets, deps }
│  ├─ git { commits, branches, prs, protection }   ci { stages }   deploy { version, releases, canary, flags, pending }
│  ├─ observability { alertRules, runbooks, slo, incidents, postmortems }
│  └─ flags {}                 сюжетные флаги
├─ quality { performance, reliability, security, maintainability, costPerMonth, reasons }
├─ debt (0–100)   budget { cash, revenuePerMonth, ledger[] }
├─ unlocks { apps[], components[], settings[], attacks[], commands[] }
├─ knowledge { nodeId → { state, score } }   achievements { id → unlockedAt }
├─ consequences[] (отложенные)   sideIncidents[]   mail[]   decisionLog[]   timeline[]
```

### 2.2. Каталог компонентов (data-driven)

Каждый тип узла описан в `components.json`: `type`, `role`, `capacity` (на размер `s`), `baseLatencyMs`, `costPerMonth`,
поддержка вертикального масштабирования (`s…2xl`), поля конфигурации, порты, разрешённые соединения (`connectsTo` по ролям).
Движок работает с **ролями** (`proxy`, `backend`, `database`, `cache`, `queue`…), поэтому новый компонент той же роли
(например, другой cache-сервер) добавляется только данными.

Правила соединений: физически невозможные связи (`MySQL → Browser`, `Queue → DNS`) блокируются с объяснением;
плохие, но возможные (Browser → Backend напрямую мимо прокси, БД без бэкапа, один Redis для всего) разрешены
и проявляются в метриках/безопасности.

### 2.3. Расчёт (детерминированный)

`simulate(state, content) → SimResult` считает окно из 60 тиков (1 тик = 1 игровая минута):

1. **Трафик**: `rps(t) = baseRps × pattern(t)` (flat/wave/spike/growth), распределение по endpoint'ам по весам и по регионам.
2. **Маршрутизация**: для каждого endpoint'а — путь по рёбрам графа от `client` до терминального узла
   (static → proxy/CDN/storage, dynamic → backend), с учётом offline-узлов, балансировщика, canary, регионов, DNS.
3. **Нагрузка и capacity**: `effectiveCapacity = base × size × health`; `utilization = load / capacity`.
4. **Латентность**: `latency = base / (1 − ρ)` до насыщения; при `ρ ≥ 1` часть запросов отбрасывается
   (`errors = (ρ−1)/ρ`), обслуженные получают латентность таймаута. Плюс сеть: RTT между регионами,
   TCP/TLS рукопожатия, вес страницы / пропускная способность.
5. **БД**: `rowsScanned` из индексов (как EXPLAIN: `const/ref/range/ALL`, filesort), время запроса,
   connections по закону Литтла, `max_connections`, пул соединений, блокировки, дедлоки, лаг реплики.
6. **Кэш**: hit ratio TTL-кэша `λT/(1+λT)` на ключ, ограничение памяти и eviction policy, устаревшие данные
   при TTL-only инвалидации, отказ Redis.
7. **Очереди**: backlog(t+1) = max(0, backlog + (in − throughput)·60), задержка задач, retry, DLQ, дубликаты
   при visibility timeout < длительности задачи, идемпотентность.
8. **Внешние провайдеры**: латентность, таймауты, ретраи (усиление нагрузки), circuit breaker, fallback.
9. **Аномалии корректности**: stale reads, двойные списания, oversell, deadlocks, потерянные события, случайные logout'ы.
10. **Стоимость**: сумма узлов по размерам + трафик (origin vs CDN) + провайдеры.
11. **Качество**: Performance/Reliability/Security/Maintainability/Cost/Technical Debt с причинами (reasons).
12. **Presentation**: выборка трасс запросов (стадии, время, статус, headers, HIT/MISS, rows scanned, retries),
    структурированные логи (с request ID, если включены), сработавшие алерты (включая ложные), события.

Случайность — только через seeded PRNG (`mulberry32`, сид = hash(seed, missionId, attempt)).
Одинаковый seed + одинаковые решения = одинаковый результат (тесты на детерминизм).

### 2.4. Действия (`GameAction`)

Все изменения мира — типизированные действия, применяемые чистым reducer'ом и записываемые в decision log:
`node.add/remove/move/config/resize`, `edge.connect/disconnect`, `app.set`, `db.createIndex/dropIndex/createTable`,
`dns.setRecord/deleteRecord`, `tls.issue/configure`, `firewall.setPort`, `files.rename/publish/optimize/delete`,
`git.*`, `ci.*`, `deploy.*`, `flags.*`, `security.*`, `alerts.*`, `runbook.*`, `incident.*`, `postmortem.*`,
`mission.pinEvidence/chooseHypothesis/choose/op/complete`, `time.wait`, `company.setName`.

После Act VII изменения «кода» (`app.set`) попадают в `deploy.pending` и вступают в силу только после деплоя
через CI/CD (с риском регрессии, зависящим от тестов и технического долга).

### 2.5. Факты и условия

`computeFacts(state, sim)` превращает мир и результат симуляции в плоский словарь фактов
(`count.backend`, `edge.backend>redis`, `app.queryMode`, `ep.catalog.p95`, `m.errorRate`, `vuln.sqli`, `anomaly.oversell`…).
Условия миссий — JSON-DSL над фактами: `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": ... }`,
`{ "fact": "ep.catalog.p95", "lt": 300 }`. Это позволяет описывать цели, решения и последствия данными.

---

## 3. Схема миссии

```jsonc
{
  "id": "m029", "slug": "index", "act": 5, "order": 29, "kind": "incident",
  "title": { "en": "...", "ru": "..." },
  "prerequisites": ["m028"],
  "unlocks": { "apps": [], "components": [], "settings": [], "attacks": [], "commands": [] },
  "setup": [ /* эффекты над миром: трафик, данные, баги, инциденты, узлы */ ],
  "trigger": { "from": "support", "subject": {…}, "body": {…} },
  "dialogue": [ { "npc": "ceo", "text": {…}, "choices": [ { "id", "text", "effects": [], "reply": {…} } ] } ],
  "symptoms": [ { "text": {…}, "app": "monitoring" } ],
  "evidence": [ { "id", "app", "hint": {…}, "match": { "kind": "log", "code": "SLOW_QUERY" }, "text": {…} } ],
  "hypotheses": [ { "id", "text": {…}, "correct": true, "feedback": {…} } ],
  "ops": [ { "id", "app": "files", "label": {…}, "effects": [], "once": true } ],
  "actions": ["db.createIndex", "node.resize"],
  "learning": ["db.index", "db.explain"],
  "objectives": [ { "id", "text": {…}, "check": <condition>, "needsSim": true } ],
  "solutions": [
    { "id": "composite-index", "kind": "good", "when": <condition>, "text": {…},
      "effects": [], "debt": -5, "consequences": [] },
    { "id": "bigger-db", "kind": "quickfix", "when": <condition>, "debt": 10,
      "consequences": [ { "id", "delay": 3, "when": <condition>, "effects": [], "mail": {…} } ] }
  ],
  "explanation": { "what", "whyNow", "limits", "underTheHood", "diagram": {…}, "article": "db.index" },
  "achievements": [ { "id": "index-wizard", "when": <condition> } ],
  "checkpoint": true,
  "rewards": { "cash": 500, "users": 2000, "days": 7 },
  "next": "m030"
}
```

Жизненный цикл миссии: `briefing` (письмо) → `investigating` (симптомы, сбор улик через «📌 Pin» в приложениях,
гипотезы) → `acting` (изменения, симуляция) → `resolved` (все цели выполнены на свежей симуляции) →
`debrief` (before/after, объяснение, последствия) → следующая миссия. Перед стартом миссии с `checkpoint: true`
автоматически создаётся checkpoint Time Machine.

---

## 4. Реестр приложений PROD OS

| id | Приложение | Открывается |
|----|------------|-------------|
| mail, browser, files, terminal, project, help | стартовые | с начала |
| encyclopedia | Encyclopedia | m003 |
| knowledge, inspector¹ | Knowledge Map, Request Inspector | m005 |
| servers | Servers | m006 |
| architecture | Architecture Builder | m007 |
| database, timemachine | Database, Time Machine | m009 |
| api | API Inspector | m016 |
| dns | DNS | m021 |
| network | Network | m024 |
| monitoring, finance | Monitoring, Finance | m027 |
| cache | Cache Manager | m031 |
| queue | Queue Monitor | m036 |
| git, cicd | Git, CI/CD | m041 |
| logs | Logs | m051 |
| traces | Trace Viewer | m053 |
| incidents | Incident Manager | m055 |
| runbooks | Runbooks | m057 |
| security, attacklab | Security Center, Attack Lab | m059 |

¹ Inspector открывается из Browser / Architecture / Trace Viewer, на рабочем столе не лежит.

Запись реестра: `{ id, titleKey, icon, defaultSize, minSize, singleton, desktop, unlock }`.
Window manager: z-order, фокус, drag за заголовок, resize, minimize/close, Cascade/Tile, клавиатура
(Esc закрывает диалог, Ctrl+` переключает окна). Скрытые/свёрнутые окна приостанавливают анимации.

---

## 5. Схема сохранения

```jsonc
SaveEnvelope {
  "schemaVersion": 3,          // версия формата GameState
  "revision": 17,              // монотонный счётчик для синхронизации (optimistic concurrency)
  "savedAt": "2026-…",
  "contentVersion": "1.0.0",
  "seed": 123456,
  "state": GameState
}
Checkpoint { id, type: "mission-start" | "manual" | "pre-restore" | "pre-decision" | "auto", label, missionId, clock, state }
```

* Миграции `v1 → v2 → v3` (`packages/engine/src/save/migrations.ts`) применяются цепочкой при загрузке.
  Новые поля всегда получают значения по умолчанию; новые миссии не ломают старые сохранения.
* Восстановление checkpoint'а сначала создаёт checkpoint `pre-restore` — прогресс нельзя потерять необратимо.
  Достижения и знания при откате не отнимаются (мета-прогресс монотонен).
* Сервер хранит сохранения append-only (`game_saves`), отклоняет понижение `schemaVersion`,
  а старые autosave'ы чистит фоновая задача (Laravel queue), не трогая checkpoint'ы.

---

## 6. Контракт API (v1)

Базовый путь: `/api/v1`. JSON. Аутентификация: `Authorization: Bearer <token>` (аккаунт, Sanctum)
или `X-Guest-Token: <token>` (гость). Мутирующие POST принимают `Idempotency-Key`.

| Группа | Метод и путь | Назначение |
|--------|--------------|------------|
| health | `GET /api/health` | liveness/readiness |
| guest | `POST /guest` | создать гостевой профиль → `guest_token` |
| auth | `POST /auth/register` | email/password (+ `guest_token` → перенос прогресса) |
| auth | `POST /auth/login` | вход (+ `guest_token` → привязка/конфликт) |
| auth | `POST /auth/logout`, `GET /auth/me` | |
| profile | `GET /profile`, `PATCH /profile` | профиль, название компании |
| profile | `POST /profile/merge-guest` | разрешение конфликта гостевого и аккаунтного прогресса |
| settings | `GET /settings`, `PUT /settings` | locale, громкость, mute, reduce motion |
| save | `GET /save`, `PUT /save` | основной сейв; `base_revision` → 409 при конфликте |
| save | `GET /checkpoints`, `POST /checkpoints`, `GET /checkpoints/{id}` | Time Machine |
| campaign | `GET /campaign` | текущая миссия, прогресс по актам |
| missions | `GET /missions`, `GET /missions/{slug}` | индекс и определения миссий |
| actions | `POST /missions/{slug}/attempts`, `PATCH /attempts/{id}` | попытки: решения, гипотеза, метрики до/после |
| simulation | `GET /simulation/components`, `GET /simulation/meta` | каталог компонентов, версия движка |
| knowledge | `GET /knowledge`, `PUT /knowledge/progress` | граф знаний; прогресс только растёт |
| achievements | `GET /achievements`, `POST /achievements/unlocks` | идемпотентная разблокировка |
| localization | `GET /locales` | поддерживаемые языки |

Ошибки: `422` (валидация, формат Laravel), `401/403`, `404`, `409` (конфликт ревизии/версии), `429` (rate limit).
Подробности — в `docs/API.md`.
