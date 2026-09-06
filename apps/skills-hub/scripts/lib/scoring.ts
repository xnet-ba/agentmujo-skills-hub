/**
 * Shared scoring, security scanning, and validation (hub.md §16, §17, §18, §22, §23).
 *
 * Single source of truth used by validate-skills.ts, calculate-score.ts,
 * sync-github.ts, the CLI, and the web server.
 */

import createHash from "node:crypto";

// ---------------------------------------------------------------------------
// §18 SECURITY SCAN
// ---------------------------------------------------------------------------

export interface SecurityScanResult {
  risk: "low" | "medium" | "high";
  issues: string[];
  scoreDelta: number;
  securityScore: number; // 0-100
}

const SECURITY_PATTERNS: Array<{ pattern: RegExp; label: string; priority: 1 | 2 | 3; delta: number }> = [
  // HIGH (priority 3)
  { pattern: /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "curl|bash pipe installation", priority: 3, delta: 20 },
  { pattern: /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "wget|sh pipe installation", priority: 3, delta: 20 },
  { pattern: /rm\s+-rf\s+\//i, label: "rm -rf / (destructive)", priority: 3, delta: 20 },
  { pattern: /rm\s+-rf\s+(~|\$HOME|\/root)/i, label: "rm -rf home (destructive)", priority: 3, delta: 20 },
  { pattern: /ssh[-_]?key|id_rsa|id_ed25519/i, label: "SSH private key reference", priority: 3, delta: 20 },
  { pattern: /aws_secret|secret_key|api[_-]?(key|secret)|token\s*=/i, label: "credential/API key", priority: 3, delta: 20 },
  { pattern: /mkfs|fdisk|dd\s+if=/i, label: "destructive filesystem", priority: 3, delta: 20 },
  { pattern: /\.ssh\/(authorized_keys|config)\b/i, label: "SSH config/keys access", priority: 3, delta: 20 },
  // MEDIUM (priority 2)
  { pattern: /chmod\s+7{3}/i, label: "chmod 777", priority: 2, delta: 10 },
  { pattern: /\.env\b/i, label: ".env access", priority: 2, delta: 10 },
  { pattern: /password\s*=|passwd/i, label: "password reference", priority: 2, delta: 10 },
  { pattern: /chown\s+-R/i, label: "chown -R", priority: 2, delta: 10 },
  // LOW (priority 1)
  { pattern: /sudo/i, label: "sudo usage", priority: 1, delta: 3 },
];

export function securityScan(content: string): SecurityScanResult {
  const issues: string[] = [];
  let scoreDelta = 0;
  for (const check of SECURITY_PATTERNS) {
    if (check.pattern.test(content)) {
      issues.push(check.label);
      scoreDelta += check.delta;
    }
  }
  const hasHigh = issues.some((l) => SECURITY_PATTERNS.some((c) => c.label === l && c.priority === 3));
  const hasMedium = issues.some((l) => SECURITY_PATTERNS.some((c) => c.label === l && c.priority === 2));
  const risk: SecurityScanResult["risk"] = hasHigh ? "high" : hasMedium ? "medium" : issues.length ? "low" : "low";
  const penalty = hasHigh ? 20 : hasMedium ? 10 : 0;
  const securityScore = Math.max(100 - scoreDelta - penalty, 0);
  return { risk, issues, scoreDelta, securityScore };
}

// ---------------------------------------------------------------------------
// §16 SKILL SCORE
// ---------------------------------------------------------------------------

export interface ScoreInput {
  relevance: number;      // 0-1 (search/ranking relevance)
  stars: number;
  lastUpdateDays: number;
  hasDocs: boolean;       // documentation quality signal
  activity: number;       // repo activity 0-1
  hasLicense: boolean;
  validated: boolean;
  security: number;       // 0-1
}

export interface ScoreOutput {
  score: number;          // 0-100
  quality: number;
  security: number;
  maintenance: number;
}

/** Weighted Skill Score (§16): relevance 30, popularity 20, maintenance 15, docs 10, activity 10, license 5, validation 5, security 5. */
export function calculateScore(input: ScoreInput): ScoreOutput {
  const starsScore = Math.min(input.stars / 100, 1);
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
// §17 VALIDATION + §20 STATUS RULES
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  description?: string;
}

const FM_REQUIRED_KEYS = ["name", "description"];

/** Parse YAML-ish frontmatter ("---\nkey: value\n---") from the top of a SKILL.md body. */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const trimmed = (content || "").replace(/^\uFEFF/, "");
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value: unknown = line.slice(i + 1).trim();
    value = /^(".*"|'.*')$/.test(value) ? value.slice(1, -1) : value;
    value = value === "" ? undefined : value;
    fm[key] = value;
  }
  return fm;
}

export function validateSkillBody(content: string): ValidationResult {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    return { valid: false, errors: ["empty SKILL.md"] };
  }
  const fm = parseFrontmatter(content);
  for (const key of FM_REQUIRED_KEYS) {
    const v = fm[key];
    if (v === undefined || String(v).trim() === "") {
      errors.push(`missing frontmatter key: ${key}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Derived status per §20:
 *  - content missing            → invalid
 *  - frontmatter invalid        → invalid
 *  - last_update older than staleDays and not checked recently → stale
 *  - otherwise                  → previous status (fallback active only if it was active)
 */
export function deriveStatus(opts: {
  previous: string;
  hasContent: boolean;
  frontmatterValid: boolean;
  lastUpdateDays: number | null;
  staleDays: number;
}): string {
  const base = ["active", "stale"].includes(opts.previous) ? opts.previous : "unverified";
  if (!opts.hasContent) return "invalid";
  if (!opts.frontmatterValid) return "invalid";
  if (opts.lastUpdateDays !== null && opts.lastUpdateDays > opts.staleDays) return "stale";
  return base;
}

// ---------------------------------------------------------------------------
// §23 TAG + §22 CATEGORY DETECTION
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  { category: "DevOps & infra", keywords: ["docker", "container", "k8s", "kubernetes", "terraform", "ansible", "ci", "cd", "github actions", "infrastructure", "provision"] },
  { category: "Security", keywords: ["security", "pentest", "hardening", "vulnerability", "cyber", "auth", "secret"] },
  { category: "Database", keywords: ["postgres", "postgresql", "mysql", "sqlite", "database", "redis", "mongo", "sql"] },
  { category: "Linux & system", keywords: ["linux", "systemd", "ubuntu", "debian", "server", "shell script", "sysadmin", "terminal"] },
  { category: "Git & workflow", keywords: ["git", "github", "branch", "merge", "commit", "pr"] },
  { category: "Web & frontend", keywords: ["react", "css", "html", "javascript", "typescript", "frontend", "web", "design"] },
  { category: "Backend & API", keywords: ["api", "graphql", "rest", "backend", "microservice", "node", "go"] },
  { category: "Data, AI & ML", keywords: ["data", "ml", "ai", "machine learning", "pandas", "analytics", "model"] },
  { category: "Testing", keywords: ["test", "tdd", "playwright", "jest", "pytest", "unit test", "e2e"] },
  { category: "Code quality", keywords: ["lint", "refactor", "code review", "static analysis", "quality"] },
  { category: "Cloud", keywords: ["aws", "azure", "gcp", "cloud"] },
  { category: "Automation & tools", keywords: ["automation", "script", "cli", "workflow", "bot"] },
];

export function deriveTags(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const tags = new Set<string>();
  for (const { keywords } of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw) && kw.length >= 3) {
        tags.add(kw.replace(/\s+/g, "-"));
        break;
      }
    }
  }
  for (const w of text.match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (["skill", "use", "when", "about", "with"].includes(w)) continue;
    if (w.length >= 5 && w.length <= 20 && !tags.has(w)) tags.add(w);
  }
  // keep the dataset's noise floor low
  return [...tags].filter((t) => !["skill", "awesome", "omni"].includes(t)).slice(0, 12);
}

export function detectCategory(name: string, description: string): string | undefined {
  const text = `${name} ${description}`.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) return category;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}