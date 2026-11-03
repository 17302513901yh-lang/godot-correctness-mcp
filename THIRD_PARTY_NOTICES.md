# Third-party notices

This package ships the following third-party material in `data/`. Each item
keeps its upstream license; the project's own CC-BY-NC-ND-4.0 license does not
apply to it. npm dependencies (for example `web-tree-sitter`) carry their own
license files in their packages.

## tree-sitter-gdscript grammar (`data/tree-sitter-gdscript.wasm`)

- Upstream: <https://github.com/PrestonKnopp/tree-sitter-gdscript>
- What ships: the grammar compiled to WebAssembly, loaded at runtime by
  `web-tree-sitter`. No source changes.
- Committed artifact SHA-256:
  `74d345fc5d603be23491243563309fa71d3e41a5d3fce6cc1c18e2dafe562fff`
- Upstream version: not recorded when the artifact was first committed. Upstream
  publishes no prebuilt WASM, so it cannot be matched to a release by hash. When
  the grammar is next rebuilt (`npx tree-sitter build --wasm` in a checkout of
  the upstream repository), record the upstream tag/commit and the new SHA-256
  here.
- License: MIT

```
The MIT License (MIT)

Copyright (c) 2016 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Godot Engine API data (`data/godot-4.4.symbols.json.gz`, `data/godot-4.5.symbols.json.gz`)

- Upstream: <https://github.com/godotengine/godot>
- What ships: class, method, property, signal, enum, and constant metadata
  extracted with `godot --headless --dump-extension-api` from the pinned Godot
  4.4 and 4.5 releases and reduced by `scripts/generate-symbol-db.ts` (see
  [docs/symbol-db.md](docs/symbol-db.md)).
- Committed artifact SHA-256:
  - `godot-4.4.symbols.json.gz`: `9ef4f9fe58e294c144ef32f4936011266e61d386d1495761bd036a9fee21ff1f`
  - `godot-4.5.symbols.json.gz`: `fe6c136a4caddbec868c2e337cee48d9f02d912252206497a3bddc18323e02ee`
- License: MIT

```
Copyright (c) 2014-present Godot Engine contributors (see AUTHORS.md).
Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
