# PROD — API contract (v1)

Base path `/api/v1`. JSON in and out. Auth is either a Sanctum bearer token
(`Authorization: Bearer <token>`, account) or `X-Guest-Token: <token>` (guest).
Mutating endpoints are validated; writes to the save use optimistic concurrency.

Real Laravel/MySQL/Redis serve PROD itself. The **in-game** MySQL/Redis/Nginx/… are
only simulation entities computed by `@prod/engine` in the browser — the API never
runs them. The API stores progress and serves data-driven content.

## Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | – | liveness |
| `GET /api/v1/simulation/meta` | – | content/schema/engine versions |
| `GET /api/v1/locales` | – | supported locales |
| `POST /api/v1/guest` | – | create a guest profile → `guest_token` |
| `POST /api/v1/auth/register` | – | email/password; optional `guest_token` carries progress in |
| `POST /api/v1/auth/login` | – | optional `guest_token`; returns `guest_conflict` when both sides have progress |
| `GET /api/v1/auth/me` | account | current user |
| `POST /api/v1/auth/logout` | account | revoke the current token |
| `POST /api/v1/profile/merge-guest` | account | resolve a guest/account conflict (`keep_account` \| `use_guest`) |
| `GET /api/v1/missions` | – | mission index |
| `GET /api/v1/missions/{slug}` | – | one mission definition |
| `GET /api/v1/knowledge` | – | knowledge nodes + articles |
| `GET /api/v1/achievements` | – | achievement definitions |
| `GET/PATCH /api/v1/profile` | guest/account | profile + company name |
| `GET/PUT /api/v1/settings` | guest/account | locale, volume, mute, reduce motion |
| `GET/PUT /api/v1/save` | guest/account | main save; `PUT` takes `base_revision` → `409` on a stale write, refuses a schema downgrade |
| `GET/POST /api/v1/checkpoints`, `GET /api/v1/checkpoints/{id}` | guest/account | Time Machine checkpoints |
| `GET /api/v1/campaign` | guest/account | current mission + completed list |
| `POST /api/v1/missions/{slug}/attempts`, `PATCH /api/v1/attempts/{id}` | guest/account | attempt: hypothesis, decisions, metrics before/after |
| `GET/PUT /api/v1/knowledge/progress` | guest/account | knowledge progress (monotonic — never lowered) |
| `GET/POST /api/v1/achievements/unlocks` | guest/account | idempotent unlocks |

## Errors
`422` validation (Laravel shape), `401` no/invalid credentials, `404` not found,
`409` save-revision or schema conflict (returns the current save), `429` rate limited.

## Guest → account
A guest plays with `X-Guest-Token`. On register the guest's save, knowledge and
achievements move into the new account and the guest profile is deleted. On login,
if the account already has progress and the guest also does, the response carries
`guest_conflict: true` and the client calls `POST /profile/merge-guest` to choose.
