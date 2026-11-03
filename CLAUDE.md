<!-- standards-version: 1.10.0 -->

# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project

godot-correctness-mcp -- Offline static correctness MCP server for Godot 4.x GDScript projects

**Version:** 0.1.1
**License:** CC-BY-NC-ND-4.0
**Author:** TMHSDigital

## Key paths

- Source: `src/` (TypeScript)
- Provider adapters: `src/providers/` (implement the `Provider` interface, wired into `ProviderManager`)
- Tools: `src/tools/`
- Package manifest: `package.json` (version source of truth)
- Tool list: `mcp-tools.json` (enumerates the MCP tools)
- Docs site: `docs/`
- CI workflows: `.github/workflows/`

## Conventions

- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- Work directly on `main` (no PRs or feature branches). Bump the version in `package.json` with `npm version <patch|minor|major> --no-git-tag-version` (keeps the lockfile in sync); `release.yml` tags the new version on push to main and `publish.yml` publishes it to npm via trusted publishing (OIDC, no token)
- Provider adapters live in `src/providers/` and implement the `Provider` interface, wired into `ProviderManager`; tools live in `src/tools/`
- Keep `mcp-tools.json` in sync with the registered tools

## Testing

```bash
npm run build
npm test
npm run typecheck
```
