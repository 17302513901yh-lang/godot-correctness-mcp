# Changelog

All notable changes to godot-correctness-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed

- The MCP server and `gdcorrect` now run when launched through npm's bin symlinks (Linux/macOS `npx` and global installs previously exited 0 without doing anything) (#31)
- README and docs CI snippets use `npx -y -p @tmhs/godot-correctness-mcp gdcorrect ...` so they run the CLI rather than the MCP server (#32)
- Parsed tree-sitter trees are freed after linting, so long-running servers no longer grow WASM memory; a failed grammar load can be retried (#38)
- `validate_scenes` checks `ExtResource` references in node `instance=` attributes and nested inside arrays/dictionaries (#37)
- Multi-line values report their first line; duplicate unquoted ext_resource ids are named in the message (#55)
- Tool failures return `isError: true`; nonexistent project roots fail clearly (#40)
- `lint_file` loads config from the project root (nearest ancestor with `godot-correctness.config.json` or `project.godot`) and reports project-relative paths, matching `lint_project` (#39)

### Changed

- Invalid config files report the file and the offending key; unknown top-level keys are rejected
- `lint_project` prunes excluded directories instead of walking them, and always skips `.git/` and `.godot/` (#41)
- Scene tool JSON includes `root`, matching the CLI output
- Tools are registered with `registerTool` and carry read-only annotations; version and kind enums derive from the pinned version list (#47)
- `@modelcontextprotocol/sdk` floor raised to `^1.32.2` (#42)
- Node.js 22 or newer is required (Node 20 is end-of-life); CI runs Node 22/24 on Ubuntu and Windows (#43, #44)
- `mcp-tools.json` is generated with `npm run generate:tools` and checked by a test (#48)

## [0.1.1] - 2026-11-03

### Changed

- Publish via npm trusted publishing (OIDC) from `publish.yml`; first publish validates the trusted publisher connection

## [0.1.0] - 2026-07-19

### Added

- stdio MCP server with the `server_info` health tool
- GDScript linting via a committed tree-sitter grammar: `lint_file` and `lint_project` with 8 rules (`delta-misuse`, `get-node-in-process`, `missing-onready`, `untyped-declaration`, `await-misuse`, `stringly-nodepath`, `connect-without-disconnect`, `float-grid-equality`) and `godot-correctness.config.json`
- Cross-version API tools for Godot 4.4 and 4.5 from committed symbol databases: `api_symbol_lookup`, `api_class_summary`, `api_diff`
- Scene, project, and registry analysis: `validate_scenes`, `validate_project_config`, `validate_registries`, `project_report`
- `gdcorrect` CLI (`lint`, `validate-scenes`, `validate-project`, `validate-registries`, `report`) with CI exit codes and `json`/`pretty` output
- `skill://` MCP resources with curated Godot 4.x guidance
- CI/CD workflows (ci, release, publish, drift-check, pages, stale, label-sync) and a GitHub Pages site
