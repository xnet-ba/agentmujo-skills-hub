# Plugin — AgentMujo Skills Hub OpenCode Plugin

## Path

`~/.config/opencode/plugins/agentmujo-skills/` (or enable via `pluginPath` in opencode config).

## Manifest

The plugin requires a `plugin.json` at its root with at minimum:

```json
{
  "name": "agentmujo-skills",
  "version": "0.1.0",
  "description": "AgentMujo Skills Hub — skills registry, install, search, and scoring",
  "author": "AgentMujo",
  "risk": "medium"
}
```

## Tools (section 10 of hub.md)

The plugin exposes 6 tools via the OpenCode tool runtime. All tools now use the real core engine (`scripts/lib/core`) so that installs persist `SKILL.md` into the user's `~/.config/opencode/skills` directory and write `health_checks` rows.

| Tool                     | CLI                               | Effect                                                                                                                                                                                   |
| ------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill_search <filters>` | `agentmujo-skills search <query>` | FTS5-aware search with category/tag/risk/verified filters; returns install_status per result                                                                                             |
| `skill_info <id>`        | `agentmujo-skills info <id>`      | Full skill record + resolved content (body + frontmatter) from part-files or id‑shape fallback                                                                                           |
| `skill_install <id>`     | `agentmujo-skills install <id>`   | Policy‑gated install: checks `maxRisk`, `minimumScore`, `minimumStars`, `verifiedOnly`. On success writes `SKILL.md`, `.mujo.json`, and registers the skill in the `installations` table |
| `skill_update <id>`      | `agentmujo-skills update <id>`    | Re‑validates content, recalculates score/status, updates `meta_json` with `last_validated` and `security_scan` metadata; emits a `health_checks` row                                     |
| `skill_remove <id>`      | `agentmujo-skills remove <id>`    | Calls core `uninstallSkill`: removes the installation directory, clears `installed_at` from `meta_json`, deletes the `installations` row                                                 |
| `skill_refresh <id>`     | `agentmujo-skills refresh <id>`   | Resets validation status and triggers a full re‑sync (same logic as `skill_update`)                                                                                                      |

## Configuration

Tools read `~/.config/opencode/skill-hub/config.json` (nested `registry.*` keys are flattened automatically). Key fields:

- `autoInstall` (boolean, default `true`) — allow auto‑install without manual approval
- `maxRisk` (`"low" | "medium" | "high"`, default `"medium"`) — risk threshold; `high` skills require manual approval unless `autoInstall` is `true` and `maxRisk` is `"high"`
- `minimumScore` (number, default `75`) — minimum quality score for a skill to be considered for auto‑install
- `minimumStars` (number, default `0`) — minimum stars a skill must have
- `verifiedOnly` (boolean, default `false`) — only show/install verified skills
- `refreshInterval` (`"6h" | "12h" | "24h" | "7d"`, default `"24h"`) — scheduled refresh period

## Policy gating (§12)

- Skills with `risk_level = "high"` and `maxRisk !== "high"` → `manualApproval: true` returned to the caller; the OpenCode session must present a confirmation prompt before proceeding.
- Skills with `risk_level = "medium"` and `maxRisk = "low"` → blocked.
- Skills with `status !== "active"` and `status !== "unverified"` → install rejected with reason `"skill status '${status}' does not allow install"`.
- Skills below `minimumScore` or `minimumStars` → rejected.

## CLI integration

The `agentmujo-skills` CLI (section 40) shares the same core engine. Commands:

```
agentmujo-skills search <query>
agentmujo-skills install <id>
agentmujo-skills update <id>
agentmujo-skills remove <id>
agentmujo-skills refresh <id>
agentmujo-skills list
agentmujo-skills info <id>
agentmujo-skills refresh [--force] [--repo=owner/repo]
```

## Development

- Add new tools by extending `plugin/tools/opencode-tools.ts` — the file must import `openRegistry`, `resolveSkill`, `getSkillContent`, `installSkill`, `uninstallSkill`, and `checkInstallPolicy` from `../apps/skills-hub/scripts/lib/core.ts`.
- All status/score changes emit a row into `health_checks` (check_type, status, details, checksum, run_at).
- Use the shared `lib/scoring.js` for `securityScan` and `calculateScore` to keep behaviour consistent between CLI, plugin, and web UI.

## Versioning

The plugin declares `compat_version` in `registry_meta` (currently `0.1.0`). When the schema or API changes, bump `schema_version` in `registry_meta` and emit a migration (see `migrateRegistry` in `scripts/lib/core.ts`).
