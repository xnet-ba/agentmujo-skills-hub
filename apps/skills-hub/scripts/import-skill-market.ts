import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import crypto from "node:crypto";

const DATA_DIR =
  process.env.SKILL_DATA_DIR ||
  path.resolve("C:/Users/Admin/Documents/Dashboard/skill-market/skills-data");
const DB_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "skill-hub",
  "registry.db"
);

const CAT_LABEL: Record<string, string> = {
  "webapp-frontend": "Web & frontend",
  "backend-api": "Backend & API",
  "data-ai-ml": "Data, AI & ML",
  "code-quality": "Code quality",
  "git-workflow": "Git & workflow",
  testing: "Testing",
  security: "Security",
  debugging: "Debugging",
  "agent-orchestration": "Agents & orchestration",
  "devops-infra": "DevOps & infra",
  "automation-tools": "Automation & tools",
  "content-docs": "Content & docs",
};

interface MetaSkill {
  name: string;
  folder: string;
  desc: string;
  license: string;
  source: string;
  srcLabel: string;
  cat: string;
}

interface PartSkill {
  name: string;
  folder: string;
  frontmatter?: Record<string, string>;
  body?: string;
}

function loadWindow(file: string): { SKILLS_META?: MetaSkill[]; SKILLS_PART?: Record<string, PartSkill[]> } {
  const ctx: { window: Record<string, unknown> } = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf-8"), ctx);
  return ctx.window as never;
}

function cleanName(name: string): string {
  return String(name).replace(/^'+|'+$/g, "").trim();
}

function hashContent(s: string): string {
  return crypto.createHash("sha256").update(s || "").digest("hex").slice(0, 32);
}

function scanRisk(body: string): { risk: string; security: number } {
  const text = body || "";
  let risk = "low";
  if (/curl[^|]*\|\s*(ba|z)?sh|wget[^|]*\|\s*(ba|z)?sh/.test(text)) risk = "high";
  else if (/rm\s+-rf|chmod\s+777|(api_?key|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/.test(text)) risk = "high";
  else if (/sudo|\.env\b|ssh.*private|passwd\b/.test(text)) risk = "medium";
  const security = risk === "high" ? 35 : risk === "medium" ? 60 : 90;
  return { risk, security };
}

function computeScore(meta: MetaSkill, bodyLen: number): {
  score: number;
  quality: number;
  maintenance: number;
} {
  const descLen = (meta.desc || "").length;
  let quality = 45;
  if (descLen > 60) quality += 10;
  if (descLen > 150) quality += 5;
  if (bodyLen > 1000) quality += 20;
  else if (bodyLen > 300) quality += 10;
  if (meta.license) quality += 5;
  quality = Math.min(100, quality);
  const maintenance = 60;
  const security = 70;
  const score = Math.round(0.5 * quality + 0.3 * security + 0.2 * maintenance);
  return { score: Math.min(100, score), quality, maintenance };
}

function deriveTags(meta: MetaSkill): string[] {
  const tags = new Set<string>([meta.cat]);
  for (const part of meta.srcLabel.toLowerCase().split(/\s+/)) {
    if (part.length > 2) tags.add(part);
  }
  const folderWords = (meta.folder || "").split(/[-_]/).filter((w) => w.length > 2);
  for (const w of folderWords.slice(0, 4)) tags.add(w);
  return [...tags].slice(0, 6);
}

function insertOrIgnoreSource(
  db: DatabaseSync,
  name: string,
  srcLabel: string
): void {
  const exists = db.prepare("SELECT 1 FROM sources WHERE name=?").get(name);
  if (exists) return;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO sources(name, type, repository, license, priority, enabled, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(name, "organization", name, "MIT", 99, 1, now);
}

const stop = (s: string) => /^(agent|skill|skills|a|an|the|to|and|of|for)$/.test(s);

function main() {
  if (!fs.existsSync(path.join(DATA_DIR, "meta.js"))) {
    console.error(`[import] meta.js not found in ${DATA_DIR}`);
    process.exit(1);
  }

  const win = loadWindow(path.join(DATA_DIR, "meta.js"));
  const meta = (win.SKILLS_META || []) as MetaSkill[];
  console.log(`[import] meta skills: ${meta.length}`);

  const partsMap = new Map<string, PartSkill>();
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.startsWith("part-") || !f.endsWith(".js")) continue;
    const w = loadWindow(path.join(DATA_DIR, f));
    const parts = (w.SKILLS_PART || {}) as Record<string, PartSkill[]>;
    for (const cat of Object.keys(parts)) {
      for (const s of parts[cat]) {
        partsMap.set(`${cat}::${cleanName(s.name)}`, s);
        partsMap.set(`${cat}::${s.folder}`, s);
      }
    }
  }
  console.log(`[import] part content entries: ${partsMap.size}`);

  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    DELETE FROM skill_tags;
    DELETE FROM skill_categories;
    DELETE FROM health_checks;
    DELETE FROM installations;
    DELETE FROM tags;
    DELETE FROM categories;
    DELETE FROM sources;
    DELETE FROM skills;
  `);

  const insertSkill = db.prepare(`
    INSERT INTO skills(
      id, name, description, repository, repository_url, skill_path, github_url,
      category, tags, license, stars, forks, open_issues, watchers,
      default_branch, created_at, updated_at, last_commit,
      score, quality_score, security_score, maintenance_score,
      author, last_update, quality, security, maintenance,
      status, verified, risk_level, content_hash, indexed_at, last_checked_at, meta_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const catCounts = new Map<string, number>();
  const srcCounts = new Map<string, string>();
  const now = new Date().toISOString();
  let imported = 0;
  const seenIds = new Map<string, number>();

  for (const m of meta) {
    const name = cleanName(m.name);
    const part = partsMap.get(`${m.cat}::${name}`) || partsMap.get(`${m.cat}::${m.folder}`);
    const body = (part && part.body) || "";
    const desc = (m.desc || "").replace(/^'+|'+$/g, "");

    const baseId = `${m.source}/${m.cat}/${m.folder}`;
    const n = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, n);
    const id = n > 1 ? `${baseId}#${n}` : baseId;

    const { risk, security } = scanRisk(body);
    const { score, quality, maintenance } = computeScore(m, body.length);
    const tags = deriveTags(m);
    const bodyKey = `${name}\n${desc}\n${body}`;

    insertSkill.run(
      id,
      name,
      desc,
      m.source,
      null,
      `skills/${m.folder}/SKILL.md`,
      null,
      CAT_LABEL[m.cat] || m.cat,
      JSON.stringify(tags),
      m.license || "MIT",
      0,
      0,
      0,
      0,
      null,
      now,
      now,
      null,
      score,
      quality,
      security,
      maintenance,
      m.source,
      null,
      quality,
      security,
      maintenance,
      "active",
      0,
      risk,
      hashContent(bodyKey),
      now,
      now,
      JSON.stringify({
        folder: m.folder,
        cat: m.cat,
        srcLabel: m.srcLabel,
        bodyLen: body.length,
        hasBody: !!part,
      })
    );

    catCounts.set(CAT_LABEL[m.cat] || m.cat, (catCounts.get(CAT_LABEL[m.cat] || m.cat) || 0) + 1);
    srcCounts.set(m.source, m.srcLabel);
    insertOrIgnoreSource(db, m.source, m.srcLabel);
    imported++;
  }

  const insertCat = db.prepare("INSERT OR IGNORE INTO categories(name, skill_count) VALUES (?,?)");
  for (const [cat, count] of catCounts) {
    insertCat.run(cat, count);
  }

  db.exec("DELETE FROM skills_fts");
  db.exec("INSERT INTO skills_fts(skills_fts) VALUES('rebuild')");

  console.log(`[import] imported: ${imported} of ${meta.length}`);
  console.log(`[import] categories: ${catCounts.size}`);
  for (const [cat, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`[import] sources (${srcCounts.size}): ${[...srcCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const total = db.prepare("SELECT COUNT(*) c FROM skills").get() as { c: number };
  console.log(`[import] TOTAL skills in DB: ${total.c}`);
  db.close();
}

main();