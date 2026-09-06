import { openRegistry } from "../skills-hub/scripts/lib/core.ts";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

function homeDir(): string {
  return os.homedir();
}

const PORT = Number(process.env.PORT || 4312);
const DB_PATH = path.join(homeDir(), ".config", "opencode", "skill-hub", "registry.db");
const WEB_DIR = __dirname2;
const SKILLS_DATA_DIR = path.join(WEB_DIR, "..", "..", "skill-market", "skills-data");
const DIST_DIR = path.join(WEB_DIR, "dist");

// Open SQLite registry (read-mostly, auto-migration)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openRegistry(DB_PATH);
// PRAGMA foreign_keys already set inside openRegistry

// ---------------------------------------------------------------------------
// JSON API endpoints (hub.md section 4 registry + section 15 fast search)
// ---------------------------------------------------------------------------
function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function apiSkills(query: URLSearchParams): unknown {
  const conditions: string[] = [];
  const params: any[] = [];

  const q = query.get("q");
  if (q) {
    conditions.push("(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }
  const category = query.get("category");
  if (category && category !== "All") {
    conditions.push("category = ?");
    params.push(category);
  }
  const minScore = query.get("minScore");
  if (minScore) {
    conditions.push("score >= ?");
    params.push(Number(minScore));
  }
  const maxRisk = query.get("maxRisk");
  if (maxRisk && maxRisk !== "All") {
    if (maxRisk === "medium") {
      conditions.push("risk_level IN ('low','medium')");
    } else {
      conditions.push("risk_level = ?");
      params.push(maxRisk);
    }
  }
  const status = query.get("status");
  if (status && status !== "All") {
    conditions.push("status = ?");
    params.push(status);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

  let total: number;
  try {
    const cnt = db.prepare(`SELECT COUNT(*) c FROM skills${where}`).get(...params) as { c: number };
    total = cnt.c;
  } catch {
    total = 0;
  }

  const sortBy = query.get("sortBy") || "score";
  const sortDir = query.get("sortDir") === "asc" ? "ASC" : "DESC";
  const orderCol =
    sortBy === "name" ? "name" : sortBy === "risk" ? "risk_level" : "score";
  const limit = Math.min(Math.max(Number(query.get("limit") || 200), 1), 500);
  const offset = Math.max(Number(query.get("offset") || 0), 0);

  let rows: any[];
  try {
    rows = db
      .prepare(
        `SELECT id, name, description, category, tags, repository, stars, forks,
                license, score, quality, security, maintenance, verified,
                status, risk_level, last_update, last_checked_at
         FROM skills${where}
         ORDER BY ${orderCol} ${sortDir}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];
  } catch {
    rows = [];
  }

  return { total, skills: rows, limit, offset };
}

function apiCategories(): unknown {
  try {
    const rows = db.prepare("SELECT DISTINCT category FROM skills ORDER BY category").all() as Array<{ category: string }>;
    return { categories: rows.map(r => r.category) };
  } catch {
    return { categories: [] };
  }
}

function apiStats(): unknown {
  try {
    const active = db.prepare("SELECT COUNT(*) c FROM skills WHERE status='active'").get() as { c: number };
    const invalid = db.prepare("SELECT COUNT(*) c FROM skills WHERE status='invalid'").get() as { c: number };
    const removed = db.prepare("SELECT COUNT(*) c FROM skills WHERE status='removed'").get() as { c: number };
    const stale = db.prepare("SELECT COUNT(*) c FROM skills WHERE status='stale'").get() as { c: number };
    const sources = db.prepare("SELECT COUNT(*) c FROM sources").get() as { c: number };
    const categories = db.prepare("SELECT COUNT(*) c FROM categories").get() as { c: number };
    const byRisk = db.prepare("SELECT risk_level, COUNT(*) c FROM skills GROUP BY risk_level").all() as Array<{ risk_level: string; c: number }>;
    const risk: Record<string, number> = {};
    for (const r of byRisk) risk[r.risk_level] = r.c;
    const version = db.prepare("SELECT value FROM registry_meta WHERE key='registry_version'").get() as { value: string } | undefined;
    return {
      total: active.c + invalid.c + removed.c + stale.c,
      active: active.c, invalid: invalid.c, removed: removed.c, stale: stale.c,
      sources: sources.c, categories: categories.c, risk,
      registry_version: version?.value || "0.1.0",
    };
  } catch {
    return { total: 0, active: 0, invalid: 0, removed: 0, stale: 0 };
  }
}

function ftsQuery(q: string): string | null {
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const safe = /^[a-z0-9_-]+$/;
  for (const t of tokens) {
    if (!safe.test(t)) return null;
  }
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

function apiSearch(query: URLSearchParams): unknown {
  const q = query.get("q") || "";
  const fts = ftsQuery(q);
  const conditions: string[] = [];
  const params: any[] = [];
  let from = "skills s";
  let order = "s.score";

  if (fts) {
    conditions.push("skills_fts MATCH ?");
    params.push(fts);
    from += " JOIN skills_fts f ON f.rowid = s.rowid";
    order = "bm25(skills_fts)";
  } else if (q) {
    conditions.push("(LOWER(s.name) LIKE LOWER(?) OR LOWER(s.description) LIKE LOWER(?))");
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  const category = query.get("category");
  if (category && category !== "All") {
    conditions.push("s.category = ?");
    params.push(category);
  }
  const minScore = query.get("minScore");
  if (minScore) {
    conditions.push("s.score >= ?");
    params.push(Number(minScore));
  }
  const maxRisk = query.get("maxRisk");
  if (maxRisk && maxRisk !== "All") {
    if (maxRisk === "medium") {
      conditions.push("s.risk_level IN ('low','medium')");
    } else {
      conditions.push("s.risk_level = ?");
      params.push(maxRisk);
    }
  }
  const status = query.get("status");
  if (status && status !== "All") {
    conditions.push("s.status = ?");
    params.push(status);
  }
  const verified = query.get("verified");
  if (verified === "1") {
    conditions.push("s.verified = 1");
  }
  const minStars = query.get("minStars");
  if (minStars) {
    conditions.push("s.stars >= ?");
    params.push(Number(minStars));
  }
  const tag = query.get("tag");
  if (tag) {
    conditions.push("s.tags LIKE ?");
    params.push(`%${tag}%`);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  let sortDir = query.get("sortDir") === "asc" ? "ASC" : "DESC";
  const sortBy = query.get("sortBy") || "score";
  let orderCol =
    sortBy === "name" ? "s.name" : sortBy === "risk" ? "s.risk_level" : sortBy === "recent" ? "s.last_checked_at" : order;
  if (fts && sortBy === "score") {
    // bm25 is smaller = better relevance; always ascending for default search
    orderCol = "bm25(skills_fts)";
    sortDir = "ASC";
  }
  const limit = Math.min(Math.max(Number(query.get("limit") || 200), 1), 500);
  const offset = Math.max(Number(query.get("offset") || 0), 0);

  let total = 0;
  try {
    const cnt = db.prepare(`SELECT COUNT(*) c FROM ${from}${where}`).get(...params) as { c: number };
    total = cnt.c;
  } catch {
    total = 0;
  }

  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT s.id, s.name, s.description, s.category, s.tags, s.repository, s.stars,
                s.forks, s.license, s.score, s.quality, s.security, s.maintenance,
                s.verified, s.status, s.risk_level, s.last_update, s.last_checked_at,
                s.meta_json
         FROM ${from}${where}
         ORDER BY ${orderCol} ${sortDir}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];
    for (const r of rows) {
      try {
        r.meta = JSON.parse(r.meta_json || "{}");
      } catch {
        r.meta = {};
      }
      delete r.meta_json;
    }
  } catch {
    rows = [];
  }

  return { total, skills: rows, limit, offset, fts: !!fts };
}

function apiSkillById(id: string): unknown {
  const row = db.prepare("SELECT * FROM skills WHERE id=?").get(id) as any | undefined;
  if (!row) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta_json || "{}");
  } catch {
    meta = {};
  }
  delete row.meta_json;
  row.meta = meta;
  row.install_status = meta.installed_at ? "installed" : "not_installed";
  return row;
}

function apiSources(): unknown {
  const rows = db
    .prepare(
      `SELECT s.name, s.type, s.repository, s.repository_url, s.priority, s.enabled, s.last_checked_at,
              (SELECT COUNT(*) FROM skills sk WHERE sk.repository = s.name) AS skill_count
       FROM sources s ORDER BY s.priority ASC, s.name`
    )
    .all() as any[];
  return { sources: rows, count: rows.length };
}

function apiTags(): unknown {
  const rows = db
    .prepare("SELECT tags FROM skills WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'")
    .all() as Array<{ tags: string }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.tags);
      if (Array.isArray(arr)) {
        for (const t of arr.slice(0, 6)) {
          if (typeof t === "string" && t) counts.set(t, (counts.get(t) || 0) + 1);
        }
      }
    } catch {
      /* ignore malformed tags */
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
  return { tags };
}

function apiHealth(): unknown {
  try {
    const row = db.prepare("SELECT 1 x").get() as { x: number };
    const total = db.prepare("SELECT COUNT(*) c FROM skills").get() as { c: number };
    const synced = db.prepare("SELECT COUNT(*) c FROM skills_fts").get() as { c: number };
    return { status: "ok", db: row.x === 1, total: total.c, fts_synced: synced.c };
  } catch (e) {
    return { status: "error", error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Skill content (lazy, from skill-market/skills-data part files) + install
// ---------------------------------------------------------------------------
const partCache = new Map<string, any[]>();

function loadPartFile(cat: string): any[] {
  if (partCache.has(cat)) return partCache.get(cat)!;
  const file = path.join(SKILLS_DATA_DIR, `part-${cat}.js`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8");
  const marker = `SKILLS_PART['${cat}'] = `;
  const idx = text.indexOf(marker);
  if (idx === -1) return [];
  const start = text.indexOf("[", idx + marker.length);
  const end = text.lastIndexOf("];");
  if (start === -1 || end <= start) return [];
  let arr: any[] = [];
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    arr = [];
  }
  partCache.set(cat, arr);
  return arr;
}

function apiSkillContent(id: string): unknown {
  const row = db.prepare("SELECT id, name, meta_json FROM skills WHERE id=?").get(id) as any | undefined;
  if (!row) return null;
  let meta: any = {};
  try {
    meta = JSON.parse(row.meta_json || "{}");
  } catch {
    meta = {};
  }
  let cat = meta.cat as string;
  let folder = meta.folder as string;
  if ((!cat || !folder) && typeof row.id === "string") {
    const parts = row.id.split("/");
    if (parts.length >= 3) {
      if (!cat) cat = parts[1];
      if (!folder) folder = parts[2].replace(/#\d+$/, "");
    }
  }
  if (!cat) return { content_available: false, reason: "no category" };
  const entries = loadPartFile(cat);
  const entry = entries.find((e) => e.name === row.name || e.folder === folder || e.folder === row.name);
  if (!entry) return { content_available: false, reason: "not in local dataset" };
  return { content_available: true, name: entry.name, folder: entry.folder, frontmatter: entry.frontmatter, body: entry.body };
}

function safeSkillDirName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return clean || "skill";
}

function apiInstallSkill(id: string): unknown {
  const row = db.prepare("SELECT id, name, meta_json FROM skills WHERE id=?").get(id) as any | undefined;
  if (!row) return { ok: false, error: "skill not found" };
  const content = apiSkillContent(id) as any;
  if (!content || !content.content_available) {
    return { ok: false, error: "content not available for install" };
  }
  const skillsRoot = path.join(homeDir(), ".config", "opencode", "skills");
  const target = path.join(skillsRoot, safeSkillDirName(row.name));
  fs.mkdirSync(target, { recursive: true });
  const fm = (content.frontmatter || {}) as Record<string, unknown>;
  const banner = Object.keys(fm).length
    ? `---\n${Object.entries(fm)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n")}\n---\n\n`
    : "";
  fs.writeFileSync(path.join(target, "SKILL.md"), banner + (content.body || ""));
  const marker = { installed_from: "skill-hub-web", installed_at: new Date().toISOString(), source_id: id };
  fs.writeFileSync(path.join(target, ".mujo.json"), JSON.stringify(marker, null, 2));
  const meta = JSON.parse(row.meta_json || "{}");
  meta.installed_at = marker.installed_at;
  meta.installed_dir = target;
  db.prepare("UPDATE skills SET meta_json=? WHERE id=?").run(JSON.stringify(meta), row.id);
  const existing = db.prepare("SELECT id FROM installations WHERE skill_id=?").get(row.id);
  if (existing) {
    db.prepare(
      "UPDATE installations SET install_path=?, status='installed', installed_at=?, removed_at=NULL WHERE skill_id=?"
    ).run(target, marker.installed_at, row.id);
  } else {
    db.prepare(
      "INSERT INTO installations (skill_id, install_path, status, installed_at) VALUES (?, ?, 'installed', ?)"
    ).run(row.id, target, marker.installed_at);
  }
  return { ok: true, path: target, name: row.name };
}

function apiUninstallSkill(id: string): unknown {
  const row = db.prepare("SELECT id, name, meta_json FROM skills WHERE id=?").get(id) as any | undefined;
  if (!row) return { ok: false, error: "skill not found" };
  let meta: any = {};
  try {
    meta = JSON.parse(row.meta_json || "{}");
  } catch {
    meta = {};
  }
  if (meta.installed_dir) {
    const target = meta.installed_dir as string;
    if (target.startsWith(path.join(homeDir(), ".config", "opencode", "skills"))) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  delete meta.installed_at;
  delete meta.installed_dir;
  db.prepare("UPDATE skills SET meta_json=? WHERE id=?").run(JSON.stringify(meta), row.id);
  db.prepare("DELETE FROM installations WHERE skill_id=?").run(row.id);
  return { ok: true, name: row.name };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
function serveFile(res: http.ServerResponse, filePath: string) {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  const ext = path.extname(filePath).toLowerCase();
  const type = mime[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": type, "Content-Length": content.length });
  res.end(content);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) {
  let file = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (file.startsWith("skills-data/")) {
    const rel = file.slice("skills-data/".length);
    const filePath = path.join(SKILLS_DATA_DIR, path.basename(rel));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    return serveFile(res, filePath);
  }
  // Seguaran basename (spriječi path traversal)
  file = path.basename(file);
  let filePath = path.join(WEB_DIR, file);
  if (!fs.existsSync(filePath) && (file === "skills.json")) {
    filePath = path.join(DIST_DIR, file);
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  serveFile(res, filePath);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === "/api/skills") {
      return sendJson(res, 200, apiSkills(url.searchParams));
    }
    if (pathname === "/api/search") {
      return sendJson(res, 200, apiSearch(url.searchParams));
    }
    if (pathname === "/api/categories") {
      return sendJson(res, 200, apiCategories());
    }
    if (pathname === "/api/sources") {
      return sendJson(res, 200, apiSources());
    }
    if (pathname === "/api/tags") {
      return sendJson(res, 200, apiTags());
    }
    if (pathname === "/api/stats") {
      return sendJson(res, 200, apiStats());
    }
    if (pathname === "/api/health") {
      return sendJson(res, 200, apiHealth());
    }
    if (pathname === "/api/install" && req.method === "POST") {
      return sendJson(res, 400, { error: "POST /api/install/:id expected" });
    }
    if (pathname.startsWith("/api/install/") && req.method === "POST") {
      const id = decodeURIComponent(pathname.slice("/api/install/".length));
      return sendJson(res, 200, apiInstallSkill(id));
    }
    if (pathname.startsWith("/api/uninstall/") && req.method === "POST") {
      const id = decodeURIComponent(pathname.slice("/api/uninstall/".length));
      return sendJson(res, 200, apiUninstallSkill(id));
    }
    if (pathname.startsWith("/api/skills/")) {
      const id = decodeURIComponent(pathname.slice("/api/skills/".length));
      const skill = apiSkillById(id);
      if (!skill) return sendJson(res, 404, { error: "skill not found" });
      return sendJson(res, 200, skill);
    }
    if (pathname.startsWith("/api/content/")) {
      const id = decodeURIComponent(pathname.slice("/api/content/".length));
      const content = apiSkillContent(id);
      if (!content) return sendJson(res, 404, { error: "skill not found" });
      return sendJson(res, 200, content);
    }
    // Everything else: static files
    return serveStatic(req, res, pathname);
  } catch (e) {
    return sendJson(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[skill-hub-web] Serving at http://localhost:${PORT}`);
  console.log(`  API: /api/skills, /api/search, /api/skills/:id, /api/categories, /api/sources, /api/tags, /api/stats, /api/health`);
  console.log(`  Static: web/, dist/, skills-data/`);
  console.log(`  DB : ${DB_PATH}`);
});