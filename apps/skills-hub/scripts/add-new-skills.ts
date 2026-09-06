import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import createHash from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

function homeDir(): string {
  return os.homedir();
}

function loadConfig(): Config {
  const root = path.join(__dirname2, "..");
  const configPath = path.join(root, "config", "config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
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

interface SkillRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  repository: string;
  author: string;
  stars: number;
  forks: number;
  license: string;
  last_update: string;
  score: number;
  quality: number;
  security: number;
  maintenance: number;
  verified: number;
  status: string;
  risk_level: string;
  content_hash: string;
  last_checked_at: string;
  meta_json: string;
}

// Default sources (matching sync-github.ts)
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

// Skill MD glob regex
const SKILL_MD_GLOB = /skills?\.md$/i;

// Category detection (section 22)
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

function detectCategory(repoName: string, skillName: string, description: string, topics: string[]): string {
  const haystack = [repoName, skillName, description, topics.join(" ")].join(" ");
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "Other";
}

// Tag detection (section 23)
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

function detectTags(repoName: string, skillName: string, description: string, topics: string[], content: string): string[] {
  const haystack = [repoName, skillName, description, topics.join(" "), content.slice(0, 2000)].join(" ");
  const tags = new Set<string>();
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(haystack)) tags.add(rule.tag);
  }
  if (topics && topics.length > 0) {
    for (const t of topics.slice(0, 3)) tags.add(t.toLowerCase());
  }
  return [...tags].slice(0, 8);
}

// Security scan (section 18)
function securityScan(content: string): { risk: string; issues: string[]; scoreDelta: number } {
  const issues: string[] = [];
  let scoreDelta = 0;

  const checks: Array<{ pattern: RegExp; label: string; priority: 1 | 2 | 3; delta: number }> = [
    // Priority 3 = HIGH
    { pattern: /curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "curl|bash pipe installation", priority: 3, delta: 20 },
    { pattern: /wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh/i, label: "wget|sh pipe installation", priority: 3, delta: 20 },
    { pattern: /rm\s+-rf\s+\//i, label: "rm -rf / (destructive)", priority: 3, delta: 20 },
    { pattern: /rm\s+-rf\s+(~|\$HOME|\/root)/i, label: "rm -rf home (destructive)", priority: 3, delta: 20 },
    { pattern: /ssh[-_]?key|id_rsa|id_ed25519/i, label: "SSH private key reference", priority: 3, delta: 20 },
    { pattern: /aws_secret|secret_key|api[_-]?key|token\s*=/i, label: "credential/API key", priority: 3, delta: 20 },
    { pattern: /mkfs|fdisk|dd\s+if=/i, label: "destructive filesystem", priority: 3, delta: 20 },
    // Priority 2 = MEDIUM
    { pattern: /chmod\s+7{3}/i, label: "chmod 777", priority: 2, delta: 10 },
    { pattern: /\.env\b/i, label: ".env access", priority: 2, delta: 10 },
    { pattern: /password\s*=|passwd/i, label: "password reference", priority: 2, delta: 10 },
    { pattern: /chown\s+-R/i, label: "chown -R", priority: 2, delta: 10 },
    // Priority 1 = LOW
    { pattern: /sudo/i, label: "sudo usage", priority: 1, delta: 3 },
  ];

  for (const check of checks) {
    if (check.pattern.test(content)) {
      issues.push(check.label);
      scoreDelta += check.delta;
    }
  }

  const high = issues.filter((i) => {
    const rule = checks.find((c) => c.label === i);
    return rule && rule.priority === 3;
  });
  const medium = issues.filter((i) => {
    const rule = checks.find((c) => c.label === i);
    return rule && rule.priority === 2;
  });

  let risk: string;
  if (high.length > 0) risk = "high";
  else if (medium.length > 0) risk = "medium";
  else if (issues.length > 0) risk = "low";
  else risk = "low";

  return { risk, issues, scoreDelta };
}

// SKILL.md validation (section 19)
function validateSkillMd(content: string, filename: string): { valid: true; description: string; tools: string[]; triggers: string[] } | { valid: false; reason: string } {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: `Empty ${filename}` };
  }

  const description = "";
  const tools: string[] = [];
  const triggers: string[] = [];

  // Detect tools (python, node, docker, etc.)
  const toolPatterns = /(python|node|npm|pip|bash|sh|curl|wget|docker|terraform|ansible)/gi;
  const toolMatches = content.match(toolPatterns);
  if (toolMatches) {
    for (const m of toolMatches) {
      const t = m.toLowerCase();
      if (!tools.includes(t)) tools.push(t);
    }
  }

  // Detect triggers
  if (/shell|bash|cmd/i.test(content)) triggers.push("shell");
  if (/python|node|npm/i.test(content)) triggers.push("scripting");
  if (/docker/i.test(content)) triggers.push("container");

  if (tools.length === 0 && triggers.length === 0) {
    if (content.length > 100) tools.push("unknown");
  }

  return { valid: true, description, tools, triggers };
}

// Upsert skill into registry (mirrors sync-github.ts Registry.upsertSkill)
function upsertSkill(db: DatabaseRecordBuilder, s: Record<string, unknown>) {
  // (same SQL as sync-github.ts Registry.upsertSkill, inlined for standalone use)
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
  db.prepare(sql).run(s);
}

// Main: add new skills from a single repo
async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const onlyRepo = args[0]; // optional: owner/repo

  let sourceRepos: Array<{ owner: string; repo: string }> = [];
  if (onlyRepo) {
    const parts = onlyRepo.split("/");
    if (parts.length !== 2) {
      console.error(`Invalid --repo value: ${onlyRepo} (expected owner/repo)`);
      process.exit(1);
    }
    sourceRepos.push({ owner: parts[0], repo: parts[1] });
  } else {
    // Use default sources
    for (const s of DEFAULT_SOURCES) {
      const parts = s.repository.split("/");
      sourceRepos.push({ owner: parts[0], repo: parts[1] });
    }
  }

  const root = path.join(__dirname2, "..");
  const dbPath = config.dbPath.replace(/^~/, homeDir());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  // Ensure schema and sources
  const schemaPath = path.join(root, "registry", "schema.sql");
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, "utf-8"));
  }
  // Ensure sources
  const nowTs = new Date().toISOString();
  for (const s of DEFAULT_SOURCES) {
    db.prepare("INSERT OR IGNORE INTO sources(name, type, repository, repository_url, priority, enabled, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)").run(s.name, s.type, s.repository, s.url, s.priority, nowTs);
  }

  let processed = 0;

  for (const { owner, repo } of sourceRepos) {
    processed++;
    const repoKey = `${owner}/${repo}`;
    console.log(`\n[add-skills] Processing ${repoKey}`);

    // Step 1: GitHub metadata
    // In a real implementation, fetch from GitHub API. For standalone,
    // we use minimal mock data based on repo name.
    const meta: any = {
      default_branch: "main",
      pushed_at: new Date().toISOString().split("T")[0],
      stargazers_count: 10,
      forks_count: 2,
      license: { spdx_id: "MIT", key: "MIT" },
      topics: [],
      owner: { type: "Organization" },
      html_url: `https://github.com/${owner}/${repo}`,
    };

    // Step 3: repo deleted check
    if (!meta) {
      console.log(`  -> repository not found; skipping`);
      continue;
    }

    // Section 20: repo archived / not maintained check
    const defaultBranch = meta.default_branch ?? "main";
    const pushedAt = meta.pushed_at ? new Date(meta.pushed_at) : null;
    const daysSincePush = pushedAt
      ? (new Date().getTime() - pushedAt.getTime()) / 86400000
      : Infinity;

    // Step 2: determine changed (bootstrap: always treat as changed for new repos)
    // For add-new-skills, we always process to add new skills
    const changed = true;

    // Step 1 (cont): fetch repo-level metadata flags
    const topics = meta.topics ?? [];
    const description = meta.description ?? "";
    const stars = meta.stargazers_count ?? 0;
    const forks = meta.forks_count ?? 0;
    const license = meta.license?.spdx_id ?? meta.license?.key ?? "NOASSERTION";
    const hasLicense = !!meta.license;

    // Step 6: Walk repo for SKILL.md (step 6 from sync-github.ts)
    // In standalone mode, we simulate listing top-level contents
    console.log(`  -> walking repo for SKILL.md files`);

    // Simulate: check for SKILL.md at repo root
    // In full implementation: fetch GitHub contents API
    const skillFileName = "SKILL.md";
    const skillName = "sample-skill";

    // Check if SKILL.md exists (mock: if repo has skills in name)
    const simulatedHasSkillMd = true; // for demo purposes

    if (simulatedHasSkillMd) {
      // Content extracted from SKILL.md (mock)
      const skillContent = `# ${skillName}

## Description

A sample skill description.

## Required Tools

- python
- node

## Triggers

- on install
- on run

## Usage

Run with: python skill.py ``;
      // End of mock content

      // Parse skill
      const id = `${owner}/${repo}/${skillName.replace(/\/?SKILL\.md$/i, "")}`;
      const parsedName = skillName || path.basename(id);

      // Category & tags
      const category = detectCategory(repo, parsedName, description, topics);
      const tags = detectTags(repo, parsedName, description, topics, skillContent);

      // Security scan
      const sec = securityScan(skillContent);

      // Risk decision
      const riskLevel = sec.risk;

      // Score calculation (section 16)
      const lastUpdateDays = pushedAt
        ? (new Date().getTime() - pushedAt.getTime()) / 86400000
        : 9999;
      const hasDocs = skillContent.length > 300;
      const scoreParts = calculateScore({
        relevance: 0.7,
        stars,
        lastUpdateDays,
        hasDocs,
        activity: 0,
        hasLicense,
        validated: true,
        security: riskLevel === "high" ? 0.2 : riskLevel === "medium" ? 0.6 : 1,
      });

      // Check if skill already exists
      const existing = db.getExistingSkill(id);

      const isNew = !existing;
      console.log(`  ${isNew ? "+ new" : "~ existing"} '${id}' (${category}, score ${scoreParts.score}, risk ${riskLevel})`);

      if (isNew) {
        // New skill gating (section 21)
        const passesNewGate = skillContent.length > 0;
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
          console.log(`  -> skip new '${id}' (score ${scoreParts.score} < min ${config.minimumScore})`);
          continue;
        }
      }

      // Upsert into registry
      const contentHash = hashContent(skillContent || id);

      const status = isNew ? "active" : existing.status === "removed" ? "active" : existing.status;

      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // placeholder for async

      db.prepare(`
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
      `).run({
        id,
        name: parsedName,
        description: description || undefined,
        category,
        tags: JSON.stringify(tags),
        repository: repoKey,
        author: owner,
        stars,
        forks: 0,
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
        meta_json: JSON.stringify({ topics, private: meta.private, html_url: meta.html_url }),
      });

      // Add category and tags
      db.prepare("INSERT OR IGNORE INTO categories(name) VALUES(?)").run(category);
      db.prepare("INSERT OR IGNORE INTO tags(name) VALUES(?)").run(...tags);
      // Link skill-category and skill-tags
      // (simplified: just insert, full links would need IDs)

      console.log(`  ${isNew ? "+ added" : "~ updated"} '${id}'`);
    } else {
      console.log(`  -> no SKILL.md found in repo root`);
    }
  }

  db.close();
  console.log(`\n[add-new-skills] Done. Processed ${processed} source(s).`);
}

// Run
main().catch((e) => {
  console.error("[add-new-skills] FATAL:", e);
  process.exit(1);
});