/**
 * agentmujo-skills — OpenCode plugin tools (hub.md §10).
 * These tools now use the real core engine (scripts/lib/core) so that
 * install / update / remove / refresh actually persist skill content
 * (SKILL.md) into the user's ~/.config/opencode/skills directory,
 * respect auto-install policy (§12), and write health_checks rows.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
  openRegistry,
  resolveSkill,
  getSkillContent,
  installSkill,
  uninstallSkill,
  checkInstallPolicy,
  HubConfig,
} from "../../apps/skills-hub/scripts/lib/core.ts";
import { securityScan, contentHash } from "../../apps/skills-hub/scripts/lib/scoring.ts";

// ---------------------------------------------------------------------------
// Config: flatten registry.* → top-level (matches loadHubConfig behaviour)
// ---------------------------------------------------------------------------
function loadConfig(): HubConfig {
  const home = os.homedir();
  const configPath = path.join(home, ".config", "opencode", "skill-hub", "config.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // default config used below
  }
  const reg = (raw.registry ?? {}) as Record<string, unknown>;
  return {
    dbPath: (reg.dbPath as string) ?? (raw.dbPath as string) ?? path.join(home, ".config", "opencode", "skill-hub", "registry.db"),
    registryDir: (reg.registryDir as string) ?? (raw.registryDir as string) ?? path.join(home, ".config", "opencode", "skill-hub", "registry"),
    schemaVersion: Number(reg.schemaVersion ?? raw.schemaVersion ?? 1),
    compatVersion: (reg.compatVersion as string) ?? (raw.compatVersion as string) ?? "0.1.0",
    autoInstall: (raw.autoInstall as boolean) ?? true,
    maxRisk: ((reg.maxRisk as string) ?? (raw.maxRisk as string) ?? "medium") as HubConfig["maxRisk"],
    minimumScore: Number(reg.minimumScore ?? raw.minimumScore ?? 75),
    minimumStars: Number(reg.minimumStars ?? raw.minimumStars ?? 0),
    verifiedOnly: (raw.verifiedOnly as boolean) ?? false,
    autoRefresh: (raw.autoRefresh as boolean) ?? true,
    refreshInterval: (raw.refreshInterval as string) ?? "24h",
    maxInstalledSkills: Number(reg.maxInstalledSkills ?? raw.maxInstalledSkills ?? 100),
  };
}

// ---------------------------------------------------------------------------
// DB: open registry (auto-migration v2 — adds installed_commit/updated_at/last_used)
// ---------------------------------------------------------------------------
function getDb(): DatabaseSync {
  const cfg = loadConfig();
  fs.mkdirSync(path.dirname(cfg.dbPath.replace(/^~/, os.homedir())), { recursive: true });
  return openRegistry(cfg.dbPath);
}

// ---------------------------------------------------------------------------
// §10: skill_search — use FTS5 index via direct DB query + part content resolve
// ---------------------------------------------------------------------------
async function skill_search(filters: {
  query?: string;
  category?: string;
  tags?: string[];
  minimum_score?: number;
  minimum_stars?: number;
  verified?: boolean;
  risk_level?: string;
  limit?: number;
}): Promise<Array<{
  id: string; name: string; description: string; repository: string;
  score: number; stars: number; risk: string; verified: boolean;
  install_status: "not_installed" | "installed" | "update_available" | "error";
}>> {
  const db = getDb();
  let sql = "SELECT s.id, s.name, s.description, s.repository, s.score, s.stars, s.risk_level, s.verified, s.status FROM skills s WHERE 1=1";
  const params: any[] = [];

  if (filters.query) {
    sql += " AND s.id LIKE ? OR s.name LIKE ? OR s.description LIKE ?";
    const q = `%${filters.query}%`;
    params.push(q, q, q);
  }
  if (filters.category && filters.category !== "All") {
    sql += " AND LOWER(s.category) = LOWER(?)";
    params.push(filters.category);
  }
  if (filters.tags && filters.tags.length > 0) {
    // simple tag-contains using LIKE on the JSON text column
    sql += ` AND (${filters.tags.map(() => "s.tags LIKE ?").join(" OR ")})`;
    params.push(...filters.tags.map(() => `%${filters.tags[0]}%`));
  }
  if (filters.minimum_score !== undefined) {
    sql += " AND s.score >= ?";
    params.push(filters.minimum_score);
  }
  if (filters.minimum_stars !== undefined) {
    sql += " AND s.stars >= ?";
    params.push(filters.minimum_stars);
  }
  if (filters.verified !== undefined) {
    sql += " AND s.verified = ?";
    params.push(filters.verified ? 1 : 0);
  }
  if (filters.risk_level) {
    sql += " AND s.risk_level = ?";
    params.push(filters.risk_level);
  }
  sql += " ORDER BY s.score DESC";
  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string; name: string; description: string; repository: string;
    score: number; stars: number; risk_level: string; verified: number; status: string;
  }>;

  return rows.map(row => {
    const installStatus = row.status === "active" && row.status !== "removed" ? "installed" : "not_installed";
    return {
      id: row.id,
      name: row.name,
      description: row.description || "",
      repository: row.repository,
      score: row.score,
      stars: row.stars,
      risk: row.risk_level,
      verified: row.verified === 1,
      install_status: installStatus,
    };
  });
}

// ---------------------------------------------------------------------------
// §10: skill_info — resolve via core engine, load real content
// ---------------------------------------------------------------------------
async function skill_info(id: string): Promise<{
  id: string; name: string; description: string; repository: string;
  score: number; stars: number; forks: number; license: string;
  risk: string; verified: boolean; install_status: string;
  category: string; tags: string[];
  content?: string; frontmatter?: unknown;
} | null> {
  const db = getDb();
  const skill = resolveSkill(db, id);
  if (!skill) return null;

  const tags = skill.tags ? JSON.parse(skill.tags) : [];
  const installStatus = skill.status === "active" && skill.status !== "removed" ? "installed" : "not_installed";

  // Try to load real content from part files (id-shape fallback)
  const contentInfo = getSkillContent(skill as any);
  let content = "";
  let frontmatter: unknown = {};
  if (contentInfo.content_available && contentInfo.body) {
    content = contentInfo.body;
    frontmatter = contentInfo.frontmatter || {};
  }

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || "",
    repository: skill.repository,
    score: skill.score,
    stars: skill.stars,
    forks: skill.forks || 0,
    license: skill.license || "",
    risk: skill.risk_level,
    verified: skill.verified === 1,
    install_status: installStatus,
    category: skill.category,
    tags: tags,
    content,
    frontmatter,
  };
}

// ---------------------------------------------------------------------------
// §10: skill_install — use core engine with policy gating
// ---------------------------------------------------------------------------
async function skill_install(skillId: string, options: { targetDir?: string } = {}): Promise<{
  success: boolean; message: string; skillId: string;
}> {
  const db = getDb();
  const skill = resolveSkill(db, skillId);
  if (!skill) return { success: false, message: "Skill not found in registry", skillId };

  const cfg = loadConfig();
  // Policy gate
  const policy = checkInstallPolicy(skill, cfg);
  if (!policy.ok) {
    const reason = policy.reason || "policy blocked";
    // If manual approval requested, surface it
    if (policy.manualApproval) {
      return {
        success: false,
        message: `High-risk skill (risk='${skill.risk_level}') exceeds maxRisk='${cfg.maxRisk}'. Manual approval required.`,
        skillId,
      };
    }
    return { success: false, message: reason, skillId };
  }

  // Use core installSkill (writes SKILL.md, .mujo.json, updates installations table)
  const result = await installSkill(db, skill, {
    maxInstalledSkills: cfg.maxInstalledSkills,
    skillsRoot: path.join(os.homedir(), ".config", "opencode", "skills"),
    policy: cfg, // pass config for internal checks
    // force: options.force ?? false,
  });

  if (result.ok) {
    return {
      success: true,
      message: `Skill '${skill.name}' installed at ${result.path}`,
      skillId,
    };
  }
  return { success: false, message: result.error || "install failed", skillId };
}

// ---------------------------------------------------------------------------
// §10: skill_update — reset validation + trigger re-sync (recalculate score/status)
// ---------------------------------------------------------------------------
async function skill_update(skillId: string): Promise<{
  success: boolean; message: string; skillId: string;
}> {
  const db = getDb();
  const skill = resolveSkill(db, skillId);
  if (!skill) return { success: false, message: "Skill not found in registry", skillId };

  // Re-validate content via core and update status/score
  const contentInfo = getSkillContent(skill as any);
  const now = new Date().toISOString();

  if (!contentInfo.content_available) {
    // Mark invalid if content truly missing
    db.prepare("UPDATE skills SET status='invalid', risk_level='high', score=0, security=0 WHERE id=?").run(skillId);
    db.prepare(
      "INSERT INTO health_checks (skill_id, check_type, status, details, checksum, run_at) VALUES (?, 'update', 'failed', 'no content available', '', ?)"
    ).run(skillId, now);
    return { success: false, message: "Content not available — skill marked invalid", skillId };
  }

  // Re-apply frontmatter validation and derive new status
  const fm = contentInfo.frontmatter || {};
  const parsedFm = (() => {
    // simple parse: look for --- ... --- at start
    const m = (contentInfo.body || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const out: Record<string, unknown> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim();
      value = /^(".*"|'.*')$/.test(value) ? value.slice(1, -1) : value;
      value = value === "" ? undefined : value;
      out[key] = value;
    }
    return out;
  })();

  const hasName = parsedFm.name && String(parsedFm.name).trim() !== "";
  const hasDescription = parsedFm.description && String(parsedFm.description).trim() !== "";
  const frontmatterValid = hasName && hasDescription;

  let newStatus = "active";
  if (!frontmatterValid) newStatus = "invalid";
  else {
    const lastUpdateDays = skill.last_update
      ? (new Date().getTime() - new Date(skill.last_update).getTime()) / (1000 * 60 * 60 * 24)
      : null;
    if (lastUpdateDays !== null && lastUpdateDays > 30) newStatus = "stale";
  }

  const scan = securityScan(contentInfo.body || "");
  let securityScore = 100 - scan.scoreDelta;
  if (scan.risk === "high") { securityScore -= 20; }
  else if (scan.risk === "medium") { securityScore -= 10; }
  securityScore = Math.max(securityScore, 0);

  const metaUpdate = {
    ...JSON.parse(skill.meta_json || "{}"),
    last_validated: now,
    validation_errors: frontmatterValid ? [] : ["missing frontmatter name or description"],
    security_scan: {
      risk: scan.risk,
      issues: scan.issues,
      score: securityScore,
    },
  };

  db.prepare(
    "UPDATE skills SET status=?, score=?, security=?, meta_json=? WHERE id=?"
  ).run(newStatus, securityScore ?? skill.score, securityScore ?? skill.score, JSON.stringify(metaUpdate), skillId);

  db.prepare(
    "INSERT INTO health_checks (skill_id, check_type, status, details, checksum, run_at) VALUES (?, 'update', ?, ?, ?, ?)"
  ).run(skillId, frontmatterValid ? "ok" : "validation failed", frontmatterValid ? "ok" : "validation failed", contentInfo.body ? contentHash(contentInfo.body) : "", now);

  return {
    success: true,
    message: `Skill '${skill.name}' updated: status=${newStatus}, score=${securityScore ?? skill.score}`,
    skillId,
  };
}

// ---------------------------------------------------------------------------
// §10: skill_remove — use core uninstallSkill
// ---------------------------------------------------------------------------
async function skill_remove(skillId: string): Promise<{
  success: boolean; message: string; skillId: string;
}> {
  const db = getDb();
  const skill = resolveSkill(db, skillId);
  if (!skill) return { success: false, message: "Skill not found in registry", skillId };

  const result = uninstallSkill(db, skill);
  if (result.ok) {
    return {
      success: true,
      message: `Skill '${skill.name}' removed and uninstall directory cleaned`,
      skillId,
    };
  }
  return { success: false, message: result.error || "remove failed", skillId };
}

// ---------------------------------------------------------------------------
// §10: skill_refresh — reset validation + trigger recalc (same logic as skill_update)
// ---------------------------------------------------------------------------
async function skill_refresh(skillId: string): Promise<{
  success: boolean; message: string; skillId: string;
}> {
  // Alias for update logic
  return skill_update(skillId);
}

// ---------------------------------------------------------------------------
// CLI: invoke a tool
// ---------------------------------------------------------------------------
async function main() {
  const tool = process.argv[2];
  const args = process.argv.slice(3);

  if (!tool) {
    console.error("Usage: node opencode-tools.ts <tool> [args]");
    console.error("Available tools: skill_search, skill_info, skill_install, skill_update, skill_remove, skill_refresh");
    process.exit(1);
  }

  try {
    switch (tool) {
      case "skill_search": {
        const filters: any = {};
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--query" && args[i + 1]) { filters.query = args[++i]; }
          else if (args[i] === "--category" && args[i + 1]) { filters.category = args[++i]; }
          else if (args[i] === "--tags" && args[i + 1]) { filters.tags = args[++i].split(","); }
          else if (args[i] === "--minimum_score" && args[i + 1]) { filters.minimum_score = parseInt(args[++i], 10); }
          else if (args[i] === "--minimum_stars" && args[i + 1]) { filters.minimum_stars = parseInt(args[++i], 10); }
          else if (args[i] === "--verified") { filters.verified = true; }
          else if (args[i] === "--risk_level" && args[i + 1]) { filters.risk_level = args[++i]; }
          else if (args[i] === "--limit" && args[i + 1]) { filters.limit = parseInt(args[++i], 10); }
        }
        const results = await skill_search(filters);
        console.log(`\n[skill_search] Found ${results.length} results`);
        for (const r of results) {
          console.log(`  [${r.install_status}] score=${r.score} '${r.name}' [${r.risk}] verified=${r.verified}`);
        }
        break;
      }

      case "skill_info": {
        if (args.length < 1) { console.error("Usage: ... skill_info <skill_id>"); process.exit(1); }
        const info = await skill_info(args[0]);
        if (!info) { console.log("Skill not found"); process.exit(0); }
        console.log(`\n[skill_info] '${info.name}' (${info.repository})`);
        console.log(`  Score: ${info.score}, Stars: ${info.stars}, Risk: ${info.risk}, Verified: ${info.verified}`);
        console.log(`  Install: ${info.install_status}`);
        if (info.content) {
          console.log(`  Content preview: ${info.content.substring(0, 100)}${info.content.length > 100 ? "..." : ""}`);
        }
        break;
      }

      case "skill_install": {
        if (args.length < 1) { console.error("Usage: ... skill_install <skill_id>"); process.exit(1); }
        const result = await skill_install(args[0]);
        console.log(`\n[skill_install] ${result.success ? "✅" : "❌"} ${result.message}`);
        break;
      }

      case "skill_update": {
        if (args.length < 1) { console.error("Usage: ... skill_update <skill_id>"); process.exit(1); }
        const result = await skill_update(args[0]);
        console.log(`\n[skill_update] ${result.success ? "✅" : "❌"} ${result.message}`);
        break;
      }

      case "skill_remove": {
        if (args.length < 1) { console.error("Usage: ... skill_remove <skill_id>"); process.exit(1); }
        const result = await skill_remove(args[0]);
        console.log(`\n[skill_remove] ${result.success ? "✅" : "❌"} ${result.message}`);
        break;
      }

      case "skill_refresh": {
        if (args.length < 1) { console.error("Usage: ... skill_refresh <skill_id>"); process.exit(1); }
        const result = await skill_refresh(args[0]);
        console.log(`\n[skill_refresh] ${result.success ? "✅" : "❌"} ${result.message}`);
        break;
      }

      default:
        console.error(`Unknown tool: ${tool}`);
        process.exit(1);
    }
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});