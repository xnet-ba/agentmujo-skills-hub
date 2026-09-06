/**
 * agentmujo-skills — CLI for the AgentMujo Skills Hub (hub.md section 40).
 *
 * Uses the same core engine as the OpenCode plugin (scripts/lib/core.ts).
 *
 *   agentmujo-skills search docker
 *   agentmujo-skills install docker-security
 *   agentmujo-skills update docker-security
 *   agentmujo-skills remove docker-security
 *   agentmujo-skills list
 *   agentmujo-skills refresh
 *   agentmujo-skills info docker-security
 *
 * Run: node apps/skills-hub/cli.ts <command> [...args]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGISTRY_DB,
  openRegistry,
  resolveSkill,
  getSkillContent,
  installSkill,
  uninstallSkill,
  getMetaJson,
  setPartsDataDir,
  listInstalled,
} from "./scripts/lib/core.ts";

const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));
setPartsDataDir(path.resolve(__dirnamePath, "..", "..", "skill-market", "skills-data"));

function db() {
  return openRegistry(REGISTRY_DB);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function printSkill(s: any, verbose = false) {
  const meta = getMetaJson(s);
  const line = `[${s.score}] ${s.name}  (${s.category}, risk ${s.risk_level}, ★${s.stars}${s.verified ? ", verified" : ""})${meta.installed_at ? "  *installed*" : ""}`;
  if (verbose) {
    console.log(`ID     : ${s.id}`);
    console.log(`Name   : ${s.name}`);
    console.log(`Desc   : ${(s.description || "").slice(0, 160)}`);
    console.log(`Cat    : ${s.category}`);
    console.log(`Score  : ${s.score} (quality ${s.quality ?? "-"}, security ${s.security ?? "-"})`);
    console.log(`Stars  : ${s.stars}  Forks: ${s.forks}  License: ${s.license || "n/a"}`);
    console.log(`Risk   : ${s.risk_level}`);
    console.log(`Status : ${s.status}  Verified: ${s.verified === 1 ? "yes" : "no"}`);
    console.log(`Repo   : ${s.repository || "n/a"}`);
    console.log(`Updated: ${s.last_update || "n/a"}`);
    console.log(`Install: ${meta.installed_dir || "not installed"}`);
  } else {
    const desc = (s.description || "").replace(/\s+/g, " ").slice(0, 90);
    console.log(`  ${line}`);
    if (desc) console.log(`    ${desc}`);
  }
}

function usage() {
  console.log(`Usage:
  agentmujo-skills search <query> [--limit N] [--category C] [--min-score N] [--risk low|medium]
  agentmujo-skills install <id-or-name>
  agentmujo-skills update   <id-or-name>
  agentmujo-skills remove   <id-or-name>
  agentmujo-skills list     [--installed] [--category C] [--limit N]
  agentmujo-skills refresh  [--stale-days N]
  agentmujo-skills info     <id-or-name>`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function cmdSearch(d: DatabaseSync, args: string[]) {
  const q = args[0];
  if (!q) {
    console.error("search requires a query");
    process.exit(2);
  }
  let limit = 10;
  let category: string | undefined;
  let minScore = 0;
  let risk: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
    else if (args[i] === "--category" && args[i + 1]) category = args[i + 1];
    else if (args[i] === "--min-score" && args[i + 1]) minScore = parseInt(args[i + 1], 10);
    else if (args[i] === "--risk" && args[i + 1]) risk = args[i + 1];
  }

  const conditions = ["(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)"];
  const params: any[] = [`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`];
  if (category && category !== "All") { conditions.push("category = ?"); params.push(category); }
  if (minScore) { conditions.push("score >= ?"); params.push(minScore); }
  if (risk) {
    conditions.push(risk === "medium" ? "risk_level IN ('low','medium')" : "risk_level = ?");
    if (risk !== "medium") params.push(risk);
  }
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const total = (d.prepare(`SELECT COUNT(*) c FROM skills${where}`).get(...params) as { c: number }).c;
  const rows = d
    .prepare(`SELECT * FROM skills${where} ORDER BY score DESC LIMIT ?`)
    .all(...params, limit) as any[];

  console.log(`Found ${total} skill(s) matching "${q}":`);
  for (const r of rows) printSkill(r);
}

function cmdInstall(d: DatabaseSync, args: string[]) {
  const idOrName = args[0];
  if (!idOrName) { console.error("install requires an id or name"); process.exit(2); }
  const row = resolveSkill(d, idOrName);
  if (!row) { console.error(`Skill not found: ${idOrName}`); process.exit(1); }
  const res = installSkill(d, row);
  if (!res.ok) { console.error(`Install failed: ${res.error}`); process.exit(1); }
  console.log(`Installed ${row.name} → ${res.path}`);
}

function cmdUpdate(d: DatabaseSync, args: string[]) {
  const idOrName = args[0];
  if (!idOrName) { console.error("update requires an id or name"); process.exit(2); }
  const row = resolveSkill(d, idOrName);
  if (!row) { console.error(`Skill not found: ${idOrName}`); process.exit(1); }
  const res = installSkill(d, row);
  if (!res.ok) { console.error(`Update failed: ${res.error}`); process.exit(1); }
  console.log(`Updated ${row.name} → ${res.path}`);
}

function cmdRemove(d: DatabaseSync, args: string[]) {
  const idOrName = args[0];
  if (!idOrName) { console.error("remove requires an id or name"); process.exit(2); }
  const row = resolveSkill(d, idOrName);
  if (!row) { console.error(`Skill not found: ${idOrName}`); process.exit(1); }
  uninstallSkill(d, row);
  console.log(`Removed ${row.name}`);
}

function cmdList(d: DatabaseSync, args: string[]) {
  let onlyInstalled = false;
  let category: string | undefined;
  let limit = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--installed") onlyInstalled = true;
    else if (args[i] === "--category" && args[i + 1]) category = args[i + 1];
    else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
  }

  if (onlyInstalled) {
    const installed = listInstalled(d);
    console.log(`Installed skills (${installed.length}):`);
    for (const i of installed) {
      const row = resolveSkill(d, i.skill_id);
      if (row) printSkill(row);
    }
    return;
  }

  const conditions: string[] = [];
  const params: any[] = [];
  if (category) { conditions.push("category = ?"); params.push(category); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const total = (d.prepare(`SELECT COUNT(*) c FROM skills${where}`).get(...params) as { c: number }).c;
  const limitSql = limit ? ` LIMIT ${limit}` : "";
  const rows = d.prepare(`SELECT * FROM skills${where} ORDER BY score DESC${limitSql}`).all(...params) as any[];
  console.log(`Skills (${rows.length} of ${total}):`);
  for (const r of rows) printSkill(r);
}

function cmdRefresh(d: DatabaseSync, args: string[]) {
  let staleDays = 365;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stale-days" && args[i + 1]) staleDays = parseInt(args[i + 1], 10);
  }
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const stale = d
    .prepare("SELECT COUNT(*) c FROM skills WHERE status='active' AND (last_update IS NULL OR last_update < ?)")
    .get(cutoff) as { c: number };
  d.prepare("UPDATE skills SET status='stale' WHERE status='active' AND (last_update IS NULL OR last_update < ?)").run(cutoff);
  d.prepare("UPDATE skills SET last_checked_at=?").run(new Date().toISOString());
  console.log(`Refresh complete. Marked ${stale.c} skill(s) stale (last update > ${staleDays}d ago).`);
}

function cmdInfo(d: DatabaseSync, args: string[]) {
  const idOrName = args[0];
  if (!idOrName) { console.error("info requires an id or name"); process.exit(2); }
  const row = resolveSkill(d, idOrName);
  if (!row) { console.error(`Skill not found: ${idOrName}`); process.exit(1); }
  printSkill(row, true);
  const content = getSkillContent(row);
  if (content.content_available) {
    console.log(`Body   : ${content.body?.length ?? 0} chars (preview available)`);
  } else {
    console.log(`Body   : not available (${content.reason})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const d = db();
switch (cmd) {
  case "search": cmdSearch(d, rest); break;
  case "install": cmdInstall(d, rest); break;
  case "update": cmdUpdate(d, rest); break;
  case "remove": cmdRemove(d, rest); break;
  case "list": cmdList(d, rest); break;
  case "refresh": cmdRefresh(d, rest); break;
  case "info": cmdInfo(d, rest); break;
  default:
    usage();
    process.exit(cmd ? 2 : 0);
}
d.close();
console.log(`\nRegistry: ${REGISTRY_DB}\nSkills root: ${path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "opencode", "skills")}`);