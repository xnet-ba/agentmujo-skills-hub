import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

function homeDir(): string {
  return os.homedir();
}

// ---------------------------------------------------------------------------
// Section 15: FAST SEARCH (hub.md lines 1175–1217)
// Uses local SQLite FTS5 index (skill_fts) — NO GitHub API calls.
// Flow: Agent → Local SQLite FTS index → results
// ---------------------------------------------------------------------------

class FastSearch {
  private db: DatabaseSync;

  constructor() {
    const dbPath = path.join(homeDir(), ".config", "opencode", "skill-hub", "registry.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  // --- FTS5 MATCH search ---
  ftsQuery(query: string, filters: {
    category?: string;
    minScore?: number;
    maxRisk?: string;
    limit?: number;
  } = {}): Array<{
    id: string; name: string; description: string; category: string;
    tags: string; score: number; risk_level: string; verified: number; status: string;
  }> {
    // Build FTS5 MATCH expression from query terms
    const terms = query
      .split(/\s+/)
      .filter(Boolean)
      .map(t => `${t}*`); // prefix matching
    const matchExpr = terms.join(" AND ");

    let sql = `
      SELECT s.id, s.name, s.description, s.category, s.tags, s.score,
             s.risk_level, s.verified, s.status
      FROM skills_fts f
      JOIN skills s ON s.rowid = f.rowid
      WHERE skills_fts MATCH ?
    `;
    const params: any[] = [matchExpr];

    if (filters.category && filters.category !== "All") {
      sql += " AND s.category = ?";
      params.push(filters.category);
    }
    if (filters.minScore !== undefined) {
      sql += " AND s.score >= ?";
      params.push(filters.minScore);
    }
    if (filters.maxRisk && filters.maxRisk !== "All") {
      sql += " AND s.risk_level = ?";
      params.push(filters.maxRisk);
    }

    sql += " ORDER BY bm25(skills_fts) LIMIT ?";
    params.push(filters.limit ?? 50);

    return this.db.prepare(sql).all(...params) as Array<{
      id: string; name: string; description: string; category: string;
      tags: string; score: number; risk_level: string; verified: number; status: string;
    }>;
  }

  // --- Fallback LIKE search when FTS5 is not available/empty ---
  likeSearch(query: string, filters: {
    category?: string;
    minScore?: number;
    maxRisk?: string;
    limit?: number;
  } = {}): Array<{
    id: string; name: string; description: string; category: string;
    tags: string; score: number; risk_level: string; verified: number; status: string;
  }> {
    let sql = `
      SELECT id, name, description, category, tags, score, risk_level, verified, status
      FROM skills
      WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?
    `;
    const like = `%${query.toLowerCase()}%`;
    const params: any[] = [like, like, like];

    if (filters.category && filters.category !== "All") {
      sql += " AND category = ?";
      params.push(filters.category);
    }
    if (filters.minScore !== undefined) {
      sql += " AND score >= ?";
      params.push(filters.minScore);
    }
    if (filters.maxRisk && filters.maxRisk !== "All") {
      sql += " AND risk_level = ?";
      params.push(filters.maxRisk);
    }

    sql += " ORDER BY score DESC LIMIT ?";
    params.push(filters.limit ?? 50);

    return this.db.prepare(sql).all(...params) as Array<{
      id: string; name: string; description: string; category: string;
      tags: string; score: number; risk_level: string; verified: number; status: string;
    }>;
  }

  close() {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const searchEngine = new FastSearch();

  // Parse args: node fts-search.ts "query" [--category X] [--minScore N] [--maxRisk X] [--limit N]
  const rawArgs = process.argv.slice(2);
  const query = rawArgs[0] || "";
  const filters: { category?: string; minScore?: number; maxRisk?: string; limit?: number } = {};

  for (let i = 1; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === "--category" && rawArgs[i + 1]) filters.category = rawArgs[++i];
    else if (a === "--minScore" && rawArgs[i + 1]) filters.minScore = parseInt(rawArgs[++i], 10);
    else if (a === "--maxRisk" && rawArgs[i + 1]) filters.maxRisk = rawArgs[++i];
    else if (a === "--limit" && rawArgs[i + 1]) filters.limit = parseInt(rawArgs[++i], 10);
  }

  console.log(`[fts-search] Query: "${query}"`);
  if (filters.category) console.log(`  category: ${filters.category}`);
  if (filters.minScore !== undefined) console.log(`  minScore: ${filters.minScore}`);
  if (filters.maxRisk) console.log(`  maxRisk: ${filters.maxRisk}`);
  if (filters.limit) console.log(`  limit: ${filters.limit}`);

  let results;
  try {
    results = searchEngine.ftsQuery(query, filters);
    console.log(`\n[fts-search] Using FTS5 index (${results.length} results)`);
  } catch {
    // FTS5 may fail if index empty or not built; fall back to LIKE
    results = searchEngine.likeSearch(query, filters);
    console.log(`\n[fts-search] FTS5 unavailable, using LIKE fallback (${results.length} results)`);
  }

  for (const r of results) {
    console.log(`  score=${r.score} [${r.risk_level}] '${r.name}' (${r.category}) verified=${r.verified === 1} status=${r.status}`);
  }

  searchEngine.close();
}

main().catch((e) => {
  console.error("[fts-search] FATAL:", e);
  process.exit(1);
});