# GDScript linting

The lint pillar parses GDScript with a committed tree-sitter grammar WASM
(`data/tree-sitter-gdscript.wasm`, loaded via `web-tree-sitter`) and runs a
conservative ruleset. No Godot binary, editor, or network is required. It is
exposed both as MCP tools (`lint_file`, `lint_project`) and as a CI-first CLI
(`gdcorrect`).

## Default ruleset

| Rule ID | Default | What it flags |
|---------|---------|---------------|
| `delta-misuse` | error | `velocity` scaled by `delta` (either operand order) in a function that calls `move_and_slide()` (double-scales; `move_and_slide()` already applies frame timing). |
| `delta-misuse` | info | `position`/`rotation` mutated in `_process`/`_physics_process` with no `delta` factor (frame-rate dependent). Same rule id, softer sub-pattern. |
| `get-node-in-process` | warning | `$` / `get_node()` lookups inside `_process`/`_physics_process` (runs every frame). |
| `missing-onready` | warning | Class-level node-path member initialized without `@onready`. |
| `untyped-declaration` | warning | `var x = ...` with neither a type hint nor `:=` inference. |
| `await-misuse` | warning | `await` applied to a literal value. Conservative: literals only. |
| `stringly-nodepath` | info | String-literal node path passed to `get_node()`/`NodePath()`/etc. (rename-fragile). |
| `connect-without-disconnect` | info | `connect()` in `_ready()` with no `disconnect()` anywhere and no `CONNECT_ONE_SHOT`. |
| `float-grid-equality` | info | `==`/`!=` where an operand is a float literal or `Vector2/3/4(...)` (precision). |

Detection is deliberately conservative: for a CI gate, false positives are worse
than misses. Only `error`-severity findings fail the CLI (exit 1).

## Configuration

Place `godot-correctness.config.json` at the project root. All fields optional;
defaults apply when the file is absent. See
[`godot-correctness.config.example.json`](../godot-correctness.config.example.json).

```json
{
  "include": ["**/*.gd"],
  "exclude": ["**/.godot/**", "**/addons/**"],
  "rules": {
    "untyped-declaration": { "severity": "info" },
    "float-grid-equality": { "enabled": false }
  },
  "registryDirs": ["resources/registries"],
  "pathPropertyPatterns": ["*_path", "*_scene"]
}
```

- `include` / `exclude`: glob sets (picomatch). Defaults: include `**/*.gd`,
  exclude `**/.godot/**`.
- `rules.<id>.enabled`: set `false` to disable a rule.
- `rules.<id>.severity`: override to `error` / `warning` / `info`. A config
  override wins over a rule's per-finding severity.
- `rules.<id>.options`: per-rule options (reserved).
- `registryDirs`, `pathPropertyPatterns`: used by the Phase 4 registry validator.

## CLI

```bash
gdcorrect lint <projectPath> --format json    # primary, machine-readable
gdcorrect lint <projectPath> --format pretty  # human-readable
```

JSON output is a findings array (`file`, `line`, `col`, `ruleId`, `severity`,
`message`, `suggestion`) plus severity counts. Exit codes: **0** clean, **1** on
any error-severity finding, **2** on tool failure.

### GitHub Actions

```yaml
- run: npx -y -p @tmhs/godot-correctness-mcp gdcorrect lint . --format json
```

The step fails the job (exit 1) when any `error`-severity finding is present.
