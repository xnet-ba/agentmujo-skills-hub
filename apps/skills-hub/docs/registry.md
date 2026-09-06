# Registry — AgentMujo Skills Hub Registry Schema

## Overview (hub.md §4)

The registry is a SQLite database at `~/.config/opencode/skill-hub/registry.db` containing all skill metadata, categories, tags, health checks, and installation tracking. Schema version is tracked via `PRAGMA user_version` and `registry_meta`.

## File (`registry\schema.sql`)

- `registry_meta` — single‑row versioning table (`schema_version`, `compat_version`, `registry_version`, `created_at`).
- `skills` — primary skill record (id, name, description, repository, category, tags, stars, license, risk_level, status, verified, score, quality, security, maintenance, content_hash, meta_json, etc.).
- `categories` / `tags` / `skill_categories` / `skill_tags` — many‑to‑many linking tables.
- `health_checks` — history of validation/score/security runs per skill.
- `installations` — which skills are installed via the plugin (skill_id, install_path, version, status, installed_at, removed_at, installed_commit, updated_at, last_used).
- `skills_fts` — FTS5 virtual table for full‑text search, kept in sync via triggers.

## Migration (hub.md §28)

Schema v1 → v2 adds three columns to `installations`:

- `installed_commit` — sha256 of the installed SKILL.md (used for update detection)
- `updated_at` — timestamp of the last install/update
- `last_used` — timestamp of the last activation

The migration is automatic: `openRegistry()` in `scripts/lib/core.ts` calls `migrateRegistry(db)` which ALTERs the table if the columns are missing and bumps `user_version` to 2.

## API endpoints (web server, hub.md §4)

- `GET /api/skills` — list skills (supports `?category=`, `?repo=`, `?installed=true`, `?search=`, pagination)
- `GET /api/skills/:id` — single skill + install_status
- `POST /api/install/:id` / `POST /api/uninstall/:id` — install/uninstall with policy gating
- `GET /api/search` — FTS5 + LIKE fallback search with filters
- `GET /api/stats` — total/active/stale/invalid counts, top categories, verified ratio
- `GET /api/categories` → `{categories: [...]}` (12)
- `GET /api/sources` → `{sources: [...]}` (25)

## Search (hub.md §15)

- Primary: `skills_fts MATCH ?` with optional `category`, `minScore`, `maxRisk`, `limit` filters.
- Fallback: `LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?` when FTS5 is empty or unavailable.

## Health checks (hub.md §324)

Each `validate`, `score`, or `security` run inserts a row:

- `skill_id` — FK to `skills.id`
- `check_type` — `'validate' | 'score' | 'security'`
- `status` — `'ok' | 'warning' | 'failed'`
- `details` — free‑form description
- `checksum` — content sha256 hash (first 32 chars)
- `run_at` — ISO‑8601 timestamp

## Adding a new source

1. Add the source to the `sources` table (or via `sync-github.ts` which pulls from GitHub).
2. Ensure the source has a `priority` (lower = higher dedup priority).
3. Run `agentmujo-skills refresh --repo=owner/repo` to sync new skills.

## Running migrations

```bash
# CLI triggers migration on start (via openRegistry)
agentmujo-skills

# Or run the migration function manually:
node -e "
  const { openRegistry } = require('./apps/skills-hub/scripts/lib/core.ts');
  const db = openRegistry('~/.config/opencode/skill-hub/registry.db');
  db.close();
"
```
