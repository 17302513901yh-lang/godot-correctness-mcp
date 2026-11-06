# godot-correctness-mcp

**Offline static correctness MCP server for Godot 4.x GDScript projects**

![License: CC-BY-NC-ND-4.0](https://img.shields.io/badge/license-CC--BY--NC--ND--4.0-green)
![Version](https://img.shields.io/badge/version-0.1.2-blue)

---

A Model Context Protocol server (and `gdcorrect` CLI) that statically checks the
correctness of Godot 4.x GDScript projects. It runs **headless, offline, and in
CI** — it never launches the editor, never needs a running Godot instance, and
never touches the network at runtime.

## Three pillars

1. **GDScript linting** — anti-pattern detection via a committed tree-sitter
   grammar (WASM). Rules like `delta-misuse`, `get-node-in-process`,
   `missing-onready`, `untyped-declaration`, `await-misuse`, `stringly-nodepath`,
   `connect-without-disconnect`, `float-grid-equality`, plus the
   `removed-api-usage` check against the Godot version your project declares. See [docs/lint.md](docs/lint.md).
2. **Cross-version API lookup & diff** — query classes/methods/properties/signals
   and diff the API between Godot **4.4** and **4.5**, from committed offline
   symbol databases. See [docs/symbol-db.md](docs/symbol-db.md).
3. **Scene / resource / registry analysis** — validate `.tscn`, `.tres`, and
   `project.godot`, including deep validation of data-driven `.tres` registries
   (the dangling-path check). See [docs/scenes.md](docs/scenes.md).

## Non-goals

- **No live bridge.** It does not connect to a running editor or game.
- **No editor plugin.** Nothing to install inside Godot.
- **No C#.** GDScript only.
- **Nothing older than Godot 4.4.** Symbol data is pinned to 4.4 and 4.5.

This is deliberately the complement to the live-session Godot MCP tools: it is the
one you run in CI and headless pipelines.

## Installation

As an MCP server (Claude Desktop / Cursor `mcpServers` config):

```json
{
  "mcpServers": {
    "godot-correctness": {
      "command": "npx",
      "args": ["-y", "@tmhs/godot-correctness-mcp"]
    }
  }
}
```

As a CLI:

```bash
npx -y -p @tmhs/godot-correctness-mcp gdcorrect lint . --format json
```

## MCP surface

**Tools:** `server_info`; `api_symbol_lookup`, `api_class_summary`, `api_diff`;
`lint_file`, `lint_project`, `list_rules`; `validate_scenes`, `validate_project_config`,
`validate_registries`, `project_report`. The lint, validate, and report tools take an
optional `baseline` file (the one `gdcorrect --write-baseline` writes) to return only new
findings; `list_rules` (and `gdcorrect rules`) lists every rule id with its default and
per-project severity.

**Resources:** curated GDScript skill snippets under `skill://` (data-driven
resources, signal hygiene, typed GDScript, preload vs load).

## CLI and CI

`gdcorrect <command> <projectPath> [options]`, where `<command>` is
`lint`, `validate-scenes`, `validate-project`, `validate-registries`, or `report`
(`gdcorrect --help` lists them all).

| Option | Meaning |
|--------|---------|
| `-f`, `--format json\|pretty\|sarif` | Output format (default `json`). `sarif` emits SARIF 2.1.0 for GitHub code scanning. |
| `--fail-on error\|warning\|info\|none` | Lowest severity that fails the run (default `error`). |
| `--baseline <file>` / `--write-baseline <file>` | Report only new findings / record the current ones (see below). |
| `--files a.gd,b.gd` / `--changed-since <git-ref>` | `lint` only: check just these files, or files changed since a ref (plus uncommitted and untracked ones). Handy for pre-commit hooks and PR CI. |
| `-h`, `--help` / `-v`, `--version` | Help / package version. |

Options also accept `--flag=value`. Unknown options, missing values, and extra
arguments are rejected. Exit codes: **0** no findings at or above `--fail-on`,
**1** otherwise, **2** on a usage, config, or tool error.

```yaml
# .github/workflows/godot-correctness.yml
jobs:
  correctness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Lint GDScript (fails on error-severity findings)
        run: npx -y -p @tmhs/godot-correctness-mcp gdcorrect lint . --format json
      - name: Validate registries
        run: npx -y -p @tmhs/godot-correctness-mcp gdcorrect validate-registries . --format json
```

**Adopting the gate on an existing project:** record today's findings once and
fail only on new ones.

```bash
gdcorrect report . --write-baseline gdcorrect-baseline.json   # commit this file
gdcorrect report . --baseline gdcorrect-baseline.json         # in CI
```

Findings are matched by rule, file, and the text of the flagged line, so edits
that only shift lines keep matching. Fixed findings show up as stale entries;
rewrite the baseline to drop them.

To show findings as pull-request annotations, upload SARIF to code scanning
(run from the repository root so paths line up):

```yaml
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: gdcorrect (SARIF)
        run: npx -y -p @tmhs/godot-correctness-mcp gdcorrect report . --format sarif > gdcorrect.sarif
        continue-on-error: true   # let the upload step run; code scanning gates the PR
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: gdcorrect.sarif }
```

## Configuration

Place `godot-correctness.config.json` at your project root (see
[`godot-correctness.config.example.json`](godot-correctness.config.example.json)):
enable/disable rules, override severities, set include/exclude globs, and declare
`registryDirs` / `pathPropertyPatterns` for registry validation. Full reference in
[docs/lint.md](docs/lint.md#configuration) and [docs/scenes.md](docs/scenes.md#configuration).

## Symbol database regeneration

The API pillar reads committed gzipped symbol DBs generated locally from pinned
Godot binaries (CI validates them but never runs Godot). Regeneration procedure:
[docs/symbol-db.md](docs/symbol-db.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md) and [BACKLOG.md](BACKLOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

CC-BY-NC-ND-4.0 -- see [LICENSE](LICENSE) for details. The bundled tree-sitter-gdscript
grammar and Godot API data are MIT-licensed upstream material; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

**Built by TMHSDigital**
