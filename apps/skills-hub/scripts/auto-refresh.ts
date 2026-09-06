/**
 * agentmujo-skills auto-refresh — hub.md §27
 * Manual + scheduled refresh with proper script paths,
 * registry_meta last_refresh tracking, and health_checks.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

function homeDir(): string {
  return os.homedir();
}

// ---------------------------------------------------------------------------
// Section 27: AUTO REFRESH (hub.md lines 1859–1903)
// - manual refresh: skill_refresh() / auto-refresh.ts manual
// - scheduled refresh: default once daily (refreshInterval from config)
//   options: 6h / 12h / 24h / 7d
// ---------------------------------------------------------------------------

interface RefreshConfig {
  autoRefresh: boolean;
  refreshInterval: string; // '6h' | '12h' | '24h' | '7d'
  dbPath: string;
  maxInstalledSkills: number;
}

// Resolve refresh interval string to milliseconds
function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  return map[interval] ?? 24 * 60 * 60 * 1000; // default daily
}

// ---------------------------------------------------------------------------
// Resolve the absolute path for a scripts/ sub-script.
// The script lives under apps/skills-hub/scripts/ relative to the repo root.
// We determine the repo root by going up from __dirname2 until we find
// skill-market/skills-data (or node_modules). For simplicity we compute
// the scripts path from the known project structure.
// ---------------------------------------------------------------------------
function resolveScriptPath(scriptName: string): string {
  // __dirname2 → plugin/tools/ or scripts/ depending on where the runner lives.
  // The safe assumption for this repo: scripts are at <root>/apps/skills-hub/scripts/
  // and <root>/plugin/tools/ has its own copies. We'll try both.
  const candidates: string[] = [];

  // Candidate 1: from __dirname2 going up to repo root then down
  const repoRoot1 = path.resolve(__dirname2, "..", "..", ".."); // three levels up from most placements
  candidates.push(path.join(repoRoot1, "apps", "skills-hub", "scripts", scriptName));
  candidates.push(path.join(repoRoot1, "scripts", scriptName));

  // Candidate 2: two levels up (if runner is in plugin/tools/)
  const repoRoot2 = path.resolve(__dirname2, ".."); // one level up
  candidates.push(path.join(repoRoot2, "apps", "skills-hub", "scripts", scriptName));
  candidates.push(path.join(repoRoot2, "scripts", scriptName));

  // Candidate 3: one level up (if runner is in scripts/ directly)
  const repoRoot3 = path.resolve(__dirname2, ".."); // already used above but keep for clarity
  candidates.push(path.join(repoRoot3, "apps", "skills-hub", "scripts", scriptName));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Last resort: return the most plausible path
  return path.join(__dirname2, "..", "apps", "skills-hub", "scripts", scriptName);
}

// ---------------------------------------------------------------------------
// Execute a script and return (exitCode, stdout)
// ---------------------------------------------------------------------------
function runScript(scriptName: string, args: string[] = []): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const p = resolveScriptPath(scriptName);
    execFile(
      process.execPath,
      [p, ...args],
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        const out = (stdout || stderr || "").trim();
        resolve({ code: err ? 1 : 0, stdout: out });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Load refresh config, normalizing nested `registry.*` → top-level keys
// ---------------------------------------------------------------------------
function loadRefreshConfig(): RefreshConfig {
  const home = homeDir();
  const configPath = path.join(home, ".config", "opencode", "skill-hub", "config.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // default fallback
  }
  const reg = (raw.registry ?? {}) as Record<string, unknown>;
  return {
    autoRefresh: (raw.autoRefresh as boolean) ?? (reg.autoRefresh as boolean) ?? true,
    refreshInterval: (raw.refreshInterval as string) ?? (reg.refreshInterval as string) ?? "24h",
    dbPath: (reg.dbPath as string) ?? (raw.dbPath as string) ?? path.join(home, ".config", "opencode", "skill-hub", "registry.db"),
    maxInstalledSkills: Number((raw.maxInstalledSkills as number) ?? (reg.maxInstalledSkills as number) ?? 100),
  };
}

// ---------------------------------------------------------------------------
// Track last_refresh in registry_meta (hub.md §4 / §27)
// ---------------------------------------------------------------------------
async function trackLastRefresh(dbPath: string): Promise<void> {
  const db = new (await import("node:sqlite")).DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    // Upsert the last_refresh timestamp
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO registry_meta (key, value) VALUES ('last_refresh', ?) ON CONFLICT(key) DO UPDATE SET value=?, run_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    ).run("last_refresh", now);
    // Also store a human-readable run_at via a separate row if desired;
    // here we just update the single meta row.
    console.log(`[auto-refresh] registry_meta updated: last_refresh=${now}`);
  } catch (e) {
    console.warn("[auto-refresh] could not update registry_meta:", e);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Run sync-github (dry-run by default; only actually sync if --force)
// ---------------------------------------------------------------------------
async function runSyncGithub(dryRun: boolean = true, repo?: string): Promise<string> {
  const cfg = loadRefreshConfig();
  const args: string[] = ["--dry-run"]; // safe default: never auto-sync without explicit opt-in
  if (!dryRun) {
    args.shift(); // remove --dry-run if caller explicitly wants live sync
  }
  if (repo) args.push("--repo", repo);

  console.log(`[auto-refresh] Running sync-github (dryRun=${!dryRun}, repo=${repo || "all"})`);
  const result = await runScript("sync-github.ts", args);
  console.log(result.stdout);
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Manual refresh: sync → validate → score → track last_refresh
// ---------------------------------------------------------------------------
async function manualRefresh(options: { force?: boolean; repo?: string } = {}): Promise<void> {
  console.log("[auto-refresh] Manual refresh requested");
  const dryRun = !options.force; // if --force, do live sync (dryRun=false)
  const repo = options.repo;

  // 1) Sync GitHub skills (respected dry-run flag)
  await runSyncGithub(dryRun, repo);

  // 2) Validate all skills (content resolution, status derivation, health_checks)
  const validate = await runScript("validate-skills.ts", []);
  console.log(validate.stdout);

  // 3) Recalculate scores via shared engine
  const score = await runScript("calculate-score.ts", []);
  console.log(score.stdout);

  // 4) Track last refresh in registry_meta
  const cfg = loadRefreshConfig();
  await trackLastRefresh(cfg.dbPath);

  console.log("[auto-refresh] Manual refresh complete");
}

// ---------------------------------------------------------------------------
// Scheduled refresh: check interval, then run manual refresh if due
// ---------------------------------------------------------------------------
async function scheduledRefresh(force = false): Promise<void> {
  const config = loadRefreshConfig();
  console.log(`[auto-refresh] Scheduled refresh (autoRefresh=${config.autoRefresh}, interval=${config.refreshInterval})`);

  if (!config.autoRefresh && !force) {
    console.log("[auto-refresh] autoRefresh is disabled. Use --force to override.");
    return;
  }

  // Check if interval elapsed since last sync (use dbPath from config;
  // the db file's mtime is a proxy for last sync; for production one would
  // store a dedicated timestamp in registry_meta, but the file mtime is a best-effort).
  const intervalMs = intervalToMs(config.refreshInterval);
  const dbPath = config.dbPath.replace(/^~/, homeDir());
  let due = true;

  try {
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      const elapsed = Date.now() - stat.mtimeMs;
      if (elapsed < intervalMs && !force) {
        due = false;
        console.log(`[auto-refresh] Not due yet (next refresh in ${Math.round((intervalMs - elapsed) / 60000)} min)`);
      }
    }
  } catch {
    /* ignore — if we can't stat the file, assume due */
  }

  if (due) {
    await manualRefresh({ force });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "scheduled";
  const force = args.includes("--force");
  const repo = args.find((a) => a.startsWith("--repo="))?.split("=")[1];

  console.log("[auto-refresh] AgentMujo Skills Hub Refresh Manager");
  console.log("=================================================\n");

  switch (mode) {
    case "manual":
      await manualRefresh({ force, repo });
      break;
    case "scheduled":
      await scheduledRefresh(force);
      break;
    case "config":
      console.log(JSON.stringify(loadRefreshConfig(), null, 2));
      break;
    default:
      console.log("Usage: node auto-refresh.ts <manual|scheduled|config> [--force] [--repo=owner/repo]");
      console.log("  manual      – run a full refresh (sync + validate + score)");
      console.log("  scheduled   – run refresh only if interval elapsed (default daily)");
      console.log("  config      – show current refresh config");
  }
}

main().catch((e) => {
  console.error("[auto-refresh] FATAL:", e);
  process.exit(1);
});