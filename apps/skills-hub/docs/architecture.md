# Architecture — AgentMujo Skills Hub

## Overview

```
                     ┌────────────────────────────────────────────┐
                     │                 skill-market/              │
                     │   meta.js  +  part-<category>.js  (13,888) │
                     └───────────────┬────────────────────────────┘
                                     │ import
                                     ▼
  ┌──────────────┐   GitHub REST    ┌─────────────────────┐   part files (lazy)
  │ sync-github  │ ────────────────►│   SQLite registry   │◄──────────────────────┐
  │              │                  │   (skills, sources, │                       │
  │ providers/   │                  │   fts, installations)│                      │
  │ GitHubSkill  │─────────────────►│                     │                       │
  └──────────────┘   upsert         └────▲───────────▲───┬┘                       │
                                         │           │   │                        │
                     Core engine         │ read      │   │ COW install            │
                     (scripts/lib/       │           │   ▼                        │
                      core.ts)  ─────────┴────────── └► ~/.config/opencode/       │
                       │                                       skills/<Name>/     │
                       │ install/uninstall/refresh                               │
          ┌────────────┼──────────────┐                                          │
          ▼            ▼              ▼                                          │
        CLI         Web API        OpenCode plugin        static dist/
     (cli.ts)     (server.ts)    (plugin/tools/*.ts)     skills.json (9.9MB)
```

## Layers

### 1. Data

- **`skill-market/`** — generisan izvor: `meta.js` (13,888 meta zapisa,
  `{name,folder,desc,license,source,srcLabel,cat}`) i `part-<cat>.js` za svaku od 12
  kategorija (`window.SKILLS_PART['cat'] = [{name,folder,frontmatter,body}]`).
- **SQLite registry** — jedna baza (`~/.config/opencode/skill-hub/registry.db`) s FTS5
  indexom (`skills_fts`). `user_version=1`, `registry_meta` čuva schema/compat/registry
  release. Tabele: `skills`, `sources`, `categories`, `installations`, `skills_fts`.
- **ID shema**: `` `${source}/${slugCat}/${folder}` ``, duplikati dobivaju `#n` sufiks.
  Meta (`cat`, `folder`) u `meta_json`; ako nedostaje, izvodi se iz ID-a (fallback).

### 2. Ingest

- **Importer** — gradi skills tabele iz `meta.js` + part fajlova, računa:
  - `score` = kombinacija quality/security/maintenance (0–100),
  - `risk_level` prema `scanRisk(body)` (shell, exfil, network, prompt injection),
  - `content_hash` (identifikacija duplikata/staleness).
- **Sync** — `sync-github.ts` (GitHubClient) i `providers/github-skill-source.ts`
  (REST+fetch) rade upsert/remove/changed dijete; `--dry-run` ne dira bazu; cache
  idempotent.

### 3. Core engine (`scripts/lib/core.ts`)

Zajednička logika za CLI/plugin/web:

- `resolveSkill(db, id|name)` — id prvo, onda name (nocase).
- `getSkillContent(row)` — lazy load part fajla (cache u memory), pretraga po `name`/
  `folder`; vraća `body` + `frontmatter` ili `{content_available:false, reason}`.
- `installSkill` — COW helper: piše `SKILL.md` + `.mujo.json`, ažurira `meta_json`
  (čuva postojeća polja!), dodaje red u `installations`, poštuje `maxInstalledSkills`.
- `uninstallSkill` — ponovno fetcha red (očuva svježinu), briše samo pod
  skills-root-om, čisti meta i installations.
- Testabilno: `setSkillsRoot()` preusmjerava instalaciju (testovi rade na temp root-u).

### 4. Web

- `server.ts` — nativni `node:http` bez deps: FTS5 search (+LIKE fallback), filteri
  (tag/category/verified/stars/status/risk), sort (score/bm25/risk/name/recent),
  paginacija (`{total, rows}`); install/uninstall endpointi; static (skills-data,
  dist/skills.json).
- `index.html`+`app.js` — katalog, kartice, details modal s SKILL.md preview, install
  gumb, toastovi, "load more".

### 5. CLI (`cli.ts`)

`search / install / update / remove / list / refresh / info` koristi isti core engine;
`refresh` označava `stale` prema `last_update`.

### 6. OpenCode plugin (`plugin/tools/`)

- `opencode-tools.ts` — `/skills` `/skills/search` `/skills/install` `/skills/remove`;
  LIKE search + stars select, parametrizirano.
- `cache-manager.ts` — prati strukturu cachea i izvještava o statusu.
- `invalid-cleanup.ts` — čisti invalid/installed skills dirs.

## Data flow (install)

```
WEB/CLI install(id)
 → resolveSkill(db, id)            → row
 → getSkillContent(row)            → part fajl → SKILL.md body
 → safeDirName(name)               → ~/.config/opencode/skills/<Name>/
 → fs.writeFile SKILL.md+.mujo.json→ COW
 → UPDATE skills.meta_json         → čuva cat/folder + dodaje installed_at/installed_dir
 → upsert installations            → status='installed'
```

Ključno: nikakav update ne smije prebrisati `meta_json` — install/uninstall uvijek
parseaju postojeći meta i mijenjaju samo svoje ključeve.

## Security invariants

- `safeDirName` / root prefix check pri brisanju.
- Risk gating prema `maxRisk` (config).
- Tokeni samo iz env, nikad u bazu.
- Install nikad automatski bez potvrde (osim `autoInstall` eksplicitno).

## Conventions

- Node ≥22, `.ts` preko type-stripping (bez tsc koraka), nula runtime deps.
- PowerShell dev okolina; ESM skripte za playwright pokretati iz roota.
- Nakon izmjena koda: `graphify update .`.
