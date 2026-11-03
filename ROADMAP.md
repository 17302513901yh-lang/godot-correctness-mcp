<!-- standards-version: 1.10.0 -->

# Roadmap

**Current:** see [CHANGELOG.md](CHANGELOG.md). Detailed designs for upcoming work live in [BACKLOG.md](BACKLOG.md) and the [issue tracker](https://github.com/TMHSDigital/godot-correctness-mcp/issues).

## godot-correctness-mcp

### v0.1.x -- Foundation (shipped)

- [x] stdio MCP server with `server_info` health tool
- [x] Pillar 1: GDScript linting via a committed tree-sitter grammar (8 rules, `lint_file`, `lint_project`)
- [x] Pillar 2: cross-version API lookup and diff for Godot 4.4 and 4.5 (`api_symbol_lookup`, `api_class_summary`, `api_diff`)
- [x] Pillar 3: scene / project / registry static analysis (`validate_scenes`, `validate_project_config`, `validate_registries`, `project_report`)
- [x] `gdcorrect` CLI with CI exit codes
- [x] `skill://` MCP resources
- [x] CI/CD workflows and npm trusted publishing
- [x] GitHub Pages site

### v0.2.0 -- Adoption and depth

- [ ] CI adoption: inline suppressions, SARIF output, baseline files
- [ ] `uid://` reference resolution
- [ ] Deeper scene checks: SubResource ids, node parents, `[connection]` targets
- [ ] Input action cross-check against `project.godot`
- [ ] `signal-callback-arity` lint rule (see BACKLOG.md)

### v1.0.0 -- Stable

- [ ] Removed/changed API lint rule driven by the symbol DB
- [ ] Node-path validation against owning scenes
- [ ] Stable, documented JSON output contract for tools and CLI
