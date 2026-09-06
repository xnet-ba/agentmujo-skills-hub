import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const __dirname2 = __filename2 ? path.dirname(__filename2) : ".";

function homeDir(): string {
  return os.homedir();
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

// ---------------------------------------------------------------------------
// Section 20: Invalid Skills (hub.md lines 1529–1578)
// Statuses: removed, invalid, stale
// Cleanup job: remove old invalid records periodically
// ---------------------------------------------------------------------------

class InvalidCleanup {
  private db: DatabaseSync;

  constructor() {
    const dbPath = path.join(homeDir(), ".config", "opencode", "skill-hub", "registry.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  // Mark a skill as invalid (SKILL.md no longer exists)
  markInvalid(skillId: string): { success: boolean; message: string } {
    const skill = this.db.prepare("SELECT * FROM skills WHERE id=?").get(skillId) as SkillRecord | undefined;
    if (!skill) return { success: false, message: "Skill not found in registry" };

    this.db.prepare("UPDATE skills SET status='invalid', risk_level='high' WHERE id=?").run(skillId);
    return { success: true, message: `Skill '${skill.name}' marked as invalid` };
  }

  // Mark a skill as removed (repository deleted)
  markRemoved(skillId: string): { success: boolean; message: string } {
    const skill = this.db.prepare("SELECT * FROM skills WHERE id=?").get(skillId) as SkillRecord | undefined;
    if (!skill) return { success: false, message: "Skill not found in registry" };

    this.db.prepare("UPDATE skills SET status='removed' WHERE id=?").run(skillId);
    return { success: true, message: `Skill '${skill.name}' marked as removed` };
  }

  // Mark skills as stale (no push > 365 days)
  markStale(): { count: number; message: string } {
    const now = new Date();
    const threeSixtyFiveDaysAgo = new Date(now.getTime() - 365 * 86400000);

    // Find active skills with last_update > 365 days ago
    const rows = this.db
      .prepare(
        `SELECT id, name, last_update FROM skills WHERE status='active' AND last_update < ?`
      )
      .all(threeSixtyFiveDaysAgo.toISOString()) as Array<{ id: string; name: string; last_update: string }>;

    for (const row of rows) {
      this.db.prepare("UPDATE skills SET status='stale' WHERE id=?").run(row.id);
    }

    return { count: rows.length, message: `${rows.length} skills marked as stale` };
  }

  // Cleanup: remove skills with status 'removed' or 'invalid' older than N days
  cleanupOld(days: number = 90): { removed: number; message: string } {
    const cutoff = new Date(Date.now() - days * 86400000);

    // Count to be removed
    const countRows = this.db
      .prepare(
        `SELECT id, last_checked_at FROM skills WHERE status IN ('removed', 'invalid') AND last_checked_at < ?`
      )
      .all(cutoff.toISOString()) as Array<{ id: string; last_checked_at: string }>;

    for (const row of countRows) {
      this.db.prepare("DELETE FROM skills WHERE id=?").run(row.id);
    }

    return { removed: countRows.length, message: `${countRows.length} old ${countRows.length > 1 ? "records" : "record"} deleted` };
  }

  // Show status summary
  statusSummary(): void {
    const active = this.db.prepare("SELECT COUNT(*) as c FROM skills WHERE status='active'").get() as { c: number };
    const invalid = this.db.prepare("SELECT COUNT(*) as c FROM skills WHERE status='invalid'").get() as { c: number };
    const removed = this.db.prepare("SELECT COUNT(*) as c FROM skills WHERE status='removed'").get() as { c: number };
    const stale = this.db.prepare("SELECT COUNT(*) as c FROM skills WHERE status='stale'").get() as { c: number };

    console.log("\n[invalid-cleanup] Status Summary:");
    console.log(`  Active:    ${active.c}`);
    console.log(`  Invalid:   ${invalid.c}`);
    console.log(`  Removed:   ${removed.c}`);
    console.log(`  Stale:     ${stale.c}`);
    console.log(`  Total:     ${active.c + invalid.c + removed.c + stale.c}`);
  }
}

// CLI
async function main() {
  const action = process.argv[3];
  const tool = new InvalidCleanup();

  console.log("[invalid-cleanup] AgentMujo Skills Hub – Invalid Skills Manager");
  console.log("================================================================\n");

  switch (action) {
    case "mark-invalid":
      if (args.length < 1) { console.error("Usage: ... mark-invalid <skill_id>"); process.exit(1); }
      const r1 = tool.markInvalid(args[0]);
      console.log(` ${r1.success ? "✅" : "❌"} ${r1.message}`);
      break;

    case "mark-removed":
      if (args.length < 1) { console.error("Usage: ... mark-removed <skill_id>"); process.exit(1); }
      const r2 = tool.markRemoved(args[0]);
      console.log(` ${r2.success ? "✅" : "❌"} ${r2.message}`);
      break;

    case "mark-stale":
      const r3 = tool.markStale();
      console.log(` ${r3.message}`);
      break;

    case "cleanup":
      if (args.length < 1) { console.error("Usage: ... cleanup <days>"); process.exit(1); }
      const days = parseInt(args[0], 10);
      const r4 = tool.cleanupOld(days);
      console.log(` ${r4.message}`);
      break;

    case "summary":
      tool.statusSummary();
      break;

    default:
      console.log("Usage: node invalid-cleanup.ts <mark-invalid|mark-removed|mark-stale|cleanup|summary>");
      console.log("  mark-invalid <id>   – mark skill as invalid");
      console.log("  mark-removed <id>   – mark skill as removed");
      console.log("  mark-stale          – mark skills inactive >365d as stale");
      console.log("  cleanup <days>      – delete removed/invalid records older than N days");
      console.log("  summary             – show status counts");
  }
}

// Dummy args placeholder – in real usage would be process.argv.slice(3)
const args: string[] = process.argv.slice(3);

main().catch((e) => {
  console.error("[invalid-cleanup] FATAL:", e);
  process.exit(1);
});