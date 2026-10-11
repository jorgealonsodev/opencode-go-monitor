# Feature: go-console-status-api

## Objective
Restore quota monitoring after OpenCode moved the Go usage page to a client-rendered console SPA.

## Problem
`https://opencode.ai/workspace/<id>/go` is replaced by `https://opencode.ai/console/<wrk_id>/go`, an empty SPA shell. The SSR regex scraping in `ScrapingFetcher` can no longer find usage data.

## New contract (observed 2026-10-11)
- `GET https://opencode.ai/console/api/go/status`
- Headers: `Cookie: auth=<value>`, `x-org-id: <workspaceId>` (wrk_...)
- JSON: `access.meters.{fiveHour,week,month}.{resetsAt (ISO), limitMicroCents (string), usedMicroCents (string)}`

## Scope
- ApiFetcher calls the new endpoint and maps meters → QuotaSnapshot (percent = used/limit*100, resetsInSeconds = resetsAt - now).
- FetcherSelector uses ApiFetcher as the primary strategy.
- openDashboard URL and i18n prompts point to the console URL.
- Tests + fixture (anonymized) + CHANGELOG.

## Tasks
- [x] T1 — Implement new status API fetch, selector switch, dashboard URL, prompts, tests, changelog (route: delegated writer; trigger: 2+ non-trivial files)

- [x] T2a — Domain changes, ActiveKeyProvider port, zen usage fetcher, delete scraping/console/FetcherSelector (route: delegated writer; trigger: 2+ non-trivial files)
- [ ] T2b — ProfileStore, profile commands, legacy removal, polling binding/backoff/auth stop (route: delegated writer)
- [ ] T2c — Per-profile history, migration, export (route: delegated writer)
- [ ] T2d — UI states/strings, i18n, docs, CHANGELOG 1.0.0, version bump, FR5 search clean (route: delegated writer)
- [ ] T2e — VSIX build and manual verification (route: inline + user)

Spec: `docs/prd/go-api-key-usage.md` (revision 2).

## Rationale T2
Console endpoint returned HTTP 401 with stored cookie (sessions expire). The API-key endpoint was verified live on 2026-10-11: HTTP 200, `{usage:{rolling|weekly|monthly:{status,percent,resetsAt}}}`; status may be `rate-limited`. Undocumented officially; used by opencode-quota and openbot.

## Checks
- `npx vitest run`, `npx tsc --noEmit`

## Progress
- Branch `fix/go-console-status-api` created.
- T1 implemented (delegated writer): ApiFetcher calls `/console/api/go/status` with `x-org-id`; FetcherSelector uses ApiFetcher only; dashboard URL, i18n prompts, tests, fixture and CHANGELOG updated. RED observed (10/16 new ApiFetcher tests failing) before GREEN. Checks: `npx vitest run` 134/134 passed; `npx tsc --noEmit` clean. Commit pending (parent).
- T2a implemented (delegated writer): `QuotaWindow.status` adds `limit-reached`; `QuotaSnapshot` gains `profileId`, drops `source`; `AuthError` and `NetworkError.retryAfterSeconds` added; `ActiveKey`/`ActiveKeyProvider` port in `src/domain/types.ts`; `FetchFn` in `src/fetchers/types.ts`; `UsageFetcher` (zen usage endpoint, Bearer, UA from `package.json` version via JSON import, `redirect: 'error'`, injectable timeout default 15 s, PRD FR2 mapping/errors). Deleted ScrapingFetcher, ApiFetcher, FetcherSelector, their tests and fixtures, `statusBarSource`. Temporary `CredentialsKeyProvider` in `src/storage/credentials.ts` (removed in T2b). `AuthError` routes to `auth` state in poll loop and Refresh. RED observed: 26/26 new UsageFetcher tests failing against a stub, plus 1 new Refresh AuthError test. Checks: `npx vitest run` 125/125 passed; `npx tsc --noEmit` clean; `npm run build` ok. Commit pending (parent).
