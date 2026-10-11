# PRD: Go quota via named API keys

| Field | Value |
|---|---|
| Status | Reviewed (product/UX, architecture, security, testability) — ready for implementation |
| Revision | 2 — 2026-10-11 |
| Target release | 1.0.0 (first stable release; breaking setup change from 0.x; 0.1.5 is never published) |
| Branch | `fix/go-console-status-api` |
| Task tracking | `odd/tasks/go-console-status-api.md` |

## 1. Summary

Switch OpenCode Go Monitor from browser-cookie authentication to OpenCode Go API keys, reading quota from `GET https://opencode.ai/zen/go/v1/usage`. Users can store several **named** API keys (for example one per team or subscription) and choose which one is monitored. Everything that only existed to support cookies, workspace IDs or HTML scraping is deleted.

## 2. Problem

- OpenCode moved the Go usage page to a client-rendered console (`https://opencode.ai/console/<wrk_id>/go`). The SSR HTML that `ScrapingFetcher` parsed no longer contains usage data, so released versions (≤ 0.1.4) show no quota.
- The interim fix on this branch (`d205f5e`) calls `GET /console/api/go/status` with the `auth` cookie and `x-org-id`. In real use it returned **HTTP 401**: console sessions expire or are revoked on logout, so cookie auth is fragile by design.
- Setup is user-hostile and risky: users copy two values from DevTools and repeat whenever the session rotates, and a cookie is a full account credential.

## 3. Evidence

| Source | Finding |
|---|---|
| Live test, 2026-10-11 | `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <Go API key>` → `200 application/json` |
| Observed response | `{"usage":{"rolling":{"status":"rate-limited","percent":100,"resetsAt":"…"},"weekly":{"status":"ok","percent":42,"resetsAt":"…"},"monthly":{"status":"ok","percent":21,"resetsAt":"…"}}}` |
| [opencode-quota providers docs](https://github.com/slkiser/opencode-quota/blob/main/docs/readme/providers.md) | Calls it "the official `https://opencode.ai/zen/go/v1/usage` API with your API key"; deprecated workspace/cookie setups |
| [openbot PR #887](https://github.com/nightly-labs/openbot/pull/887) | Same endpoint, Bearer auth, same `rolling/weekly/monthly` + `percent/resetsAt` shape |
| [OpenCode Go docs](https://opencode.ai/docs/go/) (`go.mdx`) | No usage endpoint documented. Clients should "identify itself with its own user agent … rather than a generic SDK or HTTP-library name" |
| Live test, 2026-10-11 | Console endpoint `/console/api/go/status` with stored cookie → `401` |

**Risk:** the endpoint is undocumented and may change without notice. Mitigated by strict parsing, timeouts, schema-drift logging, a distinct "unexpected response" message, and isolated mapping code (§9, FR2).

## 4. Goals

1. Quota shows correctly using only an API key.
2. One-step setup: name the key and paste it; no DevTools, no workspace ID.
3. Several named keys can be stored; the user switches the active one from the status bar in two clicks, and always knows which key is shown.
4. Credentials survive browser logout and session rotation.
5. Every state has exact, actionable wording: no key, invalid key, limit reached, network failure, unexpected response.
6. No secret appears in logs, errors, notifications, history, exports, or fixtures.
7. The extension never hammers the endpoint: bounded timeouts, backoff, `Retry-After`, and no polling with a rejected key.
8. The codebase contains no dead code, strings, fixtures or storage keys from the cookie/scraping era.

## 5. Non-goals

- Cookie or console-session authentication (removed; §8).
- Dollar amounts, upgrade prices, billing details.
- Monitoring several keys simultaneously (only the active key is polled).
- Syncing keys or profiles across machines.
- Telemetry of any kind.

## 6. Scenarios

- **New user:** installs → status bar `OC Go: add API key` → click → *Add API Key* asks for a name (`Personal`) and the key → key is validated → it becomes active and the quota appears immediately (the validation response is the first snapshot).
- **Upgrading user (≤ 0.1.4, cookie setup):** on first activation legacy data is deleted and a one-time message explains that an API key is now required, with an *Add API Key* action. Status bar shows the setup state.
- **Several subscriptions:** adds `Team 1` → info message `Saved 'Team 1'.` with action `Monitor Team 1` → or later uses *Select API Key* → quota refreshes immediately; status bar shows `OC Go · Team 1 · Rolling: 42% · 2h 13m`.
- **Key revoked or mistyped:** status bar `OC Go: invalid key`; one notification naming the profile with actions *Select API Key* / *Replace API Key*; automatic polling for that key stops until fixed.
- **5-hour window exhausted:** status bar `OC Go Rolling: limit · 2h 13m`; tooltip `Limit reached — resets in 2h 13m`. Not shown as an error.
- **Housekeeping:** renames a key, replaces a key's value, removes a key (with confirmation, history warning and "now monitoring X" feedback), or removes all keys.
- **Multiple VS Code windows:** profiles and active selection are shared; a switch in one window applies to the others on their next refresh.

## 7. Functional requirements

### FR1 — Profiles (named API keys)

**Data model**
- Profile record `{ id, name, createdAt }` in `globalState` (`opencodeGoQuota.profiles`), plus `opencodeGoQuota.activeProfileId`. The profile list is the authoritative index of secrets (SecretStorage cannot enumerate keys).
- Each key lives only in `SecretStorage` under `opencodeGoQuota.apiKey.<id>`. `id` is a generated stable identifier; renaming never moves the secret.
- Nothing above is registered with `globalState.setKeysForSync`.

**Validation rules**
- Name: `trim()` + NFC; 1–40 code points; not whitespace-only; no control characters and none of `[ ] ( )`; unique comparing with `localeCompare(…, undefined, { sensitivity: 'accent' }) === 0` (`Team` and `team` collide). Input errors: `Name is required`, `Use 40 characters or fewer`, `Names can't contain [ ] ( ) or control characters`, `A key named '<name>' already exists`.
- Key: `trim()`; 1–512 characters; no whitespace or control characters inside. Input error: `This doesn't look like an API key`.
- Escape at any input step cancels silently.

**Commands** (titles without the duplicated `OpenCode Go:` prefix; `category` stays `OpenCode Go`)
- *Add API Key* — reuses command id `opencodeGoQuota.configure` so every existing entry point keeps working. Asks for name, then key (password input). Validates with one usage request (FR2 timeouts apply):
  - `200` → save; the response becomes the first snapshot (no second request).
  - `401`/`403` → `The key was rejected by OpenCode.` actions *Try again* / *Save anyway* / *Cancel*.
  - timeout, network, `5xx`, parse error → `Couldn't verify the key (<reason>).` actions *Save anyway* / *Cancel*.
  - First profile becomes active automatically. Later profiles: non-blocking info `Saved '<name>'.` with action `Monitor <name>`.
- *Select API Key* — quick pick of profiles, active one marked `$(check)`, description `…last4` (see §9). With zero profiles it opens *Add API Key*. Selecting activates the profile and refreshes immediately.
- *Rename API Key* — pick profile, enter new name (same rules). Secret and history are untouched.
- *Replace API Key* — pick profile, enter new key, validate as in *Add*; keeps id, name and history.
- *Remove API Key* — pick profile; modal `Remove '<name>' and its stored history? This can't be undone.` [Remove] [Cancel]. Deletes secret and history. If it was active: next profile in list becomes active and info `Removed '<name>'. Now monitoring '<other>'.`; if none remain, state becomes setup.
- *Remove All API Keys* — replaces *Clear credentials* (same command id `opencodeGoQuota.clearCredentials`). Modal `Remove all <n> API keys and their history?` [Remove all] [Cancel]. Deletes every profile, secret and history. With zero profiles it does nothing.

**Legacy data removal (on activation, idempotent)**
- Delete secrets `opencodeGoQuota.authCookie`, `opencodeGoQuota.workspaceId`, `opencodeGoQuota.cookieTimestamp` and the `globalState` key `opencodeGoQuota.fetcherStrategy`.
- If at least one legacy secret existed and `opencodeGoQuota.migrationNoticeShown` is not set: show `OpenCode Go Monitor now uses API keys. Cookie setup is no longer supported — add your Go API key to continue.` with action *Add API Key*, then set the flag.
- This routine is the only place in the codebase that still names legacy keys; it is listed for deletion in the first release after 1.x where no supported upgrade path comes from ≤ 0.1.4.

### FR2 — Fetching

**Request**
- `GET https://opencode.ai/zen/go/v1/usage` (hard-coded `https://` constant, no configurable base URL).
- Headers: `Authorization: Bearer <key>`, `Accept: application/json`, `User-Agent: opencode-go-monitor/<version>`.
- `redirect: 'error'` — any 3xx is an unexpected response; the `Authorization` header is never forwarded.
- `AbortSignal.timeout(15_000)`; a timeout is a network error `Request timed out`.

**Profile binding and concurrency**
- The fetcher depends on an `ActiveKeyProvider` port (`getActive(): Promise<{ id, name, key } | null>`), never on UI or `globalState` directly.
- Each fetch captures the active profile id at start; `QuotaSnapshot` carries `profileId`. If the active profile changed when the response arrives, the result is discarded (not stored, not rendered).
- Selecting, adding, replacing or removing the active profile bumps a fetch generation so the follow-up refresh is never skipped by the in-flight guard, and resets backoff (failure count, last failure time, last failure state).
- Every code path releases the in-flight guard (success, error, timeout).

**Mapping** (per window `rolling`, `weekly`, `monthly`)
- `status: "ok"` → `ok`. `status: "rate-limited"` → `limit-reached` with `usagePercent = 100`. Any other status string → `unknown` (value logged, truncated to 32 chars).
- `usagePercent` ← `Number(percent)`; non-finite → window `unknown`; clamped to `[0, 100]`, raw value logged when out of range.
- `resetsInSeconds` ← `max(0, round((Date.parse(resetsAt) − now) / 1000))`; missing/unparseable `resetsAt` → `0`, status unchanged; past → `0`.
- 1–2 invalid windows → snapshot returned with those windows `unknown`. All three invalid, missing `usage`, or non-JSON body → `ParseError`.

**Errors and polling**

| Condition | Domain error | State | Polling |
|---|---|---|---|
| No active profile | `CredentialsError` | setup | stops until a key is added |
| `401` / `403` | `AuthError { profileId, profileName, httpStatus }` | auth | stops for that profile (scheduled and window-focus) until select/replace/manual *Refresh*; one notification per failure episode |
| `429`, `503` | `NetworkError(status)` | error | honor `Retry-After` (seconds or HTTP-date) else existing backoff; never < 60 s |
| Other non-2xx, timeout, offline | `NetworkError` | error | existing backoff (60 s → 30 min) |
| 3xx, bad JSON, schema mismatch | `ParseError` | error | existing backoff; message `Unexpected response from OpenCode — the extension may need an update.` |

- Manual *Refresh*, *Select API Key* and window-focus refetch share one 10 s debounce.
- Minimum poll interval stays 60 s.
- Both the poll loop and the *Refresh* command route `AuthError` and `CredentialsError` to the auth/setup states; all messages are translated and name the profile, never the key.
- `extension.ts` is the single owner of backoff.

### FR3 — UI

| State | Status bar text | Tooltip | Single click |
|---|---|---|---|
| setup | `OC Go: add API key` | `No OpenCode Go API key configured. Click to add one.` | *Add API Key* |
| active, 1 profile | `OC Go Rolling: 42% · 2h 13m` (unchanged format) | windows + footer `Key: <name> \| Updated 12:04` | *Refresh* |
| active, ≥ 2 profiles | `OC Go · <name≤12…> · Rolling: 42% · 2h 13m` | same + `Switch API key` command link | *Refresh* |
| limit reached (displayed window) | `OC Go Rolling: limit · 2h 13m` | `Limit reached — resets in 2h 13m` on that window line | *Refresh* |
| auth | `OC Go: invalid key` | `API key '<name>' was rejected (401/403). Click to choose another key.` | *Select API Key* |
| error | `OC Go: error` (unchanged) | error reason | *Refresh* |

- Colors unchanged: computed from the maximum percent across windows, so a limit-reached window uses the error-threshold color; distinction comes from the text. Unknown windows render `?%` without reset time.
- Double click keeps opening *Show Details*. The details quick pick adds `Switch API key (<name>)` and replaces "Reconfigure credentials"/"Logout" with *Add API Key* / *Remove All API Keys*.
- The tooltip `Workspace` and `Source` lines are removed.
- *Open Dashboard* opens `https://opencode.ai/console`.
- All new strings exist in EN and ES (`i18n.ts`, `package.nls.json`, `package.nls.es.json`).

### FR4 — History per profile
- Stored under `opencodeGoQuota.history.<profileId>`; predictions use only the active profile's history.
- Upgrade: the legacy key `opencodeGoQuota.history` is moved to the first profile's key when that profile is created, then deleted. Until then it is left untouched. No prompt.
- Stored entries keep only the fields the domain still uses; a legacy `source` field on old entries is ignored on read and not written again.
- *Export History* exports the active profile as `{ profile: <name>, entries: [...] }`; with zero entries shows the existing "no data" message.
- Removing a profile deletes its history.

### FR5 — Removal of obsolete code and data

Everything below is deleted, not deprecated. After this change, a repository-wide search for `cookie`, `workspaceId`, `scraping`, `ScrapingFetcher`, `x-org-id`, `console/api/go/status`, `fetcherStrategy` and `statusBarSource` returns matches only inside the FR1 legacy-removal routine, its tests, the CHANGELOG and this PRD.

| Area | Delete |
|---|---|
| Fetchers | `src/fetchers/ScrapingFetcher.ts`; the console-status implementation in `ApiFetcher.ts` (replaced by the zen usage fetcher); `src/fetchers/FetcherSelector.ts` and its dead backoff (`recordFailure`, `recordSuccess`, `getBackoffDelay`, `BACKOFF_STAGES`) — the fetcher is used directly behind the `QuotaFetcher` interface. `FetchFn` moves to `src/fetchers/types.ts`. |
| Storage | `src/storage/credentials.ts` (cookie/workspace storage, `maskCookie`, cookie timestamp) — replaced by `src/storage/profiles.ts`; strategy cache in `history.ts` (`getCachedStrategy`, `setCachedStrategy`, `CachedStrategy` type). |
| Domain | `source` field and `'api' \| 'scraping'` union from `QuotaSnapshot`. |
| UI | `StatusBarManager.setWorkspaceId` and workspace/source tooltip lines (replaced by `setProfileName`); details items "Reconfigure credentials" and "Logout". |
| Commands | Workspace-ID capture in `openDashboard.ts` and `extension.ts`; cookie prompts in `configure.ts`. |
| i18n / manifest | `promptWorkspaceId`, `promptAuthCookie`, `statusBarWorkspace`, `statusBarSource`, auth-expired wording and any other key without a remaining caller (EN, ES, `package.nls*.json`); `wrk_`/cookie placeholders. |
| Logging | HTML-length/snippet debug logs and cookie-length logs. |
| Tests / fixtures | `test/ScrapingFetcher.test.ts`, `test/FetcherSelector.test.ts`, `test/credentials.test.ts` (replaced by profile tests), `test/fixtures/dashboard.html`, `test/fixtures/go-status.json`; cookie/workspace cases in remaining tests. |
| Docs | Cookie/DevTools/workspace-ID setup sections in both READMEs; the `0.1.5` CHANGELOG section (folded into `1.0.0`). |
| Dependencies / build | Any dependency, script or `.vscodeignore` entry that only served the removed code (verify; none expected). |

Domain additions in the same change: `QuotaWindow.status` becomes `'ok' | 'limit-reached' | 'error' | 'unknown'`; `QuotaSnapshot` gains `profileId`; `AuthError` is added to `src/domain/errors.ts`; `src/storage/profiles.ts` exposes `ProfileStore` (on `MementoLike` + `SecretStorageLike`) and implements `ActiveKeyProvider`.

### FR6 — Documentation
- Root and extension READMEs: API-key setup, managing several keys, where the key is found in the OpenCode console.
- CHANGELOG `## [1.0.0]`: breaking setup change, named keys, endpoint switch, removed features.

## 8. Migration and compatibility
- **Breaking setup change:** cookie configurations cannot be converted to an API key; upgrading users run *Add API Key* once (one-time notice, FR1).
- Settings (`pollIntervalSeconds`, thresholds, `displayWindow`, `debug`) are unchanged.
- Existing history is preserved and attached to the first profile (FR4).
- Multiple VS Code windows share profiles and the active selection; each window picks up a change on its next refresh.

## 9. Security and privacy
- Keys live only in `SecretStorage`. They never appear in `globalState`, settings, logs, errors, notifications, history or exports.
- The last 4 characters of a key may appear **only** in the *Select/Rename/Replace/Remove* quick picks, read from SecretStorage on demand and never persisted. Keys shorter than 12 characters show `…` only. Debug logs show key length only (`[n chars]`).
- Profile names are treated as potentially sensitive (team or client names): shown in UI and in user-initiated exports, never in debug logs. Names are markdown-escaped before insertion into the trusted tooltip; the forbidden characters in FR1 prevent command-link injection.
- No `setKeysForSync`; no telemetry; the only outbound host is `opencode.ai`.
- `redirect: 'error'` and a hard-coded HTTPS URL prevent sending the key elsewhere.
- Debug logs record only key names of `usage` and each window, computed percents, and unrecognized status values (truncated) — never the raw body or headers.

## 10. Acceptance criteria
*One refresh* = a single invocation of the fetch routine in `extension.ts`.

1. **Mapping:** given the fixture `zen-usage.json`, the snapshot has rolling `limit-reached`/100, weekly `ok`/42, monthly `ok`/21, and `resetsInSeconds` equal to `resetsAt − now` under fake timers.
2. **Limit reached:** a `rate-limited` window yields `status === 'limit-reached'`, `usagePercent === 100`; the status bar state is `active` (not `error`) and its text contains the localized `limit` label.
3. **Request shape:** the request uses the constant URL, `Authorization: Bearer <key>`, `Accept`, `User-Agent` matching `^opencode-go-monitor/\d+\.\d+\.\d+$`, `redirect: 'error'`, and an abort signal.
4. **Invalid key:** a `401` ends the same refresh in state `auth`, shows exactly one notification naming the profile with actions *Select API Key* / *Replace API Key*, and no scheduled poll fires afterwards until the profile changes or *Refresh* runs.
5. **Timeout:** a fetch that never resolves fails after 15 s with `Request timed out`, the in-flight guard is released, and the next scheduled poll runs.
6. **Retry-After:** a `429` with `Retry-After: 120` delays the next poll by ≥ 120 s.
7. **Partial / malformed:** a response missing `weekly` returns weekly `unknown` and valid others; a response missing `usage` or with non-JSON body raises `ParseError` and shows the "unexpected response" message.
8. **Profiles:** add/rename/replace/remove/remove-all behave as FR1, including duplicate names differing only by case, 40 vs 41 code points, emoji names, forbidden characters, and removing the last profile (→ setup).
9. **Switching:** *Select API Key* triggers a refresh even while a fetch is in flight; the in-flight result for the old profile is discarded; the new snapshot is appended only to the new profile's history; backoff is reset.
10. **History migration:** seeding `opencodeGoQuota.history` with N entries (including ones with `source: 'scraping'`) and adding the first profile results in N entries under `opencodeGoQuota.history.<id>` and no legacy key.
11. **Legacy removal:** after activation with legacy secrets, none remain, `fetcherStrategy` is gone, the notice was shown once, and a second activation shows nothing.
12. **No leakage:** a unit test capturing debug output, notifications and an exported history file during add + fetch + 401 + export asserts that no substring of length ≥ 4 of the synthetic key appears, except the last-4 description in quick picks.
13. **No obsolete code:** the FR5 repository search returns matches only in the allowed locations; `tsc --noEmit` passes with no unused exports reported by a one-off check (e.g. `npx ts-prune` or equivalent, not added as a dependency).
14. **Build:** `npx vitest run`, `npx tsc --noEmit`, `npm run build`, and VSIX packaging succeed.
15. **Manual:** with the VSIX installed and a real key, the status bar shows live quota; with a second profile, switching works; with a deliberately wrong key, the invalid-key state appears.

## 11. Test plan
- Follow existing seams: `SecretStorageLike`, `MementoLike`, `WindowLike` fakes and injectable `fetchFn`; `vi.useFakeTimers()` for time.
- New fixture `test/fixtures/zen-usage.json` with the §3 shape and synthetic values.
- Unit, test-first: fetcher (request shape, mapping, ranges, partial windows, errors, timeout, redirect, Retry-After), `ProfileStore` (validation rules, CRUD, active fallback, secrets keyed by id, legacy removal, no sync registration), commands (add/select/rename/replace/remove/remove-all, validation outcomes), polling (profile binding, generation, backoff reset, auth stop, debounce), history migration and export, status bar states and strings, leakage test (AC12).
- Manual per AC15.

## 12. Delivery plan
Each step is one work-unit commit that builds and passes tests on its own.

| Step | Content |
|---|---|
| T2a | Domain changes (`AuthError`, `limit-reached`, `profileId`, drop `source`), `ActiveKeyProvider` port, zen usage fetcher with timeout/redirect/mapping; delete `ScrapingFetcher`, console-status code and `FetcherSelector` — wired through a temporary single-key adapter |
| T2b | `ProfileStore`, profile commands, legacy removal + notice, polling binding/generation/backoff reset/auth stop/Retry-After/debounce; delete `credentials.ts` and the temporary adapter |
| T2c | Per-profile history, migration, export; delete strategy cache |
| T2d | Status bar/tooltip/details states and strings, i18n EN/ES with obsolete keys deleted, open dashboard, READMEs, CHANGELOG 1.0.0, version bump; FR5 search clean |
| T2e | VSIX build and manual verification |

Merge to `master`, tagging and publishing remain manual decisions. The interim commits on this branch (`d205f5e`, `17190a6`) stay in history; the PR description explains they are superseded.

## 13. Decisions taken during review
1. *Configure* is retitled *Add API Key* on the same command id; *Clear credentials* becomes *Remove All API Keys* with confirmation.
2. A new key becomes active automatically only if it is the first; otherwise a non-blocking `Monitor <name>` action is offered.
3. Limit-reached reuses the error-threshold color and is distinguished by text (`limit`), not a new color.
4. *Replace API Key* is added so an invalid key can be fixed without losing its name and history.
5. Percent is clamped to `[0, 100]` for display and storage.
6. Last-4 masking is allowed only in key-management quick picks, read on demand.
7. All cookie/scraping/workspace code, strings, tests, fixtures and storage keys are deleted rather than deprecated (FR5); only the idempotent legacy-removal routine remains.

## 14. Out-of-scope follow-ups
- Monitoring several keys at once (e.g. multi-row tooltip).
- A setting to hide the profile name from the status bar.
- Deleting the FR1 legacy-removal routine in a later release.
