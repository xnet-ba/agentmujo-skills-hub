/**
 * agentmujo-skills validate — hub.md §17/§20/§4
 * Validates all skills using part-file content + security scan.
 * Emits health_checks rows and updates status/score/risk_level.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { openRegistry, getSkillContent, loadHubConfig } from "./lib/core.ts";
import { securityScan, parseFrontmatter, contentHash } from "./lib/scoring.ts";

// ---------------------------------------------------------------------------
// CLI args: --dry-run, --id <id>, --limit N, --stale-days N
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let dryRun = false;
let skillId: string | undefined;
let limit = Infinity;
let staleDays = 30;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") dryRun = true;
  else if (args[i] === "--id" && args[i + 1]) {
    skillId = args[++i];
  } else if (args[i] === "--limit" && args[i + 1]) {
    limit = Math.max(0, parseInt(args[++i], 10));
  } else if (args[i] === "--stale-days" && args[i + 1]) {
    staleDays = Math.max(0, parseInt(args[++i], 10));
  }
}

// ---------------------------------------------------------------------------
// Configuration (shared engine)
// ---------------------------------------------------------------------------
const cfg = loadHubConfig();

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const dbPath = cfg.dbPath.replace(/^~/, os.homedir());
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openRegistry(dbPath);

// Ensure sources exist
const insertSource = db.prepare(
  `INSERT OR IGNORE INTO sources(name, type, repository, repository_url, priority, enabled, created_at)
   VALUES(?, ?, ?, ?, ?, 1, ?)`
);
const nowTs = new Date().toISOString();
for (const s of [
  { name: "anthropics", type: "organization", repository: "anthropics/skills", url: "https://github.com/anthropics/skills", priority: 1 },
  { name: "addyosmani", type: "user", repository: "addyosmani/claude-skills", url: "https://github.com/addyosmani/claude-skills", priority: 2 },
  { name: "composio", type: "organization", repository: "ComposioHQ/composio", url: "https://github.com/ComposioHQ/composio", priority: 3 },
]) {
  insertSource.run(s.name, s.type, s.repository, s.url, s.priority, nowTs);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
const skills = db.prepare("SELECT * FROM skills WHERE status != 'removed'").all() as Array<{
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
  last_update: string | null;
}>;

let validatedCount = 0;
let invalidCount = 0;
let staleCount = 0;
let activeCount = 0;
let riskCounts = { high: 0, medium: 0, low: 0 };

// ---------------------------------------------------------------------------
// Helper: derive status per §20 (simplified; uses last_update if available)
// ---------------------------------------------------------------------------
function deriveNewStatus(
  previous: string,
  hasContent: boolean,
  frontmatterValid: boolean,
  lastUpdateDays: number | null,
  staleDays: number
): string {
  if (!hasContent) return "invalid";
  if (!frontmatterValid) return "invalid";
  if (lastUpdateDays !== null && lastUpdateDays > staleDays) return "stale";
  // keep previous unless it was unverified
  if (!["active", "stale", "invalid", "removed"].includes(previous)) return "unverified";
  return previous;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let processed = 0;

  for (const skill of skills) {
    // Filter by --id
    if (skillId && skill.id !== skillId) continue;
    processed++;
    if (processed > limit) break;

    // Resolve skill content via core engine (part files + id-shape fallback)
    const contentInfo = getSkillContent(skill as any);
    if (!contentInfo.content_available) {
      if (!dryRun) {
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE skills SET status='invalid', score=0, security=0, risk_level='high',
             meta_json=? WHERE id=?`
        ).run(
          JSON.stringify({
            ...JSON.parse(skill.meta_json || "{}"),
            last_validated: now,
            validation_errors: ["no content available - skill-market part file missing"],
          }),
          skill.id
        );
        db.prepare(
          `INSERT INTO health_checks (skill_id, check_type, status, details, checksum, run_at)
           VALUES (?, 'validate', 'failed', ?, ?, ?)`
        ).run(skill.id, "no content available - skill-market part file missing", "", now);
      }
      console.log(`[validate] '${skill.id}' → invalid (no content)`);
      invalidCount++;
      continue;
    }

    const content = contentInfo.body || "";
    const fm = contentInfo.frontmatter || {};

    // Parse frontmatter and check required keys
    const parsedFm = parseFrontmatter(content);
    const hasName = parsedFm.name && String(parsedFm.name).trim() !== "";
    const hasDescription = parsedFm.description && String(parsedFm.description).trim() !== "";

    // Security scan
    const sec = securityScan(content);
    riskCounts[sec.risk] = (riskCounts[sec.risk] || 0) + 1;

    // Calculate security score (0-100)
    let securityScore = 100 - sec.scoreDelta;
    if (sec.risk === "high") securityScore = Math.max(securityScore - 20, 0);
    else if (sec.risk === "medium") securityScore = Math.max(securityScore - 10, 0);
    securityScore = Math.max(securityScore, 0);

    // Frontmatter validation
    const frontmatterValid = hasName && hasDescription;

    // Determine content-maintenance age (days since last_update)
    const lastUpdateDays = skill.last_update
      ? (new Date().getTime() - new Date(skill.last_update).getTime()) / (1000 * 60 * 60 * 24)
      : null;

    // New status per §20
    const newStatus = deriveNewStatus(
      skill.status,
      contentInfo.content_available,
      frontmatterValid,
      lastUpdateDays,
      staleDays
    );

    // Score: use security score as base, minimum 0
    const newScore = securityScore;

    // Update meta_json with validation metadata
    const metaUpdate = {
      ...JSON.parse(skill.meta_json || "{}"),
      last_validated: new Date().toISOString(),
      validation_errors: frontmatterValid ? [] : ["missing frontmatter name or description"],
      security_scan: {
        risk: sec.risk,
        issues: sec.issues,
        score: securityScore,
      },
    };

    if (!dryRun) {
      db.prepare(
        `UPDATE skills SET score=?, security=?, risk_level=?, status=?, meta_json=? WHERE id=?`
      ).run(newScore, securityScore, sec.risk, newStatus, JSON.stringify(metaUpdate), skill.id);

      // Health check
      const checkStatus = newStatus === "invalid" || newStatus === "stale" ? "failed" : "ok";
      const details = frontmatterValid ? "ok" : `validation issue: ${frontmatterValid ? "" : "missing frontmatter name/description"}`;
      db.prepare(
        `INSERT INTO health_checks (skill_id, check_type, status, details, checksum, run_at)
         VALUES (?, 'validate', ?, ?, ?, ?)`
      ).run(skill.id, checkStatus, details, contentHash(content), new Date().toISOString());
    }

    console.log(
      `[validate] '${skill.id}' → status=${newStatus}, score=${newScore}, security=${securityScore}, risk=${sec.risk}`
    );

    if (newStatus === "active") activeCount++;
    else if (newStatus === "stale") staleCount++;
    else if (newStatus === "invalid") invalidCount++;
    else invalidCount++; // blocked/removed etc.
  }

  db.close();

  console.log(
    `\n[validate] Done. Processed ${processed} skills; active=${activeCount}, stale=${staleCount}, invalid=${invalidCount}`
  );
  console.log(`  Risk distribution: high=${riskCounts.high}, medium=${riskCounts.medium}, low=${riskCounts.low}`);
}

// Run
main().catch((e) => {
  console.error("[validate-skills] FATAL:", e);
  process.exit(1);
});