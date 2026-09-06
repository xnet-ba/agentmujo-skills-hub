import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

function homeDir(): string {
  return os.homedir();
}

// ---------------------------------------------------------------------------
// Config loader (matches sync-github.ts loadConfig pattern)
// ---------------------------------------------------------------------------
function loadConfig(): Config {
  const root = path.join(__dirname2, "..");
  const configPath = path.join(root, "config", "config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  // Normalize nested "registry" object into flat fields for convenience.
  const reg = parsed.registry ?? {};
  return {
    dbPath: reg.dbPath ?? parsed.dbPath,
    registryDir: reg.registryDir ?? parsed.registryDir,
    schemaVersion: reg.schemaVersion ?? parsed.schemaVersion ?? 1,
    compatVersion: reg.compatVersion ?? parsed.compatVersion ?? "0.1.0",
    autoInstall: parsed.autoInstall ?? true,
    maxRisk: parsed.maxRisk ?? "medium",
    minimumScore: parsed.minimumScore ?? 75,
    minimumStars: parsed.minimumStars ?? 0,
    verifiedOnly: parsed.verifiedOnly ?? false,
    autoRefresh: parsed.autoRefresh ?? true,
    refreshInterval: parsed.refreshInterval ?? "24h",
    maxInstalledSkills: parsed.maxInstalledSkills ?? 100,
    cache: parsed.cache ?? {},
  };
}

interface Config {
  dbPath: string;
  registryDir: string;
  schemaVersion: number;
  compatVersion: string;
  autoInstall: boolean;
  maxRisk: string;
  minimumScore: number;
  minimumStars: number;
  verifiedOnly: boolean;
  autoRefresh: boolean;
  refreshInterval: string;
  maxInstalledSkills: number;
  cache: {
    root: string;
    installedSkillsPath: string;
  };
}

// ---------------------------------------------------------------------------
// Database (registry) builder (section 4)
// Mirrors sync-github.ts Registry class (lines 420–578)
// ---------------------------------------------------------------------------

class RegistryBuilder {
  private db: DatabaseSync;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const dbPath = config.dbPath.replace(/^~/, homeDir());
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.applySchemaIfNeeded();
    this.ensureSources();
  }

  private applySchemaIfNeeded() {
    const row = this.db
      .prepare("PRAGMA user_version")
      .get() as unknown { user_version: number };
    const current = row.user_version;

    if (current !== this.config.schemaVersion) {
      const schemaPath = path.join(this.config.registryDir, "schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, "utf-8");
        this.db.exec(schema);
      }
      // Ensure meta reflects config values.
      this.db
        .prepare(
          "INSERT OR IGNORE INTO registry_meta(key, value) VALUES(?, ?)"
        )
        .run("schema_version", String(this.config.schemaVersion));
      this.db
        .prepare("UPDATE registry_meta SET value=? WHERE key='schema_version'")
        .run(String(this.config.schemaVersion));
      console.log(
        `[registry] schema applied (user_version ${current} -> ${this.config.schemaVersion})`
      );
    }
  }

  private ensureSources() {
    const nowTs = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO sources(name, type, repository, repository_url, priority, enabled, created_at)
       VALUES(?, ?, ?, ?, ?, 1, ?)`
    );
    // Default sources matching sync-github.ts DEFAULT_SOURCES
    const defaults = [
      {
        name: "anthropic",
        type: "organization",
        repository: "anthropics/skills",
        url: "https://github.com/anthropics/skills",
        priority: 1,
      },
      {
        name: "addyosmani",
        type: "user",
        repository: "addyosmani/claude-skills",
        url: "https://github.com/addyosmani/claude-skills",
        priority: 2,
      },
      {
        name: "composio",
        type: "organization",
        repository: "ComposioHQ/composio",
        url: "https://github.com/ComposioHQ/composio",
        priority: 3,
      },
    ];
    for (const s of defaults) {
      insert.run(s.name, s.type, s.repository, s.url, s.priority, nowTs);
    }
    console.log(`[registry] ensured ${defaults.length} default sources`);
  }

  // --- Public API ---

  getExistingSkill(id: string): any {
    return this.db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
  }

  getLastChecked(repo: string): { last_checked_at: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT MAX(last_checked_at) AS last_checked_at FROM skills WHERE repository = ?`
      )
      .get(repo) as { last_checked_at: string | null } | undefined;
    return row && row.last_checked_at
      ? { last_checked_at: row.last_checked_at }
      : undefined;
  }

  upsertSkill(s: Record<string, unknown>) {
    const sql = `
      INSERT INTO skills(
        id, name, description, category, tags, repository, author,
        stars, forks, license, last_update, score, quality, security,
        maintenance, verified, status, risk_level, content_hash,
        indexed_at, last_checked_at, meta_json
      ) VALUES(
        @id, @name, @description, @category, @tags, @repository, @author,
        @stars, @forks, @license, @last_update, @score, @quality, @security,
        @maintenance, @verified, @status, @risk_level, @content_hash,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'), @last_checked_at, @meta_json
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        category=excluded.category,
        tags=excluded.tags,
        repository=excluded.repository,
        author=excluded.author,
        stars=excluded.stars,
        forks=excluded.forks,
        license=excluded.license,
        last_update=excluded.last_update,
        score=excluded.score,
        quality=excluded.quality,
        security=excluded.security,
        maintenance=excluded.maintenance,
        verified=excluded.verified,
        status=excluded.status,
        risk_level=excluded.risk_level,
        content_hash=excluded.content_hash,
        last_checked_at=excluded.last_checked_at,
        meta_json=excluded.meta_json
    `;
    this.db.prepare(sql).run(s);
  }

  setStatus(id: string, status: string) {
    this.db
      .prepare(
        `UPDATE skills SET status=?, last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`
      )
      .run(status, id);
  }

  addCategory(name: string) {
    this.db.prepare("INSERT OR IGNORE INTO categories(name) VALUES(?)").run(name);
  }

  addTag(name: string) {
    this.db.prepare("INSERT OR IGNORE INTO tags(name) VALUES(?)").run(name);
  }

  linkSkillCategory(skillId: string, categoryName: string) {
    const c = this.db
      .prepare("SELECT id FROM categories WHERE name=?")
      .get(categoryName) as { id: number } | undefined;
    if (!c) return;
    this.db
      .prepare(
        "INSERT OR IGNORE INTO skill_categories(skill_id, category_id) VALUES(?, ?)"
      )
      .run(skillId, c.id);
  }

  linkSkillTags(skillId: string, tagNames: string[]) {
    for (const t of tagNames) {
      const tag = this.db.prepare("SELECT id FROM tags WHERE name=?").get(t) as
        | { id: number }
        | undefined;
      if (!tag) continue;
      this.db
        .prepare(
          "INSERT OR IGNORE INTO skill_tags(skill_id, tag_id) VALUES(?, ?)"
        )
        .run(skillId, tag.id);
    }
  }

  getAllSkills(): any[] {
    return this.db.prepare("SELECT * FROM skills").all() as any[];
  }

  close() {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI: build the registry (entry point)
// ---------------------------------------------------------------------------

interface Args {
  dryRun: boolean;
  force: boolean;
}

function parseArgs(raw: string[]): Args {
  const args: Args = { dryRun: false, force: false };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
  }
  return args;
}

function main() {
  const config = loadConfig();
  console.log(`[build-registry] Loading config from ${config.dbPath}`);

  const registry = new RegistryBuilder(config);

  const all = registry.getAllSkills();
  console.log(`[build-registry] Registry contains ${all.length} skills`);

  // Print meta info
  const schemaVersion = registry.db
    .prepare("PRAGMA user_version")
    .get() as unknown { user_version: number };
  console.log(`[build-registry] user_version: ${schemaVersion.user_version}`);

  registry.close();
  console.log(`[build-registry] Done.`);
}

main().catch((e) => {
  console.error("[build-registry] FATAL:", e);
  process.exit(1);
});