# Tasks: OpenCode Go Quota VSCode Extension MVP

## Phase 1: Project Scaffolding

- [x] 1. Create package.json with VSCode extension manifest, dependencies, scripts
  - **Files**: package.json
  - **Dependencies**: None
  - **Acceptance criteria**:
    - Valid package.json with name "opencode-go-monitor"
    - activationEvents: "onStartupFinished"
    - Contributes: commands, configuration, statusBarItem
    - Dependencies: undici (Node 18+ built-in), cheerio
    - Scripts: compile, test, package

- [x] 2. Create tsconfig.json with strict mode
  - **Files**: tsconfig.json
  - **Dependencies**: 1
  - **Acceptance criteria**:
    - Strict mode enabled
    - OutDir pointing to dist/
    - Include src/, test/

- [x] 3. Create vitest config and test setup with mocked vscode module
  - **Files**: vitest.config.ts, test/setup.ts, test/mockvscode.ts
  - **Dependencies**: 2
  - **Acceptance criteria**:
    - vitest runs without errors
    - vscode module mocked correctly for unit tests

- [x] 4. Create .vscodeignore and esbuild build script
  - **Files**: .vscodeignore, build.mjs
  - **Dependencies**: 1
  - **Acceptance criteria**:
    - Build produces valid .vsix via vsce package

## Phase 2: Domain Layer

- [x] 5. Define domain types (QuotaWindow, QuotaSnapshot, QuotaFetcher interface)
  - **Files**: src/domain/types.ts
  - **Dependencies**: 1
  - **Acceptance criteria**:
    - QuotaWindow: { usagePercent: number, resetsInSeconds: number }
    - QuotaSnapshot: { timestamp, rolling, weekly, monthly, source }
    - QuotaFetcher interface with fetch() and isAvailable()

- [x] 6. Implement format utilities (human-readable time, percentage formatting)
  - **Files**: src/domain/format.ts
  - **Dependencies**: 5
  - **Acceptance criteria**:
    - formatTime(seconds): "42m", "4h 12m", "2d 4h"
    - formatPercent(value): "65%" with clamping 0-100

- [x] 7. Implement linear regression prediction algorithm
  - **Files**: src/domain/prediction.ts
  - **Dependencies**: 5
  - **Acceptance criteria**:
    - linearRegression(points[]): { slope, intercept, r2 }
    - predictExhaustion(snapshots[]): Date | null
    - Returns null if slope <= 0 or insufficient data

## Phase 3: Storage Layer

- [x] 8. Implement credentials storage (SecretStorage wrapper for authCookie, config for workspaceId)
  - **Files**: src/storage/credentials.ts
  - **Dependencies**: 5
  - **Acceptance criteria**:
    - saveCredentials(authCookie, workspaceId): void
    - getCredentials(): { authCookie, workspaceId } | null
    - clearCredentials(): void
    - authCookie in SecretStorage, workspaceId in workspace.getConfiguration

- [x] 9. Implement history storage (globalState wrapper with 30-day retention, 10k max)
  - **Files**: src/storage/history.ts
  - **Dependencies**: 5
  - **Acceptance criteria**:
    - append(snapshot): void
    - getAll(): QuotaSnapshot[]
    - getLast24h(): QuotaSnapshot[]
    - cleanup() called on init (removes >30 days, keeps 10k max)

## Phase 4: Fetchers

- [x] 10. Implement ScrapingFetcher (regex extraction from SolidJS SSR hydration)
  - **Files**: src/fetchers/ScrapingFetcher.ts
  - **Dependencies**: 5, 8
  - **Acceptance criteria**:
    - fetch(): Promise<QuotaSnapshot>
    - Parses console.opencode.ai HTML
    - Extracts monthlyUsage from SolidJS hydration script
    - Throws on parse failure

- [x] 11. Implement ApiFetcher (behind feature flag)
  - **Files**: src/fetchers/ApiFetcher.ts
  - **Dependencies**: 5, 8
  - **Acceptance criteria**:
    - fetch(): Promise<QuotaSnapshot>
    - Calls GET https://console.opencode.ai/zen/go/v1/usage
    - isAvailable(): returns true if API responds 200

- [x] 12. Implement FetcherSelector (auto-detection with 24h cache, exponential backoff)
  - **Files**: src/fetchers/FetcherSelector.ts
  - **Dependencies**: 10, 11
  - **Acceptance criteria**:
    - fetch(): uses ApiFetcher if available, else ScrapingFetcher
    - Caches availability decision for 24h
    - Exponential backoff: 1m → 5m → 15m → 30m (max 30m)
    - Handles errors gracefully, never throws unhandled

## Phase 5: UI

- [x] 13. Implement StatusBarItem manager (create, update, color thresholds, states)
  - **Files**: src/ui/statusBar.ts
  - **Dependencies**: 6, 12
  - **Acceptance criteria**:
    - create(): StatusBarItem with command
    - update(snapshot): updates text, color based on thresholds
    - setState(state): "setup" | "auth" | "error" | "loading" | "normal"
    - Color thresholds: 0-79% default, 80-94% warning, 95-100% error
    - Text format: "$(graph) OC Go: <pct>% · <reset>"

- [x] 14. Implement QuickPick builder (detail view, history, actions)
  - **Files**: src/ui/quickPick.ts
  - **Dependencies**: 6, 7, 9
  - **Acceptance criteria**:
    - showDetailQuickPick(snapshot, prediction): shows rolling/weekly/monthly
    - showHistoryQuickPick(history): shows last 7 days entries
    - Actions: "Open dashboard", "Force refresh", "Reconfigure", "Export history"

## Phase 6: Commands

- [x] 15. Implement configure command (input prompts, validation, save)
  - **Files**: src/commands/configure.ts
  - **Dependencies**: 8, 14
  - **Acceptance criteria**:
    - Prompts for workspaceId (text)
    - Prompts for authCookie (password input)
    - Validates non-empty
    - Saves via credentials storage
    - Shows inline help on how to obtain values

- [x] 16. Implement refresh command (force fetch)
  - **Files**: src/commands/refresh.ts
  - **Dependencies**: 12
  - **Acceptance criteria**:
    - Forces immediate fetch
    - Updates status bar
    - Shows notification on success/failure

- [x] 17. Implement showDetails command (open QuickPick)
  - **Files**: src/commands/showDetails.ts
  - **Dependencies**: 14
  - **Acceptance criteria**:
    - Opens QuickPick with snapshot details
    - Shows prediction if available

- [x] 18. Implement exportHistory command (write JSON to file)
  - **Files**: src/commands/exportHistory.ts
  - **Dependencies**: 9
  - **Acceptance criteria**:
    - Exports history to JSON file via vscode.dialog.showSaveDialog
    - Includes all snapshots with metadata

- [x] 19. Implement openDashboard command (open URL)
  - **Files**: src/commands/openDashboard.ts
  - **Dependencies**: None
  - **Acceptance criteria**:
    - Opens https://console.opencode.ai in browser

- [x] 20. Implement clearCredentials command
  - **Files**: src/commands/clearCredentials.ts
  - **Dependencies**: 8
  - **Acceptance criteria**:
    - Clears credentials from SecretStorage
    - Resets to setup state
    - Shows confirmation notification

## Phase 7: Integration

- [x] 21. Wire up extension.ts (activate: create all components, start polling)
  - **Files**: src/extension.ts
  - **Dependencies**: All previous
  - **Acceptance criteria**:
    - activate(): initializes statusBar, storage, starts polling timer
    - Polling interval: configurable (default 300s, min 60s)
    - Initial fetch on activation
    - All commands registered

- [x] 22. Wire up deactivate (dispose status bar, stop polling)
  - **Files**: src/extension.ts
  - **Dependencies**: 21
  - **Acceptance criteria**:
    - deactivate(): clears timer, disposes statusBarItem
    - No memory leaks on reload

- [x] 23. Implement sleep/resume detection and force-fetch on wake
  - **Files**: src/extension.ts
  - **Dependencies**: 21
  - **Acceptance criteria**:
    - On wake from sleep, if elapsed > 2× poll interval, force fetch
    - Uses onDidChangePowerState or equivalent

## Phase 8: Tests

- [x] 24. Unit tests for ScrapingFetcher with HTML fixtures
  - **Files**: test/ScrapingFetcher.test.ts, test/fixtures/dashboard.html
  - **Dependencies**: 10
  - **Acceptance criteria**:
    - Tests parse HTML fixtures correctly
    - Tests handle missing data gracefully

- [x] 25. Unit tests for prediction algorithm with synthetic data
  - **Files**: test/prediction.test.ts
  - **Dependencies**: 7
  - **Acceptance criteria**:
    - Tests linear regression with known data
    - Tests exhaustion prediction edge cases

- [x] 26. Unit tests for format utilities
  - **Files**: test/format.test.ts
  - **Dependencies**: 6
  - **Acceptance criteria**:
    - Tests formatTime for all time ranges
    - Tests formatPercent clamping

- [x] 27. Unit tests for FetcherSelector logic
  - **Files**: test/FetcherSelector.test.ts
  - **Dependencies**: 12
  - **Acceptance criteria**:
    - Tests fallback behavior
    - Tests backoff timing

## Build & Release

- [x] 28. Create README.md with screenshots and setup guide
  - **Dependencies**: All implementation complete
  - **Acceptance criteria**: Complete user guide

- [x] 29. Create CHANGELOG.md for v0.1.0
  - **Dependencies**: 28
  - **Acceptance criteria**: Initial release notes

- [x] 30. Build .vsix and verify local install
  - **Dependencies**: 28
  - **Acceptance criteria**: Extension installs and runs in VSCode

---

## Dependencies Graph

```
Phase 1 (1-4) → Phase 2 (5-7) → Phase 3 (8-9) → Phase 4 (10-12)
                                                          ↓
Phase 7 (21-23) ← Phase 6 (15-20) ← Phase 5 (13-14) ←───┘
                            ↓
                    Phase 8 (24-27)
                            ↓
                    Build (28-30)
```