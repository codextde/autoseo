import Link from "next/link";
import { ArrowLeft, FileJson } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { requireUser } from "@/server/auth/guards";
import { getBranding } from "@/server/branding";
import { getSetting } from "@/server/settings";
import { buildOpenApiDocument } from "@/server/api/openapi";
import { apiUrls } from "@/server/api/urls";
import { toolCatalog } from "@/server/mcp/server";
import { CodeBlock } from "@/features/api-settings/components/code-block";
import { cn } from "@/lib/utils";

export const metadata = { title: "API & MCP docs" };

type Json = Record<string, unknown>;
type Param = { name: string; in: string; required?: boolean; description?: string; schema?: Json };

const METHOD_TONE: Record<string, string> = {
  get: "bg-info/12 text-info ring-info/25",
  post: "bg-success/12 text-success ring-success/25",
  put: "bg-warning/15 text-warning ring-warning/30",
  delete: "bg-destructive/10 text-destructive ring-destructive/25",
};

function typeLabel(schema: Json | undefined): string {
  if (!schema) return "";
  if (Array.isArray(schema.enum)) return (schema.enum as unknown[]).map(String).join(" | ");
  const t = schema.type;
  if (t === "array") return `${typeLabel(schema.items as Json)}[]`;
  const base = Array.isArray(t) ? t.filter((x) => x !== "null").join(" | ") : String(t ?? "any");
  const extra: string[] = [];
  if (schema.default !== undefined) extra.push(`default ${JSON.stringify(schema.default)}`);
  if (schema.minimum !== undefined || schema.maximum !== undefined) extra.push(`${schema.minimum ?? ""}–${schema.maximum ?? ""}`);
  return extra.length ? `${base} (${extra.join(", ")})` : base;
}

function slug(method: string, path: string) {
  return `${method}-${path.replace(/[{}]/g, "").replace(/[^a-z0-9]+/gi, "-")}`.replace(/-+$/, "");
}

/** Human-readable reference for the REST API, OAuth and the MCP server (rendered from the OpenAPI document). */
export default async function ApiDocsPage() {
  await requireUser();
  const [brand, security] = await Promise.all([getBranding(), getSetting("security")]);
  const doc = buildOpenApiDocument(brand.appName, security.apiRateLimitPerMinute) as {
    info: { title: string };
    paths: Record<string, Record<string, Json>>;
  };
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));
  const tags = [...new Set(ops.map((o) => (o.op.tags as string[])[0]!))];
  const groups = toolCatalog();
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/settings/api" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" /> API &amp; MCP
          </Link>
        }
        title={`${brand.appName} API & MCP reference`}
        description="REST API v1, OAuth 2.1 authorization server and MCP tools. All endpoints are also described in the machine-readable OpenAPI 3.1 document."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
              <FileJson className="size-3.5" /> openapi.json
            </a>
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <div className="sticky top-4 space-y-4 text-sm">
            <div className="space-y-1">
              {[
                ["#auth", "Authentication"],
                ["#envelope", "Responses & errors"],
                ["#oauth", "OAuth 2.1"],
                ["#mcp", "MCP server"],
              ].map(([href, label]) => (
                <a key={href} href={href} className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {label}
                </a>
              ))}
            </div>
            {tags.map((tag) => (
              <div key={tag}>
                <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{tag}</div>
                {ops
                  .filter((o) => (o.op.tags as string[])[0] === tag)
                  .map((o) => (
                    <a key={slug(o.method, o.path)} href={`#${slug(o.method, o.path)}`} className="block truncate rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <span className="mr-1.5 font-mono text-[10px] uppercase">{o.method}</span>
                      {String(o.op.summary)}
                    </a>
                  ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          <Panel title="Authentication" className="scroll-mt-4" contentClassName="space-y-3 text-sm">
            <span id="auth" className="block scroll-mt-24" />
            <p>
              Send <code className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code> with an API key (<code className="font-mono text-xs">as_live_…</code>, created in Settings → API &amp; MCP) or an OAuth access token. Scopes: <b>read</b> (all GET endpoints), <b>write</b> (create/update — also bounded by the key owner&apos;s role), <b>spend</b> (anything that can cost money: DataForSEO research, AI generation, tracking runs — marked “incurs cost” below), <b>export</b> (bulk export). API keys and OAuth apps require the owner to hold the “Integrations, API keys” permission. Keys can be limited to selected projects.
            </p>
            <CodeBlock label="Example" code={`curl ${apiUrls.rest}/projects \\\n  -H "Authorization: Bearer $AUTOSEO_API_KEY"`} />
          </Panel>

          <Panel title="Responses & errors" contentClassName="space-y-3 text-sm">
            <span id="envelope" className="block scroll-mt-24" />
            <p>
              Every response uses the envelope <code className="font-mono text-xs">{"{ data, meta, error }"}</code>. Lists return <code className="font-mono text-xs">meta.pagination</code> (<code className="font-mono text-xs">page</code>, <code className="font-mono text-xs">limit</code>, <code className="font-mono text-xs">total</code>, <code className="font-mono text-xs">totalPages</code>); analytics return <code className="font-mono text-xs">meta.period</code>. Errors carry a stable <code className="font-mono text-xs">error.code</code>: unauthorized, invalid_token (401), insufficient_scope, forbidden (403), not_found (404), validation_error (400), rate_limited (429).
            </p>
            <p>
              Rate limit: {security.apiRateLimitPerMinute} requests per minute per credential — see the <code className="font-mono text-xs">X-RateLimit-*</code> headers and <code className="font-mono text-xs">Retry-After</code> on 429.
            </p>
            <CodeBlock code={`{\n  "data": null,\n  "meta": { "requestId": "req_…" },\n  "error": { "code": "insufficient_scope", "message": "This credential lacks the \\"write\\" scope." }\n}`} />
          </Panel>

          <Panel title="OAuth 2.1" contentClassName="space-y-3 text-sm">
            <span id="oauth" className="block scroll-mt-24" />
            <p>
              MCP clients such as Claude and ChatGPT connect with OAuth 2.1: dynamic client registration (RFC 7591), authorization code with PKCE (S256 only), rotating refresh tokens, and token revocation (RFC 7009). Access tokens expire after 1 hour.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["Authorization server metadata", `${apiUrls.base}/.well-known/oauth-authorization-server`],
                ["Protected resource metadata", apiUrls.resourceMetadata("/api/mcp")],
                ["Registration", apiUrls.register],
                ["Authorization", apiUrls.authorize],
                ["Token", apiUrls.token],
                ["Revocation", apiUrls.revoke],
              ].map(([label, url]) => (
                <div key={label} className="min-w-0 rounded-xl border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <code className="block truncate font-mono text-xs">{url}</code>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="MCP server" description={`${toolCount} tools · Streamable HTTP · ${apiUrls.mcp}`} contentClassName="space-y-4">
            <span id="mcp" className="block scroll-mt-24" />
            <CodeBlock label="Claude Code" code={`claude mcp add --transport http autoseo ${apiUrls.mcp}`} />
            <p className="text-sm text-muted-foreground">
              Tools are listed per credential scope (read / write / spend / export). Tools marked <b>spend</b> can incur cost (DataForSEO
              research, AI generation, tracking runs) and need the <b>spend</b> scope plus the matching role permission (e.g. “Run paid SEO
              research”); <b>writes</b> tools need the write scope and the matching role permission. Each tool call counts against the
              per-credential rate limit, also inside JSON-RPC batches.
            </p>
            {groups.map((g) => (
              <div key={g.id} className="space-y-2">
                <h3 id={`mcp-${g.id}`} className="scroll-mt-24 text-sm font-semibold">
                  {g.label} <span className="font-normal text-muted-foreground">· {g.tools.length}</span>
                </h3>
                <div className="divide-y rounded-xl border">
                  {g.tools.map((t) => {
                    const props = ((t.inputSchema as Json).properties ?? {}) as Record<string, Json>;
                    const required = new Set(((t.inputSchema as Json).required as string[] | undefined) ?? []);
                    const paid = t.spend;
                    return (
                      <div key={t.name} className="space-y-1.5 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="min-w-0 font-mono text-sm font-semibold break-all">{t.name}</code>
                          <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
                            {t.scope}
                          </Badge>
                          {t.permission && (
                            <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                              {t.permission}
                            </Badge>
                          )}
                          {paid && (
                            <Badge variant="outline" className="h-5 border-warning/40 px-1.5 text-[10px] text-warning">
                              spend
                            </Badge>
                          )}
                          {!t.annotations.readOnlyHint && !paid && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              writes
                            </Badge>
                          )}
                          {t.annotations.destructiveHint && (
                            <Badge variant="outline" className="h-5 border-destructive/40 px-1.5 text-[10px] text-destructive">
                              destructive
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{t.description}</p>
                        {Object.keys(props).length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {Object.keys(props).map((p, i) => (
                              <span key={p}>
                                {i > 0 && ", "}
                                <code className="font-mono text-foreground">
                                  {p}
                                  {required.has(p) ? "*" : ""}
                                </code>
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Panel>

          {tags.map((tag) => (
            <section key={tag} className="space-y-3">
              <h2 className="pt-2 text-lg font-semibold tracking-tight">{tag}</h2>
              {ops
                .filter((o) => (o.op.tags as string[])[0] === tag)
                .map(({ path, method, op }) => {
                  const params = ((op.parameters as Param[]) ?? []).filter((p) => p.in === "query");
                  const body = (op.requestBody as { content: { "application/json": { schema: Json } } } | undefined)?.content["application/json"].schema;
                  const example = `curl ${method !== "get" ? `-X ${method.toUpperCase()} ` : ""}"${apiUrls.rest}${path.replace("{projectId}", "prj_…").replace(/\{(\w+)\}/g, "<$1>")}" \\\n  -H "Authorization: Bearer $AUTOSEO_API_KEY"${body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '{ … }'` : ""}`;
                  return (
                    <div key={slug(method, path)} id={slug(method, path)} className="scroll-mt-4">
                      <Panel
                        title={
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[11px] uppercase ring-1 ring-inset", METHOD_TONE[method])}>{method}</span>
                            <code className="min-w-0 truncate font-mono text-[13px]">{path}</code>
                          </span>
                        }
                        description={String(op.summary)}
                        actions={
                          <span className="flex gap-1">
                            <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
                              {String(op["x-required-scope"])}
                            </Badge>
                            {op["x-required-permission"] ? (
                              <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                                {String(op["x-required-permission"])}
                              </Badge>
                            ) : null}
                            {op["x-incurs-cost"] ? (
                              <Badge variant="outline" className="h-5 border-warning/40 px-1.5 text-[10px] text-warning">
                                incurs cost
                              </Badge>
                            ) : null}
                          </span>
                        }
                        contentClassName="space-y-3"
                      >
                        {op.description ? <p className="text-sm text-muted-foreground">{String(op.description)}</p> : null}
                        {params.length > 0 && (
                          <div className="overflow-x-auto rounded-xl border">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-muted/60 text-xs text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Query parameter</th>
                                  <th className="px-3 py-2 font-medium">Type</th>
                                  <th className="hidden px-3 py-2 font-medium md:table-cell">Description</th>
                                </tr>
                              </thead>
                              <tbody>
                                {params.map((p) => (
                                  <tr key={p.name} className="border-t align-top">
                                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                                      {p.name}
                                      {p.required && <span className="text-destructive">*</span>}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{typeLabel(p.schema)}</td>
                                    <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">{p.description ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {body && <CodeBlock label="Request body (JSON schema)" code={JSON.stringify(body, null, 2)} />}
                        <CodeBlock label="Example" code={example} />
                      </Panel>
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
