# Changelog

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
