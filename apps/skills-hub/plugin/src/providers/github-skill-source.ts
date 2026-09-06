/**
 * GitHubSkillSource — reference implementation of SkillSource (hub.md §33).
 *
 * Pulls SKILL.md entries from a GitHub repo's tree via the REST API. Content
 * is resolved lazily through `getContent` (in-tree SKILL.md or raw download).
 */

import fs from "node:fs";
import path from "node:path";
import { SkillSource, SkillUpdate, SourceMeta, SyncResult } from "./skill-source.ts";

const GITHUB_API = "https://api.github.com";

export class GitHubSkillSource extends SkillSource {
  readonly meta: SourceMeta;

  constructor(
    private readonly repo: string,
    private readonly token: string | undefined,
    options: Partial<SourceMeta> = {}
  ) {
    super();
    const [owner, repoName] = repo.split("/");
    this.meta = {
      name: repoName,
      label: options.label ?? repo,
      url: `https://github.com/${repo}`,
      defaultBranch: options.defaultBranch,
      bundledContent: options.bundledContent ?? true,
      enabled: options.enabled ?? true,
      priority: options.priority ?? 0,
      ...{ owner, repoName },
    };
  }

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    const h: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agentmujo-skill-hub",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers() });
    if (res.status === 403) {
      const limit = res.headers.get("x-ratelimit-remaining");
      throw new Error(`GitHub rate limited (remaining: ${limit ?? "?"})`);
    }
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${url}`);
    return (await res.json()) as T;
  }

  async list(): Promise<SkillUpdate[]> {
    const repoInfo = await this.json<{ default_branch: string; pushed_at: string; stargazers_count: number; forks_count: number }>(
      `${GITHUB_API}/repos/${this.repo}`
    );
    const branch = this.meta.defaultBranch ?? repoInfo.default_branch;
    const sha = (await this.json<{ object: { sha: string } }>(`${GITHUB_API}/repos/${this.repo}/git/ref/heads/${branch}`)).object.sha;
    const commit = await this.json<{ commit: { committer: { date: string } } }>(
      `${GITHUB_API}/repos/${this.repo}/commits/${sha}`
    );
    const updatedAt = commit.commit.committer.date;

    const tree = await this.json<{ tree: Array<{ path: string; type: string }> }>(
      `${GITHUB_API}/repos/${this.repo}/git/trees/${sha}?recursive=1`
    );
    const skills = tree.tree.filter((e) => e.type === "blob" && /^SKILL\.md$/i.test(path.basename(e.path)));

    const entries: SkillUpdate[] = [];
    for (const s of skills) {
      const rel = path.relative(branch === s.path.split("/")[0] ? s.path : "skills", s.path);
      const dir = path.posix.dirname(s.path);
      const folder = path.posix.basename(dir);
      entries.push({
        id: `${this.repo}/${folder}`,
        name: folder,
        description: "",
        skillPath: s.path,
        content: null,
        contentUrl: `https://raw.githubusercontent.com/${this.repo}/${sha}/${s.path}`,
        source: this.meta.name,
        author: this.meta.label,
        githubUrl: `https://github.com/${this.repo}/blob/${branch}/${s.path}`,
        updatedAt,
        stars: repoInfo.stargazers_count,
        forks: repoInfo.forks_count,
      });
    }
    return entries;
  }

  async getContent(entry: SkillUpdate): Promise<string | null> {
    if (entry.content) return entry.content;
    if (entry.contentUrl) {
      const res = await fetch(entry.contentUrl, { headers: this.headers("application/vnd.github.raw") });
      if (res.ok) return await res.text();
    }
    return null;
  }

  async saveCache(key: string, data: unknown): Promise<void> {
    const dir = path.join(process.env.SKILL_HUB_CACHE ?? path.join(process.cwd(), ".cache", this.meta.name));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(data, null, 2));
  }

  async loadCache<T>(key: string): Promise<T | undefined> {
    const file = path.join(process.env.SKILL_HUB_CACHE ?? path.join(process.cwd(), ".cache", this.meta.name), `${key}.json`);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    } catch {
      return undefined;
    }
  }

  /** Thin wrapper returning SyncResult — kept for parity with sync-github.ts. */
  async sync(apply: (entries: SkillUpdate[]) => Promise<void>): Promise<SyncResult> {
    const entries = await this.list();
    await apply(entries);
    return {
      source: this.meta.name,
      skipped: 0,
      upserted: entries.length,
      removed: 0,
      changed: entries.filter((e) => e.contentUrl).length,
    };
  }
}