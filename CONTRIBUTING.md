# Contributing to godot-correctness-mcp

Thank you for your interest in contributing.

## Getting Started

1. Fork the repository
2. Create a branch in your fork
3. Make your changes following the conventions below
4. Open a pull request against `main`

Maintainers commit directly to `main`; outside contributions always come in as pull requests.

### Local setup

```bash
npm ci
npm run build
npm run typecheck
npm test
```

## Conventions

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` -- new feature, lint rule, check, or tool
- `fix:` -- bug fix
- `docs:` -- documentation changes
- `chore:` -- maintenance, dependency updates
- `refactor:` -- code restructuring

### Lint rules

- Add `src/lint/rules/<rule-id>.ts` and register it in `src/lint/rules/index.ts`
- Add a fixture under `test/fixtures/gd/` with positive and near-miss negative cases
- Document it in `docs/lint.md`

### Scene, project, and registry checks

- Add the check in `src/scenes/validate.ts`, a fixture under `test/fixtures/scene-project/`, and the rule id in `docs/scenes.md`

### Tools

- Register the tool with `server.registerTool` in `src/tools/`
- Run `npm run generate:tools` to refresh `mcp-tools.json` (a test fails if it is stale)
- Add vitest tests

Maintainers bump the version in `package.json` (`npm version <patch|minor|major> --no-git-tag-version`); CI tags and publishes it when it lands on `main`.

## Pull Request Process

1. Ensure CI passes (it runs `npm run build`, `npm run typecheck`, `npm run validate:artifacts`, and `npm test` on Ubuntu and Windows)
2. Update `CHANGELOG.md` if the change is user-facing
3. Use a descriptive PR title following conventional commit format

## Inbound license grant and DCO

This project's outbound license is CC-BY-NC-ND-4.0. Contributions are accepted inbound under a broader grant via the Developer Certificate of Origin (DCO). Both pieces are required because CC-BY-NC-ND-4.0 alone cannot cleanly accept third-party derivatives.

### Required grant

By submitting a contribution to this repository, you certify that you have the right to do so under the Developer Certificate of Origin (DCO) 1.1, and you grant TMHSDigital a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contribution under the project's current license (CC-BY-NC-ND-4.0) or any successor license chosen by the project.

### DCO sign-off

Every commit in a pull request must carry a `Signed-off-by:` trailer matching the commit author. Sign at commit time with the `-s` flag:

```bash
git commit -s -m "feat: add new tool"
```

This appends a line like `Signed-off-by: Jane Developer <jane@example.com>` to the commit message. The GitHub DCO App enforces this on every PR.

For the full inbound/outbound model and rationale, see [`standards/licensing.md`](https://github.com/TMHSDigital/Developer-Tools-Directory/blob/main/standards/licensing.md) in the Developer-Tools-Directory meta-repo.
