# Changelog

## [0.1.5] - 2026-10-11

### Fixed
- Quota data could no longer be read after OpenCode moved the Go usage page to a client-rendered console (`https://opencode.ai/console/<workspace-id>/go`). Usage is now fetched from the console status API (`GET https://opencode.ai/console/api/go/status`) using the `auth` cookie and the workspace ID as `x-org-id`; the 5-hour, weekly and monthly meters map to the rolling, weekly and monthly windows.

### Changed
- "Open Dashboard" now opens `https://opencode.ai/console/<workspace-id>/go`.
- Credential prompts now point to the console URL (`/console/wrk_...`) for the workspace ID and to the `opencode.ai` cookies for the auth cookie.

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
