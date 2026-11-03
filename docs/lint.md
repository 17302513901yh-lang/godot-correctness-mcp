# GDScript linting

The lint pillar parses GDScript with a committed tree-sitter grammar WASM
(`data/tree-sitter-gdscript.wasm`, MIT, see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); loaded via `web-tree-sitter`) and runs a
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
| `removed-api-usage` | warning | **Opt-in** (set `targetVersion`). Engine API that was removed in the target Godot version, calls whose argument count becomes invalid, and overrides of engine virtuals that were removed or changed arity. See below. |

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

- `include` / `exclude`: glob sets (picomatch), relative to the project root.
  Defaults: include `**/*.gd`, exclude `**/.godot/**`. `addons/` **is linted by
  default**; add `"addons/**"` to `exclude` to skip third-party plugins.
  Excluded directories are not descended into, and `.git/` and `.godot/` are
  always skipped.
- `rules.<id>.enabled`: set `false` to disable a rule.
- `rules.<id>.severity`: override to `error` / `warning` / `info`. A config
  override wins over a rule's per-finding severity.
- `rules.<id>.options`: per-rule options (currently read by `removed-api-usage`).
- `registryDirs`, `pathPropertyPatterns`: used by the registry validator (see [scenes.md](scenes.md)).

Unknown top-level keys (for example a typo like `exlude`) are rejected with an
error naming the config file, rather than silently ignored. `$schema` and
`$comment` are allowed.

`lint_file` and `lint_project` use the same config: `lint_file` loads it from
the nearest ancestor directory that contains `godot-correctness.config.json` or
`project.godot`.

## Upgrading Godot: `removed-api-usage`

Enable it by naming the version you are moving to (the source version defaults
to the pinned version before it):

```json
{ "rules": { "removed-api-usage": { "options": { "targetVersion": "4.5" } } } }
```

Options: `targetVersion` (required to enable) and `fromVersion` (optional).
Using the committed symbol databases, it flags:

- members removed between the versions (methods, properties, signals,
  constants), accessed through receivers whose type is statically certain:
  bare or `self.` calls in a script that `extends` a built-in class,
  `ClassName.member`, and variables/parameters with an explicit built-in type;
- calls whose argument count was valid before and is invalid after (new
  optional parameters never trigger it);
- script methods overriding engine virtuals that were removed in the target or
  whose parameter count changed, which the engine would stop calling.

Members that moved to a parent class are not reported. Untyped receivers are
never guessed at; use `api_diff` for anything else.

## Inline suppressions

Silence a specific finding without disabling the rule project-wide:

```gdscript
var legacy = load_thing()  # gdcorrect-ignore[untyped-declaration]

# gdcorrect-ignore[get-node-in-process]
var hud := get_node("HUD")   # a comment-only directive applies to the next line

# gdcorrect-ignore-file[stringly-nodepath]   # whole file
```

- `# gdcorrect-ignore[rule-a, rule-b]` on a code line applies to that line; on a
  comment-only line it applies to the next line.
- Omit the brackets (`# gdcorrect-ignore`) to silence every rule on that line.
- `# gdcorrect-ignore-file[...]` applies to the whole file.
- A directive that silences nothing is reported as an `unused-suppression`
  `info` finding so stale comments get cleaned up. Configure it like any rule
  (`"rules": { "unused-suppression": { "enabled": false } }`).

## CLI

```bash
gdcorrect lint <projectPath> --format json    # primary, machine-readable
gdcorrect lint <projectPath> --format pretty  # human-readable
gdcorrect lint <projectPath> --format sarif   # SARIF 2.1.0 for code scanning
```

JSON output is a findings array (`file`, `line`, `col`, `ruleId`, `severity`,
`message`, `suggestion`) plus severity counts. Exit codes: **0** clean, **1** on
any error-severity finding, **2** on tool failure.

### GitHub Actions

```yaml
- run: npx -y -p @tmhs/godot-correctness-mcp gdcorrect lint . --format json
```

The step fails the job (exit 1) when any `error`-severity finding is present.
