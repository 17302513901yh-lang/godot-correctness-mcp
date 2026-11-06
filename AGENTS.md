<!-- standards-version: 1.10.0 -->

# AGENTS.md

This file tells AI coding agents how the godot-correctness-mcp repo works and how to contribute correctly.

## Repository overview

This is an MCP server (plus the `gdcorrect` CLI) for offline static correctness checks on Godot 4.x GDScript projects. It contains:

- **`src/index.ts`** -- MCP server entry (stdio transport only) and `server_info`
- **`src/cli.ts`** -- the `gdcorrect` CLI (same analyzers, CI-friendly exit codes)
- **`src/tools/`** -- MCP tool registration (`api.ts`, `lint.ts`, `scenes.ts`) and the shared result helpers (`result.ts`)
- **`src/lint/`** -- GDScript lint engine, config loading, project linting, and the rules in `src/lint/rules/`
- **`src/gdscript/`** -- tree-sitter GDScript parser and AST helpers
- **`src/scenes/`** -- static .tscn / project.godot / .tres registry validation and `project_report`
- **`src/godot/`** -- tolerant parser for Godot text formats
- **`src/symbols/`** -- Godot API symbol DB loading, lookup, and cross-version diff
- **`src/project/`** -- shared project file walker
- **`src/resources/`** -- `skill://` MCP resources (content in `skills/`)
- **`data/`** -- committed artifacts: per-version symbol DBs and the GDScript grammar WASM
- **`scripts/`** -- symbol DB generation/validation and `mcp-tools.json` generation
- **`package.json`** -- npm package manifest (version source of truth)
- **`mcp-tools.json`** -- generated list of the MCP tools this server exposes
- **`docs/`** -- documentation and GitHub Pages site
- **`CHANGELOG.md`** -- release history

## Branching and commit model

- **Single branch**: `main` only. No develop/release branches. Maintainers commit directly to `main`; outside contributors open a pull request from a fork (see CONTRIBUTING.md).
- **Conventional commits** are required. Use them to decide the version bump (`npm version <patch|minor|major> --no-git-tag-version`); `release.yml` tags and publishes that version when it lands on `main`, and CI never writes to `main`:
  - `feat:` or `feat(scope):` -- bump the **minor** version
  - `feat!:` or a `BREAKING CHANGE` trailer -- bump the **major** version
  - everything else (`fix:`, `chore:`, `docs:`, etc.) -- bump the **patch** version
- Commit messages should be concise and describe the "why", not the "what".

## CI/CD workflows

### `ci.yml` (runs on PR and push to main)

Builds, typechecks, and runs the test suite on Node 22 and 24, on Ubuntu and Windows:
- TypeScript build (`npm run build`)
- Typecheck of `src/`, `scripts/`, and `test/` (`npm run typecheck`)
- ESLint with typescript-eslint, including type-aware async checks in `src/` (`npm run lint`)
- Committed symbol DB validation (`npm run validate:artifacts`)
- Test suite (`npm test`, vitest, offline)

### `release.yml` (runs after CI passes on main)

Triggered by a successful CI run for a push to `main` (or manually). It checks out the exact commit CI tested, reads the version from `package.json` and, if there is no matching tag yet, pushes the `v<version>` tag (plus the floating `vMAJOR` and `vMAJOR.MINOR` tags), creates a GitHub Release, and dispatches `publish.yml`. It only pushes tags and never writes to `main`.

### `publish.yml` (runs on workflow_dispatch)

Publishes the package to npm via trusted publishing (OIDC, no token), after running the same build, typecheck, artifact validation and test gates as CI. It only runs from `main` or a published release. A release created by `release.yml` uses `GITHUB_TOKEN`, which cannot trigger other workflows, so `release.yml` dispatches `publish.yml` explicitly.

### `drift-check.yml`

Checks this repo against the ecosystem standards for drift.

### `pages.yml` (deploys docs/ to GitHub Pages)

Builds and deploys the documentation site on push to main.

### `stale.yml`

Marks issues/PRs as stale after 30 days of inactivity.

### `label-sync.yml`

Keeps repository labels in sync.

## Version management

- The **source of truth** for the current version is `package.json`.
- Bump it with `npm version <patch|minor|major> --no-git-tag-version` (keeps the lockfile in sync) and update the README badge, following conventional-commit intent.
- When the bump reaches `main`, `release.yml` tags that version and publishes it. CI never writes to `main`.

## Code conventions

- No hardcoded credentials -- CI scans for password/token/api_key patterns.
- Conventional commits; bump the version deliberately (CI tags and publishes it).
- `mcp-tools.json` is generated: run `npm run generate:tools` after changing a tool. `test/tools.test.ts` fails when it drifts from the registered tools.

## Adding content

### New lint rule

1. Add `src/lint/rules/<rule-id>.ts` exporting a `Rule` (`id`, `description`, `defaultSeverity`, `check`)
2. Add it to `DEFAULT_RULES` in `src/lint/rules/index.ts`
3. Add a fixture in `test/fixtures/gd/` and assertions in `test/lint.test.ts` (positive and near-miss negative cases)
4. Document it in `docs/lint.md`; use the `feat:` commit prefix

### New scene / project / registry check

1. Add the check to the relevant function in `src/scenes/validate.ts`
2. Extend `test/fixtures/scene-project/` and `test/scenes.test.ts`
3. Document the rule id in `docs/scenes.md`; use the `feat:` commit prefix

### New tool

1. Register the tool with `server.registerTool` in `src/tools/`, returning results through `ok` / `fail` / `guard` from `src/tools/result.ts`
2. Run `npm run generate:tools` to refresh `mcp-tools.json`
3. Add vitest tests (see `test/tools.test.ts`)
4. Use the `feat:` commit prefix

## License

CC-BY-NC-ND-4.0. All contributions fall under this license.
