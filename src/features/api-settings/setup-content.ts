/**
 * Isomorphic setup snippets for the API & MCP settings page (MCP clients, agent setup prompt,
 * skills). Everything is generated from the instance URL.
 */

export type ClientAuth = "oauth" | "bearer" | "both";

export type SnippetBlock = { label?: string; language: "bash" | "json" | "toml" | "text"; code: string };

export type McpClientGuide = {
  id: string;
  name: string;
  auth: ClientAuth;
  summary: string;
  steps: string[];
  snippets: SnippetBlock[];
  note?: string;
};

export function mcpClientGuides(mcpUrl: string, keyPlaceholder = "<YOUR_API_KEY>"): McpClientGuide[] {
  const publicNote = /\/\/(localhost|127\.|\[::1\])/.test(mcpUrl)
    ? "This instance runs on localhost. Cloud clients (claude.ai, ChatGPT) can only reach an instance that is publicly available over HTTPS."
    : undefined;
  return [
    {
      id: "claude",
      name: "Claude",
      auth: "oauth",
      summary: "claude.ai, Claude Desktop & mobile — custom connector with OAuth sign-in.",
      steps: [
        "Open Claude → Settings → Connectors → Add custom connector.",
        `Name it “AutoSEO” and paste the MCP server URL.`,
        "Click Connect — you are redirected here to sign in and approve access (choose workspace, projects and permissions).",
        "Enable the connector in a chat via the tools menu and ask e.g. “How visible is my brand in ChatGPT this month?”.",
      ],
      snippets: [{ label: "MCP server URL", language: "text", code: mcpUrl }],
      note: publicNote,
    },
    {
      id: "claude-code",
      name: "Claude Code",
      auth: "both",
      summary: "Terminal agent — OAuth via /mcp, or an API key header.",
      steps: [
        "Add the server with OAuth, then run /mcp inside Claude Code and choose Authenticate.",
        "Or add it with an API key (no browser needed, good for CI and servers).",
        "Verify with: claude mcp list",
      ],
      snippets: [
        { label: "OAuth", language: "bash", code: `claude mcp add --transport http autoseo ${mcpUrl}` },
        { label: "API key", language: "bash", code: `claude mcp add --transport http autoseo ${mcpUrl} \\\n  --header "Authorization: Bearer ${keyPlaceholder}"` },
      ],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      auth: "oauth",
      summary: "ChatGPT developer mode connector with OAuth sign-in.",
      steps: [
        "In ChatGPT open Settings → Apps & Connectors → Advanced settings and enable Developer mode.",
        "Click Create (new connector), name it “AutoSEO” and paste the MCP server URL.",
        "Choose Authentication: OAuth and create the connector — you are redirected here to approve access.",
        "In a chat, pick Developer mode and enable the AutoSEO connector.",
      ],
      snippets: [{ label: "MCP server URL", language: "text", code: mcpUrl }],
      note: publicNote,
    },
    {
      id: "cursor",
      name: "Cursor",
      auth: "bearer",
      summary: "Add to ~/.cursor/mcp.json (global) or .cursor/mcp.json (project).",
      steps: [
        "Create an API key below — read is enough for analysis; add write for changes and “Spend credits” for paid research (DataForSEO, AI generation).",
        "Add the server to your mcp.json and reload Cursor (Settings → MCP).",
      ],
      snippets: [
        {
          label: "mcp.json",
          language: "json",
          code: JSON.stringify({ mcpServers: { autoseo: { url: mcpUrl, headers: { Authorization: `Bearer ${keyPlaceholder}` } } } }, null, 2),
        },
      ],
    },
    {
      id: "vscode",
      name: "VS Code",
      auth: "bearer",
      summary: "GitHub Copilot agent mode — .vscode/mcp.json with a secure key prompt.",
      steps: [
        "Create an API key below.",
        "Add .vscode/mcp.json to your workspace (or run “MCP: Add Server” → HTTP).",
        "Start the server from the MCP view; VS Code asks for the key once and stores it securely.",
      ],
      snippets: [
        {
          label: ".vscode/mcp.json",
          language: "json",
          code: JSON.stringify(
            {
              servers: { autoseo: { type: "http", url: mcpUrl, headers: { Authorization: "Bearer ${input:autoseo-api-key}" } } },
              inputs: [{ type: "promptString", id: "autoseo-api-key", description: "AutoSEO API key", password: true }],
            },
            null,
            2,
          ),
        },
      ],
    },
    {
      id: "codex",
      name: "Codex CLI",
      auth: "bearer",
      summary: "OpenAI Codex — ~/.codex/config.toml with the key from an env var.",
      steps: ["Create an API key below and export it as AUTOSEO_API_KEY.", "Add the server to ~/.codex/config.toml and restart Codex."],
      snippets: [
        { label: "Shell", language: "bash", code: `export AUTOSEO_API_KEY="${keyPlaceholder}"` },
        { label: "~/.codex/config.toml", language: "toml", code: `[mcp_servers.autoseo]\nurl = "${mcpUrl}"\nbearer_token_env_var = "AUTOSEO_API_KEY"` },
      ],
    },
  ];
}

export type PluginUrls = {
  origin: string;
  mcp: string;
  /** Claude Code URL marketplace (only usable when the instance is served over public HTTPS). */
  marketplace: string;
  marketplaceSupported: boolean;
  pluginZip: string;
  bundleZip: string;
  skillsZip: string;
};

export function pluginUrls(origin: string, marketplaceSupported: boolean): PluginUrls {
  return {
    origin,
    mcp: `${origin}/api/mcp`,
    marketplace: `${origin}/api/plugin/marketplace.json`,
    marketplaceSupported,
    pluginZip: `${origin}/api/plugin/autoseo.zip`,
    bundleZip: `${origin}/api/plugin/autoseo-marketplace.zip`,
    skillsZip: `${origin}/api/plugin/skills.zip`,
  };
}

export type PluginGuide = { id: string; name: string; steps: string[]; snippets: SnippetBlock[]; note?: string };

/** How to install the AutoSEO plugin (MCP server + skills) per agent, for this instance. */
export function pluginInstallGuides(u: PluginUrls): PluginGuide[] {
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      steps: u.marketplaceSupported
        ? ["Add this instance as a plugin marketplace and install the plugin.", "Start a new Claude Code session so the plugin loads, then run /mcp and authenticate AutoSEO (OAuth)."]
        : [
            "Download the marketplace bundle and unzip it.",
            "Add the unzipped folder as a local marketplace and install the plugin.",
            "Run /mcp in Claude Code and authenticate AutoSEO (OAuth).",
          ],
      snippets: u.marketplaceSupported
        ? [{ label: "Terminal", language: "bash", code: `claude plugin marketplace add ${u.marketplace}\nclaude plugin install autoseo@autoseo` }]
        : [{ label: "Terminal", language: "bash", code: `curl -fsSLo autoseo-marketplace.zip ${u.bundleZip}\nunzip -o autoseo-marketplace.zip\nclaude plugin marketplace add ./autoseo-marketplace\nclaude plugin install autoseo@autoseo` }],
      note: u.marketplaceSupported
        ? "Skills are namespaced: /autoseo:seo-audit. Updates: claude plugin marketplace update autoseo."
        : "The one-command URL marketplace needs this instance on public HTTPS (Claude Code downloads plugin archives only over HTTPS from non-local hosts), so a local bundle is used instead.",
    },
    {
      id: "codex",
      name: "Codex",
      steps: [
        "Download the marketplace bundle and unzip it.",
        "Add it as a local plugin marketplace, then install AutoSEO from /plugins in Codex.",
        "Sign in with OAuth when Codex connects, or set an API key if your Codex version asks for one.",
      ],
      snippets: [{ label: "Terminal", language: "bash", code: `curl -fsSLo autoseo-marketplace.zip ${u.bundleZip}\nunzip -o autoseo-marketplace.zip\ncodex plugin marketplace add ./autoseo-marketplace` }],
    },
    {
      id: "cursor",
      name: "Cursor",
      steps: [
        "Cursor installs plugins from its marketplace or from a team marketplace backed by a Git repository.",
        "Push the unzipped bundle to a repository your team can read and import it under Cursor Settings → Plugins, or add just the MCP server with the JSON from the MCP tab.",
      ],
      snippets: [{ label: "Bundle", language: "text", code: u.bundleZip }],
    },
    {
      id: "skills-only",
      name: "Other agents (skills only)",
      steps: [
        "Add the MCP server (see the MCP tab), then download the skills.",
        "Copy each skill folder into the agent's skills directory, e.g. ~/.claude/skills/ or .agents/skills/.",
      ],
      snippets: [{ label: "Terminal", language: "bash", code: `curl -fsSLo autoseo-skills.zip ${u.skillsZip}\nunzip -o autoseo-skills.zip` }],
    },
  ];
}

/** Copy-paste prompt that lets any coding agent install AutoSEO itself (open-seo "setup prompt"). */
export function agentSetupPrompt(u: PluginUrls, appName = "AutoSEO"): string {
  return `Set up ${appName} in this agent. Do what you can; guide me through anything that needs my input.

${appName} is a self-hosted AI visibility (GEO) and SEO platform at ${u.origin}. Its MCP server is ${u.mcp} (Streamable HTTP, OAuth 2.1 with dynamic client registration).

1. Check this agent
- Identify this agent and its version. Ask only if you cannot tell.
- Check for an existing ${appName} connection. Preserve other integrations and avoid duplicates.

2. Install the plugin first (MCP server + 17 skills, namespaced and updatable)
- Claude Code: ${u.marketplaceSupported ? `claude plugin marketplace add ${u.marketplace} then claude plugin install autoseo@autoseo` : `download ${u.bundleZip}, unzip it, then claude plugin marketplace add ./autoseo-marketplace and claude plugin install autoseo@autoseo`}
- Codex: download ${u.bundleZip}, unzip it, run codex plugin marketplace add ./autoseo-marketplace, then install AutoSEO from /plugins.
- Other agents: check their current documentation for plugin support before running commands.

3. Fall back to MCP + skills if plugins are unsupported
- Add ${u.mcp} as a remote HTTP MCP server named "autoseo" using this agent's documented method.
- Download ${u.skillsZip} and install the skills for this agent only. If skills are unsupported, use the MCP tools alone.

4. Sign in
- Prefer OAuth: start the login and let me approve it in my browser (a workspace owner or admin must approve).
- No OAuth? Send me to ${u.origin}/settings/api to create an API key (add "Spend credits" if I want paid research), and have me put it in the client's secret settings or environment — never in chat or a repository.

5. Reload and verify
- Reload using this agent's native flow; restart only if needed.
- Once the tools load, call whoami and list_projects (free). Check that the skills are discoverable too. Never claim success before those reads work.
- Do not create projects or run paid research during setup.

6. Finish with a short handoff (at most 140 words)
**Status** — what succeeded or what blocked setup.
**Next** — the reload step if needed, then suggest: seo-audit (recommended), ai-visibility-report, seo-project-setup, keyword-research — using this agent's way to invoke skills.`;
}

/** Copy-paste prompt that updates installed AutoSEO skills / plugin (open-seo "Update your skills"). */
export function agentUpdatePrompt(u: PluginUrls, appName = "AutoSEO"): string {
  return `Update my installed ${appName} plugin and skills from ${u.origin}.

Identify this agent and how ${appName} was installed (plugin marketplace, local bundle, or copied skill folders). Use the matching installer, checking the installed client's help before running commands. Update only ${appName} in its existing scope. Preserve my MCP endpoint (${u.mcp}), sign-in, and personal skill edits; ask before replacing conflicting edits. Avoid duplicate skills.

- Claude Code plugin: ${u.marketplaceSupported ? "claude plugin marketplace update autoseo, then update the autoseo plugin." : `download ${u.bundleZip} again, replace the local autoseo-marketplace folder, then run claude plugin marketplace update autoseo and update the autoseo plugin.`}
- Codex plugin: download ${u.bundleZip}, replace the local autoseo-marketplace folder, and update AutoSEO from /plugins.
- Copied skills: download ${u.skillsZip} and replace the installed AutoSEO skill folders (SKILL.md files), keeping my own edits where I ask.

Reload skills if supported; if I need to reload or start a new session, tell me what to do. Verify the updated skill files and that this agent can discover them — an active MCP connection alone does not prove the skills updated. Briefly tell me what changed and anything left to do. Do not run SEO research during the update.`;
}
