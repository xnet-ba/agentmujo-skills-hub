import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(os.homedir(), ".config", "opencode", "skill-hub", "registry.db");

const db = new DatabaseSync(DB_PATH);
const rows = db
  .prepare(
    `SELECT id, name, description, category, tags, repository, stars, forks, license,
            score, quality, security, maintenance, verified, status, risk_level,
            last_update, last_checked_at, meta_json
     FROM skills ORDER BY score DESC`
  )
  .all() as any[];

const skills = rows.map((r) => {
  let meta = {};
  try {
    meta = JSON.parse(r.meta_json || "{}");
  } catch {
    meta = {};
  }
  delete r.meta_json;
  r.meta = meta;
  return r;
});

const tags = db
  .prepare("SELECT tags FROM skills WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'")
  .all() as Array<{ tags: string }>;
const tagCounts = new Map<string, number>();
for (const r of tags) {
  try {
    const arr = JSON.parse(r.tags);
    if (Array.isArray(arr)) {
      for (const t of arr.slice(0, 6)) if (typeof t === "string" && t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  } catch {
    /* ignore */
  }
}

const sources = db
  .prepare(
    `SELECT s.name, s.type, s.repository, s.repository_url, s.priority, s.enabled,
            (SELECT COUNT(*) FROM skills sk WHERE sk.repository = s.name) AS skill_count
     FROM sources s ORDER BY s.priority ASC, s.name`
  )
  .all();

const categories = db
  .prepare("SELECT name, description AS label, skill_count FROM categories ORDER BY name")
  .all();

const generated_at = new Date().toISOString();
const dataset = {
  generated_at,
  schema_version: "0.1.0",
  counts: { skills: skills.length, sources: sources.length, categories: categories.length },
  categories,
  sources,
  tags: [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100),
  skills,
};

const distDir = path.join(__dirname2, "dist");
fs.mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, "skills.json");
fs.writeFileSync(out, JSON.stringify(dataset));
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`[export] wrote ${out} (${skills.length} skills, ${mb} MB)`);