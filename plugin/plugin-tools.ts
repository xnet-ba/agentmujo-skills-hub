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
// Plugin manifest type (section 9)
// ---------------------------------------------------------------------------
interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  engines?: {
    opencode?: string;
  };
  permissions?: string[];
  features?: string[];
  risk?: "low" | "medium" | "high";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Plugin loader and validator (sections 9–14)
// ---------------------------------------------------------------------------

function loadPluginManifest(pluginPath: string): PluginManifest | null {
  const manifestPath = path.join(pluginPath, "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
}

function validatePluginManifest(m: PluginManifest): { valid: true; warnings: string[] } | { valid: false; reason: string } {
  const warnings: string[] = [];

  // Required fields
  if (!m.name) return { valid: false, reason: "Missing 'name' in plugin manifest" };
  if (!m.version) warnings.push("Missing 'version' in plugin manifest");
  if (!m.description) warnings.push("Missing 'description' in plugin manifest");
  if (!m.author) warnings.push("Missing 'author' in plugin manifest");

  // Risk validation
  if (m.risk && !["low", "medium", "high"].includes(m.risk)) {
    warnings.push(`Invalid 'risk' value: ${m.risk}`);
  }

  // Engine compatibility
  if (m.engines && m.engines.opencode) {
    // Simple semver check (placeholder)
    if (!/^\d+\.\d+\.\d+$/.test(m.engines.opencode)) {
      warnings.push(`Invalid opencode engine version format: ${m.engines.opencode}`);
    }
  }

  // Permissions sanity check
  if (m.permissions && m.permissions.length > 0) {
    const riskyPerms = ["shell", "file_system", "network", "env_access"];
    for (const p of m.permissions) {
      if (riskyPerms.includes(p.toLowerCase())) {
        warnings.push(`Potentially risky permission: ${p}`);
      }
    }
  }

  if (warnings.length > 0) return { valid: true, warnings };
  if (m.name && m.version && m.description && m.author) return { valid: true, warnings };
  return { valid: false, reason: "Manifest missing required fields" };
}

// ---------------------------------------------------------------------------
// CLI: validate a plugin directory
// ---------------------------------------------------------------------------
function main() {
  const pluginDir = process.argv[2] || path.join(homeDir(), "agentmujo-plugins");

  fs.mkdirSync(pluginDir, { recursive: true });

  // Scan for plugin directories
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  const pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  console.log(`[plugin-tools] Scanning plugin directory: ${pluginDir}`);
  console.log(`  Found ${pluginDirs.length} plugin directory(s)\n`);

  for (const dir of pluginDirs) {
    const fullPath = path.join(pluginDir, dir);
    const manifest = loadPluginManifest(fullPath);

    if (!manifest) {
      console.log(`[${dir}] ❌ No plugin.json manifest found`);
      continue;
    }

    const result = validatePluginManifest(manifest);

    if (result.valid) {
      const riskIcon = manifest.risk === "high" ? "🔴" : manifest.risk === "medium" ? "🟡" : "🟢";
      console.log(`[${dir}] ✅ ${riskIcon} "${manifest.name}" v${manifest.version}`);
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          console.log(`   ⚠️  ${w}`);
        }
      }
    } else {
      console.log(`[${dir}] ❌ "${dir}" — ${result.reason}`);
    }
  }
}

// Run
main().catch((e) => {
  console.error("[plugin-tools] FATAL:", e);
  process.exit(1);
});