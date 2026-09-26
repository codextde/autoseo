import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MCP_TOOLS } from "@/server/mcp/tools";
import { contextPatchOp } from "./project-context";
import { claudeUrlMarketplace, instancePluginFiles, listSkills, marketplaceBundleZip, pluginZip, skillsZip, urlMarketplaceSupported } from "./plugin";

const inst = { appUrl: "https://seo.example.com", appName: "AutoSEO" };
const toolNames = new Set(MCP_TOOLS.map((t) => t.name));
const contextOps = new Set<string>(contextPatchOp.options.map((o) => o.shape.op.value));
const TOOL_LIKE = /^(get|list|run|add|save|search|find|create|update|remove|tag|generate|share|delete|inspect|optimize|compare|stop|estimate|comment)_[a-z0-9_]+$|^whoami$/;

describe("agent skills catalog", () => {
  const skills = listSkills();

  it("ships the 11 open-seo product skills and the AI-visibility skills", () => {
    const slugs = skills.map((s) => s.slug);
    for (const s of [
      "seo-audit", "keyword-research", "keyword-clustering", "competitive-landscape", "competitor-analysis", "link-prospecting",
      "local-seo", "seo-coach", "seo-project-setup", "seo-report", "simple-issue-description",
      "ai-visibility-report", "competitor-gap", "content-opportunities", "sentiment-review", "source-outreach", "ai-project-setup",
    ]) expect(slugs).toContain(s);
  });

  it("has valid frontmatter and only references real MCP tools or context ops", () => {
    for (const s of skills) {
      expect(s.name, s.slug).toBe(s.slug);
      expect(s.description.length, s.slug).toBeGreaterThan(30);
      const refs = [...s.body.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]!).filter((n) => TOOL_LIKE.test(n));
      const unknown = refs.filter((n) => !toolNames.has(n) && !contextOps.has(n));
      expect(unknown, `${s.slug} references unknown tools`).toEqual([]);
      expect(s.body).not.toMatch(/openseo\.so|OpenSEO MCP/);
    }
  });
});

describe("instance plugin build", () => {
  it("bakes the instance MCP URL into every manifest and drops the userConfig prompt", () => {
    const files = new Map(instancePluginFiles(inst).map((f) => [f.path, f.content.toString()]));
    const claude = JSON.parse(files.get(".claude-plugin/plugin.json")!);
    expect(claude.userConfig).toBeUndefined();
    expect(claude.mcpServers.autoseo).toEqual({ type: "http", url: "https://seo.example.com/api/mcp" });
    expect(JSON.parse(files.get("mcp.json")!).mcpServers.autoseo.url).toBe("https://seo.example.com/api/mcp");
    expect(files.has(".codex-plugin/plugin.json") && files.has(".cursor-plugin/plugin.json") && files.has("plugin.json")).toBe(true);
    expect([...files.keys()].filter((f) => f.endsWith("/SKILL.md")).length).toBe(listSkills().length);
  });

  it("keeps the repo manifest instance-agnostic (user_config URL)", () => {
    const repo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "plugins/autoseo/.claude-plugin/plugin.json"), "utf8"));
    expect(repo.mcpServers.autoseo.url).toBe("${user_config.autoseo_url}/api/mcp");
    expect(repo.userConfig.autoseo_url.required).toBe(true);
  });

  it("produces deterministic archives whose sha256 is pinned in the URL marketplace", () => {
    const a = pluginZip(inst);
    expect(crypto.createHash("sha256").update(a.zip).digest("hex")).toBe(a.sha256);
    expect(pluginZip({ ...inst }).sha256).toBe(a.sha256);
    const m = claudeUrlMarketplace(inst);
    expect(m.plugins[0]!.source).toEqual({ source: "archive", url: "https://seo.example.com/api/plugin/autoseo.zip", sha256: a.sha256 });
    expect(marketplaceBundleZip(inst).zip.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
    expect(skillsZip().zip.length).toBeGreaterThan(1000);
  });

  it("only offers the URL marketplace on public HTTPS", () => {
    expect(urlMarketplaceSupported("https://seo.example.com")).toBe(true);
    expect(urlMarketplaceSupported("http://seo.example.com")).toBe(false);
    expect(urlMarketplaceSupported("https://localhost:3000")).toBe(false);
  });
});
