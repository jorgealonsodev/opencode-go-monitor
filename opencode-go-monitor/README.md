# OpenCode Go Monitor

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/jorgealonsodev/opencode-go-monitor)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Real-time OpenCode Go monitoring in your VS Code: status bar. Available in **English** and **Spanish**.

## Features

- **Status bar with real-time quota percentage** — See your current OpenCode Go usage at a glance, right in your VSCode status bar
- **Color-coded thresholds** — Visual feedback with green (normal), yellow (warning), and red (error) colors based on configurable usage thresholds
- **Progress bars on hover** — Hover over the status bar item to see detailed progress bars for rolling, weekly, and monthly usage
- **Selectable display window** — Choose which quota window to display: Rolling, Weekly, or Monthly
- **Historical tracking and exhaustion prediction** — Tracks usage over time and predicts when you might exhaust your quota using linear regression
- **API key authentication** — Reads your quota with an OpenCode Go API key; no browser session or DevTools needed
- **Several named API keys** — Store one key per team or subscription and switch the monitored key in two clicks
- **Bilingual (EN/ES)** — Automatically detects your VSCode language and displays all messages in English or Spanish

## Screenshots

![OpenCode Go Monitor Tooltip](https://raw.githubusercontent.com/jorgealonsodev/opencode-go-monitor/master/opencode-go-monitor/screenshots/tooltip.png)

*Hover over the status bar item to see detailed progress bars for all three quota windows (Rolling, Weekly, Monthly).*

### What you'll see:

- **Status bar**: Real-time usage percentage with reset countdown, prefixed with the key name when you have several keys
- **Hover tooltip**: Visual progress bars for all quota windows
- **Color coding**: Green (normal), Yellow (≥80%), Red (≥95%)
- **QuickPick details**: Full breakdown with exhaustion prediction
- **Bilingual interface**: Automatically adapts to your VSCode language (EN/ES)

## Setup

### Installation

1. Download the `.vsix` file from the [releases page](https://github.com/jorgealonsodev/opencode-go-monitor/releases)
2. Open VSCode
3. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
4. Click the `...` menu (More Actions) and select **Install from VSIX...**
5. Select the downloaded `.vsix` file
6. **Reload VSCode** (`Ctrl+Shift+P` → `Developer: Reload Window`)

### Getting an API key

1. Sign in to the [OpenCode console](https://opencode.ai/console) in your browser
2. Open the API keys section of the workspace that holds your Go subscription
3. Create a new key (or copy an existing one)

### Adding the key to the extension

1. Open the VSCode Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type and select: **OpenCode Go: Add API Key** (or click `OC Go: add API key` in the status bar)
3. Enter a name for the key (for example `Personal` or `Team 1`)
4. Paste the API key (input is masked for security)
5. The key is checked with OpenCode and the quota appears immediately

The first key you add becomes the monitored key. Later keys are saved and offered with a **Monitor** action.

> **Upgrading from 0.1.x**: browser-session setups (DevTools values and workspace ID) are no longer supported. Old credentials are removed on first start and you are asked to add an API key once. Your quota history is kept and attached to the first key you add.

## Configuration

All settings are available under `OpenCode Go Monitor` in VS Code: settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `opencodeGoQuota.pollIntervalSeconds` | `number` | `300` | How often to poll for quota updates (minimum: 60s) |
| `opencodeGoQuota.warningThreshold` | `number` | `80` | Usage percentage to trigger warning color (yellow) |
| `opencodeGoQuota.errorThreshold` | `number` | `95` | Usage percentage to trigger error color (red) |
| `opencodeGoQuota.displayWindow` | `string` | `"rolling"` | Which quota window to display: `rolling`, `weekly`, or `monthly` |
| `opencodeGoQuota.debug` | `boolean` | `false` | Enable debug logging to the Output panel |

> **Note**: API keys are stored only in VSCode's SecretStorage (OS keychain) and persist across all projects until you remove them. Key names and the selected key are shared by all VSCode windows; keys are never synced across machines.

## Commands

All commands are available from the VSCode Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| **OpenCode Go: Add API Key** | Name and store a new API key (validated with OpenCode) |
| **OpenCode Go: Select API Key** | Choose which stored key is monitored |
| **OpenCode Go: Rename API Key** | Rename a stored key (its history is kept) |
| **OpenCode Go: Replace API Key** | Paste a new value for a stored key, keeping its name and history |
| **OpenCode Go: Remove API Key** | Delete a stored key and its history |
| **OpenCode Go: Remove All API Keys** | Delete every stored key and all history |
| **OpenCode Go: Refresh Quota** | Force an immediate quota fetch and status bar update |
| **OpenCode Go: Show Details** | Open QuickPick with detailed quota breakdown and prediction |
| **OpenCode Go: Export History** | Export the monitored key's quota history to a JSON file |
| **OpenCode Go: Open Dashboard** | Open the OpenCode console dashboard in your browser |
| **OpenCode Go: Select Display Window** | Choose which quota window to display in the status bar |

## Status Bar

| State | Text | Single click |
|-------|------|--------------|
| No API key | `OC Go: add API key` | Add API Key |
| Active, one key | `OC Go Rolling: 42% · 2h 13m` | Refresh |
| Active, several keys | `OC Go · Team 1 · Rolling: 42% · 2h 13m` (names longer than 12 characters are shortened) | Refresh |
| Limit reached | `OC Go Rolling: limit · 2h 13m` | Refresh |
| Key rejected | `OC Go: invalid key` | Select API Key |
| Error | `OC Go: error` (hover for the reason) | Refresh |

- **Hover tooltip**: progress bars for all three windows (`Limit reached — resets in …` for an exhausted window, `?%` when a window could not be read), the monitored key name and last update time, and a **Switch API key** link when you have several keys
- **Colors**: Green (normal), Yellow (≥80%), Red (≥95%), based on the highest window
- **Double click**: opens the details QuickPick (breakdown, prediction, switch/add/remove keys)

When a key is rejected, automatic polling for it stops until you select another key, replace it, or run **Refresh Quota**.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Build production bundle
npm run build

# Package as .vsix
npm run package
```

### Project Structure

```
src/
├── domain/        # Core types, formatting, and prediction algorithms
├── storage/       # API key profiles (SecretStorage) and per-key history (globalState)
├── fetchers/      # UsageFetcher (OpenCode Go usage endpoint)
├── polling/       # QuotaPoller (schedule, backoff, Retry-After, debounce)
├── ui/            # StatusBarItem and QuickPick UI components
├── commands/      # VSCode command handlers
├── i18n.ts        # Internationalization (English/Spanish)
└── extension.ts   # Extension entry point (activation, polling, lifecycle)
```

## Troubleshooting

### `OC Go: invalid key` in status bar

OpenCode rejected the monitored key (it was revoked or mistyped). Click the status bar to select another key, or run **OpenCode Go: Replace API Key** to paste a new value.

### "Unexpected response from OpenCode"

The usage endpoint answered with data the extension does not understand. Check for an extension update; the extension retries with backoff in the meantime.

### Debug mode

Enable debug logging by setting `opencodeGoQuota.debug` to `true` in settings. View logs in `View → Output → OpenCode Go Quota`. Logs never contain API keys.

## License

MIT
