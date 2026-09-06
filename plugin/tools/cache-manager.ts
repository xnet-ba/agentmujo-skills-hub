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
// Section 14: Cache (hub.md lines 1133–1173)
// Local cache structure: ~/.config/opencode/skill-hub/
// ├── cache/
// ├── installed/
// ├── downloads/
// ├── registry.db
// ├── logs/
// └── config.json
// ---------------------------------------------------------------------------

interface CacheConfig {
  cacheRoot: string;
  installedDir: string;
  downloadsDir: string;
  logsDir: string;
  dbPath: string;
  configPath: string;
}

// Initialize cache directory structure
function initCache(): CacheConfig {
  const cacheRoot = path.join(homeDir(), ".config", "opencode", "skill-hub");
  const config = {
    cacheRoot,
    installedDir: path.join(cacheRoot, "installed"),
    downloadsDir: path.join(cacheRoot, "downloads"),
    logsDir: path.join(cacheRoot, "logs"),
    dbPath: path.join(cacheRoot, "registry.db"),
    configPath: path.join(cacheRoot, "config.json"),
  };

  // Create all directories if they don't exist
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.mkdirSync(config.installedDir, { recursive: true });
  fs.mkdirSync(config.downloadsDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });

  // Initialize config.json if it doesn't exist
  if (!fs.existsSync(config.configPath)) {
    const defaultConfig = {
      schemaVersion: 1,
      compatVersion: "0.1.0",
      autoInstall: true,
      maxRisk: "medium",
      minimumScore: 75,
      minimumStars: 0,
      verifiedOnly: false,
      autoRefresh: true,
      refreshInterval: "24h",
      maxInstalledSkills: 100,
    };
    fs.writeFileSync(config.configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`[cache-manager] Created default config at ${config.configPath}`);
  } else {
    console.log(`[cache-manager] Config already exists at ${config.configPath}`);
  }

  // Initialize registry.db if it doesn't exist (simple placeholder)
  if (!fs.existsSync(config.dbPath)) {
    console.log(`[cache-manager] NOTE: registry.db not found at ${config.dbPath}`);
    console.log("  Run build-registry.ts to initialize the SQLite database.");
  }

  return config;
}

// List cache contents
function listCache(): void {
  const cacheRoot = path.join(homeDir(), ".config", "opencode", "skill-hub");

  if (!fs.existsSync(cacheRoot)) {
    console.log("[cache-manager] Cache directory does not exist");
    initCache();
    return;
  }

  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  console.log(`\n[cache-manager] Cache root: ${cacheRoot}\n`);

  for (const entry of entries) {
    const fullPath = path.join(cacheRoot, entry.name);
    if (entry.isDirectory()) {
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      console.log(`  ${entry.name}/`);
      for (const sub of subEntries) {
        console.log(`    ${sub.name}`);
      }
    } else {
      console.log(`  ${entry.name}`);
    }
  }

  // Show config.json contents if it exists
  const configPath = path.join(cacheRoot, "config.json");
  if (fs.existsSync(configPath)) {
    console.log("\n  config.json:");
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      console.log(`    ${JSON.stringify(parsed, null, 4)}`);
    } catch {
      console.log("    (could not parse)");
    }
  }
}

// Validate cache structure
function validateCache(): void {
  const cacheRoot = path.join(homeDir(), ".config", "opencode", "skill-hub");
  const issues: string[] = [];

  if (!fs.existsSync(cacheRoot)) {
    console.log("[cache-manager] Cache root does not exist – will be created on next init");
    initCache();
    return;
  }

  // Check required directories
  const requiredDirs = ["cache", "installed", "downloads", "logs"];
  for (const d of requiredDirs) {
    const dPath = path.join(cacheRoot, d);
    if (!fs.existsSync(dPath)) {
      issues.push(`Missing directory: ${d}`);
    }
  }

  // Check registry.db
  const dbPath = path.join(cacheRoot, "registry.db");
  if (!fs.existsSync(dbPath)) {
    issues.push("Missing: registry.db");
  }

  // Check config.json
  const configPath = path.join(cacheRoot, "config.json");
  if (!fs.existsSync(configPath)) {
    issues.push("Missing: config.json");
  }

  if (issues.length === 0) {
    console.log("[cache-cache] ✅ Cache structure is valid");
  } else {
    console.log("[cache-manager] ⚠️  Cache issues found:");
    for (const issue of issues) {
      console.log(`   • ${issue}`);
    }
    console.log("   Run init to fix.");
  }
}

// CLI
async function main() {
  const action = process.argv[3];

  console.log("[cache-manager] AgentMujo Skills Hub Cache Manager");
  console.log("===========================================\n");

  switch (action) {
    case "init":
      initCache();
      break;
    case "list":
      listCache();
      break;
    case "validate":
      validateCache();
      break;
    default:
      console.log("Usage: node cache-manager.ts <init|list|validate>");
      console.log("  init      – create cache directory structure");
      console.log("  list      – list cache contents");
      console.log("  validate  – validate cache integrity");
  }
}

main().catch((e) => {
  console.error("[cache-manager] FATAL:", e);
  process.exit(1);
});