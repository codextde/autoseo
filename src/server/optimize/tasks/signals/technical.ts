import "server-only";
import { sql } from "drizzle-orm";
import * as cheerio from "cheerio";
import { AI_BOTS } from "@/lib/engines";
import { classifyAccess, parseRobotsTxt } from "@/server/audit-crawler/robots";
import { safeFetch } from "@/server/optimize/net";
import { registerTaskSignal } from "./registry";
import { clamp10, rows } from "./helpers";
import type { SignalContext, TaskFinding } from "./types";

/** AI search / user-agent crawlers that must reach your pages to cite them (training bots are a policy choice). */
const CITATION_BOTS = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Googlebot", "Bingbot", "Applebot", "DuckAssistBot"];
const TRAINING_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "meta-externalagent", "CCBot"];

type AuditIssuePlay = { title: (n: number) => string; impact: number; effort: number; category?: "technical" | "content"; why: string; steps: string[] };

const AUDIT_PLAYS: Record<string, AuditIssuePlay> = {
  "blocked-page": {
    title: (n) => `Unblock ${n} page${n === 1 ? "" : "s"} that refuse crawlers`,
    impact: 9,
    effort: 3,
    why: "Pages answer crawlers with 401/403 or a bot challenge. AI crawlers give up on those pages, so they can never be cited.",
    steps: ["Check WAF / bot-protection rules (Cloudflare, Akamai…) for these URLs.", "Allow verified AI search crawlers and Googlebot/Bingbot.", "Re-run the site audit to confirm 200 responses."],
  },
  "server-error": {
    title: (n) => `Fix server errors on ${n} page${n === 1 ? "" : "s"}`,
    impact: 8,
    effort: 4,
    why: "5xx responses stop crawlers from reading the page and make engines drop it from their index.",
    steps: ["Check server logs for the failing URLs.", "Fix the underlying errors or return proper 404/410 for removed pages.", "Re-run the site audit."],
  },
  "broken-internal-link": {
    title: (n) => `Fix ${n} broken internal link${n === 1 ? "" : "s"}`,
    impact: 6,
    effort: 3,
    why: "Broken links waste crawl budget and hide pages from crawlers that discover content by following links.",
    steps: ["Update or remove the links pointing to 4xx/5xx URLs.", "Add redirects for moved pages.", "Re-run the site audit."],
  },
  "missing-title": {
    title: (n) => `Add title tags to ${n} page${n === 1 ? "" : "s"}`,
    impact: 6,
    effort: 2,
    why: "Engines use the title to understand what a page answers; pages without one are rarely cited.",
    steps: ["Write a unique, descriptive 30–60 character title per page.", "Include the main topic/question.", "Re-run the site audit."],
  },
  "broken-page": {
    title: (n) => `Resolve ${n} page${n === 1 ? "" : "s"} returning 4xx`,
    impact: 5,
    effort: 3,
    why: "Linked pages returning errors break the crawl path and signal poor maintenance.",
    steps: ["Restore the pages or redirect them to the best replacement.", "Remove internal links to removed pages.", "Re-run the site audit."],
  },
  "thin-content": {
    title: (n) => `Expand ${n} thin page${n === 1 ? "" : "s"}`,
    impact: 5,
    effort: 6,
    category: "content",
    why: "Pages under ~150 words rarely contain an extractable answer, so engines skip them.",
    steps: ["Decide per page: expand, merge into a stronger page, or noindex.", "Add a direct answer, facts and FAQs to the pages you keep.", "Re-run the site audit."],
  },
  "duplicate-content": {
    title: (n) => `Consolidate ${n} duplicate page${n === 1 ? "" : "s"}`,
    impact: 4,
    effort: 4,
    why: "Duplicates split signals between URLs; engines may cite the wrong version or none.",
    steps: ["Pick the canonical version of each duplicate group.", "Redirect or canonicalize the others.", "Re-run the site audit."],
  },
  "missing-meta-description": {
    title: (n) => `Write meta descriptions for ${n} page${n === 1 ? "" : "s"}`,
    impact: 4,
    effort: 3,
    why: "Meta descriptions summarise the page for search and AI retrieval snippets.",
    steps: ["Write a 120–160 character description that answers the page's main question.", "Re-run the site audit."],
  },
  "missing-h1": {
    title: (n) => `Add an H1 to ${n} page${n === 1 ? "" : "s"}`,
    impact: 3,
    effort: 2,
    why: "A clear H1 tells crawlers what the page is about.",
    steps: ["Add one descriptive H1 per page.", "Re-run the site audit."],
  },
  "redirect-chain": {
    title: (n) => `Shorten ${n} redirect chain${n === 1 ? "" : "s"}`,
    impact: 4,
    effort: 3,
    why: "AI crawlers follow few redirects; long chains lose them before the content.",
    steps: ["Point links and redirects straight to the final URL.", "Re-run the site audit."],
  },
  "redirect-loop": {
    title: (n) => `Fix ${n} redirect loop${n === 1 ? "" : "s"}`,
    impact: 6,
    effort: 3,
    why: "Redirect loops make pages unreachable for every crawler.",
    steps: ["Fix the redirect rules causing the loop.", "Re-run the site audit."],
  },
  "canonical-conflict": {
    title: (n) => `Resolve conflicting canonicals on ${n} page${n === 1 ? "" : "s"}`,
    impact: 4,
    effort: 3,
    why: "Conflicting canonical signals make engines guess which URL to index and cite.",
    steps: ["Align the HTML and HTTP header canonicals.", "Re-run the site audit."],
  },
  "slow-response": {
    title: (n) => `Speed up ${n} slow page${n === 1 ? "" : "s"}`,
    impact: 5,
    effort: 6,
    why: "AI user-agents fetch pages live while answering and time out quickly; slow pages get skipped.",
    steps: ["Cache HTML at the edge for these URLs.", "Reduce server processing time below 800 ms.", "Re-run the site audit."],
  },
};

type AuditRow = { id: string; completed_at: string | null; pages_crawled: number };
type IssueRow = { issue_type: string; severity: string; pages: number; urls: string[] };
type BotErrRow = { path: string; bots: string[]; status: number; n: number };

async function latestAudit(ctx: SignalContext): Promise<AuditRow | null> {
  if (!(await ctx.tableExists("site_audits"))) return null;
  try {
    const [row] = await rows<AuditRow>(sql`
      select id, completed_at, pages_crawled from site_audits
      where project_id = ${ctx.projectId} and status = 'completed' order by completed_at desc nulls last limit 1`);
    return row ?? null;
  } catch {
    return null;
  }
}

/** Technical: crawl access for AI crawlers (live robots.txt / homepage checks), site audit issues, bot-traffic errors. */
registerTaskSignal({
  key: "technical_issue",
  label: "Technical & crawl access",
  category: "technical",
  description: "Crawl access, rendering, structured data and site health issues that block AI engines.",
  datasets: ["Live crawl", "Site audit", "Crawlability check", "Bot traffic"],
  async collect(ctx) {
    const pid = ctx.projectId;
    const findings: TaskFinding[] = [];
    const evaluated = new Set<string>();
    const origin = `https://${ctx.project.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

    /* 1) robots.txt — live */
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 12_000, maxBytes: 512 * 1024 });
      evaluated.add(ctx.fingerprint(["robots_search"]));
      evaluated.add(ctx.fingerprint(["robots_training"]));
      if (res.status === 200) {
        const robots = parseRobotsTxt(res.text());
        const blocked = CITATION_BOTS.map((t) => ({ t, ...classifyAccess(robots, t) })).filter((b) => b.status === "blocked");
        const training = TRAINING_BOTS.map((t) => ({ t, ...classifyAccess(robots, t) })).filter((b) => b.status === "blocked");
        if (blocked.length) {
          findings.push({
            subject: ["robots_search"],
            category: "technical",
            title: `Unblock ${blocked.length} AI search crawler${blocked.length === 1 ? "" : "s"} in robots.txt`,
            summary: `robots.txt blocks ${blocked.map((b) => b.t).join(", ")} — engines using them can't read or cite your pages.`,
            description: `Your robots.txt at ${origin}/robots.txt disallows the site root for **${blocked.map((b) => b.t).join(", ")}**. These user-agents fetch pages when AI assistants search the web or answer a user, so blocking them removes you from those answers.`,
            steps: [
              "Open robots.txt and find the Disallow rules for the listed user-agents (or a wildcard group that applies to them).",
              `Add explicit groups, e.g. "User-agent: OAI-SearchBot / Allow: /" for every AI search crawler you want to be cited by.`,
              "Keep blocks for training-only crawlers (GPTBot, CCBot, Google-Extended) if that's your policy — they don't affect live answers.",
              "Deploy and re-run the analysis (this task resolves automatically).",
            ],
            acceptanceCriteria: ["All AI search / user-agent crawlers can fetch the site root.", "robots.txt still blocks what you intentionally block."],
            impact: 9,
            effort: 2,
            evidence: [
              {
                kind: "issues",
                label: "Blocked crawlers",
                items: blocked.map((b) => ({
                  label: b.t,
                  value: "Blocked",
                  detail: `${AI_BOTS.find((x) => x.token === b.t)?.company ?? ""} · ${b.rootVerdict.rule ? `${b.rootVerdict.rule.type === "allow" ? "Allow" : "Disallow"}: ${b.rootVerdict.rule.path}` : "root disallowed"}`,
                  good: false,
                })),
              },
            ],
            datasets: ["Live crawl (robots.txt)"],
            targetUrls: [`${origin}/robots.txt`],
            data: { blocked: blocked.map((b) => b.t) },
          });
        }
        if (training.length >= 3 && !blocked.length) {
          findings.push({
            subject: ["robots_training"],
            category: "technical",
            title: "Review your AI training-crawler policy",
            summary: `robots.txt blocks ${training.map((b) => b.t).join(", ")} — fine for live answers, but it limits how models learn about your brand.`,
            description:
              "Training crawlers don't fetch pages for live answers, but they shape what models know about your brand long-term. Blocking them is a legitimate policy — make sure it's a deliberate one.",
            steps: ["Decide with legal/marketing whether you want models trained on your public content.", "Adjust robots.txt accordingly (per user-agent).", "Dismiss this task if blocking is intentional."],
            acceptanceCriteria: ["The training-crawler policy is documented and reflected in robots.txt."],
            impact: 3,
            effort: 1,
            evidence: [{ kind: "issues", label: "Blocked training crawlers", items: training.map((b) => ({ label: b.t, value: "Blocked", good: false })) }],
            datasets: ["Live crawl (robots.txt)"],
            targetUrls: [`${origin}/robots.txt`],
            autoResolvable: true,
            data: { training: training.map((b) => b.t) },
          });
        }
      }
    } catch {
      // domain unreachable — leave robots tasks untouched this run
    }

    /* 2) Homepage structured data + llms.txt — live */
    try {
      const home = await safeFetch(origin, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024, headers: { accept: "text/html" } });
      if (home.ok && (home.headers.get("content-type") ?? "").includes("html")) {
        evaluated.add(ctx.fingerprint(["org_schema"]));
        const $ = cheerio.load(home.text());
        const types = new Set<string>();
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const visit = (n: unknown) => {
              if (Array.isArray(n)) return n.forEach(visit);
              if (!n || typeof n !== "object") return;
              const o = n as Record<string, unknown>;
              const t = o["@type"];
              for (const x of Array.isArray(t) ? t : t ? [t] : []) types.add(String(x));
              if (o["@graph"]) visit(o["@graph"]);
            };
            visit(JSON.parse($(el).contents().text()));
          } catch {
            // invalid JSON-LD block
          }
        });
        const hasOrg = [...types].some((t) => ["Organization", "Corporation", "LocalBusiness", "OnlineStore", "Store", "Brand"].includes(t));
        if (!hasOrg) {
          findings.push({
            subject: ["org_schema"],
            category: "technical",
            title: "Add Organization structured data to your homepage",
            summary: types.size ? `The homepage has JSON-LD (${[...types].slice(0, 3).join(", ")}) but no Organization entity.` : "The homepage has no JSON-LD structured data.",
            description:
              "An Organization node (name, logo, url, sameAs links to your social/Wikipedia/Crunchbase profiles, contact) helps engines resolve your brand as a known entity and connect third-party mentions to you.",
            steps: [
              "Add a JSON-LD <script> with @type Organization (name, url, logo, sameAs, contactPoint) to the homepage.",
              "List every official profile in sameAs.",
              "Validate with the Rich Results Test / Schema Markup Validator.",
            ],
            acceptanceCriteria: ["The homepage exposes a valid Organization JSON-LD node."],
            impact: 6,
            effort: 2,
            evidence: [{ kind: "issues", label: "Structured data found on the homepage", items: types.size ? [...types].map((t) => ({ label: t })) : [{ label: "None", good: false }] }],
            datasets: ["Live crawl (homepage)"],
            targetUrls: [origin],
            data: { types: [...types] },
          });
        }
      }
      const llms = await safeFetch(`${origin}/llms.txt`, { timeoutMs: 8_000, maxBytes: 256 * 1024 }).catch(() => null);
      if (llms) {
        evaluated.add(ctx.fingerprint(["llms_txt"]));
        const ok = llms.status === 200 && !(llms.headers.get("content-type") ?? "").includes("html") && llms.text().trim().length > 20;
        if (!ok) {
          findings.push({
            subject: ["llms_txt"],
            category: "technical",
            title: "Publish an llms.txt file",
            summary: "No llms.txt found — a low-effort way to point AI agents to your most important pages.",
            description:
              "llms.txt is an emerging convention: a markdown file at the site root that lists your key pages with one-line descriptions so AI agents can find the right content quickly. It's not a ranking factor, but it's cheap.",
            steps: ["Generate a draft on the Crawlability page.", "Review the listed pages and descriptions.", `Publish it at ${origin}/llms.txt.`],
            acceptanceCriteria: [`${origin}/llms.txt returns a markdown file listing your key pages.`],
            impact: 3,
            effort: 1,
            evidence: [{ kind: "note", label: "llms.txt", value: `HTTP ${llms.status}` }],
            datasets: ["Live crawl"],
            targetUrls: [`/p/${pid}/crawlability`],
            data: { status: llms.status },
          });
        }
      }
    } catch {
      // homepage unreachable
    }

    /* 3) Latest completed site audit */
    const audit = await latestAudit(ctx);
    if (audit) {
      for (const type of Object.keys(AUDIT_PLAYS)) evaluated.add(ctx.fingerprint(["audit", type]));
      evaluated.add(ctx.fingerprint(["audit", "structured-data"]));
      try {
        const issues = await rows<IssueRow>(sql`
          select issue_type, max(severity) as severity, count(distinct page_url)::int as pages, (array_agg(distinct page_url))[1:8] as urls
          from site_audit_issues where audit_id = ${audit.id} group by issue_type`);
        for (const i of issues) {
          const play = AUDIT_PLAYS[i.issue_type];
          const pages = Number(i.pages);
          if (!play || pages === 0) continue;
          const scale = pages >= 50 ? 2 : pages >= 10 ? 1 : 0;
          findings.push({
            subject: ["audit", i.issue_type],
            category: play.category ?? "technical",
            title: play.title(pages),
            summary: `Site audit found “${i.issue_type.replace(/-/g, " ")}” on ${pages} page${pages === 1 ? "" : "s"}.`,
            description: play.why,
            steps: play.steps,
            acceptanceCriteria: [`The next site audit reports 0 pages with “${i.issue_type.replace(/-/g, " ")}”.`],
            impact: clamp10(play.impact + scale),
            effort: clamp10(play.effort + (pages >= 50 ? 1 : 0)),
            evidence: [
              {
                kind: "pages",
                label: "Affected pages",
                value: `${pages} page${pages === 1 ? "" : "s"}`,
                items: (i.urls ?? []).map((u) => ({ label: u.replace(/^https?:\/\/(www\.)?/, ""), href: u })),
              },
            ],
            datasets: ["Site audit"],
            targetUrls: [...(i.urls ?? []).slice(0, 8), `/p/${pid}/seo/audit`],
            data: { issue: i.issue_type, pages, severity: i.severity },
          });
        }
        const [sd] = await rows<{ missing: number; total: number; urls: string[] }>(sql`
          select count(*) filter (where not has_structured_data)::int as missing, count(*)::int as total,
            (array_agg(url) filter (where not has_structured_data))[1:8] as urls
          from site_audit_pages where audit_id = ${audit.id} and is_indexable and status_code between 200 and 299`);
        const missing = Number(sd?.missing ?? 0);
        const total = Number(sd?.total ?? 0);
        if (total >= 5 && missing / total >= 0.3) {
          findings.push({
            subject: ["audit", "structured-data"],
            category: "technical",
            title: `Add structured data to ${missing} indexable page${missing === 1 ? "" : "s"}`,
            summary: `${Math.round((missing / total) * 100)}% of crawled indexable pages have no JSON-LD.`,
            description: "Structured data (Article, Product, FAQPage, HowTo, Organization) makes facts on your pages machine-readable, which helps engines extract and attribute them.",
            steps: ["Add a JSON-LD template per page type (articles, products, category pages).", "Include FAQPage markup where the page has FAQs.", "Validate and re-run the site audit."],
            acceptanceCriteria: ["At least 80% of indexable pages expose valid JSON-LD."],
            impact: 6,
            effort: 5,
            evidence: [{ kind: "pages", label: "Pages without JSON-LD", value: `${missing} / ${total}`, items: (sd?.urls ?? []).map((u) => ({ label: u.replace(/^https?:\/\/(www\.)?/, ""), href: u })) }],
            datasets: ["Site audit"],
            targetUrls: [`/p/${pid}/seo/audit`],
            data: { missing, total },
          });
        }
      } catch {
        // audit tables changed shape — skip
      }
    }

    /* 4) Crawlability score (AI crawler access audit) */
    if (await ctx.tableExists("crawlability_checks")) {
      try {
        const [c] = await rows<{ score: number | null; scores: Record<string, number> | null; completed_at: string | null }>(sql`
          select score, scores, completed_at from crawlability_checks
          where project_id = ${pid} and status = 'completed' order by completed_at desc nulls last limit 1`);
        if (c) {
          evaluated.add(ctx.fingerprint(["crawlability_score"]));
          const score = c.score == null ? null : Number(c.score);
          if (score != null && score < 70) {
            const weak = Object.entries(c.scores ?? {})
              .filter(([, v]) => Number(v) < 70)
              .sort((a, b) => Number(a[1]) - Number(b[1]));
            findings.push({
              subject: ["crawlability_score"],
              category: "technical",
              title: `Raise your AI crawlability score (${score}/100)`,
              summary: weak.length ? `Weakest areas: ${weak.slice(0, 3).map(([k, v]) => `${k} ${Math.round(Number(v))}`).join(", ")}.` : "The latest crawlability check found access issues for AI crawlers.",
              description: "The crawlability check tests robots.txt, llms.txt, server-side rendering and status codes for AI crawlers. Fix the weakest areas first.",
              steps: ["Open Crawlability and review the failed checks.", "Fix rendering/access issues for the affected crawlers and pages.", "Re-run the crawlability check."],
              acceptanceCriteria: ["Crawlability score of 70 or more."],
              impact: clamp10(score < 40 ? 9 : 7),
              effort: 4,
              evidence: [{ kind: "metric", label: "Crawlability score", value: `${score}/100`, chart: weak.map(([k, v]) => ({ label: k, value: Math.round(Number(v)) })) }],
              datasets: ["Crawlability check"],
              targetUrls: [`/p/${pid}/crawlability`],
              data: { score, weak },
            });
          }
        }
      } catch {
        // table shape differs
      }
    }

    /* 5) Bot traffic: AI crawlers hitting errors */
    if (await ctx.tableExists("analytics_bot_visits")) {
      try {
        const errs = await rows<BotErrRow>(sql`
          select path, array_agg(distinct bot) as bots, max(status)::int as status, count(*)::int as n
          from analytics_bot_visits
          where project_id = ${pid} and ts >= ${ctx.since.toISOString()} and status >= 400
          group by path order by n desc limit 10`);
        const [{ n: visits } = { n: 0 }] = await rows<{ n: number }>(
          sql`select count(*)::int as n from analytics_bot_visits where project_id = ${pid} and ts >= ${ctx.since.toISOString()}`,
        );
        if (Number(visits) > 0) {
          evaluated.add(ctx.fingerprint(["bot_errors"]));
          const errTotal = errs.reduce((a, e) => a + Number(e.n), 0);
          if (errTotal >= 5) {
            findings.push({
              subject: ["bot_errors"],
              category: "technical",
              title: `Fix errors AI crawlers hit on ${errs.length} URL${errs.length === 1 ? "" : "s"}`,
              summary: `${errTotal} AI-bot requests ended in 4xx/5xx in the last 30 days (${Math.round((errTotal / Number(visits)) * 100)}% of bot visits).`,
              description: "Your server/CDN logs show AI crawlers requesting URLs that fail. Every failed fetch is a page engines can't read or cite.",
              steps: ["Redirect moved URLs that bots still request to their replacement.", "Fix server errors on the listed paths.", "Check bot protection isn't serving challenges to verified AI crawlers."],
              acceptanceCriteria: ["Under 2% of AI-bot requests fail over the next 30 days."],
              impact: clamp10(errTotal >= 100 ? 8 : 6),
              effort: 3,
              evidence: [
                {
                  kind: "pages",
                  label: "Failing paths",
                  items: errs.map((e) => ({ label: e.path, value: Number(e.n), detail: `HTTP ${e.status} · ${(e.bots ?? []).join(", ")}` })),
                },
              ],
              datasets: ["Bot traffic"],
              targetUrls: [`/p/${pid}/analytics/bots`],
              data: { errors: errTotal, paths: errs.map((e) => e.path) },
            });
          }
        }
      } catch {
        // table shape differs
      }
    }

    return { findings, evaluated };
  },
});
