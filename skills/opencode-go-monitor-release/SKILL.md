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

### 1. GitFlow Release Branching (MANDATORY)

Releases **MUST** follow GitFlow. Never cut a release directly from `develop`.

| Step | Action | Target Branch |
|------|--------|---------------|
| 1 | Create `release/x.y.z` from `develop` | `release/x.y.z` |
| 2 | Bump version on release branch | `release/x.y.z` |
| 3 | Prepare changelog / release notes | `release/x.y.z` |
| 4 | Merge release branch into `master` | `master` |
| 5 | Create annotated tag `vx.y.z` on `master` | `master` |
| 6 | Push `master` + tag | `master` |
| 7 | Merge `master` back into `develop` | `develop` |

**Rules:**
- NEVER create a tag directly on `develop`
- NEVER push a release commit to `master` without going through a release branch
- ALWAYS merge back into `develop` to keep histories aligned

### 2. CI Branch Validation (GitFlow)

Continuous Integration **MUST** run on all long-lived and release-related branches. Do not assume CI is only for `master`.

| Branch Pattern | CI Required | Notes |
|----------------|-------------|-------|
| `develop`      | Yes         | Main integration branch |
| `master`       | Yes         | Production / stable branch |
| `release/**`   | Yes         | Release candidate branches |
| `hotfix/**`    | Yes         | Emergency fix branches |

**Pull Request Validation:**
- PRs **MUST** target `develop` or `master`
- CI must pass before merging any PR

**Rules:**
- NEVER disable CI for `develop`, `release/*`, or `hotfix/*`
- ALWAYS ensure PR validation runs against both `develop` and `master`
- This is part of the standard GitFlow process for this repo

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
# 1. Ensure develop is up to date
git checkout develop
git pull origin develop

# 2. Create release branch
git checkout -b release/x.y.z

# 3. Bump version in opencode-go-monitor/package.json
# 4. Update README.md badge if needed
# 5. Prepare release notes in assets/RELEASE-NOTES-TEMPLATE.md or draft

git add -A
git commit -m "chore(release): prepare vx.y.z"

# 6. Merge to master
git checkout master
git pull origin master
git merge --no-ff release/x.y.z -m "chore(release): merge vx.y.z into master"

# 7. Tag
git tag -a vx.y.z -m "Release vx.y.z"

# 8. Push master + tag
git push origin master
git push origin vx.y.z

# 9. Merge back to develop
git checkout develop
git pull origin develop
git merge --no-ff master -m "chore(release): merge master back into develop"
git push origin develop
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
