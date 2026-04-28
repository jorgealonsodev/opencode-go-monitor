# OpenCode Go Quota Monitor

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/your-org/opencode-go-quota)

Real-time OpenCode Go quota monitoring in your VSCode status bar.

## Features

- **Status bar with real-time quota percentage** — See your current OpenCode Go usage at a glance, right in your VSCode status bar
- **Color-coded thresholds** — Visual feedback with green (normal), yellow (warning), and red (error) colors based on configurable usage thresholds
- **Historical tracking and exhaustion prediction** — Tracks usage over time and predicts when you might exhaust your quota using linear regression
- **Dual backend (API + scraping with auto-fallback)** — Automatically detects and uses the official API when available, falling back to HTML scraping for maximum compatibility

## Screenshots

> **Note:** Screenshots will be added after initial testing. The extension displays:
> - Status bar item: `$(graph) OC Go: 42% · 4h 12m`
> - QuickPick detail view with rolling, weekly, and monthly windows
> - Historical data with trend prediction

## Setup

### Installation

1. Download the `.vsix` file from the [releases page](https://github.com/your-org/opencode-go-quota/releases)
2. Open VSCode
3. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
4. Click the `...` menu (More Actions) and select **Install from VSIX...**
5. Select the downloaded `.vsix` file

### Obtaining Credentials

You need two pieces of information from your OpenCode account: `workspaceId` and `authCookie`.

#### Getting your `authCookie`:

1. Log in to [console.opencode.ai](https://console.opencode.ai) in your browser
2. Open DevTools (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`)
3. Go to the **Application** tab (Chrome/Edge) or **Storage** tab (Firefox)
4. In the left sidebar, expand **Cookies** and select `https://console.opencode.ai`
5. Find the session cookie (usually named `session`, `auth`, or similar)
6. Copy the **Value** field — this is your `authCookie`

#### Getting your `workspaceId`:

1. While logged in to [console.opencode.ai](https://console.opencode.ai), navigate to the Go section
2. Look at the URL in your browser's address bar
3. The URL path will be: `/workspace/{workspaceId}/go`
4. Copy the `{workspaceId}` part — this is your `workspaceId`

#### Configuring the Extension:

1. Open VSCode Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type and select: **OpenCode Go: Configure Credentials**
3. Enter your `workspaceId`
4. Enter your `authCookie` (input is masked for security)
5. The extension will immediately start monitoring your quota

## Configuration

All settings are available under `OpenCode Go Quota Monitor` in VSCode settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `opencodeGoQuota.workspaceId` | `string` | `""` | Your OpenCode workspace ID |
| `opencodeGoQuota.pollIntervalSeconds` | `number` | `300` | How often to poll for quota updates (minimum: 60s) |
| `opencodeGoQuota.warningThreshold` | `number` | `80` | Usage percentage to trigger warning color (yellow) |
| `opencodeGoQuota.errorThreshold` | `number` | `95` | Usage percentage to trigger error color (red) |
| `opencodeGoQuota.fetcherStrategy` | `string` | `"auto"` | Data fetcher strategy: `auto`, `api`, or `scraping` |
| `opencodeGoQuota.debug` | `boolean` | `false` | Enable debug logging to the Output panel |

## Commands

All commands are available from the VSCode Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| **OpenCode Go: Configure Credentials** | Set or update your workspace ID and auth cookie |
| **OpenCode Go: Refresh Quota** | Force an immediate quota fetch and status bar update |
| **OpenCode Go: Show Details** | Open QuickPick with detailed quota breakdown and prediction |
| **OpenCode Go: Export History** | Export all historical quota data to a JSON file |
| **OpenCode Go: Open Dashboard** | Open the OpenCode console dashboard in your browser |
| **OpenCode Go: Clear Credentials** | Remove all stored credentials and reset to initial state |

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
├── storage/       # Credentials (SecretStorage) and history (globalState)
├── fetchers/      # ApiFetcher, ScrapingFetcher, and FetcherSelector
├── ui/            # StatusBarItem and QuickPick UI components
├── commands/      # All 6 VSCode commands
└── extension.ts   # Extension entry point (activation, polling, lifecycle)
```

## License

MIT
