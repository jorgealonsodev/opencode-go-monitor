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
- [x] T2b — ProfileStore, profile commands, legacy removal, polling binding/backoff/auth stop (route: delegated writer; trigger: 2+ non-trivial files)
- [x] T2c — Per-profile history, migration, export (route: delegated writer)
- [x] T2d — UI states/strings, i18n, docs, CHANGELOG 1.0.0, version bump, FR5 search clean (route: delegated writer)
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
- T2b implemented (delegated writer): `src/storage/profiles.ts` (`ProfileStore` implements `ActiveKeyProvider`; FR1 validation helpers; `keyHint`; idempotent `removeLegacyData` + one-time notice); `src/commands/apiKeys.ts` (Add on `opencodeGoQuota.configure`, Select, Rename, Replace, Remove, Remove All on `opencodeGoQuota.clearCredentials`; add/replace validate via a one-off `ActiveKeyProvider` and reuse a 200 as first snapshot). Polling now lives in `src/polling/QuotaPoller.ts` (injected clock; setTimeout chain; fetch generation + profile binding; backoff reset on profile change; AuthError → auth state, one notification per episode, scheduled/focus polling stopped until select/replace/manual Refresh; CredentialsError → setup; Retry-After with 60 s floor; shared 10 s leading+trailing debounce for Refresh/Select/focus). `extension.ts` only wires it; `refresh.ts` delegates to the poller and holds translated `notifyAuthRejected`/`notifyRefreshFailed`. Status bar single click: setup → Add API Key, auth → Select API Key (`singleClickCommand`). Deleted `credentials.ts` (+ temporary adapter, `maskCookie`), `configure.ts`, `clearCredentials.ts`, `test/credentials.test.ts`, `setWorkspaceId` + workspace tooltip line, workspace capture in Open Dashboard (now `https://opencode.ai/console`), unused i18n keys. Command titles without the `OpenCode Go:` prefix (EN/ES). Fixes advisory R3-poll-auth-untested. RED observed: 86/88 new tests failing against stubs. Checks: `npx vitest run` 190/190 passed; `npx tsc --noEmit` clean; `npm run build` ok. Commit pending (parent).
  - Left for T2c: history is still the single global key — Remove / Remove All do not delete history yet; snapshots are not yet scoped per profile; strategy cache in `history.ts` still present.
  - Left for T2d: `setProfileName` + tooltip footer `Key: <name>`, auth/setup status bar texts and tooltips, details quick pick items (Reconfigure/Logout), ShowDetails still fetches directly; `msgLegacyNotice` contains "Cookie" in `i18n.ts` (needs FR5 allowlist or relocation).
- T2c implemented (delegated writer): history per profile under `opencodeGoQuota.history.<profileId>` (`HistoryStorage` reads/exports only the active profile; `append` writes to the snapshot's own profile; entries are reduced to domain fields so a legacy `source` is ignored on read and never written again). `migrateLegacyHistory` moves the legacy `opencodeGoQuota.history` to the first profile on `ProfileStore.add` (entries without `profileId` get the new id; merged oldest-first; legacy key deleted; idempotent) and is re-run at activation when a profile exists (recovers an interrupted move); activation `cleanup()` now only trims per-profile keys and never touches the legacy key. *Export History* writes `{ profile, entries }` for the active profile; zero entries → existing "no data" message. `remove` deletes that profile's history, `removeAll` deletes every `history.<id>` key. Strategy cache (`getCachedStrategy`/`setCachedStrategy`/`clearCachedStrategy`/`StrategyCacheEntry`/`STRATEGY_CACHE_*`) deleted from `history.ts`. Advisories resolved: R3-remove-history-promise, R3-keyring-transient-setup (`ProfileStore` in-memory per-profile key cache: populated on add/replace/successful read, cleared on remove/removeAll; a never-readable key still yields null), R3-cross-window-stuck-loading (a result or error discarded in the current generation is treated as a profile change → backoff reset + debounced fetch of the new active profile, or setup when none), R3-initial-snapshot-trailing (initial validation snapshot cancels a pending trailing debounce fetch). RED observed: 27/208 failing before implementation. Checks: `npx vitest run` 208/208 passed; `npx tsc --noEmit` clean; `npm run build` ok. Commit pending (parent).

- T2d implemented (delegated writer): `StatusBarManager.setProfileName(name, count)`; FR3 states/strings EN+ES (setup `OC Go: add API key`, auth `OC Go: invalid key` with profile tooltip, error tooltip = translated reason via `describeError`, ≥2 profiles prefix truncated to 12 code points + `…`, limit-reached `limit` text + `Limit reached — resets in …` line, unknown `?%` without reset, footer `Key: <name> | Updated hh:mm`, `Switch API key` command link). Rich tooltip is markdown trusted only for `opencodeGoQuota.selectApiKey` (`isTrusted: { enabledCommands }`); profile names markdown-escaped; non-active tooltips are plain strings (adapter no longer guesses markdown). Poller passes the error to `setState('error', err)`. Details quick pick returns an action id (Switch API key / Add API Key / Remove All API Keys replace Reconfigure/Logout; all labels translated); `showDetails` refreshes through the poller (no direct fetch/append), only when a profile is active. `migrateLegacyHistory` dedupes by timestamp (R3-migration-interrupt-duplicates). Removed: obsolete i18n keys (`stateAuthExpired`, `detailsReconfigure`, `detailsLogout`), unused `QuotaFetcher.isAvailable` (FetcherSelector residue), `getWorstWindow`, `getLast24h`, `showHistoryQuickPick`, unused barrels `src/domain/index.ts`, `src/ui/index.ts`. READMEs (API-key setup, several keys, status bar states, badge 1.0.0), CHANGELOG `[1.0.0]` replaces `[0.1.5]`, version 1.0.0 (package.json + lock). R3-limit-reached-unproved resolved by status bar tests. RED observed: 33/223 failing (statusBar 18, commands 10, quickPick 4, history 1), then 4 more (describeError 2, poller error detail 2). Checks: `npx vitest run` 224/224 passed; `npx tsc --noEmit` clean; `npm run build` ok; FR5 grep only matches the legacy-removal routine (`profiles.ts`), its notice string `msgLegacyNotice` (EN/ES) and its tests, plus `source: 'scraping'` seeds in legacy-history migration tests (AC10). Commit pending (parent).
  - Left for T2e: VSIX packaging and manual check (AC15), incl. tooltip command link rendering, hh:mm footer, limit-reached text. Note: setting `opencodeGoQuota.debug` is documented but not read by the code (pre-existing; PRD keeps settings unchanged). Renaming the active key updates the status bar on the next refresh.

### Review — T2a (`9280583`)
- RDD: risk medium, review granted, lens reliability → approved, acknowledged (lineage review-b73d4db83b4f18a7).
- Advisory (non-blocking): R3-cookie-as-bearer (temporary adapter sends stored cookie as Bearer → fixed by T2b), R3-limit-reached-unproved (status bar rendering of `limit-reached` untested → T2d), R3-poll-auth-untested (poll-loop AuthError path untested → T2b).
- Reviewed boundary advances to `9280583`.

### Review — T2b (`62d5e3e`)
- RDD: risk medium, review granted, lens reliability → approved, acknowledged (lineage review-de673bca150bdb90).
- Advisory (non-blocking), all folded into T2c:
  - R3-keyring-transient-setup — `ProfileStore.getActive` has no cache; a transient undefined from the Linux keyring stops polling in setup although a profile exists.
  - R3-cross-window-stuck-loading — result discarded because another window changed the active profile leaves the status bar in `loading` until next interval.
  - R3-remove-history-promise — Remove/Remove All copy promises history deletion that T2b doesn't perform (T2c implements it).
  - R3-initial-snapshot-trailing — initial snapshot from validation does not cancel a pending trailing debounce fetch.
- Reviewed boundary advances to `62d5e3e`.

### Review — T2c (`6c64b17`)
- RDD: risk medium, review granted, lens reliability → approved, acknowledged (lineage review-820a281e59daf443).
- Advisory (non-blocking): R3-migration-interrupt-duplicates — `migrateLegacyHistory` writes the per-profile key before deleting the legacy key; an interruption between both re-merges legacy entries on next activation (duplicates). Folded into T2d (dedupe by timestamp on merge).
- Reviewed boundary advances to `6c64b17`.
