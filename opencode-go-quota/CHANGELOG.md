# Changelog

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
