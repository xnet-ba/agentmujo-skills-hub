/**
 * sync-github.ts
 *
 * GitHub Sync Engine for the AgentMujo Skills Hub.
 *
 * Implements hub.md sections 19-25:
 *   19. GITHUB SYNC (lines 1461-1519) - steps 1-8
 *   20. INVALID SKILLS (lines 1529-1577)
 *   21. NEW SKILLS (lines 1581-1625)
 *   22. CATEGORY DETECTION (lines 1629-1699)
 *   23. TAG DETECTION (lines 1703-1735)
 *   24. DUPLICATES (lines 1741-1775)
 *   25. GITHUB API RATE LIMIT (lines 1779-1809)
 *
 * Design principles:
 *   - Incremental: check repo metadata (updated_at / latest commit / default
 *     branch) FIRST and only download a repo/skill when something changed.
 *   - Never use the GitHub API for every agent request (section 25).
 *   - Do NOT delete invalid skills physically - only mark status.
 *   - Use the built-in `node:sqlite` DatabaseSync module (verified available).
 *
 * Run: node scripts/sync-github.ts [--dry-run] [--limit N] [--repo owner/repo]
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration loading (section 26, lines 1815-1845)
// ---------------------------------------------------------------------------
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
  root: string;
  cacheDir: string;
  installedDir: string;
  downloadsDir: string;
  logsDir: string;
  installedSkillsPath: string;
}

function loadConfig(): Config {
  const root = path.join(__dirname, "..");
  const configPath = path.join(root, "config", "config.json");
  let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  // Normalize nested registry object to flat fields
  config.dbPath = config.registry?.dbPath ?? config.dbPath;
  config.registryDir = config.registry?.registryDir ?? config.registryDir;
  config.schemaVersion = config.registry?.schemaVersion ?? config.schemaVersion;
  config.compatVersion = config.registry?.compatVersion ?? config.compatVersion;

  // Resolve relative paths against the config file location so the script
  // works regardless of the current working directory.
  const resolve = (p: string | undefined, fallback: string): string => {
    if (!p) return fallback;
    const expanded = p.replace(/^~/, os.homedir());
    return path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
  };
  config.dbPath = resolve(config.registry?.dbPath ?? config.dbPath, path.join(os.homedir(), ".config", "opencode", "skill-hub", "registry.db"));
  config.registryDir = resolve(config.registry?.registryDir ?? config.registryDir, path.join(root, "registry"));
  const cache = config.cache ?? {};
  config.root = resolve(cache.root, path.join(os.homedir(), ".config", "opencode", "skill-hub"));
  config.cacheDir = path.join(config.root, cache.cacheDir ?? "cache");
  config.installedDir = path.join(config.root, cache.installedDir ?? "installed");
  config.downloadsDir = path.join(config.root, cache.downloadsDir ?? "downloads");
  config.logsDir = path.join(config.root, cache.logsDir ?? "logs");
  config.installedSkillsPath = resolve(config.installedSkillsPath, path.join(os.homedir(), ".config", "opencode", "skills"));
  return config;
}

// ---------------------------------------------------------------------------
// Source list (sources registered in the registry)
// ---------------------------------------------------------------------------
const DEFAULT_SOURCES = [
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

const MIN_QUALITY_SCORE_FOR_NEW = 75; // minimumScore from config, section 21
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h default (section 27)

// ---------------------------------------------------------------------------
// GitHub API client with rate-limit handling (section 25)
// ---------------------------------------------------------------------------
class GitHubClient {
  private token: string | undefined;
  private cache: Map<string, { data: unknown; ts: number }>;
  private cacheTtlMs: number;
  private rateLimitRemaining = 60;
  private rateLimitReset = 0;

  constructor(cacheDir: string, token?: string) {
    this.token = token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    this.cacheTtlMs = 60 * 60 * 1000; // 1h
    this.cache = new Map();
    // Persist cache to disk for cross-run incrementality (section 25).
    fs.mkdirSync(cacheDir, { recursive: true });
    this.cacheFile = path.join(cacheDir, "github-api-cache.json");
    this.loadCache();
  }

  private cacheFile: string;

  private loadCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
        for (const [k, v] of Object.entries(raw)) {
          this.cache.set(k, v);
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  private saveCache() {
    try {
      fs.writeFileSync(
        this.cacheFile,
        JSON.stringify(Object.fromEntries(this.cache))
      );
    } catch {
      /* ignore */
    }
  }

  private async sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async get(pathStr: string, force = false): Promise<any> {
    const key = pathStr;
    if (!force && this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      if (Date.now() - entry.ts < this.cacheTtlMs) {
        return entry.data;
      }
    }

    if (
      !this.token &&
      this.rateLimitRemaining <= 0 &&
      Date.now() < this.rateLimitReset
    ) {
      const wait = this.rateLimitReset - Date.now() + 1000;
      console.warn(
        `GitHub rate limit reached. Waiting ${(wait / 1000).toFixed(0)}s...`
      );
      await this.sleep(Math.min(wait, 65000));
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "AgentMujo-Skills-Hub",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`https://api.github.com${pathStr}`, {
          headers,
        });

        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = res.headers.get("x-ratelimit-reset");
        if (remaining) this.rateLimitRemaining = parseInt(remaining, 10);
        if (reset) this.rateLimitReset = parseInt(reset, 10) * 1000;

        if (res.status === 403 && this.rateLimitRemaining === 0) {
          const wait = Math.max(this.rateLimitReset - Date.now() + 1000, 0);
          console.warn(
            `Rate limited. Backing off ${(wait / 1000).toFixed(0)}s...`
          );
          await this.sleep(Math.min(wait, 65000));
          continue; // retry (attempt 0 -> 1)
        }

        if (res.status === 404) return null;
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
          await this.sleep(wait);
          continue;
        }
        if (res.status === 502 || res.status === 503) {
          await this.sleep(5000 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          lastErr = new Error(`GitHub API ${res.status}: ${res.statusText}`);
          break;
        }

        const data = await res.json();
        this.cache.set(key, { data, ts: Date.now() });
        this.saveCache();
        return data;
      } catch (e) {
        lastErr = e;
        await this.sleep(2000 * (attempt + 1));
      }
    }
    throw lastErr ?? new Error(`GitHub API request failed: ${pathStr}`);
  }

  async getRepoMeta(owner: string, repo: string): Promise<any> {
    return this.get(`/repos/${owner}/${repo}`);
  }

  async getLatestCommit(owner: string, repo: string, branch?: string): Promise<any> {
    const pathStr = branch
      ? `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}?per_page=1`
      : `/repos/${owner}/${repo}/commits?per_page=1`;
    const data = await this.get(pathStr);
    if (Array.isArray(data)) return data[0] ?? null;
    return data ?? null;
  }

  async getContentList(owner: string, repo: string, p: string): Promise<any> {
    return this.get(`/repos/${owner}/${repo}/contents/${p}`);
  }

  async getRateLimit(): Promise<any> {
    return this.get("/rate_limit");
  }
}

// ---------------------------------------------------------------------------
// Category detection (section 22, lines 1629-1699)
// ---------------------------------------------------------------------------
const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /docker|container|kubernetes|k8s|helm/i, category: "DevOps / Containers" },
  { pattern: /systemd|linux|ubuntu|debian|server|bash|shell|unix/i, category: "Linux / System Administration" },
  { pattern: /postgres|mysql|sql|database|nosql|redis|mongodb/i, category: "Database" },
  { pattern: /aws|azure|gcp|cloud|lambda|s3|ec2/i, category: "Cloud / AWS" },
  { pattern: /security|penetration|hack|vuln|audit|owasp/i, category: "Security" },
  { pattern: /python|python3|pip/i, category: "Python" },
  { pattern: /javascript|node|typescript|js|npm/i, category: "JavaScript / TypeScript" },
  { pattern: /react|next|vue|angular|frontend|front-end|ui/i, category: "Frontend" },
  { pattern: /express|flask|django|fastapi|backend|api|rest|graphql/i, category: "Backend / API" },
  { pattern: /ai|llm|gpt|claude|agent|prompt|machine.?learning|ml/i, category: "AI / LLM" },
  { pattern: /test|testing|e2e|unit|cypress|playwright|jest/i, category: "Testing" },
  { pattern: /git|github|ci|cd|pipeline|deploy|release/i, category: "CI/CD" },
  { pattern: /elastic|kibana|logstash|monitoring|observability|grafana|logging/i, category: "Monitoring / Observability" },
  { pattern: /terraform|ansible|puppet|chef|infrastructure|infra/i, category: "Infrastructure as Code" },
  { pattern: /design|figma|sketch|ux|ui\/|css|sass|tailwind/i, category: "Design" },
  { pattern: /wordpress|php|drupal|cms/i, category: "CMS / PHP" },
  { pattern: /github|gh|repo|git/i, category: "Git / GitHub" },
];

function detectCategory(
  repoName: string,
  skillName: string,
  description: string,
  topics: string[]
): string {
  const haystack = [repoName, skillName, description, topics.join(" ")].join(" ");
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Tag detection (section 23, lines 1703-1735)
// ---------------------------------------------------------------------------
const TAG_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /docker/i, tag: "docker" },
  { pattern: /container/i, tag: "containers" },
  { pattern: /kubernetes|k8s/i, tag: "kubernetes" },
  { pattern: /linux/i, tag: "linux" },
  { pattern: /security|secure/i, tag: "security" },
  { pattern: /vuln|exploit|pentest|penetration/i, tag: "pentesting" },
  { pattern: /hardening/i, tag: "hardening" },
  { pattern: /devops/i, tag: "devops" },
  { pattern: /aws/i, tag: "aws" },
  { pattern: /azure/i, tag: "azure" },
  { pattern: /gcp|google cloud/i, tag: "gcp" },
  { pattern: /python/i, tag: "python" },
  { pattern: /node|javascript/i, tag: "javascript" },
  { pattern: /typescript/i, tag: "typescript" },
  { pattern: /database|sql|postgres|mysql|redis/i, tag: "database" },
  { pattern: /ai|llm|gpt|claude|prompt/i, tag: "ai" },
  { pattern: /agent/i, tag: "agents" },
  { pattern: /test/i, tag: "testing" },
  { pattern: /ci|cicd|pipeline/i, tag: "ci-cd" },
  { pattern: /monitoring|observability|grafana|logging/i, tag: "observability" },
];

function detectTags(
  repoName: string,
  skillName: string,
  description: string,
  topics: string[],
  content: string
): string[] {
  const haystack = [
    repoName,
    skillName,
    description,
    topics.join(" "),
    content.slice(0, 2000),
  ].join(" ");
  const tags = new Set<string>();
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(haystack)) tags.add(rule.tag);
  }
  // Skill is always tagged with repo topics for extra signal
  if (topics && topics.length > 0) {
    for (const t of topics.slice(0, 3)) tags.add(t.toLowerCase());
  }
  return [...tags].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Security scan (section 18) - used during validation (step 6)
// ---------------------------------------------------------------------------
function securityScan(content: string): { risk: string; issues: string[] } {
  const issues: string[] = [];
  const checks: Array<{ pattern: RegExp; label: string; priority: 1 | 2 | 3 }> = [
    { pattern: /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "curl|bash pipe installation", priority: 3 },
    { pattern: /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "wget|sh pipe installation", priority: 3 },
    { pattern: /rm\s+-rf\s+\//i, label: "rm -rf / (destructive)", priority: 3 },
    { pattern: /rm\s+-rf\s+(~|\$HOME|\/root)/i, label: "rm -rf home (destructive)", priority: 3 },
    { pattern: /chmod\s+7{3}/i, label: "chmod 777", priority: 2 },
    { pattern: /ssh[-_]?key|id_rsa|id_ed25519/i, label: "SSH private key reference", priority: 3 },
    { pattern: /\.env\b/i, label: ".env access", priority: 2 },
    { pattern: /password\s*=|passwd/i, label: "password reference", priority: 2 },
    { pattern: /aws_secret|secret_key|api[_-]?key|token\s*=/i, label: "credential/API key", priority: 3 },
    { pattern: /sudo/i, label: "sudo usage", priority: 1 },
    { pattern: /mkfs|fdisk|dd\s+if=/i, label: "destructive filesystem", priority: 3 },
    { pattern: /chown\s+-R/i, label: "chown -R", priority: 2 },
  ];

  for (const check of checks) {
    if (check.pattern.test(content)) {
      issues.push(check.label);
    }
  }

  // Risk classification (hub.md section 18)
  const high = issues.filter((i) => {
    const rule = checks.find((c) => c.label === i);
    return rule && rule.priority === 3;
  });
  const medium = issues.filter((i) => {
    const rule = checks.find((c) => c.label === i);
    return rule && rule.priority === 2;
  });

  if (high.length > 0) return { risk: "high", issues };
  if (medium.length > 0) return { risk: "medium", issues };
  if (issues.length > 0) return { risk: "low", issues };
  return { risk: "low", issues };
}

// ---------------------------------------------------------------------------
// Skill score calculation (section 16) - recalculated on refresh (step 7)
// ---------------------------------------------------------------------------
function calculateScore(input: {
  relevance: number;
  stars: number;
  lastUpdateDays: number;
  hasDocs: boolean;
  activity: number;
  hasLicense: boolean;
  validated: boolean;
  security: number;
}): { score: number; quality: number; security: number; maintenance: number } {
  const starsScore = Math.min(input.stars / 100, 1); // 0..1, 100+ stars = full

  // Maintenance: recency of last update (inverse of lastUpdateDays)
  let maintenance = 0;
  if (input.lastUpdateDays <= 30) maintenance = 1;
  else if (input.lastUpdateDays <= 90) maintenance = 0.7;
  else if (input.lastUpdateDays <= 365) maintenance = 0.4;
  else maintenance = 0.15;

  const active = Math.min(input.activity / 50, 1);

  const raw =
    0.3 * input.relevance +
    0.2 * starsScore +
    0.15 * maintenance +
    0.1 * (input.hasDocs ? 1 : 0) +
    0.1 * active +
    0.05 * (input.hasLicense ? 1 : 0) +
    0.05 * (input.validated ? 1 : 0) +
    0.05 * input.security;

  const score = Math.round(Math.min(Math.max(raw, 0), 1) * 100);
  return {
    score,
    quality: Math.round(input.relevance * 100),
    security: Math.round(input.security * 100),
    maintenance: Math.round(maintenance * 100),
  };
}

// ---------------------------------------------------------------------------
// Registry database wrapper (schema.sql)
// ---------------------------------------------------------------------------
class Registry {
  private db: DatabaseSync;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    const dbPath = config.dbPath.replace(/^~/, os.homedir());
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.applySchemaIfNeeded();
    this.ensureSources();
  }

  private applySchemaIfNeeded() {
    const row = this.db
      .prepare("PRAGMA user_version")
      .get() as unknown as { user_version: number };
    const current = row.user_version;

    if (current !== this.config.schemaVersion) {
      const schemaPath = path.join(this.config.registryDir, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      // Re-apply schema. For a fresh DB this creates everything.
      // Note: mixed DDL (CREATE TABLE + FTS triggers) executes as one script.
      this.db.exec(schema);
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
    for (const s of DEFAULT_SOURCES) {
      insert.run(s.name, s.type, s.repository, s.url, s.priority, nowTs);
    }
  }

  getExistingSkill(id: string): any {
    return this.db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
  }

  getLastChecked(repo: string): { last_checked_at: string } | undefined {
    // Track last-check per repository in sources or via skills.
    // For simplicity use max(last_checked_at) across a repo's skills.
    const row = this.db
      .prepare(
        `SELECT MAX(last_checked_at) AS last_checked_at
         FROM skills WHERE repository = ?`
      )
      .get(repo) as { last_checked_at: string | null } | undefined;
    return row && row.last_checked_at
      ? { last_checked_at: row.last_checked_at }
      : undefined;
  }

  upsertSkill(s: Record<string, unknown>) {
    // Ensure repository_url is derived from repository if missing
    if (!s.repository_url && s.repository) {
      s.repository_url = `https://github.com/${s.repository}`;
    }

    // SQL statement for upserting a skill record. `last_checked_at` is bound
    // via parameter (callers always pass a value) matching the skills schema.
    const sql = `
      INSERT INTO skills(
        id, name, description, category, tags, repository, repository_url, author,
        stars, forks, license, last_update, score, quality, security,
        maintenance, verified, status, risk_level, content_hash,
        last_checked_at, meta_json
      ) VALUES(
        @id, @name, @description, @category, @tags, @repository, @repository_url, @author,
        @stars, @forks, @license, @last_update, @score, @quality, @security,
        @maintenance, @verified, @status, @risk_level, @content_hash,
        @last_checked_at, @meta_json
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        description=excluded.description,
        category=excluded.category,
        tags=excluded.tags,
        repository=excluded.repository,
        repository_url=excluded.repository_url,
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

    // Build a clean record with only the columns the skills table knows about.
    // This prevents "Unknown named parameter" errors when GitHub skills have
    // additional fields that SQLite doesn't recognize.
    const knownKeys = new Set([
      "id", "name", "description", "category", "tags", "repository",
      "repository_url", "author", "stars", "forks", "license",
      "last_update", "score", "quality", "security", "maintenance",
      "verified", "status", "risk_level", "content_hash",
      "last_checked_at", "meta_json",
    ]);
    const clean: Record<string, unknown> = {};
    for (const k of knownKeys) {
      if (k in s) {
        clean[k] = s[k];
      }
    }

    try {
      this.db.prepare(sql).run(clean);
    } catch (err) {
      console.error("[sync-github] upsertSkill error:", (err as Error).message);
      console.error("[sync-github] clean keys:", Object.keys(clean));
    }
  }

  setStatus(id: string, status: string) {
    this.db
      .prepare(
        `UPDATE skills SET status=?, last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`
      )
      .run(status, id);
  }

  addCategory(name: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO categories(name) VALUES(?)")
      .run(name);
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
// Main sync orchestration (sections 19-25)
// ---------------------------------------------------------------------------
interface Args {
  dryRun: boolean;
  limit: number;
  onlyRepo?: string;
  forceRefresh: boolean;
}

function parseArgs(raw: string[]): Args {
  const args: Args = { dryRun: false, limit: 0, forceRefresh: false };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit" && raw[i + 1]) args.limit = parseInt(raw[i + 1], 10);
    else if (a === "--repo" && raw[i + 1]) args.onlyRepo = raw[i + 1];
    else if (a === "--force") args.forceRefresh = true;
  }
  return args;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const SKILL_MD_GLOB = /skills?\.md$/i;

async function main() {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2));

  const cacheDir = config.cacheDir;

  const registry = new Registry(config);
  const gh = new GitHubClient(cacheDir, undefined);

  console.log(`[sync-github] Starting GitHub sync`);
  console.log(`  dryRun  : ${args.dryRun}`);
  console.log(`  limit   : ${args.limit || "none"}`);
  console.log(`  repo    : ${args.onlyRepo || "all sources"}`);

  // Rate-limit detection first (section 25)
  try {
    const rl = await gh.getRateLimit();
    if (rl && rl.rate) {
      console.log(
        `  rate    : ${rl.rate.remaining}/${rl.rate.limit} reset ${new Date(rl.rate.reset * 1000).toISOString()}`
      );
    }
  } catch (e) {
    console.warn(`  [warn]  : could not read rate limit: ${(e as Error).message}`);
  }

  // Resolve candidate sources: either the specific repo or the default sources.
  const sourceRepos: Array<{ owner: string; repo: string }> = [];
  if (args.onlyRepo) {
    const parts = args.onlyRepo.split("/");
    if (parts.length !== 2) {
      console.error(`Invalid --repo value: ${args.onlyRepo} (expected owner/repo)`);
      registry.close();
      process.exit(1);
    }
    sourceRepos.push({ owner: parts[0], repo: parts[1] });
  } else {
    for (const s of DEFAULT_SOURCES) {
      const parts = s.repository.split("/");
      sourceRepos.push({ owner: parts[0], repo: parts[1] });
    }
  }

  let processedCount = 0;
  const now = new Date();

  // -------------------------------------------------------------------------
  // Steps 1-5: per-repository metadata check and change detection
  // -------------------------------------------------------------------------
  for (const { owner, repo } of sourceRepos) {
    if (args.limit && processedCount >= args.limit) break;
    const repoKey = `${owner}/${repo}`;

    console.log(`\n[repo] ${repoKey}`);

    // Step 1: GitHub metadata
    let meta: any;
    try {
      meta = await gh.getRepoMeta(owner, repo);
    } catch (e) {
      console.warn(`  [warn] metadata fetch failed: ${(e as Error).message}`);
      continue;
    }

    // Step 3 (+20): repository deleted -> mark all its skills removed
    if (!meta) {
      console.log(`  -> repository not found; marking skills 'removed'`);
      const skills = registry
        .getAllSkills()
        .filter((s) => s.repository === repoKey);
      for (const s of skills) {
        if (!args.dryRun) registry.setStatus(s.id, "removed");
      }
      continue;
    }

    // Section 20: repo archived / not maintained -> stale
    const defaultBranch = meta.default_branch ?? "main";
    const pushedAt = meta.pushed_at ? new Date(meta.pushed_at) : null;
    const daysSincePush = pushedAt
      ? (now.getTime() - pushedAt.getTime()) / 86400000
      : Infinity;

    // Step 2: determine whether anything changed vs our last sync
    const lastChecked = registry.getLastChecked(repoKey);
    let changed = args.forceRefresh;

    // Check latest commit (step 4/5 change detection): only download if changed
    let latestCommit = null;
    try {
      latestCommit = await gh.getLatestCommit(owner, repo, defaultBranch);
    } catch (e) {
      console.warn(`  [warn] latest commit fetch failed: ${(e as Error).message}`);
    }

    if (!changed && lastChecked) {
      const lastCheckedDate = new Date(lastChecked.last_checked_at);
      changed = !latestCommit || new Date(latestCommit.commit?.committer?.date) > lastCheckedDate;
    } else if (!changed && !lastChecked) {
      // Bootstrap: never checked -> treat as changed (new skills)
      changed = true;
    }

    console.log(`  branch  : ${defaultBranch}`);
    console.log(`  pushed  : ${daysSincePush.toFixed(1)}d ago`);
    console.log(`  changed : ${changed}`);

    // Step 1 (cont): fetch repo-level metadata flags for scoring
    const topics = meta.topics ?? [];
    const description = meta.description ?? "";
    const stars = meta.stargazers_count ?? 0;
    const forks = meta.forks_count ?? 0;
    const license = meta.license?.spdx_id ?? meta.license?.key ?? "NOASSERTION";
    const hasLicense = !!meta.license;

    // -----------------------------------------------------------------------
    // Step 6: If changed, validate & sync skills (walk repo for SKILL.md)
    // -----------------------------------------------------------------------
    if (changed) {
      processedCount++;

      // Walk the repo root for skill directories (naive: list top-level contents)
      // In a full implementation we'd walk recursively; here we fetch the
      // top-level SKILL.md or list contents to locate skills.
      let skillsFound: any[] = [];
      try {
        const contents = await gh.getContentList(owner, repo, "");
        for (const entry of contents) {
          if (entry.type === "file" && SKILL_MD_GLOB.test(entry.name)) {
            // The repo root itself is a single skill
            skillsFound.push({
              name: entry.name.replace(/\.md$/i, ""),
              path: entry.path,
              type: entry.type,
              contentUrl: entry.download_url,
            });
          } else if (entry.type === "dir") {
            // Check for <dir>/SKILL.md
            try {
              const sub = await gh.getContentList(owner, repo, entry.path);
              const hasSkillMd = (sub || []).some(
                (e: any) =>
                  e.type === "file" && SKILL_MD_GLOB.test(e.name)
              );
              if (hasSkillMd) {
                skillsFound.push({
                  name: entry.name,
                  path: entry.path,
                  type: "dir",
                  contentUrl: null,
                });
              }
            } catch {
              /* ignore unreadable subdir */
            }
          }
        }
      } catch (e) {
        console.warn(`  [warn] content listing failed: ${(e as Error).message}`);
      }

      if (skillsFound.length === 0) {
        // No human skills found -> still mark known skills if they exist,
        // otherwise this repo contributes nothing.
        const known = registry
          .getAllSkills()
          .filter((s) => s.repository === repoKey);
        if (known.length === 0) {
          console.log(`  -> no SKILL.md found in repo (skipping)`);
        } else {
          // Section 20: SKILL.md no longer exists -> invalid
          for (const s of known) {
            if (s.status !== "removed") {
              console.log(`  -> marking '${s.id}' invalid (no SKILL.md)`);
              if (!args.dryRun) registry.setStatus(s.id, "invalid");
            }
          }
        }
        continue;
      }

      // Load SKILL.md content (fetch raw markdown)
      for (const skill of skillsFound) {
        let content = "";
        if (skill.contentUrl) {
          try {
            const res = await fetch(skill.contentUrl);
            content = await res.text();
          } catch (e) {
            console.warn(
              `  [warn] could not fetch content for ${skill.path}: ${(e as Error).message}`
            );
          }
        }

        const id = `${owner}/${repo}/${skill.path.replace(/\/?SKILL\.md$/i, "")}`;
        const skillName = skill.name || path.basename(id);
        const contentHash = hashContent(content || id);

        // Section 22: category + Section 23: tags
        const category = detectCategory(repo, skillName, description, topics);
        const tags = detectTags(repo, skillName, description, topics, content);

        // Section 18: security scan
        const sec = securityScan(content || "no content");

        // Risk decision (config.maxRisk)
        const riskLevel = sec.risk;

        // Section 16: score
        const lastUpdateDays = pushedAt
          ? (now.getTime() - pushedAt.getTime()) / 86400000
          : 9999;
        const hasDocs = content.length > 300;
        const scoreParts = calculateScore({
          relevance: 0.7, // relevance determined more precisely in ranking steps
          stars,
          lastUpdateDays,
          hasDocs,
          activity: meta.open_issues_count ?? 0,
          hasLicense,
          validated: true,
          security: riskLevel === "high" ? 0.2 : riskLevel === "medium" ? 0.6 : 1,
        });

        const existing = registry.getExistingSkill(id);

        // Section 21: new skill gating
        const isNew = !existing;
        if (isNew) {
          const passesNewGate = content.length > 0 || skill.contentUrl !== null; // SKILL.md exists
          const repoPublic = !meta.private;
          const qualityOk = scoreParts.score >= config.minimumScore;

          if (!repoPublic) {
            console.log(`  -> skip new '${id}' (private repo)`);
            continue;
          }
          if (!passesNewGate) {
            console.log(`  -> skip new '${id}' (no SKILL.md content)`);
            continue;
          }
          if (!hasLicense) {
            console.log(`  -> skip new '${id}' (no acceptable license)`);
            continue;
          }
          if (!qualityOk) {
            console.log(
              `  -> skip new '${id}' (score ${scoreParts.score} < min ${config.minimumScore})`
            );
            continue;
          }
        }

        const status = isNew ? "active" : existing.status === "removed" ? "active" : existing.status;

        if (!args.dryRun) {
          registry.upsertSkill({
            id,
            name: skillName,
            description: description || undefined,
            category,
            tags: JSON.stringify(tags),
            repository: repoKey,
            author: owner,
            stars,
            forks,
            license: license || undefined,
            last_update: meta.pushed_at,
            score: scoreParts.score,
            quality: scoreParts.quality,
            security: scoreParts.security,
            maintenance: scoreParts.maintenance,
            verified: meta.owner?.type === "Organization" ? 1 : 0,
            status,
            risk_level: riskLevel,
            content_hash: contentHash,
            last_checked_at: new Date().toISOString(),
            meta_json: JSON.stringify({ topics, private: meta.private, html_url: meta.html_url, issues: sec.issues }),
          });

          registry.addCategory(category);
          registry.linkSkillCategory(id, category);
          for (const t of tags) {
            registry.addTag(t);
          }
          registry.linkSkillTags(id, tags);

          console.log(
            `  ${isNew ? "+ new" : "~ updated"} '${id}' (${category}, score ${scoreParts.score}, risk ${riskLevel})`
          );
        } else {
          console.log(
            `  [dry-run] ${isNew ? "+ new" : "~ updated"} '${id}' (${category}, score ${scoreParts.score}, risk ${riskLevel})`
          );
        }
      }
    } else {
      // Not changed -> just update last_checked_at for existing skills (step 8)
      const known = registry
        .getAllSkills()
        .filter((s) => s.repository === repoKey);
      for (const s of known) {
        if (!args.dryRun && s.status === "active") {
          registry.setStatus(s.id, s.status);
        }
      }
      console.log(`  -> no changes; touched ${known.length} known skills`);
    }

    // Section 20: mark stale if not maintained recently (even if unchanged)
    if (!args.dryRun && daysSincePush > 365) {
      const known = registry
        .getAllSkills()
        .filter((s) => s.repository === repoKey && s.status === "active");
      for (const s of known) {
        registry.setStatus(s.id, "stale");
      }
      console.log(`  -> marked ${known.length} skills stale (>365d no push)`);
    }
  }

  // -------------------------------------------------------------------------
  // Sections 24 / 7: Duplicate detection (step 7 recalc)
  // -------------------------------------------------------------------------
  const all = registry.getAllSkills();
  const contentHashMap = new Map<string, string[]>();
  for (const s of all) {
    if (s.status === "removed" || s.status === "invalid") continue;
    const arr = contentHashMap.get(s.content_hash) || [];
    arr.push(s.id);
    contentHashMap.set(s.content_hash, arr);
  }

  let dupCount = 0;
  for (const [hash, ids] of contentHashMap.entries()) {
    if (ids.length > 1) {
      // Identical content duplicates (section 24)
      dupCount += ids.length - 1;
      // Keep the highest-scoring as recommended; mark others via meta
      ids.sort((a, b) => {
        const sa = registry.getExistingSkill(a)?.score ?? 0;
        const sb = registry.getExistingSkill(b)?.score ?? 0;
        return sb - sa;
      });
      const best = ids[0];
      for (let i = 1; i < ids.length; i++) {
        const worse = registry.getExistingSkill(ids[i]);
        const meta = worse && worse.meta_json ? JSON.parse(worse.meta_json) : {};
        meta.duplicate_of = best;
        meta.recommended = null;
        if (!args.dryRun) {
          registry.upsertSkill({ ...worse, meta_json: JSON.stringify(meta) });
        }
      }
    }
  }
  if (dupCount > 0) {
    console.log(`\n[duplicates] detected ${dupCount} duplicate content entries`);
  } else {
    console.log(`\n[duplicates] none detected`);
  }

  registry.close();
  console.log(`\n[sync-github] Done.`);
}

// Helper to resolve home dir (await in main)
function homeDir(): Promise<string> {
  return Promise.resolve(os.homedir());
}

main().catch((e) => {
  console.error("[sync-github] FATAL:", e);
  process.exit(1);
});
