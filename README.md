# AgentMujo Skills Hub

Centralni katalog, registry i installer za **13,888 OpenCode skills** iz 25+ javnih izvora
(Awesome lists, organizacije i repozitoriji), s ocjenama kvalitete, sigurnosnom analizom i
instalacijom u jednu komandu.

| Sastavni dio                      | Put                                              |
| --------------------------------- | ------------------------------------------------ |
| Web katalog + REST API            | `apps/web/`                                      |
| SQLite registry (SQL)             | `apps/skills-hub/registry/schema.sql`            |
| Importer                          | `apps/skills-hub/scripts/import-skill-market.ts` |
| Core engine (dijeli CLI i plugin) | `apps/skills-hub/scripts/lib/core.ts`            |
| CLI                               | `apps/skills-hub/cli.ts`                         |
| GitHub sync                       | `apps/skills-hub/scripts/sync-github.ts`         |
| Provideri (sources)               | `apps/skills-hub/plugin/src/providers/`          |
| Testovi                           | `apps/skills-hub/tests/hub.test.ts`              |
| OpenCode plugin (runtime)         | `plugin/`                                        |

## Brzi početak

```bash
# Baza (stvara se automatski u ~/.config/opencode/skill-hub/registry.db)
npm run db:init            # ili: node apps/skills-hub/scripts/db-init.ts

# Import cijelog skill-marketa (13,888 skills)
node apps/skills-hub/scripts/import-skill-market.ts

# Web server + API na :4312
node apps/web/server.ts

# CLI
node apps/skills-hub/cli.ts search docker
node apps/skills-hub/cli.ts install "omni/webapp-frontend/api-designer"
node apps/skills-hub/cli.ts remove "omni/webapp-frontend/api-designer"
node apps/skills-hub/cli.ts list --installed
node apps/skills-hub/cli.ts info "ReasoningBank with AgentDB"

# Staticki export (dist/skills.json, 9.9 MB)
node apps/web/export-dist.ts

# Testovi
node --test apps/skills-hub/tests/hub.test.ts
```

## Web API

`GET  /api/search` — FTS5/MATCH + filteri (q, category, tag, minScore, maxRisk, status,
verified, minStars, sortBy, sortDir, limit, offset). Vraća `{total, rows, limit, offset}`.
`POST /api/install/:id` / `POST /api/uninstall/:id` — instaliraj / ukloni skill.
`GET  /api/skills/:id` — detalji + `install_status`. `GET /api/content/:id` — SKILL.md sadržaj.
`GET  /api/categories` · `/api/sources` · `/api/tags` · `/api/health`.

## Komponente

- **Registry**: SQLite + FTS5, `PRAGMA user_version` za migracije; `registry_meta`
  (schema/compat/registry version) — dodaj CILJ u `hub.md` §4.
- **Importer**: uklanja duplikate dodjeljivanjem ID sufiksa `#n`; računa score (quality +
  security + maintenance), rizik (naredbe, exfil, itd.), tagove i content hash.
- **Core engine**: `resolveSkill`, `getSkillContent` (lazy part-file putanja s id-fallback),
  `installSkill`/`uninstallSkill` s COW u `~/.config/opencode/skills/` i ograničenjem broja.
- **CLI**: search/install/update/remove/list/refresh/info nad istim engineom kao plugin.
- **Sync**: `sync-github.ts` (GitHub REST) + `GitHubSkillSource` provider za druge izvore.

## Konfiguracija

`apps/skills-hub/config/config.json` + `~/.config/opencode/skill-hub/config.json`
(za runtime). Ključevi: `maxRisk`, `minimumScore`, `minimumStars`, `verifiedOnly`,
`refreshInterval`, `maxInstalledSkills`, cache/installed/downloads dirs.

## Licenca

MIT — vidi [LICENSE](LICENSE).

## Plugin (OpenCode)

Instalirati putem opencode`-a ili ručno kopirati `plugin/`folder u`~/.config/opencode/plugins/`.
Početak:

```bash
agentmujo-skills skill_search "docker"
agentmujo-skills skill_install "docker-security"
agentmujo-skills skill_info "docker-security"
```

Policija automatskog instaliranja kontrolisana preko `~/.config/opencode/skill-hub/config.json`:

- `maxRisk` — granični nivo rizika (low/medium/high)
- `minimumScore` — minimalni bodovi kvalitete (default 75)
- `minimumStars` — minimalni broj zvjezdica (default 0)
- `verifiedOnly` — samo verifikovanih skills
- `autoInstall` — ako je false, svi install zahtevaju potvrdu

`skill_remove` brise SKILL.md directory i čisti installations tablicu.
`skill_refresh` ponovno validira sadržaj i recalcuira score/status.

## Dodavanje izvora

Novi GitHub/org/repository moze se dodati naredbom:

```bash
agentmujo-skills refresh --repo=owner/repo
```

Ili direktno u SQLite registry ili izmantrajući `sync-github.ts` skriptu.
Svaki izvor ima `priority` za dedup (manji broj = viši prioritet).

## Sustav ocjena (hub.md §16)

Svaki skill dobiva bodoviti score u opsegu 0–100 na temelju sljedećih komponenta:

- **Quality** (relevance, docs, license) — 30%
- **Popularity** (stars, activity) — 20%
- **Maintenance** (recency of last update) — 15%
- **Docs presence** — 10%
- **Activity** (repo commits/issue activity) — 10%
- **License** presence — 5%
- **Validation status** — 5%
- **Security scan** — 5% (nize score ako nađete nebezbedne naredbe)

Score se recalcuira naredbom `agentmujo-skills refresh` ili `node calculate-score.ts`.

## API statistika

`GET /api/stats` vraća:

```json
{ "total": 13888, "active": X, "stale": Y, "invalid": Z, "verified": V, "avgScore": S }
```
