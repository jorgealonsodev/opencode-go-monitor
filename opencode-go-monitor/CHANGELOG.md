# Changelog

## [1.0.0] - 2026-10-11

### Breaking
- Authentication now uses OpenCode Go API keys. Cookie and workspace ID setups are no longer supported and cannot be converted. After upgrading, run **Add API Key** once (a one-time notice offers it); old cookie-era credentials and the cached fetch strategy are deleted on first start.

### Added
- Named API keys: store several keys (for example one per team or subscription) and choose which one is monitored. Commands: *Add API Key* (same command id as the former *Configure*), *Select API Key*, *Rename API Key*, *Replace API Key*, *Remove API Key* and *Remove All API Keys* (same command id as the former *Clear Credentials*, now with confirmation).
- New keys are validated with one usage request; a successful response becomes the first snapshot.
- Quota history per key; the pre-1.0 history is moved to the first key you add, and *Export History* exports the monitored key as `{ profile, entries }`.
- Limit-reached state: an exhausted window shows `OC Go Rolling: limit · 2h 13m` and `Limit reached — resets in …` in the tooltip instead of an error.
- Status bar states for a missing key (`OC Go: add API key`) and a rejected key (`OC Go: invalid key`); single click adds or selects a key in those states.
- With two or more keys the status bar shows the key name, and the tooltip shows `Key: <name>` plus a *Switch API key* link. The details QuickPick adds *Switch API key*, *Add API Key* and *Remove All API Keys*.

### Changed
- Quota is read from `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>` and an `opencode-go-monitor/<version>` user agent.
- *Open Dashboard* opens `https://opencode.ai/console`.
- The error tooltip shows the failure reason; unexpected responses show "Unexpected response from OpenCode — the extension may need an update."
- Windows that cannot be read show `?%` instead of failing the whole refresh.

### Fixed
- Quota could not be read after OpenCode moved the Go usage page to a client-rendered console, and console session cookies expired or were revoked on logout (HTTP 401).
- Requests time out after 15 s, honor `Retry-After` on 429/503 (never less than 60 s), and refuse redirects so the key is never forwarded.
- A rejected key stops automatic polling until another key is selected, the key is replaced, or *Refresh* runs; one notification per failure episode.
- Manual *Refresh*, *Select API Key* and window-focus refetches share a 10 s debounce; results for a key that is no longer active are discarded.
- Re-running an interrupted history migration no longer duplicates entries.

### Removed
- Cookie and workspace ID authentication, the HTML scraping fetcher, the console status API client and the fetch strategy selector, with their prompts, strings, settings documentation and tests.
- Workspace and data source lines from the status bar tooltip; *Reconfigure credentials* and *Logout* from the details QuickPick.

## [0.1.4] - 2026-09-01

### Fixed
- Scraping parser failed with `ParseError` after opencode.ai changed the Go page payload: `usagePercent` can now be fractional and is followed by new `usage`/`limit` fields. The parser no longer requires an integer percent or a trailing closing brace.

## [0.1.3] - 2026-07-09

### Added
- Status bar hover tooltip now shows the active workspace in the footer, alongside the data source and last-updated time

### Fixed
- Aligned status bar color unit tests with the foreground-color behavior introduced in 0.1.2 (they still asserted the old `backgroundColor` theme ids)

## [0.1.2] - 2026-05-02

### Fixed
- Status bar alert colors now work reliably across all VS Code themes. Switched from `backgroundColor` (inconsistent across themes) to foreground `color` with direct hex values (#f14c4c for error/auth expired, #cca700 for warning), matching the approach used by similar working extensions
- Alert color now reflects the worst case among all three quota windows (rolling, weekly, monthly) instead of only the selected display window

### Changed
- Switched from GitFlow to master + worktrees workflow. Master is now the only long-lived branch; features use branches or worktrees
- Updated CI to Node.js 20 and added `--no-dependencies` to vsce package to fix undici ReferenceError on Node 18

### Documentation
- Updated extension README with stable GitHub screenshot URL to fix vsce path rewriting in subfolder repos

## [0.1.1] - 2026-04-29

### Changed
- Renamed the extension package and folder from `opencode-go-quota` to `opencode-go-monitor`
- Aligned Marketplace-facing metadata and README content with current scraping-only behavior
- Optimized the extension icon and corrected screenshot handling in the packaged README

### Fixed
- Restored status bar warning/error background colors using the correct VS Code `backgroundColor` API
- Improved status bar polling behavior after failures, including auth-state handling during backoff
- Stabilized credential reads with in-memory caching and fixed refresh error handling

## [0.1.0] - 2026-04-28

### Added
- Status bar item showing real-time OpenCode Go quota usage
- Color-coded thresholds (warning at 80%, error at 95%)
- ScrapingFetcher with SolidJS SSR hydration parsing
- ApiFetcher (behind feature flag, ready for official API)
- Auto-detection with fallback between API and scraping
- Historical tracking in globalState (30-day retention, 10k max)
- Exhaustion prediction via linear regression
- QuickPick detail view with all quota windows
- Commands: configure, refresh, show details, export history, open dashboard, clear credentials
- Exponential backoff on fetch failures
- Sleep/resume detection with force-fetch on wake
- 122 unit tests
