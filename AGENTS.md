# Agent Skills — opencode-go-monitor

This file registers project-specific skills for AI agents working in this repository.

## Project-Level Skills

| Skill | Description | Path |
|-------|-------------|------|
| `opencode-go-monitor-release` | Release workflow for the VSCode extension — GitFlow branching, version bump, release notes format, VSIX packaging | [SKILL.md](skills/opencode-go-monitor-release/SKILL.md) |

## How to Use

When an AI agent is asked to prepare a release, bump the version, write release notes, or package the `.vsix` for this repo, it MUST load the `opencode-go-monitor-release` skill before proceeding.
