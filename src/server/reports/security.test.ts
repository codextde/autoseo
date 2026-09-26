import { describe, expect, it } from "vitest";
import { emptyBundle } from "@/features/reports/lib/bundle";
import { resolveDeckData, resolveToken } from "@/features/reports/lib/catalog";
import { buildLibraryDeck } from "@/features/reports/lib/templates/library";
import { PITCH_THEME } from "@/features/reports/lib/theme";
import type { ProjectContext } from "@/server/auth/context";
import { canManageWorkspaceReports } from "./access";
import { sanitizeReportHtml } from "./document";
import { fetchPublicImage, readBytesCapped } from "./safe-fetch";
import { SHARE_PASSWORD_MIN, hashSharePassword, verifySharePassword } from "./share";

describe("SSRF-safe image fetch (M4)", () => {
  it("refuses loopback, link-local metadata and private targets", async () => {
    expect(await fetchPublicImage("http://127.0.0.1:3000/brand/icon.svg")).toBeNull();
    expect(await fetchPublicImage("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await fetchPublicImage("http://[::1]/x.png")).toBeNull();
    expect(await fetchPublicImage("http://10.0.0.1/x.png")).toBeNull();
    expect(await fetchPublicImage("http://localhost/x.png")).toBeNull();
    expect(await fetchPublicImage("file:///etc/passwd")).toBeNull();
  });
  it("streams with a hard byte cap", async () => {
    const big = new Response(new Uint8Array(2048));
    expect(await readBytesCapped(big, 1024)).toBeNull();
    const small = new Response(new Uint8Array(512));
    expect((await readBytesCapped(small, 1024))?.length).toBe(512);
  });
});

describe("share passwords (M6)", () => {
  it("hashes asynchronously and verifies", async () => {
    const hash = await hashSharePassword("correct horse");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifySharePassword("correct horse", hash)).toBe(true);
    expect(await verifySharePassword("wrong password", hash)).toBe(false);
    expect(await verifySharePassword("x".repeat(5000), hash)).toBe(false);
    expect(SHARE_PASSWORD_MIN).toBe(8);
  });
});

describe("workspace-scoped report resources (L4)", () => {
  const ctx = (perms: string[], allProjects: boolean) =>
    ({ permissions: new Set(perms), membership: { allProjects } }) as unknown as ProjectContext;
  it("requires settings.manage or all-projects access on top of reports.manage", () => {
    expect(canManageWorkspaceReports(ctx(["reports.manage"], false))).toBe(false);
    expect(canManageWorkspaceReports(ctx(["reports.manage", "settings.manage"], false))).toBe(true);
    expect(canManageWorkspaceReports(ctx(["reports.manage"], true))).toBe(true);
    expect(canManageWorkspaceReports(ctx(["settings.manage"], true))).toBe(false);
  });
});

describe("served AI HTML (L9)", () => {
  it("strips navigation, forms, scripts and handlers but keeps content", () => {
    const out = sanitizeReportHtml(
      `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><style>p{color:red}</style></head>` +
        `<body><form action="https://evil.example"><input name=pw><button formaction="https://evil.example">Go</button></form>` +
        `<a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a><img src="data:text/html,<script>1</script>" onerror="alert(1)">` +
        `<img src="data:image/png;base64,AAAA"><iframe src="https://evil.example"></iframe><script>alert(1)</script><p onclick="x()">Keep me</p></body></html>`,
    );
    expect(out).not.toMatch(/http-equiv|<base|<form|formaction|javascript:|onerror|onclick|<iframe|<script|data:text\/html/i);
    expect(out).toContain("Keep me");
    expect(out).toContain("data:image/png;base64,AAAA");
    expect(out).toContain("p{color:red}");
  });
});

describe("public share data (L11)", () => {
  it("only ships values the deck references", () => {
    const bundle = emptyBundle({ id: "prj_x", name: "Acme", domain: "acme.com" });
    bundle.ai.fanouts = [{ query: "secret internal query", count: 3 }];
    bundle.ai.prompts = [
      { id: "p1", text: "unreferenced prompt text", topic: null, funnelStage: null, answers: 1, visibility: 0, prevVisibility: null, mentionRate: 0, citationRate: 0, category: "none" },
    ];
    const deck = buildLibraryDeck("one_pager", PITCH_THEME);
    const resolved = resolveDeckData(deck, { bundle });
    const json = JSON.stringify(resolved);
    expect(json).not.toContain("secret internal query");
    expect(json).not.toContain("unreferenced prompt text");
    expect(Object.keys(resolved.tokens)).toContain("brand.name");
    expect(resolveToken("brand.name", { bundle: null, resolved }).text).toBe("Acme");
    // tokens that are not on the slides resolve to a dash, not to real data
    expect(resolveToken("ai.top_prompt", { bundle: null, resolved }).text).toBe("—");
  });
});
