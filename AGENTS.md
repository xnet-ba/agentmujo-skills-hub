# Dashboard

This is a fresh workspace — no project initialized yet. A full-stack Dashboard project will be built here.

## State

- **Not a git repo** — `git init` needed before first commit
- **No package manager configured** — npm is available globally (v10.9.2)
- **No source files** — all existing files are test artifacts from setup verification

## Global Dev Tools (available system-wide)

- Node.js 22.13.0 / npm 10.9.2
- Python 3.12.8
- Git 2.45.2

## MCP Servers (configured in `~/.config/opencode/opencode.jsonc`)

| Server     | Access                                          |
| ---------- | ----------------------------------------------- |
| Filesystem | Scoped to `C:\Users\Admin\Documents\Dashboard`  |
| Playwright | `--browser chromium --headless`                 |
| GitHub     | Uses stored PAT — can create repos, issues, PRs |
| Memory     | Knowledge graph persistence                     |
| Context7   | Remote MCP endpoint                             |

## Skills (19 installed globally in `~/.config/opencode/skills/`)

`git-commit`, `git-release`, `git-pr`, `code-review`, `test-guide`, `lint-fix`, `api-docs`, `changelog`, `readme-gen`, `env-setup`, `debug-log`, `perf-audit`, `security-scan`, `dependency-update`, `arch-decision`, `error-handler`, `monorepo`, `css-styling`, `shell-script`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
