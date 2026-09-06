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
  const root = path.join(__dirname2, "..");
  const configPath = path.join(root, "config", "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const reg = parsed.registry ?? {};
    return {
      dbPath: reg.dbPath ?? parsed.dbPath ?? path.join(homeDir(), ".config", "opencode", "skill-hub", "registry.db"),
      schemaVersion: reg.schemaVersion ?? parsed.schemaVersion ?? 1,
      maxRisk: parsed.maxRisk ?? "medium",
      minimumScore: parsed.minimumScore ?? 75,
    };
  } catch {
    return {
      dbPath: path.join(homeDir(), ".config", "opencode", "skill-hub", "registry.db"),
      schemaVersion: 1,
      maxRisk: "medium",
      minimumScore: 75,
    };
  }
}

interface Config {
  dbPath: string;
  schemaVersion: number;
  maxRisk: string;
  minimumScore: number;
}

// ---------------------------------------------------------------------------
// Demo seed data — populates registry so the whole pipeline can be tested
// ---------------------------------------------------------------------------

interface SeedSkill {
  name: string;
  description: string;
  category: string;
  tags: string[];
  repository: string;
  author: string;
  stars: number;
  forks: number;
  license: string;
  score: number;
  quality: number;
  security: number;
  maintenance: number;
  verified: number;
  status: string;
  risk_level: string;
  last_update: string;
}

const SEED_SKILLS: SeedSkill[] = [
  {
    name: "docker-security-expert",
    description: "Expert skill for hardening and securing Docker containers. Covers image scanning, runtime protection, and container isolation best practices.",
    category: "Security",
    tags: ["docker", "security", "hardening", "containers"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 1832,
    forks: 214,
    license: "MIT",
    score: 92,
    quality: 95,
    security: 80,
    maintenance: 100,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2025-06-12T10:00:00Z",
  },
  {
    name: "docker-hardening",
    description: "Guidance for Docker deployment hardening: user namespaces, seccomp profiles, and least-privilege configuration.",
    category: "Security",
    tags: ["docker", "hardening", "security"],
    repository: "addyosmani/claude-skills",
    author: "addyosmani",
    stars: 754,
    forks: 98,
    license: "MIT",
    score: 84,
    quality: 82,
    security: 60,
    maintenance: 100,
    verified: 0,
    status: "active",
    risk_level: "medium",
    last_update: "2025-03-20T10:00:00Z",
  },
  {
    name: "container-security",
    description: "Comprehensive container security scanning: image vulnerability triage, SBOM generation, and supply-chain validation.",
    category: "Security",
    tags: ["containers", "security", "vuln"],
    repository: "ComposioHQ/composio",
    author: "composio",
    stars: 512,
    forks: 61,
    license: "Apache-2.0",
    score: 78,
    quality: 75,
    security: 40,
    maintenance: 100,
    verified: 0,
    status: "active",
    risk_level: "medium",
    last_update: "2024-11-05T10:00:00Z",
  },
  {
    name: "docker-audit",
    description: "Audit running Docker environments: misconfiguration detection, security baseline checks, and CIS Docker benchmark.",
    category: "Security",
    tags: ["docker", "audit", "security"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 321,
    forks: 45,
    license: "MIT",
    score: 71,
    quality: 68,
    security: 50,
    maintenance: 70,
    verified: 1,
    status: "stale",
    risk_level: "medium",
    last_update: "2023-08-15T10:00:00Z",
  },
  {
    name: "k8s-cluster-setup",
    description: "Production Kubernetes cluster setup: kubeadm init, networking (CNI), ingress controllers, and persistent storage.",
    category: "DevOps / Containers",
    tags: ["kubernetes", "k8s", "devops", "infra"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 2450,
    forks: 310,
    license: "MIT",
    score: 95,
    quality: 98,
    security: 85,
    maintenance: 100,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2025-07-02T10:00:00Z",
  },
  {
    name: "python-data-science",
    description: "End-to-end Python data science workflow: pandas, numpy, scikit-learn, and matplotlib for analysis and modeling.",
    category: "Python",
    tags: ["python", "data", "pandas", "numpy"],
    repository: "addyosmani/claude-skills",
    author: "addyosmani",
    stars: 1890,
    forks: 205,
    license: "MIT",
    score: 90,
    quality: 92,
    security: 75,
    maintenance: 100,
    verified: 0,
    status: "active",
    risk_level: "low",
    last_update: "2025-05-01T10:00:00Z",
  },
  {
    name: "aws-cloud-security",
    description: "AWS security best practices: IAM least privilege, S3 bucket policies, CloudTrail auditing, and GuardDuty setup.",
    category: "Cloud / AWS",
    tags: ["aws", "security", "cloud", "iam"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 1520,
    forks: 178,
    license: "Apache-2.0",
    score: 88,
    quality: 90,
    security: 100,
    maintenance: 70,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2024-12-20T10:00:00Z",
  },
  {
    name: "postgresql-performance",
    description: "PostgreSQL performance tuning: query optimization, indexing strategies, vacuum tuning, and connection pooling.",
    category: "Database",
    tags: ["postgres", "sql", "database", "performance"],
    repository: "ComposioHQ/composio",
    author: "composio",
    stars: 980,
    forks: 118,
    license: "PostgreSQL",
    score: 81,
    quality: 79,
    security: 55,
    maintenance: 100,
    verified: 0,
    status: "active",
    risk_level: "low",
    last_update: "2025-01-15T10:00:00Z",
  },
  {
    name: "frontend-react-a11y",
    description: "Accessibility-first React development: ARIA patterns, keyboard navigation, and WCAG 2.1 compliance checks.",
    category: "Frontend",
    tags: ["react", "a11y", "accessibility", "frontend"],
    repository: "addyosmani/claude-skills",
    author: "addyosmani",
    stars: 678,
    forks: 52,
    license: "MIT",
    score: 79,
    quality: 76,
    security: 45,
    maintenance: 70,
    verified: 0,
    status: "stale",
    risk_level: "low",
    last_update: "2024-02-11T10:00:00Z",
  },
  {
    name: "terraform-infra",
    description: "Terraform infrastructure as code: module design, state management, remote backends, and apply automation.",
    category: "Infrastructure as Code",
    tags: ["terraform", "infra", "iac"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 1120,
    forks: 134,
    license: "MIT",
    score: 86,
    quality: 88,
    security: 70,
    maintenance: 100,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2025-04-10T10:00:00Z",
  },
  {
    name: "jenkins-cicd-pipeline",
    description: "Jenkins CI/CD pipeline authoring: Jenkinsfile patterns, agent configuration, and artifact promotion strategies.",
    category: "CI/CD",
    tags: ["ci-cd", "pipeline", "jenkins"],
    repository: "ComposioHQ/composio",
    author: "composio",
    stars: 345,
    forks: 41,
    license: "Apache-2.0",
    score: 62,
    quality: 58,
    security: 30,
    maintenance: 40,
    verified: 0,
    status: "stale",
    risk_level: "medium",
    last_update: "2023-05-22T10:00:00Z",
  },
  {
    name: "grafana-observability",
    description: "Full observability stack with Grafana + Prometheus: dashboard creation, alerting rules, and metric collection setup.",
    category: "Monitoring / Observability",
    tags: ["observability", "grafana", "prometheus", "monitoring"],
    repository: "addystack-observability/skills",
    author: "addystack",
    stars: 512,
    forks: 63,
    license: "AGPL-3.0",
    score: 74,
    quality: 72,
    security: 40,
    maintenance: 70,
    verified: 0,
    status: "active",
    risk_level: "medium",
    last_update: "2024-09-01T10:00:00Z",
  },
  {
    name: "linux-shell-admin",
    description: "Linux system administration: shell scripting, cron automation, user management, and systemd service configuration.",
    category: "Linux / System Administration",
    tags: ["linux", "bash", "shell", "systemd"],
    repository: "addyosmani/claude-skills",
    author: "addyosmani",
    stars: 890,
    forks: 102,
    license: "MIT",
    score: 77,
    quality: 74,
    security: 55,
    maintenance: 70,
    verified: 0,
    status: "active",
    risk_level: "medium",
    last_update: "2024-07-19T10:00:00Z",
  },
  {
    name: "node-api-backend",
    description: "Production Node.js REST API: Express/Fastify patterns, error handling, authentication, and rate limiting.",
    category: "Backend / API",
    tags: ["node", "javascript", "api", "backend", "express"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 1420,
    forks: 150,
    license: "MIT",
    score: 87,
    quality: 89,
    security: 80,
    maintenance: 100,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2025-06-01T10:00:00Z",
  },
  {
    name: "cypress-e2e-testing",
    description: "End-to-end testing with Cypress: test runner setup, cypress.config, CI integration, and visual regression testing.",
    category: "Testing",
    tags: ["testing", "cypress", "e2e"],
    repository: "addyosmani/claude-skills",
    author: "addyosmani",
    stars: 690,
    forks: 58,
    license: "MIT",
    score: 73,
    quality: 70,
    security: 35,
    maintenance: 70,
    verified: 0,
    status: "active",
    risk_level: "low",
    last_update: "2024-04-22T10:00:00Z",
  },
  {
    name: "git-release-management",
    description: "Git release management: versioning (semver), tags, release branches, and changelog automation.",
    category: "Git / GitHub",
    tags: ["git", "release", "github", "semver"],
    repository: "anthropics/skills",
    author: "anthropic",
    stars: 780,
    forks: 66,
    license: "MIT",
    score: 82,
    quality: 84,
    security: 60,
    maintenance: 70,
    verified: 1,
    status: "active",
    risk_level: "low",
    last_update: "2025-02-14T10:00:00Z",
  },
];

function main() {
  const config = loadConfig();
  const dbPath = config.dbPath.replace(/^~/, homeDir());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  // Apply schema
  const root = path.join(__dirname2, "..");
  const schemaPath = path.join(root, "registry", "schema.sql");
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, "utf-8"));
  }

  // Insert sources
  const sources = [
    ["anthropic", "anthropics/skills", "https://github.com/anthropics/skills", "organization", 1],
    ["addyosmani", "addyosmani/claude-skills", "https://github.com/addyosmani/claude-skills", "user", 2],
    ["composio", "ComposioHQ/composio", "https://github.com/ComposioHQ/composio", "organization", 3],
    ["addystack", "addystack-observability/skills", "https://github.com/addystack-observability/skills", "user", 4],
  ];
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO sources(name, type, repository, repository_url, priority, created_at)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  const nowTs = new Date().toISOString();
  for (const [id, repo, url, type, priority] of sources) {
    insertSource.run(id, type, repo, url, priority, nowTs);
  }

  // Insert categories and tags
  const categoryNames = [...new Set(SEED_SKILLS.map(s => s.category))];
  const insertCat = db.prepare("INSERT OR IGNORE INTO categories(name) VALUES(?)");
  for (const c of categoryNames) insertCat.run(c);

  const tagNames = [...new Set(SEED_SKILLS.flatMap(s => s.tags))];
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags(name) VALUES(?)");
  for (const t of tagNames) insertTag.run(t);

  // Insert skills
  const insertSkill = db.prepare(`
    INSERT INTO skills(
      id, name, description, category, tags, repository, author,
      stars, forks, license, last_update, score, quality, security,
      maintenance, verified, status, risk_level, content_hash,
      last_checked_at, meta_json
    ) VALUES(
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      category=excluded.category,
      tags=excluded.tags,
      repository=excluded.repository,
      author=excluded.author,
      stars=excluded.stars,
      forks=excluded.forks,
      license=excluded.license,
      last_update=excluded.last_update,
      score=excluded.score,
      quality=excluded.quality,
      security=excluded.security,
      maintenance=excluded.maintenance,
      verified=excluded.verified,
      status=excluded.status,
      risk_level=excluded.risk_level,
      last_checked_at=excluded.last_checked_at,
      meta_json=excluded.meta_json
  `);

  const now = new Date().toISOString();
  for (const s of SEED_SKILLS) {
    const id = `${s.author}/${s.repository.split("/")[1]}/${s.name}`;
    insertSkill.run(
      id, s.name, s.description, s.category, JSON.stringify(s.tags), s.repository, s.author,
      s.stars, s.forks, s.license, s.last_update, s.score, s.quality, s.security,
      s.maintenance, s.verified, s.status, s.risk_level, "", now, "{}"
    );
  }

  // Additional demo skills
  const additionalSkills = [
    {
      name: "linux-system-admin",
      description: "Essential Linux system administration: user management, package management, systemd services, and security hardening.",
      category: "Linux / System Administration",
      tags: ["linux", "sysadmin", "bash", "systemd", "security"],
      repository: "addyosmani/claude-skills",
      author: "addyosmani",
      stars: 472,
      forks: 56,
      license: "MIT",
      score: 85,
      quality: 88,
      security: 80,
      maintenance: 95,
      verified: 0,
      status: "active",
      risk_level: "low",
      last_update: "2025-06-28T10:00:00Z",
    },
    {
      name: "monitoring-prometheus",
      description: "Prometheus monitoring setup: scraping, rules, alerts, and Grafana dashboards for infrastructure monitoring.",
      category: "Monitoring / Observability",
      tags: ["prometheus", "monitoring", "grafana", "alerting"],
      repository: "anthropics/skills",
      author: "anthropic",
      stars: 589,
      forks: 123,
      license: "Apache-2.0",
      score: 89,
      quality: 90,
      security: 85,
      maintenance: 95,
      verified: 1,
      status: "active",
      risk_level: "low",
      last_update: "2025-09-01T10:00:00Z",
    },
    {
      name: "ci-cd-github-actions",
      description: "CI/CD pipelines with GitHub Actions: build, test, deploy automation; matrix strategies and artifact publishing.",
      category: "CI/CD",
      tags: ["github-actions", "ci", "cd", "automation", "devops"],
      repository: "addyosmani/claude-skills",
      author: "addyosmani",
      stars: 445,
      forks: 88,
      license: "MIT",
      score: 83,
      quality: 80,
      security: 70,
      maintenance: 85,
      verified: 0,
      status: "active",
      risk_level: "medium",
      last_update: "2025-08-15T10:00:00Z",
    },
  ];

  for (const s of additionalSkills) {
    const id = `${s.author}/${s.repository.split("/")[1]}/${s.name}`;
    insertSkill.run(
      id, s.name, s.description, s.category, JSON.stringify(s.tags), s.repository, s.author,
      s.stars, s.forks, s.license, s.last_update, s.score, s.quality, s.security,
      s.maintenance, s.verified, s.status, s.risk_level, "", now, "{}"
    );
  }

  console.log(`[seed-demo] Inserted ${SEED_SKILLS.length + additionalSkills.length} skills`);
  console.log(`  Categories: ${categoryNames.join(", ")}`);
  console.log(`  Tags: ${tagNames.length} unique`);
  console.log(`  DB: ${dbPath}`);

  db.close();
  console.log("[seed-demo] Done.");
}

try {
  main();
} catch (e) {
  console.error("[seed-demo] FATAL:", e);
  process.exit(1);
}