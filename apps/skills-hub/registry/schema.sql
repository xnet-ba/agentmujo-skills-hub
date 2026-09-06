-- =============================================================================
-- AgentMujo Skills Hub — Registry Schema
-- =============================================================================
-- SQLite registry schema per hub.md section 4 (REGISTRY)
-- (hub.md lines 240-435)
--
-- Versioning (hub.md lines 2681, 2685):
--   - SCHEMA_VERSION   : tracks the registry schema itself (bump on migration)
--   - COMPAT_VERSION   : tracks the plugin/tooling min required compatibility
--   - REGISTRY_VERSION : tracks the data registry release (0.1.0 / 0.2.0 / 1.0.0)
--
-- Full-text search uses SQLite FTS5 (hub.md line 313).
-- =============================================================================

PRAGMA user_version = 2;
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Registry metadata (single-row versioning table)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registry_meta (
    key                TEXT PRIMARY KEY,
    value              TEXT NOT NULL
);

INSERT OR IGNORE INTO registry_meta (key, value) VALUES
    ('schema_version',    '1'),      -- bump on schema migration (hub.md 2681)
    ('compat_version',    '0.1.0'),  -- plugin min compatibility (hub.md 2685)
    ('registry_version',  '0.1.0'),  -- data release version (hub.md 2671)
    ('created_at',        strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- -----------------------------------------------------------------------------
-- Source repositories being tracked (hub.md 325)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL UNIQUE,          -- e.g. 'anthropics/skills'
    type             TEXT,                          -- 'organization' | 'user' (hub.md)
    repository       TEXT NOT NULL,                 -- owner/repo
    repository_url   TEXT,                          -- full https URL
    url              TEXT,                          -- alias used by scripts
    license          TEXT,
    default_branch   TEXT DEFAULT 'main',
    priority         INTEGER NOT NULL DEFAULT 99,   -- lower wins on dedup (hub.md 250)
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    indexed_at       TEXT,
    last_checked_at  TEXT
);

-- -----------------------------------------------------------------------------
-- Skills registry (hub.md 321)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
    id                   TEXT PRIMARY KEY,          -- owner/repo/path (hub.md 437)
    name                 TEXT NOT NULL,
    description          TEXT,
    repository           TEXT NOT NULL,
    repository_url       TEXT,
    skill_path           TEXT,
    github_url           TEXT,
    category             TEXT,
    tags                 TEXT,                      -- JSON array
    stars                INTEGER DEFAULT 0,
    forks                INTEGER DEFAULT 0,
    open_issues          INTEGER DEFAULT 0,
    watchers             INTEGER DEFAULT 0,
    license              TEXT,
    default_branch       TEXT DEFAULT 'main',
    created_at           TEXT,
    updated_at           TEXT,
    last_commit          TEXT,
    score                INTEGER DEFAULT 0,         -- 0-100 (hub.md sec 16)
    quality_score        INTEGER DEFAULT 0,
    security_score       INTEGER DEFAULT 0,
    maintenance_score    INTEGER DEFAULT 0,
    -- Convenience columns used by the tooling scripts (complement hub.md fields)
    author               TEXT,
    last_update          TEXT,
    quality              INTEGER DEFAULT 0,
    security             INTEGER DEFAULT 0,
    maintenance          INTEGER DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'unverified'
                         CHECK (status IN
                                ('active','stale','invalid','removed','blocked','unverified')),
    verified             INTEGER DEFAULT 0,          -- 0/1
    risk_level           TEXT NOT NULL DEFAULT 'low'
                         CHECK (risk_level IN ('low','medium','high')),
    content_hash         TEXT,
    indexed_at           TEXT,
    last_checked_at      TEXT,
    meta_json            TEXT                       -- flexible extra metadata
);

CREATE INDEX IF NOT EXISTS idx_skills_name        ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_category    ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_status      ON skills(status);
CREATE INDEX IF NOT EXISTS idx_skills_score       ON skills(score DESC);
CREATE INDEX IF NOT EXISTS idx_skills_risk        ON skills(risk_level);
CREATE INDEX IF NOT EXISTS idx_skills_repository  ON skills(repository);

-- -----------------------------------------------------------------------------
-- Categories (hub.md 322)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,               -- e.g. 'Coding', 'AI', 'Security'
    description TEXT,
    skill_count INTEGER DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- Tags (hub.md 323)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    skill_count INTEGER DEFAULT 0
);

-- Many-to-many: skills <-> categories
CREATE TABLE IF NOT EXISTS skill_categories (
    skill_id    TEXT NOT NULL REFERENCES skills(id)  ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (skill_id, category_id)
);

-- Many-to-many: skills <-> tags
CREATE TABLE IF NOT EXISTS skill_tags (
    skill_id    TEXT NOT NULL REFERENCES skills(id)  ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (skill_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- Health checks (hub.md 324) — history of validation runs per skill
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_checks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    check_type      TEXT NOT NULL,                   -- e.g. 'sync','security','score'
    status          TEXT NOT NULL,                   -- e.g. 'ok','failed','warning'
    details         TEXT,
    checksum        TEXT,
    run_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_skill ON health_checks(skill_id);

-- -----------------------------------------------------------------------------
-- Installations (hub.md 326) — which skills are/were installed via plugin
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS installations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id         TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    install_path     TEXT NOT NULL,
    version          TEXT,
    status           TEXT NOT NULL DEFAULT 'installed'
                     CHECK (status IN
                            ('installed','pending','failed','removed','updated')),
    installed_at     TEXT NOT NULL,
    removed_at       TEXT,
    installed_commit TEXT,               -- sha256 of the installed SKILL.md (hub.md 28)
    updated_at       TEXT,               -- last install/update time
    last_used        TEXT,               -- last activation time
    last_checked_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_install_skill ON installations(skill_id);

-- -----------------------------------------------------------------------------
-- Full-text search over skills (hub.md 313) — FTS5
-- -----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    id UNINDEXED,
    name,
    description,
    tags,
    category,
    content='skills',
    content_rowid='rowid'
);

-- Trigger helpers: keep FTS in sync with skills
CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(rowid, id, name, description, tags, category)
    VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;

CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
    VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
END;

CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
    VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
    INSERT INTO skills_fts(rowid, id, name, description, tags, category)
    VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;
