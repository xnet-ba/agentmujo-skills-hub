/**
 * agentmujo-skills calculate-score — hub.md §16
 * Recalculates quality/security/maintenance/score for all skills using the shared engine.
 * Emits health_checks rows.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { calculateScore } from "./lib/scoring.js";

// ---------------------------------------------------------------------------
// CLI args: --dry-run, --id <id>, --limit N
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let dryRun = false;
let skillId: string | undefined;
let limit = Infinity;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") dryRun = true;
  else if (args[i] === "--id" && args[i + 1]) {
    skillId = args[++i];
    limit--;
  } else if (args[i] === "--limit" && args[i + 1]) {
    limit = Math.max(0, parseInt(args[++i], 10));
    limit--;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const root = path.join(__dirname2, "..");
const configPath = path.join(root, "config", "config.json");
const raw = fs.readFileSync(configPath, "utf-8");
const parsed = JSON.parse(raw);
const reg = parsed.registry ?? {};
const cfg = {
  minimumScore: reg.minimumScore ?? parsed.minimumScore ?? 75,
  minimumStars: reg.minimumStars ?? parsed.minimumStars ?? 0,
  maxRisk: reg.maxRisk ?? parsed.maxRisk ?? "medium",
  verifiedOnly: reg.verifiedOnly ?? parsed.verifiedOnly ?? false,
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const dbPath = reg.dbPath ?? parsed.dbPath ?? "~/.config/opencode/skill-hub/registry.db";
const realDbPath = dbPath.replace(/^~/, os.homedir());
fs.mkdirSync(path.dirname(realDbPath), { recursive: true });
const db = new DatabaseSync(realDbPath);
db.exec("PRAGMA foreign_keys = ON;");

// Read all skills
const skills = db
  .prepare(
    "SELECT id, stars, last_update, quality, security, maintenance, score FROM skills"
  )
  .all() as Array<{
    id: string;
    stars: number;
    last_update: string | null;
    quality: number;
    security: number;
    maintenance: number;
    score: number;
  }>;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  let updated = 0;
  const now = new Date();
  const staleDays = 30; // could read from config, keep simple

  for (const skill of skills) {
    // Filter by --id
    if (skillId && skill.id !== skillId) continue;
    if (--limit < 0) break;

    // Compute lastUpdateDays from last_update
    let lastUpdateDays = 999;
    if (skill.last_update) {
      const updateDate = new Date(skill.last_update);
      if (!isNaN(updateDate.getTime())) {
        lastUpdateDays = Math.floor((now.getTime() - updateDate.getTime()) / 86400000);
      }
    }

    // Build ScoreInput for the shared engine
    const input = {
      relevance: 0.7,
      stars: skill.stars,
      lastUpdateDays,
      hasDocs: skill.quality >= 50,
      activity: 0,
      hasLicense: skill.security > 0,
      validated: true,
      security: skill.security / 100, // normalize 0-100 → 0-1
    };

    const result = calculateScore(input);

    if (!dryRun) {
      db.prepare("UPDATE skills SET score=?, quality=?, security=?, maintenance=? WHERE id=?")
        .run(result.score, result.quality, result.security, result.maintenance, skill.id);

      // Health check
      db.prepare(
        `INSERT INTO health_checks (skill_id, check_type, status, details, checksum, run_at)
         VALUES (?, 'score', 'ok', 'recalculated via shared engine', ?, ?)`
      ).run(skill.id, (""), now.toISOString());
    }

    console.log(
      `[calculate-score] '${skill.id}' -> score=${result.score}, quality=${result.quality}, security=${result.security}, maintenance=${result.maintenance}`
    );
    updated++;
  }

  db.close();
  console.log(`\n[calculate-score] Done. Updated ${updated} skills.`);
}

// Run
main().catch((e) => {
  console.error("[calculate-score] FATAL:", e);
  process.exit(1);
});