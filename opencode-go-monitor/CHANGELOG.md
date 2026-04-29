# Changelog

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
