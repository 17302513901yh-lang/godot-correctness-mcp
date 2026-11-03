# Scene, resource, and registry validation

The third pillar statically validates Godot text formats (`.tscn`, `.tres`,
`project.godot`) with a tolerant, dependency-free parser. No Godot binary,
editor, or network is required. Exposed as MCP tools and `gdcorrect` CLI
subcommands, all sharing the lint pillar's findings-array and exit-code contract
(0 clean, 1 on any error-severity finding, 2 tool failure).

## Checks

### validate_scenes (`gdcorrect validate-scenes`)
For every `.tscn` under the project root:

| Rule ID | Severity | Flags |
|---------|----------|-------|
| `scene-ext-resource-missing` | error | An `ext_resource` `path` that does not resolve to an existing file. |
| `scene-missing-ext-resource-id` | error | An `ExtResource("id")` reference whose id is not declared in the scene (in properties, nested arrays/dicts, or node `instance=` attributes). |
| `scene-duplicate-resource-id` | error | Two `ext_resource` declarations sharing an id. |
| `scene-missing-sub-resource-id` | error | A `SubResource("id")` reference whose id has no `[sub_resource]` declaration in the file. |
| `scene-node-parent-missing` | error | A `[node parent="..."]` path that names no node declared in the scene (paths under instanced sub-scenes are skipped). |
| `scene-connection-method-missing` | error | A `[connection]` whose target node's script has no such method. Checked only when the script directly `extends` a built-in class, so its own `func`s plus the engine class chain (from the symbol DB) are the complete method set. |

`res://` maps to the project root; `uid://`-only references are skipped (not
statically resolvable).

### validate_project_config (`gdcorrect validate-project`)
Reads `project.godot`:

| Rule ID | Severity | Flags |
|---------|----------|-------|
| `project-missing` | error | No `project.godot` at the given root. |
| `project-main-scene-missing` | error | `run/main_scene` points at a missing scene. |
| `project-autoload-missing` | error | An `[autoload]` entry points at a missing file (leading `*` handled). |
| `project-input-malformed` | warning | An `[input]` action that is not a well-formed dictionary. |
| `project-input-action-undefined` | warning | A string-literal action name passed to `Input.is_action_*`, `get_action_strength`, `get_axis`, or `get_vector` in a `.gd` file that is not defined in `[input]` (built-in `ui_*` actions are allowed; `InputMap.has_action` is ignored). |

### validate_registries (`gdcorrect validate-registries`) — the headline check
For each directory in `registryDirs`, every `.tres`:

| Rule ID | Severity | Flags |
|---------|----------|-------|
| `registry-parse-error` | error | File is not a valid Godot text resource (no `gd_resource` header). |
| `registry-script-missing` | error | The resource's script `ext_resource` does not resolve to an existing `.gd`. |
| `registry-dangling-path` | error | A string property that looks like a resource path points at a missing file. |

When a resource's script resolves and declares `class_name`, that name is
recorded per entry in the result. The dangling-path check is why this pillar
exists: these failures are invisible until a runtime scene load.

A value is treated as a resource path when it is a string that is `res://`-prefixed,
ends in `.tscn`/`.tres`/`.gd`/`.res`/`.scn`, or whose property name matches
`pathPropertyPatterns`.

### project_report (`gdcorrect report`)
Aggregates all of the above plus GDScript lint into one JSON report with
severity counts.

## Configuration

Added to `godot-correctness.config.json` (see [config reference](./lint.md#configuration)):

```json
{
  "registryDirs": ["resources/items", "resources/levels"],
  "pathPropertyPatterns": ["*_path", "*_scene", "*_texture", "*_resource"]
}
```

- `registryDirs`: project-relative directories of data-driven `.tres` registries
  to deep-validate. Empty by default (no registry validation until configured).
- `pathPropertyPatterns`: property-name globs whose string values are treated as
  resource paths. Defaults to `*_path`, `*_scene`, `*_texture`, `*_resource`.
