/**
 * skill-hub core engine (shared by CLI and OpenCode plugin).
 *
 * Implements hub.md sections 4, 13, 14, 32 and mirrors the install/content
 * logic used by the web server so every consumer behaves identically.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { contentHash } from "./scoring.ts";

export const REGISTRY_DB = path.join(os.homedir(), ".config", "opencode", "skill-hub", "registry.db");
export const SKILLS_ROOT = path.join(os.homedir(), ".config", "opencode", "skills");
export const PARKING_DIR = path.join(os.homedir(), ".config", "opencode", "skill-hub", "cache");

let skillsRoot: string = SKILLS_ROOT;
/** Redirect installation target (used by tests and embedded environments). */
export function setSkillsRoot(root: string) {
  skillsRoot = root;
}
function activeSkillsRoot(): string {
  return skillsRoot;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string;
  repository: string;
  score: number;
  stars: number;
  verified: number;
  status: string;
  risk_level: string;
  meta_json: string;
  [k: string]: unknown;
}

export function openRegistry(dbPath: string = REGISTRY_DB): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  // Bootstrap the schema for a brand-new (empty) database before migrating.
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
  if (tables.length === 0) {
    db.exec(`CREATE TABLE IF NOT EXISTS installations (
      skill_id TEXT PRIMARY KEY,
      install_path TEXT,
      status TEXT DEFAULT 'installed',
      installed_at TEXT NOT NULL,
      removed_at TEXT,
      installed_commit TEXT,
      updated_at TEXT,
      last_used TEXT
    )`);
  }
  migrateRegistry(db);
  return db;
}

export function getMetaJson(row: { meta_json?: string }): Record<string, unknown> {
  try {
    return JSON.parse(row.meta_json || "{}");
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export interface HubConfig {
  dbPath: string;
  registryDir: string;
  schemaVersion: number;
  compatVersion: string;
  autoInstall: boolean;
  maxRisk: "low" | "medium" | "high";
  minimumScore: number;
  minimumStars: number;
  verifiedOnly: boolean;
  autoRefresh: boolean;
  refreshInterval: string;
  maxInstalledSkills: number;
}

const DEFAULT_CONFIG: HubConfig = {
  dbPath: "~/.config/opencode/skill-hub/registry.db",
  registryDir: "registry",
  schemaVersion: 1,
  compatVersion: "0.1.0",
  autoInstall: true,
  maxRisk: "medium",
  minimumScore: 75,
  minimumStars: 0,
  verifiedOnly: false,
  autoRefresh: true,
  refreshInterval: "24h",
  maxInstalledSkills: 100,
};

/** Load config.json, normalizing the nested `registry.*` object to top-level. */
export function loadHubConfig(configPath?: string): HubConfig {
  let raw: Record<string, unknown> = {};
  const p = configPath || path.join(os.homedir(), ".config", "opencode", "skill-hub", "config.json");
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    raw = {};
  }
  const reg = (raw.registry ?? {}) as Record<string, unknown>;
  return {
    dbPath: (reg.dbPath as string) ?? (raw.dbPath as string) ?? DEFAULT_CONFIG.dbPath,
    registryDir: (reg.registryDir as string) ?? (raw.registryDir as string) ?? DEFAULT_CONFIG.registryDir,
    schemaVersion: Number(reg.schemaVersion ?? raw.schemaVersion ?? DEFAULT_CONFIG.schemaVersion),
    compatVersion: (reg.compatVersion as string) ?? (raw.compatVersion as string) ?? DEFAULT_CONFIG.compatVersion,
    autoInstall: (raw.autoInstall as boolean) ?? DEFAULT_CONFIG.autoInstall,
    maxRisk: ((raw.maxRisk as string) ?? DEFAULT_CONFIG.maxRisk) as HubConfig["maxRisk"],
    minimumScore: Number(raw.minimumScore ?? DEFAULT_CONFIG.minimumScore),
    minimumStars: Number(raw.minimumStars ?? DEFAULT_CONFIG.minimumStars),
    verifiedOnly: (raw.verifiedOnly as boolean) ?? DEFAULT_CONFIG.verifiedOnly,
    autoRefresh: (raw.autoRefresh as boolean) ?? DEFAULT_CONFIG.autoRefresh,
    refreshInterval: (raw.refreshInterval as string) ?? DEFAULT_CONFIG.refreshInterval,
    maxInstalledSkills: Number(raw.maxInstalledSkills ?? DEFAULT_CONFIG.maxInstalledSkills),
  };
}

/** §43: read registry_meta and report compatibility vs the tooling's declared compat version. */
export function compatCheck(db: DatabaseSync, toolingCompat: string): { ok: boolean; message: string } {
  try {
    const meta =
      (db.prepare("SELECT value FROM registry_meta WHERE key='compat_version'").get() as { value: string } | undefined)?.value ??
      "0.1.0";
    const schema =
      (db.prepare("SELECT value FROM registry_meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value ?? "1";
    if (meta !== toolingCompat) {
      return {
        ok: false,
        message: `compatibility mismatch: registry_meta.compat_version='${meta}' vs tooling='${toolingCompat}' (run validate-skills to resync)`,
      };
    }
    return { ok: true, message: `registry ok (schema ${schema}, compat ${meta})` };
  } catch {
    return { ok: false, message: "registry_meta not readable" };
  }
}

// ---------------------------------------------------------------------------
// §12 AUTO-INSTALL POLICY
// ---------------------------------------------------------------------------

export interface InstallPolicyCheck {
  ok: boolean;
  reason?: string;
  manualApproval?: boolean;
}

/** Decide whether a skill may be installed (auto or with confirmation). */
export function checkInstallPolicy(row: SkillRecord, cfg: HubConfig): InstallPolicyCheck {
  if (!["active", "unverified"].includes(row.status)) {
    return { ok: false, reason: `skill status '${row.status}' does not allow install` };
  }
  if (cfg.minimumScore > 0 && row.score < cfg.minimumScore) {
    return { ok: false, reason: `score ${row.score} below minimumScore ${cfg.minimumScore}` };
  }
  if (cfg.minimumStars > 0 && row.stars < cfg.minimumStars) {
    return { ok: false, reason: `stars ${row.stars} below minimumStars ${cfg.minimumStars}` };
  }
  if (cfg.verifiedOnly && row.verified !== 1) {
    return { ok: false, reason: "skill is not verified (verifiedOnly)" };
  }
  if (row.risk_level === "high" && cfg.maxRisk !== "high") {
    return { ok: false, reason: "Found potentially useful high-risk skill. Manual approval required.", manualApproval: true };
  }
  if (row.risk_level === "medium" && cfg.maxRisk === "low") {
    return { ok: false, reason: `risk 'medium' exceeds maxRisk 'low'` };
  }
  return { ok: true };
}

/** Resolve a skill by exact id, then by name (name is unique in the dataset). */
export function resolveSkill(db: DatabaseSync, identifier: string): SkillRecord | undefined {
  const byId = db.prepare("SELECT * FROM skills WHERE id=?").get(identifier) as SkillRecord | undefined;
  if (byId) return byId;
  return db.prepare("SELECT * FROM skills WHERE name=? COLLATE NOCASE LIMIT 1").get(identifier) as
    | SkillRecord
    | undefined;
}

export function safeDirName(name: string): string {
  return (name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 120)) || "skill";
}

// ---------------------------------------------------------------------------
// Content (lazy load from skill-market part files; hub.md sections 32, 37)
// ---------------------------------------------------------------------------
let partsDataDir: string | null = null;
export function setPartsDataDir(dir: string) {
  partsDataDir = dir;
}
function partsDir(): string {
  return (partsDataDir ||
    path.join(process.cwd(), "skill-market", "skills-data"));
}

const partCache = new Map<string, any[]>();

export function loadPart(cat: string): any[] {
  if (partCache.has(cat)) return partCache.get(cat)!;
  const file = path.join(partsDir(), `part-${cat}.js`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8");
  const marker = `SKILLS_PART['${cat}'] = `;
  const idx = text.indexOf(marker);
  if (idx === -1) return [];
  const start = text.indexOf("[", idx + marker.length);
  const end = text.lastIndexOf("];");
  let arr: any[] = [];
  if (start !== -1 && end > start) {
    try {
      arr = JSON.parse(text.slice(start, end + 1));
    } catch {
      arr = [];
    }
  }
  partCache.set(cat, arr);
  return arr;
}

export function getSkillContent(row: SkillRecord): { content_available: boolean; body?: string; frontmatter?: unknown; reason?: string } {
  const meta = getMetaJson(row);
  // Meta is normally written by the importer; fall back to parsing the
  // `${source}/${cat}/${folder}` id shape when meta is empty (e.g. rows
  // updated by older tooling).
  let cat = meta.cat as string | undefined;
  let folder = meta.folder as string | undefined;
  if ((!cat || !folder) && typeof row.id === "string") {
    const parts = row.id.split("/");
    if (parts.length >= 3) {
      if (!cat) cat = parts[1];
      if (!folder) folder = parts[2].replace(/#\d+$/, "");
    }
  }
  if (!cat) return { content_available: false, reason: "no category" };
  const entries = loadPart(cat);
  const entry =
    entries.find((e) => e.name === row.name) ||
    entries.find((e) => (folder && e.folder === folder) || e.folder === row.name);
  if (!entry) return { content_available: false, reason: "not in local dataset" };
  return { content_available: true, body: entry.body, frontmatter: entry.frontmatter };
}

// ---------------------------------------------------------------------------
// Registry migrations (hub.md §28)
// ---------------------------------------------------------------------------

/** Schema v2: installations gains updated_at, last_used, installed_commit. */
export function migrateRegistry(db: DatabaseSync, targetVersion = 2): number {
  const pragma = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = pragma.user_version;
  const cols = new Set(
    (db.prepare("PRAGMA table_info(installations)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (version < 2) {
    if (!cols.has("installed_commit")) db.exec("ALTER TABLE installations ADD COLUMN installed_commit TEXT");
    if (!cols.has("updated_at")) db.exec("ALTER TABLE installations ADD COLUMN updated_at TEXT");
    if (!cols.has("last_used")) db.exec("ALTER TABLE installations ADD COLUMN last_used TEXT");
    version = 2;
    db.exec("PRAGMA user_version = 2");
  }
  return version;
}

// ---------------------------------------------------------------------------
// Installed skills (hub.md sections 13, 28)
// ---------------------------------------------------------------------------
export interface InstallRow {
  skill_id: string;
  install_path: string;
  status: string;
  installed_at: string;
  installed_commit?: string;
  updated_at?: string;
  last_used?: string;
}

export function listInstalled(db: DatabaseSync): InstallRow[] {
  return (
    db
      .prepare(
        "SELECT skill_id, install_path, status, installed_at, installed_commit, updated_at, last_used FROM installations ORDER BY installed_at DESC"
      )
      .all() as unknown as InstallRow[]
  );
}

export const INSTALLABLE_STATUSES = ["active", "unverified"];

export function installSkill(
  db: DatabaseSync,
  row: SkillRecord,
  opts: { maxInstalledSkills?: number; skillsRoot?: string; policy?: HubConfig; force?: boolean } = {}
): { ok: boolean; path?: string; error?: string; manualApproval?: boolean } {
  // §12 install policy
  if (opts.policy) {
    const check = checkInstallPolicy(row, opts.policy);
    if (!check.ok) {
      return { ok: false, error: check.reason || "policy blocked install", manualApproval: check.manualApproval };
    }
  }
  const maxInstalled = opts.maxInstalledSkills ?? 100;
  const targetRoot = opts.skillsRoot || activeSkillsRoot();
  const current = listInstalled(db).filter((i) => i.status === "installed");
  if (current.length >= maxInstalled) {
    return { ok: false, error: `max installed skills reached (${maxInstalled})` };
  }

  const content = getSkillContent(row);
  if (!content.content_available) {
    return { ok: false, error: "content not available for install" };
  }

  const target = path.join(skillsRoot, safeDirName(row.name));
  fs.mkdirSync(target, { recursive: true });

  let markdown = content.body || "";
  const fm = content.frontmatter as Record<string, unknown> | undefined;
  if (!markdown.startsWith("---") && fm && Object.keys(fm).length) {
    const yaml = Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    markdown = `---\n${yaml}\n---\n\n${markdown}`;
  }
  fs.writeFileSync(path.join(target, "SKILL.md"), markdown);

  const marker = {
    installed_from: "skill-hub",
    installed_at: new Date().toISOString(),
    source_id: row.id,
  };
  fs.writeFileSync(path.join(target, ".mujo.json"), JSON.stringify(marker, null, 2));

  const meta = getMetaJson(row);
  meta.installed_at = marker.installed_at;
  meta.installed_dir = target;
  db.prepare("UPDATE skills SET meta_json=? WHERE id=?").run(JSON.stringify(meta), row.id);

  const commit = contentHash(markdown);
  const existing = db.prepare("SELECT id FROM installations WHERE skill_id=?").get(row.id);
  if (existing) {
    db.prepare(
      "UPDATE installations SET install_path=?, status='installed', installed_at=?, removed_at=NULL, installed_commit=?, updated_at=? WHERE skill_id=?"
    ).run(target, marker.installed_at, commit, marker.installed_at, row.id);
  } else {
    db.prepare(
      "INSERT INTO installations (skill_id, install_path, status, installed_at, installed_commit, updated_at) VALUES (?, ?, 'installed', ?, ?, ?)"
    ).run(row.id, target, marker.installed_at, commit, marker.installed_at);
  }

  return { ok: true, path: target };
}

export function uninstallSkill(db: DatabaseSync, row: SkillRecord): { ok: boolean; error?: string } {
  const fresh = db.prepare("SELECT * FROM skills WHERE id=?").get(row.id) as SkillRecord | undefined;
  const target = fresh ? (getMetaJson(fresh).installed_dir as string | undefined) : undefined;
  if (target && target.startsWith(activeSkillsRoot())) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (fresh) {
    const meta = getMetaJson(fresh);
    delete meta.installed_at;
    delete meta.installed_dir;
    db.prepare("UPDATE skills SET meta_json=? WHERE id=?").run(JSON.stringify(meta), row.id);
  }
  db.prepare("DELETE FROM installations WHERE skill_id=?").run(row.id);
  return { ok: true };
}