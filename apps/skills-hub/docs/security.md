# Security — AgentMujo Skills Hub

## Security scanning (hub.md §18)

The `securityScan` function (shared in `scripts/lib/scoring.ts`) analyses raw `SKILL.md` content for dangerous patterns. Patterns are categorised by priority:

| Priority   | Pattern                                                                                                                   | Example                                       | Score Delta |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| 3 (HIGH)   | `curl … \| … sh`, `wget … \| … sh`, `rm -rf /`, `rm -rf ~/`, SSH key references, credential/API keys, `mkfs`/`dd`/`fdisk` | `curl https://example.com/install.sh \| bash` | 20          |
| 2 (MEDIUM) | `chmod 777`, `.env` access, password references, `chown -R`                                                               | `chmod 777 .`                                 | 10          |
| 1 (LOW)    | `sudo` usage                                                                                                              | `sudo apt-get install`                        | 3           |

The scan returns `{risk, issues, scoreDelta, securityScore}` where `risk` is `"high" | "medium" | "low"`.

## Install policy (hub.md §12)

Auto‑install is gated by the following checks (implemented in `checkInstallPolicy`):

1. **Status check** — skill must be `active` or `unverified`.
2. **Score threshold** — `score >= minimumScore` (configurable, default 75).
3. **Stars threshold** — `stars >= minimumStars` (configurable, default 0).
4. **Verified only** — if `verifiedOnly` is `true`, `verified` must be `1`.
5. **Risk level** —
   - `risk_level = "high"` and `maxRisk !== "high"` → manual approval required.
   - `risk_level = "medium"` and `maxRisk = "low"` → blocked.

The policy is enforced by the CLI (`agentmujo-skills install`), the OpenCode plugin tools (`skill_install`), and the web server (`POST /api/install/:id`).

## Content security on install

When a skill is installed, the core engine (`installSkill`) writes the `SKILL.md` content to `~/.config/opencode/skills/<name>/SKILL.md` and records the content’s sha256 hash as `installed_commit` in the `installations` table. On subsequent installs/updates, the hash can be compared to detect if the skill’s content has changed (enabling “updated” status).

## Security‑related config

| Config key     | Default    | Description                                            |
| -------------- | ---------- | ------------------------------------------------------ |
| `maxRisk`      | `"medium"` | Risk threshold for auto‑install                        |
| `minimumScore` | `75`       | Minimum quality score for consideration                |
| `minimumStars` | `0`        | Minimum stars for consideration                        |
| `verifiedOnly` | `false`    | If `true`, only verified skills may be installed       |
| `autoInstall`  | `true`     | If `false`, all installs require explicit confirmation |

## Reporting security issues

If a skill’s content contains dangerous patterns that should be blocked, maintainers can:

1. Add the pattern to the `SECURITY_PATTERNS` array in `scripts/lib/scoring.ts`.
2. Re‑run `validate-skills.ts` or `agentmujo-skills refresh` to update all affected skills.
3. Affected skills will receive `status="invalid"` and `risk_level="high"` (if the pattern is priority‑3).

## For plugin developers

- Use `securityScan(content)` from `./lib/scoring.js` before presenting any skill content to users.
- Respect the `maxRisk`/`minimumScore`/`verifiedOnly` config when calling `skill_install`.
- Emit a `health_checks` row with `check_type="security"` after any security scan.
