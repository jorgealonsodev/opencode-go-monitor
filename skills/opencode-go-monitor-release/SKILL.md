---
name: opencode-go-monitor-release
description: >
  Release workflow for the opencode-go-monitor VSCode extension.
  Trigger: When releasing, bumping version, preparing changelog, or cutting a new version of the extension.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Preparing a new release of the OpenCode Go Monitor VSCode extension
- Bumping the extension version in `package.json`
- Writing or reviewing release notes for a GitHub release
- Packaging the `.vsix` asset for distribution
- Any task that touches the release lifecycle of this repo

## Critical Patterns

### 1. Master + Worktrees Workflow (MANDATORY)

This repo uses a **simplified trunk-based workflow**: `master` is the only long-lived branch. Development happens in **feature branches** or **git worktrees** — never in a `develop` branch.

| Step | Action |
|------|--------|
| 1 | Work on a feature branch or in a worktree |
| 2 | Open PR to `master` |
| 3 | Merge PR to `master` (CI must pass) |
| 4 | To release: bump version on `master`, tag `vx.y.z`, push |

**Rules:**
- NEVER create a `develop` branch
- NEVER create release branches — tag directly on `master`
- ALWAYS use PRs to merge into `master`
- Use `git worktree` for parallel streams of work instead of long-lived branches

### 2. CI Branch Validation

Continuous Integration runs on:

| Branch Pattern | CI Required | Notes |
|----------------|-------------|-------|
| `master`       | Yes         | Main and only long-lived branch |
| `v*` tags      | Yes         | Release builds |
| PRs to `master`| Yes         | Must pass before merge |

**Rules:**
- NEVER disable CI for `master`
- ALL changes to `master` go through a PR with passing CI

### 3. Version Bump Location

Only `opencode-go-monitor/package.json` contains the extension version.

```json
{
  "version": "x.y.z"
}
```

Also update `README.md` version badge if present:
```markdown
<img src="https://img.shields.io/badge/version-x.y.z-blue" alt="Version">
```

### 4. Release Notes Format (STRICT — NO ICONS/EMOJIS)

- **NO icons or emojis anywhere in the release notes**
- Title: `vMAJOR.MINOR.PATCH - [Brief summary of main change]`
- Executive Summary: exactly 2 short lines
- Sections in this order:
  1. `Breaking Changes` (omit if none)
  2. `Features`
  3. `Bug Fixes`
  4. `Improvements`
- Each bullet should mention contributor/PR when available
- Standard assets note at the bottom
- Comparison link using exact URL pattern

See [assets/RELEASE-NOTES-TEMPLATE.md](assets/RELEASE-NOTES-TEMPLATE.md) for the full template.

### 5. VSIX Asset

The release workflow packages the extension automatically on tag push, but verify locally:

```bash
cd opencode-go-monitor
npm run build
npx vsce package --out opencode-go-monitor.vsix
```

The CI workflow (`.github/workflows/release.yml`) attaches the `.vsix` to the GitHub release. Ensure the release notes mention:

```
Binaries and SHA-256 checksums are attached below.
```

## Commands

### Start a release

```bash
# 1. Ensure master is up to date
git checkout master
git pull origin master

# 2. Bump version in opencode-go-monitor/package.json
# 3. Update README.md badge if needed
# 4. Prepare release notes in assets/RELEASE-NOTES-TEMPLATE.md or draft

git add -A
git commit -m "chore(release): prepare vx.y.z"

# 5. Tag
git tag -a vx.y.z -m "Release vx.y.z"

# 6. Push master + tag
git push origin master
git push origin vx.y.z
```

### Work on a feature (using worktrees)

```bash
# 1. Create a new worktree for the feature
git worktree add ../opencode-go-monitor-feature-name feature-branch-name
cd ../opencode-go-monitor-feature-name

# 2. Work, commit, push
git push -u origin feature-branch-name

# 3. Open PR to master via GitHub
# 4. After merge, clean up
cd ..
git worktree remove opencode-go-monitor-feature-name
git branch -d feature-branch-name
```

### Verify VSIX locally

```bash
cd opencode-go-monitor
npm ci
npm run build
npx vsce package --out opencode-go-monitor.vsix
ls -la opencode-go-monitor.vsix
```

## Resources

- **Templates**: See [assets/RELEASE-NOTES-TEMPLATE.md](assets/RELEASE-NOTES-TEMPLATE.md) for the copy-paste release notes template
- **CI/CD**: See `.github/workflows/release.yml` for the automated packaging workflow
- **Extension manifest**: `opencode-go-monitor/package.json` — single source of truth for version
