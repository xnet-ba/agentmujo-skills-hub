PROJECT NAME:

AgentMujo Skills Hub

GOAL:

Napraviti centralni, brz i jednostavan registry za OpenCode skills koji trenutno sadrži oko 13.888 skillova iz GitHub repozitorija.

Sistem mora omogućiti da:

1. korisnik pregleda skillove kroz web HTML/JS aplikaciju

2. OpenCode/AgentMujo automatski pretražuje Skills Hub kada mu je potreban skill

3. agent dobije najbolje relevantne skillove

4. agent može sam instalirati odgovarajući skill

5. agent može koristiti već instalirani skill

6. agent može ažurirati ili ukloniti skill

7. registry se automatski osvježava

8. nevažeći/stari/obrisani skillovi se automatski označavaju ili uklanjaju

9. novi kvalitetni GitHub skillovi automatski budu dodani

10. sistem ostane ekstremno brz čak i sa desetinama hiljada skillova

==================================================

1. ARHITEKTURA

==================================================

Sistem podijeliti na:

A. AgentMujo Skills Hub Registry

B. Web katalog

C. OpenCode Plugin

D. Skill Cache/Installer

E. GitHub Sync/Validator

F. Search + Ranking engine

Glavni koncept:

GitHub

↓

Registry Sync

↓

SQLite/local index

↓

AgentMujo Skills Hub

├── Web UI

└── OpenCode Plugin

          ↓

     Search skill

          ↓

     Rank results

          ↓

     Validate

          ↓

     Install

          ↓

     OpenCode reload

          ↓

     Agent uses skill

==================================================

2. CRITICAL DESIGN PRINCIPLE

==================================================

NE instalirati svih 13.888 skillova u OpenCode.

Hub mora sadržavati metadata/index svih dostupnih skillova.

OpenCode fizički instalira samo skillove koji su potrebni.

Primjer:

Available:

13.888

Installed:

23

Active/relevant:

5-10

Pipeline:

AVAILABLE

→ SEARCHED

→ SELECTED

→ VALIDATED

→ INSTALLED

→ USED

==================================================

3. GITHUB REPOSITORY

==================================================

Napraviti javni GitHub repository:

agentmujo-skills-hub

Predložena struktura:

agentmujo-skills-hub/

│

├── README.md

├── LICENSE

├── package.json

├── tsconfig.json

├── .gitignore

│

├── apps/

│ └── web/

│ ├── index.html

│ ├── app.js

│ ├── styles.css

│ └── assets/

│

├── plugin/

│ ├── src/

│ │ ├── index.ts

│ │ ├── tools/

│ │ ├── registry/

│ │ ├── installer/

│ │ ├── validator/

│ │ ├── ranking/

│ │ └── cache/

│ └── package.json

│

├── registry/

│ ├── skills.db

│ ├── skills.json

│ ├── categories.json

│ └── schema.sql

│

├── scripts/

│ ├── sync-github.ts

│ ├── validate-skills.ts

│ ├── calculate-score.ts

│ ├── remove-invalid.ts

│ ├── add-new-skills.ts

│ └── build-registry.ts

│

├── config/

│ └── config.json

│

└── docs/

    ├── architecture.md

    ├── plugin.md

    ├── registry.md

    └── security.md

==================================================

4. REGISTRY

==================================================

Koristiti SQLite kao primarni lokalni registry.

SQLite je preferiran zbog brzog searcha i filtriranja.

Dodati SQLite FTS5 full-text search.

Registry mora sadržavati najmanje:

skills

categories

tags

sources

health_checks

installations

SKILLS FIELDS:

id

name

description

repository

repository_url

skill_path

github_url

category

tags

stars

forks

open_issues

watchers

license

default_branch

created_at

updated_at

last_commit

score

quality_score

security_score

maintenance_score

status

verified

risk_level

content_hash

indexed_at

last_checked_at

STATUS:

active

stale

invalid

removed

blocked

unverified

RISK:

low

medium

high

==================================================

5. SKILL ID

==================================================

Svaki skill mora imati stabilni jedinstveni ID.

Preferirati:

owner/repository/path

Primjer:

anthropics/skills/frontend-design

Ako repository sadrži više skillova:

owner/repo/path/to/skill

Ne koristiti samo ime skill-a jer nije dovoljno jedinstveno.

==================================================

6. SKILL DISCOVERY

==================================================

Hub mora podržavati:

keyword search

full text search

category search

tag search

GitHub repository search

score filtering

stars filtering

recently updated

verified only

risk filtering

installed only

available only

Primjeri:

"docker security"

"linux systemd"

"postgres backup"

"terraform aws"

"python testing"

==================================================

7. WEB UI

==================================================

Napraviti jednostavan i brz HTML/CSS/JS frontend.

Bez teških frameworka ako nisu potrebni.

Preferirati:

HTML

CSS

Vanilla JS

ili minimalni framework samo ako donosi jasnu korist.

UI mora imati:

SEARCH

[ Search skills... ]

FILTERS:

Category

Tags

Minimum score

GitHub stars

Recently updated

Verified

Risk

Installed

CATEGORY LIST:

Coding

AI

Linux

DevOps

Security

Database

Networking

GitHub

Git

Docker

Kubernetes

Cloud

Testing

Web

Documentation

Automation

Data

System Administration

itd.

SKILL CARD:

Name

Description

Category

Tags

GitHub stars

Score

Risk

Verified

Last updated

Buttons:

[GitHub]

[Details]

[Install]

==================================================

8. SKILL DETAILS PAGE

==================================================

Prikazati:

Name

Description

Repository

GitHub URL

Author

Stars

Forks

License

Last update

Categories

Tags

Score

Security score

Maintenance score

Risk

Verification status

Skill path

Actions:

Install

Update

Remove

Prikazati i informacije o tome šta skill sadrži:

SKILL.md

scripts

references

assets

==================================================

9. OPEN_CODE PLUGIN

==================================================

Napraviti OpenCode plugin:

AgentMujo Skills Hub Plugin

Plugin mora omogućiti agentu pristup Skills Hub registryju.

Glavni princip:

Agent ne mora znati gdje se skill nalazi.

Agent kaže:

"treba mi skill za Docker security"

Plugin pretraži Hub.

==================================================

10. OPEN_CODE TOOLS

==================================================

Plugin treba imati mali i jasan API.

Primarni tools:

skill_search

skill_info

skill_install

skill_update

skill_remove

skill_refresh

skill_search:

Input:

query

category

tags

minimum_score

minimum_stars

verified

risk_level

limit

Output:

id

name

description

repository

score

stars

risk

verified

install status

==================================================

11. AUTOMATSKI SKILL DISCOVERY

==================================================

OVO JE KLJUČNA FUNKCIJA.

AgentMujo/OpenCode treba AUTOMATSKI pregledati Skills Hub kada procijeni da mu nedostaje odgovarajući skill.

Primjer:

User:

"Provjeri Docker sigurnost na serveru."

Agent procijeni:

Relevant skills needed:

docker security

Agent automatski poziva:

skill_search("docker security")

Dobije:

1. docker-security-expert

2. docker-hardening

3. container-security

4. docker-audit

Agent izabere najbolji prema:

relevance

score

verification

security

maintenance

GitHub quality

Zatim pozove:

skill_install(selected_skill)

Plugin:

download

validate

security check

install

reload OpenCode skills

Agent zatim nastavlja originalni task koristeći novi skill.

==================================================

12. AUTO-INSTALL POLICY

==================================================

Agent može automatski instalirati skill samo ako:

skill je validan

skill nije blocked

risk je prihvatljiv

repository je dostupan

SKILL.md postoji

skill prolazi basic security checks

Za HIGH risk skill:

ne instalirati automatski

nego vratiti:

"Found potentially useful high-risk skill. Manual approval required."

Za LOW/MEDIUM:

automatska instalacija može biti dozvoljena prema konfiguraciji.

==================================================

13. INSTALLATION

==================================================

Instalirani skillovi se ne kopiraju u registry.

Registry ostaje metadata/index.

Skill se fizički instalira u OpenCode skill directory.

Primarno:

~/.config/opencode/skills/

Svaki skill imati izoliran vlastiti direktorij.

Primjer:

~/.config/opencode/skills/

├── docker-security

├── systemd-expert

├── postgres-admin

└── linux-networking

Nakon instalacije:

OpenCode skill reload.

==================================================

14. CACHE

==================================================

Implementirati lokalni cache.

Primjer:

~/.config/opencode/skill-hub/

├── cache/

├── installed/

├── downloads/

├── registry.db

├── logs/

└── config.json

Ne preuzimati GitHub repository ponovo ako se nije promijenio.

==================================================

15. FAST SEARCH

==================================================

Search mora biti lokalni i brz.

NE slati svaki search na GitHub API.

Flow:

Agent

↓

Local SQLite FTS index

↓

results

GitHub se koristi samo za:

sync

validation

metadata

updates

==================================================

16. RANKING

==================================================

Napraviti Skill Score.

Score mora kombinovati:

relevance

GitHub stars

recent activity

maintenance

documentation quality

repository activity

license

validation

security

community signals

Primjer:

30% relevance

20% GitHub popularity

15% maintenance

10% documentation

10% repository activity

5% license

5% validation

5% security

Score:

0-100

Primjeri:

95-100 = excellent

90-94 = recommended

80-89 = good

70-79 = acceptable

<70 = low quality

Score treba biti recalculated pri refreshu.

==================================================

17. VERIFICATION

==================================================

Svaki skill mora proći validation.

Provjeriti:

SKILL.md postoji

valid frontmatter

name postoji

description postoji

repository postoji

path postoji

README/repository information

license kada je dostupna

Provjeriti pomoćne fajlove:

scripts/

references/

assets/

Skill koji ne zadovoljava minimum:

status = invalid

==================================================

18. SECURITY SCAN

==================================================

Napraviti osnovni static security scanner.

Tražiti potencijalno opasne obrasce:

curl | bash

wget | sh

rm -rf

sudo

chmod 777

credential access

SSH private keys

.env access

password files

destructive filesystem operations

Rezultat:

security_score

risk_level

Primjer:

LOW:

normal documentation/instructions

MEDIUM:

shell scripts with system modifications

HIGH:

credential access

destructive commands

suspicious remote execution

==================================================

19. GITHUB SYNC

==================================================

Implementirati sync engine.

SYNC:

1. GitHub metadata

2. detect new repos

3. detect deleted repos

4. detect renamed repos

5. detect updated repos

6. validate

7. recalculate score

8. update registry

Ne preuzimati cijeli repository svaki put.

Prvo provjeriti:

updated_at

latest commit

default branch

metadata

Samo ako postoji promjena:

download repository/skill

==================================================

20. INVALID SKILLS

==================================================

Ako repository više ne postoji:

status = removed

Ako SKILL.md više ne postoji:

status = invalid

Ako repository nije dugo održavan:

status = stale

Ne mora se odmah fizički obrisati iz registryja.

Prvo markirati status.

Cleanup job kasnije može ukloniti stare invalid records.

==================================================

21. NEW SKILLS

==================================================

Sync mora pronalaziti nove kvalitetne skillove na GitHubu.

Novi skill može biti dodan ako:

SKILL.md postoji

repository javno dostupan

repo validan

license prihvatljiva

quality score iznad minimalnog praga

Novi skill automatski dobija:

category

tags

score

risk

status

==================================================

22. CATEGORY DETECTION

==================================================

Automatski odrediti kategoriju iz:

repository name

skill name

description

SKILL.md

README

GitHub topics

Primjer:

docker

container

kubernetes

→ DevOps / Containers

systemd

linux

ubuntu

server

→ Linux / System Administration

postgres

mysql

database

→ Database

==================================================

23. TAG DETECTION

==================================================

Automatski generisati tagove.

Primjer:

docker

linux

security

containers

hardening

devops

Skill može imati više tagova.

==================================================

24. DUPLICATES

==================================================

Detektovati:

duplicate repositories

duplicate skill paths

duplicate content

forks

identične SKILL.md datoteke

Ako su dva skill-a gotovo ista:

odabrati bolji kandidat kao recommended.

==================================================

25. GITHUB API RATE LIMIT

==================================================

Sync mora poštovati GitHub API limits.

Implementirati:

local cache

incremental sync

retry

backoff

rate-limit detection

GitHub API ne smije biti korišten za svaki Agent request.

==================================================

26. CONFIGURATION

==================================================

config.json:

{

"registry": "...",

"autoInstall": true,

"maxRisk": "medium",

"minimumScore": 75,

"minimumStars": 0,

"verifiedOnly": false,

"autoRefresh": true,

"refreshInterval": "24h",

"maxInstalledSkills": 100

}

Konfiguracija mora biti lako promjenjiva.

==================================================

27. AUTO REFRESH

==================================================

Registry može imati:

manual refresh

skill_refresh()

i scheduled refresh.

Default:

jednom dnevno.

Moguće:

6h

12h

24h

7d

Sync mora biti incremental.

==================================================

28. INSTALLED SKILLS MANAGEMENT

==================================================

Plugin mora znati:

koji skillovi su instalirani

koja verzija/commit je instalirana

kada je instalirana

kada je zadnji put korištena

da li postoji update

Metadata:

installed_at

updated_at

last_used

installed_commit

==================================================

29. AUTO UPDATE

==================================================

Ako postoji nova verzija:

skill_update

Opcionalno:

autoUpdate = false

default.

Sigurnija opcija je:

detect update

notify agent

agent decides

==================================================

30. SKILL USAGE LEARNING

==================================================

U kasnijoj verziji dodati:

usage statistics

Primjer:

docker-security

used 48 times

linux-debug

used 31 times

postgres-admin

used 3 times

To se može koristiti za bolji ranking.

Formula može kasnije uključiti:

local_usage_score

==================================================

31. AGENT RECOMMENDATION

==================================================

Dodati lokalni ranking signal:

"skills that worked well for this agent"

AgentMujo može vremenom učiti:

Skill X successful 95%

Skill Y successful 61%

To kasnije utiče na ranking.

==================================================

32. OFFLINE MODE

==================================================

Ako GitHub nije dostupan:

Hub i dalje mora raditi.

Search mora koristiti lokalni registry.

Može:

search

skill_info

koristiti već instalirane skillove

Ne može:

new install

fresh update

dok GitHub nije dostupan.

==================================================

33. PROVIDER ABSTRACTION

==================================================

Ne vezivati core isključivo za GitHub.

Definisati interface:

SkillSource

Methods:

search()

get()

install()

update()

remove()

refresh()

Prvi provider:

GitHubSkillSource

Kasnije možemo dodati:

GitLabSkillSource

LocalSkillSource

HTTPRegistrySource

PrivateGitHubSource

Bez promjene core logike.

==================================================

34. REGISTRY API

==================================================

Ako je potrebno, napraviti mali HTTP API:

GET /api/skills

GET /api/skills/:id

GET /api/search

GET /api/categories

GET /api/stats

GET /api/health

Ali za prvu verziju OpenCode plugin može direktno čitati lokalni SQLite registry.

HTTP API ostaviti kao optional layer.

==================================================

35. WEB HOSTING

==================================================

Web app treba biti statični frontend i može se hostovati preko:

GitHub Pages

ili

Cloudflare Pages

Registry metadata može biti generisana kao:

skills.json

za frontend.

SQLite ostaje runtime/backend registry za plugin.

==================================================

36. STATIC FRONTEND DATA

==================================================

Build treba generisati:

dist/skills.json

minificirani metadata dataset za web UI.

Web UI ne mora imati backend za osnovno browsing/search iskustvo.

==================================================

37. PERFORMANCE

==================================================

Cilj:

instant local search

bez učitavanja 13.888 velikih GitHub repozitorija

metadata-only registry

lazy loading skill content

Frontend mora koristiti:

pagination

virtualized list ili efficient DOM rendering

debounced search

Plugin mora:

cache results

cache metadata

ne downloadati nepotrebne skillove

==================================================

38. AGENT FLOW

==================================================

NORMALAN AGENT FLOW:

User:

"Analiziraj sigurnost mog Docker setupa."

Agent:

1. procijeni task

2. prepozna da nema odgovarajući skill

3. pozove Skill Hub

4. search("docker security")

5. dobije ranked results

6. provjeri score/risk

7. izabere najbolji skill

8. install

9. validate

10. reload OpenCode skills

11. koristi novi skill

12. nastavlja task

Agent NE mora pitati korisnika za svaki LOW/MEDIUM risk skill ako je autoInstall enabled.

==================================================

39. IMPORTANT AGENT TOOL POLICY

==================================================

Agentu jasno dokumentovati:

DO NOT:

- instalirati random skill

- instalirati low quality skill ako postoji bolji

- instalirati HIGH risk skill automatski

- downloadati cijeli registry

- koristiti GitHub API za svaki request

DO:

- pretraži Hub

- koristi ranking

- prefer verified

- prefer maintained

- prefer high score

- validate before install

- cache locally

- reload after install

==================================================

40. CLI OPTIONAL

==================================================

Dodati opcionalni CLI:

agentmujo-skills search docker

agentmujo-skills install docker-security

agentmujo-skills update docker-security

agentmujo-skills remove docker-security

agentmujo-skills list

agentmujo-skills refresh

agentmujo-skills info docker-security

CLI koristi isti core engine kao OpenCode plugin.

==================================================

41. TESTING

==================================================

Napraviti testove za:

registry

search

ranking

GitHub sync

validation

security scanner

install

update

remove

duplicate detection

stale detection

OpenCode plugin

offline mode

Testirati sa najmanje:

100

1,000

10,000

50,000

skill records

Cilj je da arhitektura ostane brza i kada registry poraste preko 100.000 skillova.

==================================================

42. DOCUMENTATION

==================================================

README mora objasniti:

šta je AgentMujo Skills Hub

kako radi

instalacija OpenCode plugina

kako koristiti web katalog

kako dodati skill source

kako radi auto-install

security model

score system

registry sync

Dokumentovati i:

AgentMujo Skills Hub Architecture

OpenCode Integration

Skill Registry Format

Security Model

Contribution Guide

==================================================

43. VERSIONING

==================================================

Semver:

0.1.0

0.2.0

1.0.0

Registry schema mora imati version.

Plugin i registry moraju provjeravati compatibility.

==================================================

44. OPEN SOURCE

==================================================

Repository mora biti spreman za open-source.

Dodati:

LICENSE

CONTRIBUTING.md

SECURITY.md

CODE_OF_CONDUCT.md

README.md

==================================================

45. MVP

==================================================

PRVA RADNA VERZIJA MORA IMATI SAMO:

SQLite registry

GitHub sync

validation

ranking

full-text search

HTML/JS catalog

OpenCode plugin

skill_search

skill_info

skill_install

skill_remove

skill_update

skill_refresh

local cache

OpenCode skill reload

basic security scan

NEMOJ u MVP dodavati nepotrebnu kompleksnost.

==================================================

46. NAJVAŽNIJI REQUIREMENT

==================================================

AgentMujo mora moći SAM pronaći skill.

Primjer:

TASK:

"Debuguj Nginx reverse proxy."

Interno:

Agent detects missing expertise

        ↓

skill_search("nginx reverse proxy debugging")

        ↓

Hub returns ranked results

        ↓

Agent selects best safe skill

        ↓

skill_install()

        ↓

OpenCode reload

        ↓

Agent uses skill

        ↓

Task continues

Korisnik ne mora znati naziv skill-a.

==================================================

47. FUTURE ARCHITECTURE

==================================================

Dizajn mora omogućiti:

semantic embeddings

vector search

local LLM ranking

skill recommendations

skill usage learning

multiple registries

private skill registries

organization registries

signed skills

cryptographic verification

skill dependency management

skill bundles

skill versioning

automatic rollback

skill sandboxing

Ali ništa od toga ne treba biti obavezno za MVP.

==================================================

48. FINAL PRINCIPLE

==================================================

AgentMujo Skills Hub nije samo web katalog.

To je:

CENTRALNI DISCOVERY + REGISTRY + PACKAGE MANAGER

ZA OPENCODE SKILLS.

13.888+ skillova treba tretirati kao searchable knowledge/index layer.

OpenCode treba fizički imati samo ono što mu treba.

AgentMujo treba moći:

DISCOVER

→ RANK

→ VALIDATE

→ INSTALL

→ LOAD

→ USE

→ UPDATE

→ REMOVE

skills autonomno.

Prioriteti:

1. SIMPLE

2. FAST

3. SAFE

4. AUTONOMOUS

5. EXTENSIBLE

==================================================

SUCCESS CRITERIA

==================================================

Projekt je uspješan kada instaliran OpenCode + AgentMujo plugin može dobiti task kao:

"Provjeri PostgreSQL backup konfiguraciju"

i bez korisnikovog znanja o skillovima:

1. prepoznati potrebnu ekspertizu

2. pretražiti AgentMujo Skills Hub

3. pronaći najbolji kompatibilni skill

4. provjeriti njegov kvalitet i sigurnost

5. instalirati ga

6. reloadovati OpenCode

7. koristiti skill

8. završiti task

bez ručnog traženja GitHub repositoryja.
