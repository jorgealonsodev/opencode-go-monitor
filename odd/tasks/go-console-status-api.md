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

## Checks
- `npx vitest run`, `npx tsc --noEmit`

## Progress
- Branch `fix/go-console-status-api` created.
- T1 implemented (delegated writer): ApiFetcher calls `/console/api/go/status` with `x-org-id`; FetcherSelector uses ApiFetcher only; dashboard URL, i18n prompts, tests, fixture and CHANGELOG updated. RED observed (10/16 new ApiFetcher tests failing) before GREEN. Checks: `npx vitest run` 134/134 passed; `npx tsc --noEmit` clean. Commit pending (parent).
