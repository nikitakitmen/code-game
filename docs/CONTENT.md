# Authoring PROD content

All game content is data, not code. It lives in `packages/content/data/` and is
consumed unchanged by the web client (in the browser) and by the Laravel seeder
(into the database). You never touch React or the engine to add a mission.

```
packages/content/data/
├─ components.json     architecture components: capacity, latency, cost, config, rules
├─ settings.json       "code" settings the player flips (auth, security, cache, async…)
├─ knowledge.json      Knowledge Map nodes + Encyclopedia articles
├─ achievements.json   achievements and their unlock conditions
├─ npcs.json           characters
├─ attacks.json        Attack Lab scenarios
├─ commands.json       the Terminal's allow-list of simulated commands
├─ initial-state.json  the starting world of a new campaign
└─ missions/act-01.json … act-12.json   the 100-mission campaign
```

## The mission shape

A mission is pure data (see `MissionDef` in `packages/engine/src/types.ts`). The
engine drives it through: **briefing → investigating → acting → resolved → debrief**.

```jsonc
{
  "id": "m029", "slug": "index", "act": 5, "order": 29, "kind": "incident",
  "title": { "en": "Add the index", "ru": "Добавить индекс" },
  "summary": { "en": "…", "ru": "…" },
  "prerequisites": ["m028"],
  "unlocks": { "apps": [], "components": [], "settings": [], "attacks": [], "commands": [] },
  "setup": [ /* effects applied to the world when the mission starts */ ],
  "trigger": { "from": "lev", "subject": {…}, "body": {…} },     // the email
  "dialogue": [ { "npc": "nika", "text": {…}, "choices": [ … ] } ],
  "symptoms": [ { "text": {…}, "app": "monitoring" } ],
  "evidence": [ { "id": "e-slow", "app": "logs", "hint": {…}, "text": {…},
                  "match": { "kind": "log", "key": "SLOW_QUERY" } } ],
  "hypotheses": [ { "id": "h1", "text": {…}, "correct": true, "feedback": {…} } ],
  "ops": [ { "id": "idx", "app": "database", "label": {…}, "effects": [ … ] } ],
  "objectives": [ { "id": "o1", "text": {…}, "check": <condition>, "sim": true } ],
  "solutions": [ { "id": "good", "kind": "good", "when": <condition>,
                   "text": {…}, "effects": [ … ], "debt": -5, "consequences": [ … ] } ],
  "explanation": { "what": {…}, "whyNow": {…}, "limits": {…}, "article": "db.index" },
  "achievements": [ { "id": "index-wizard", "when": <condition> } ],
  "checkpoint": true,
  "rewards": { "cash": 500, "users": 2000, "days": 7 },
  "next": "m030"
}
```

Every player-facing string is `{ "en": …, "ru": … }` — localisation completeness is
checked by the content tests.

## Conditions and facts

Objectives, solutions, consequences, achievements and Attack Lab steps are **conditions**
over **facts**. `computeFacts(state, content, sim)` produces a flat dictionary describing
the world and the latest simulation, e.g. `ep.catalog.rows`, `app.queryMode`,
`role.backend`, `m.availability`, `vuln.sqli`, `anomaly.oversold`.

```jsonc
{ "all": [ { "fact": "ep.catalog.rows", "lt": 5000 },
           { "fact": "app.queryMode", "eq": "parameterized" } ] }
```

Operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `truthy`, `falsy`; combinators:
`all`, `any`, `not`. See `packages/engine/src/facts.ts` for the full fact catalogue.

## Effects

`setup`, `ops`, dialogue choices and `solutions` carry **effects** applied to the world
(see `Effect` in types.ts): `set`/`inc`/`push`/`merge`/`remove` over a path, `addNode`,
`connect`, `debt`, `cash`, `users`, `mail`, `unlock`, `incident`, `fixBug`, `addBug`,
`advance`. Paths select into the world, e.g. `endpoints[id=catalog].cpuMs`.

## Validating your content

```bash
npm run test:content
```

This checks: unique ids and order, resolvable `prerequisites`/`next`, bilingual strings,
known NPC/knowledge/achievement references, and — crucially — that **every fact referenced
by an objective or solution is one the engine actually emits**. It also plays Act I end to
end to prove the missions are completable, and re-runs the simulation twice to prove
determinism.

## Save compatibility

Adding missions, components or settings does not break existing saves. Each save carries a
`schemaVersion`; `packages/engine/src/save/migrations.ts` upgrades older saves (v1 → v2 → v3)
and `loadState` fills any new fields with defaults. If you change the *shape* of
`GameState`, bump `SAVE_SCHEMA_VERSION` and add a migration step.
