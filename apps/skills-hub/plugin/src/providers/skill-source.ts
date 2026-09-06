/**
 * SkillSource — provider contract for the AgentMujo Skills Hub (hub.md §33).
 *
 * Each registry source (GitHub repo, local folder, future marketplaces)
 * implements this interface. The sync engine and refresh jobs talk only to
 * this shape, never to concrete HTTP/fetch logic.
 */

export interface SkillUpdate {
  /** `${source}/${cat}/${folder}` style stable identity. */
  id: string;
  name: string;
  description: string;
  /** Path relative to the source root, e.g. `skills/docker/SKILL.md`. */
  skillPath: string | null;
  /** Raw SKILL.md body (frontmatter may be embedded). */
  content: string | null;
  /** Direct URL to fetch the file lazily when content is not bundled. */
  contentUrl: string | null;
  source: string;
  category?: string | null;
  tags?: string[];
  license?: string | null;
  stars?: number;
  forks?: number;
  author?: string | null;
  githubUrl?: string | null;
  updatedAt?: string | null;
}

export interface SourceMeta {
  name: string;
  label: string;
  url: string;
  defaultBranch?: string;
  /** Content structure flag: does the repo carry SKILL.md bodies in-tree? */
  bundledContent: boolean;
  enabled: boolean;
  priority: number;
}

export interface SyncResult {
  source: string;
  skipped: number;
  upserted: number;
  removed: number;
  changed: number;
  error?: string;
}

export abstract class SkillSource {
  abstract readonly meta: SourceMeta;

  /** Fetch all skill entries for the source in one pass. */
  abstract list(): Promise<SkillUpdate[]>;

  /**
   * Materialize the SKILL.md body for an entry. Returns the markdown when the
   * source bundles content, otherwise downloads it via `contentUrl`.
   */
  abstract getContent(entry: SkillUpdate): Promise<string | null>;

  /** Cache a raw response so repeated syncs avoid network hits. */
  abstract saveCache(key: string, data: unknown): Promise<void>;
  abstract loadCache<T>(key: string): Promise<T | undefined>;
}