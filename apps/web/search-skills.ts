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

function loadConfig(): Config {
  const root = path.join(__dirname2, "..", "..", "skills-hub");
  const configPath = path.join(root, "config", "config.json");
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

interface Config {
  dbPath: string;
  registryDir: string;
  schemaVersion: number;
  compatVersion: string;
  autoInstall: boolean;
  maxRisk: string;
  minimumScore: number;
  minimumStars: number;
  verifiedOnly: boolean;
  autoRefresh: boolean;
  refreshInterval: string;
  maxInstalledSkills: number;
  cache: {
    root: string;
    installedSkillsPath: string;
  };
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
// Search & filter (sections 7–8)
// ---------------------------------------------------------------------------

interface SearchFilter {
  query?: string; // search in name/description
  category?: string;
  minScore?: number;
  maxRisk?: string;
  verifiedOnly?: boolean;
  status?: string;
}

function readSkills(db: DatabaseSync): SkillRecord[] {
  return db.prepare("SELECT * FROM skills").all() as SkillRecord[];
}

function searchSkills(skills: SkillFilter[], sf: SearchFilter): SkillRecord[] {
  let result = [...skills];

  // Query search in name/description (simple contains)
  if (sf.query) {
    const q = sf.query.toLowerCase();
    result = result.filter(
      (s) => (s.name && s.name.toLowerCase().includes(q)) || (s.description && s.description.toLowerCase().includes(q))
    );
  }

  // Filter by category
  if (sf.category && sf.category !== "All") {
    result = result.filter((s) => s.category === sf.category);
  }

  // Filter by minimum score
  if (sf.minScore !== undefined) {
    result = result.filter((s) => s.score >= sf.minScore);
  }

  // Filter by max risk
  if (sf.maxRisk && sf.maxRisk !== "All") {
    result = result.filter((s) => s.risk_level === sf.maxRisk);
  }

  // Filter by verified only
  if (sf.verifiedOnly === true) {
    result = result.filter((s) => s.verified === 1);
  }

  // Filter by status
  if (sf.status && sf.status !== "All") {
    result = result.filter((s) => s.status === sf.status);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const config = loadConfig();
  const dbPath = config.dbPath.replace(/^~/, homeDir());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  const skills = readSkills(db);

  // Parse simple CLI args: node search-skills.ts --query="term" --category="Cat" --minScore=80
  const args = process.argv.slice(2);
  const sf: SearchFilter = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--query" && args[i + 1]) { sf.query = args[++i]; }
    else if (a === "--category" && args[i + 1]) { sf.category = args[++i]; }
    else if (a === "--minScore" && args[i + 1]) { sf.minScore = parseInt(args[++i], 10); }
    else if (a === "--maxRisk" && args[i + 1]) { sf.maxRisk = args[++i]; }
    else if (a === "--verified") { sf.verifiedOnly = true; }
    else if (a === "--status" && args[i + 1]) { sf.status = args[++i]; }
  }

  const filtered = searchSkills(skills, sf);

  console.log(`\n[search] Showing ${filtered.length} of ${skills.length} skills`);
  if (sf.query) console.log(`  query: "${sf.query}"`);
  if (sf.category) console.log(`  category: ${sf.category}`);
  if (sf.minScore !== undefined) console.log(`  minScore: ${sf.minScore}`);
  if (sf.maxRisk) console.log(`  maxRisk: ${sf.maxRisk}`);
  if (sf.verifiedOnly) console.log(`  verifiedOnly: true`);
  if (sf.status) console.log(`  status: ${sf.status}`);

  // Print table-like output
  for (const s of filtered) {
    const riskIcon = s.risk_level === "high" ? "🔴" : s.risk_level === "medium" ? "🟡" : "🟢";
    const verifiedIcon = s.verified === 1 ? "✓" : " ";
    console.log(` ${riskIcon} ${verifiedIcon} score=${s.score} '${s.name}' [${s.category}] ${s.status}`);
  }

  db.close();
}

// Run
main().catch((e) => {
  console.error("[search] FATAL:", e);
  process.exit(1);
});