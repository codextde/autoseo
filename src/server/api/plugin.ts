import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createZip, type ZipEntry } from "./zip";

/**
 * AutoSEO agent plugin + skills catalog. Source of truth: `plugins/autoseo/**` in the repository
 * (copied into the Docker image). The app serves an instance-specific build of it — MCP URL baked
 * in — as a Claude Code URL marketplace (archive source) and as zip downloads for Codex / Cursor.
 */

const PLUGIN_ROOT = path.join(process.cwd(), "plugins", "autoseo");
const URL_PLACEHOLDER = "https://YOUR-AUTOSEO-DOMAIN";
export const PLUGIN_NAME = "autoseo";
export const MARKETPLACE_NAME = "autoseo";

export type SkillGroup = "seo" | "ai" | "guides";
export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = {
  seo: "SEO workflows",
  ai: "AI visibility",
  guides: "Guides & utilities",
};
const SKILL_GROUPS: Record<string, SkillGroup> = {
  "seo-audit": "seo",
  "keyword-research": "seo",
  "keyword-clustering": "seo",
  "competitive-landscape": "seo",
  "competitor-analysis": "seo",
  "link-prospecting": "seo",
  "local-seo": "seo",
  "ai-visibility-report": "ai",
  "competitor-gap": "ai",
  "content-opportunities": "ai",
  "sentiment-review": "ai",
  "source-outreach": "ai",
  "ai-project-setup": "ai",
  "seo-coach": "guides",
  "seo-project-setup": "guides",
  "seo-report": "guides",
  "simple-issue-description": "guides",
};
const GROUP_ORDER: SkillGroup[] = ["seo", "ai", "guides"];

export type SkillDoc = {
  slug: string;
  name: string;
  title: string;
  description: string;
  group: SkillGroup;
  body: string;
  bytes: number;
};

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

function parseSkill(slug: string, body: string): SkillDoc {
  const fm = /^---\n([\s\S]*?)\n---/.exec(body)?.[1] ?? "";
  const field = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm)?.[1]?.trim() ?? "";
    return m.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
  };
  const title = /^#\s+(.+)$/m.exec(body.replace(/^---[\s\S]*?---/, ""))?.[1]?.trim() ?? slug;
  return {
    slug,
    name: field("name") || slug,
    title: title.replace(/^AutoSEO\s+/, ""),
    description: field("description"),
    group: SKILL_GROUPS[slug] ?? "guides",
    body,
    bytes: Buffer.byteLength(body, "utf8"),
  };
}

let cache: { key: string; files: Map<string, Buffer> } | null = null;

/** All plugin source files (relative path → bytes); re-read when the directory changes (dev). */
function pluginSource(): Map<string, Buffer> {
  if (!fs.existsSync(PLUGIN_ROOT)) return new Map();
  const list = walk(PLUGIN_ROOT).sort();
  const key = list.map((f) => `${f}:${fs.statSync(path.join(PLUGIN_ROOT, f)).mtimeMs}`).join("|");
  if (cache?.key === key) return cache.files;
  const files = new Map(list.map((f) => [f, fs.readFileSync(path.join(PLUGIN_ROOT, f))]));
  cache = { key, files };
  return files;
}

export function listSkills(): SkillDoc[] {
  const docs: SkillDoc[] = [];
  for (const [file, buf] of pluginSource()) {
    const m = /^skills\/([a-z0-9-]+)\/SKILL\.md$/.exec(file);
    if (m) docs.push(parseSkill(m[1]!, buf.toString("utf8")));
  }
  return docs.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.slug.localeCompare(b.slug));
}

export function getSkill(slug: string): SkillDoc | null {
  return listSkills().find((s) => s.slug === slug) ?? null;
}

/* ───────────────────────────── Instance build ───────────────────────────── */

type Instance = { appUrl: string; appName: string };

function json(v: unknown) {
  return `${JSON.stringify(v, null, 2)}\n`;
}

/** Plugin files with this instance's MCP URL baked in (no user configuration needed). */
export function instancePluginFiles(inst: Instance): ZipEntry[] {
  const mcpUrl = `${inst.appUrl}/api/mcp`;
  const out: ZipEntry[] = [];
  for (const [file, buf] of pluginSource()) {
    if (file === ".claude-plugin/plugin.json") {
      const m = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
      delete m.userConfig;
      m.homepage = inst.appUrl;
      m.mcpServers = { autoseo: { type: "http", url: mcpUrl } };
      out.push({ path: file, content: json(m) });
    } else if (file === "plugin.json" || file === ".codex-plugin/plugin.json") {
      const m = JSON.parse(buf.toString("utf8")) as { homepage?: string; extensions?: { "com.openai"?: { interface?: Record<string, unknown> } } };
      m.homepage = inst.appUrl;
      const iface = m.extensions?.["com.openai"]?.interface;
      if (iface) iface.websiteURL = inst.appUrl;
      out.push({ path: file, content: json(m) });
    } else if (file === ".cursor-plugin/plugin.json") {
      const m = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
      m.homepage = inst.appUrl;
      out.push({ path: file, content: json(m) });
    } else if (file === "mcp.json" || file === "README.md") {
      const text = buf.toString("utf8").replaceAll(URL_PLACEHOLDER, inst.appUrl);
      out.push({ path: file, content: file === "README.md" ? `> Pre-configured for ${inst.appName} at ${inst.appUrl}.\n\n${text}` : text });
    } else {
      out.push({ path: file, content: buf });
    }
  }
  return out;
}

type Built = { zip: Buffer; sha256: string };
const zipCache = new Map<string, Built>();

function cachedZip(cacheKey: string, entries: () => ZipEntry[]): Built {
  const sourceKey = `${cacheKey}|${cache?.key ?? ""}`;
  const hit = zipCache.get(sourceKey);
  if (hit) return hit;
  const zip = createZip(entries());
  const built = { zip, sha256: crypto.createHash("sha256").update(zip).digest("hex") };
  if (zipCache.size > 20) zipCache.clear();
  zipCache.set(sourceKey, built);
  return built;
}

/** Plugin root as a zip (Claude Code `archive` source; also usable with `claude --plugin-dir`). */
export function pluginZip(inst: Instance): Built {
  pluginSource();
  return cachedZip(`plugin:${inst.appUrl}:${inst.appName}`, () => instancePluginFiles(inst));
}

/** A local marketplace root for Claude Code, Codex and Cursor: marketplace manifests + plugins/autoseo. */
export function marketplaceBundleZip(inst: Instance): Built {
  pluginSource();
  return cachedZip(`bundle:${inst.appUrl}:${inst.appName}`, () => {
    const description = `${inst.appName} (${inst.appUrl}) — AI visibility & SEO for your agent.`;
    const root = "autoseo-marketplace";
    return [
      {
        path: `${root}/.claude-plugin/marketplace.json`,
        content: json({
          name: MARKETPLACE_NAME,
          owner: { name: inst.appName, url: inst.appUrl },
          description,
          plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, description, category: "SEO" }],
        }),
      },
      {
        path: `${root}/.agents/plugins/marketplace.json`,
        content: json({
          name: MARKETPLACE_NAME,
          interface: { displayName: inst.appName },
          plugins: [
            {
              name: PLUGIN_NAME,
              source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
              category: "Productivity",
            },
          ],
        }),
      },
      {
        path: `${root}/.cursor-plugin/marketplace.json`,
        content: json({
          name: MARKETPLACE_NAME,
          owner: { name: inst.appName },
          metadata: { description },
          plugins: [{ name: PLUGIN_NAME, source: `plugins/${PLUGIN_NAME}`, description }],
        }),
      },
      ...instancePluginFiles(inst).map((f) => ({ path: `${root}/plugins/${PLUGIN_NAME}/${f.path}`, content: f.content })),
    ];
  });
}

/** Skills only (for agents without plugin support): autoseo-skills/<name>/SKILL.md. */
export function skillsZip(): Built {
  const skills = listSkills();
  return cachedZip("skills", () => [
    ...skills.map((s) => ({ path: `autoseo-skills/${s.slug}/SKILL.md`, content: s.body })),
    ...(pluginSource().has("NOTICE.md") ? [{ path: "autoseo-skills/NOTICE.md", content: pluginSource().get("NOTICE.md")! }] : []),
  ]);
}

/** Claude Code URL marketplace (`claude plugin marketplace add <url>`): the plugin is an HTTPS archive. */
export function claudeUrlMarketplace(inst: Instance) {
  const { sha256 } = pluginZip(inst);
  const version = JSON.parse(pluginSource().get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}").version ?? "1.0.0";
  return {
    name: MARKETPLACE_NAME,
    owner: { name: inst.appName, url: inst.appUrl },
    description: `${inst.appName} — AI visibility & SEO for your agent (${inst.appUrl}).`,
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "archive", url: `${inst.appUrl}/api/plugin/${PLUGIN_NAME}.zip`, sha256 },
        description: `AutoSEO MCP server + ${listSkills().length} skills for AI visibility and SEO workflows.`,
        version,
        category: "SEO",
      },
    ],
  };
}

/** Claude Code only accepts archive sources over HTTPS on a non-loopback host. */
export function urlMarketplaceSupported(appUrl: string): boolean {
  try {
    const u = new URL(appUrl);
    return u.protocol === "https:" && !/^(localhost|127\.|\[::1\])/.test(u.hostname) && !u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}
