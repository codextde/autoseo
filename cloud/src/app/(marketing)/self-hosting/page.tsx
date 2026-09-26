import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CodeBlock, CommandPill } from "@/components/marketing/code-block";
import { installCommand, price } from "@/components/marketing/content";
import { JsonLd } from "@/components/marketing/json-ld";
import { pageMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { CtaLink, Container, GitHubIcon } from "@/components/marketing/primitives";
import { Prose } from "@/components/marketing/prose";
import { breadcrumbs, graph } from "@/components/marketing/structured-data";
import { absoluteUrl, site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Self-Host AutoSEO: Docker & Coolify Setup Guide",
  description:
    "Self-host AutoSEO, the open-source AI SEO & GEO platform, on your own server: one-line installer, Docker Compose or Coolify, setup, updates and backups.",
  path: "/self-hosting",
  ownImage: true,
});

const toc = [
  { id: "requirements", label: "Requirements" },
  { id: "installer", label: "Option A: One-line installer" },
  { id: "docker-compose", label: "Option B: Docker Compose" },
  { id: "coolify", label: "Option C: Coolify" },
  { id: "first-run", label: "First-run setup" },
  { id: "configure", label: "Email, AI & DataForSEO" },
  { id: "local-agents", label: "Local agents" },
  { id: "updating", label: "Updating" },
  { id: "backups", label: "Backups" },
  { id: "environment", label: "Optional environment variables" },
  { id: "help", label: "Help & managed hosting" },
];

const raw = "https://raw.githubusercontent.com/codextde/autoseo/main/deploy";

export default function SelfHostingPage() {
  return (
    <>
      <JsonLd
        data={graph(
          {
            "@type": "TechArticle",
            headline: "How to self-host AutoSEO",
            description:
              "Install the open-source AutoSEO platform on your own server with a one-line installer, Docker Compose or Coolify.",
            url: absoluteUrl("/self-hosting"),
            inLanguage: "en",
            dateModified: site.legalUpdated,
            author: { "@id": absoluteUrl("/#organization") },
            publisher: { "@id": absoluteUrl("/#organization") },
            about: { "@id": absoluteUrl("/#software") },
          },
          breadcrumbs([{ name: "Self-hosting", path: "/self-hosting" }]),
        )}
      />
      <PageHero
        crumb="Self-hosting"
        eyebrow="Self-hosting guide"
        title="Self-host AutoSEO in minutes"
        subtitle="AutoSEO is a single Next.js app plus PostgreSQL, shipped as a Docker image. Run it on any Linux server — free, with every feature, under the MIT license."
      >
        <div className="mt-8 flex max-w-xl flex-col gap-3">
          <CommandPill command={installCommand} className="w-full sm:w-fit" />
          <p className="text-sm text-muted-foreground">
            Rather not run a server?{" "}
            <Link href="/pricing" className="font-medium text-foreground underline underline-offset-4 hover:no-underline">
              AutoSEO Cloud
            </Link>{" "}
            gives you a private, managed instance for {price}/month.
          </p>
        </div>
      </PageHero>

      <Container className="py-14 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <details className="mk-faq group rounded-xl border bg-card lg:hidden">
              <summary className="flex cursor-pointer items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none">
                On this page
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <TocLinks className="px-2 pb-3" />
            </details>
            <nav aria-label="On this page" className="hidden lg:block">
              <p className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
              <TocLinks className="mt-3" />
            </nav>
          </aside>

          <article className="min-w-0 max-w-3xl">
            <Prose>
              <h2 id="requirements">Requirements</h2>
              <ul>
                <li>
                  A Linux server (VPS or bare metal) with <strong>2 vCPU and 2–4 GB RAM</strong> — enough for small teams.
                  Scale up for heavy site audits or large keyword and backlink jobs.
                </li>
                <li>
                  <a href="https://docs.docker.com/engine/install/" target="_blank" rel="noopener">
                    Docker
                  </a>{" "}
                  with the Compose v2 plugin (the installer can install it for you).
                </li>
                <li>
                  A domain (for example <code>seo.example.com</code>) whose DNS A record points at the server, and ports
                  80 and 443 open — used for automatic HTTPS.
                </li>
              </ul>

              <h2 id="installer">Option A: One-line installer</h2>
              <p>The fastest way to a production instance. Run this on your server:</p>
              <CodeBlock title="Install" code={installCommand} prompt />
              <p>The installer:</p>
              <ol>
                <li>
                  downloads <code>deploy/docker-compose.yml</code> and <code>deploy/Caddyfile</code> from the repository
                  into <code>/opt/autoseo</code> (change it with <code>--dir</code>),
                </li>
                <li>installs Docker if it is missing (it asks first),</li>
                <li>asks for your domain and checks that its DNS points at the server,</li>
                <li>
                  generates a random Postgres password and writes <code>.env</code> (mode <code>600</code>),
                </li>
                <li>
                  pulls the prebuilt image <code>{site.image}</code> and starts the app, PostgreSQL and Caddy for
                  automatic HTTPS,
                </li>
                <li>waits until the app is healthy and prints your first-run setup code.</li>
              </ol>
              <p>
                Re-running the script is safe — it keeps your existing <code>.env</code>. Useful flags:
              </p>
              <CodeBlock
                title="Installer flags"
                prompt
                code={[
                  "# Non-interactive install",
                  `${installCommand} -s -- --domain seo.example.com --yes`,
                  "",
                  "# Use your own reverse proxy instead of the bundled Caddy",
                  `${installCommand} -s -- --no-proxy`,
                  "",
                  "# Pin an image tag, or show all options",
                  `${installCommand} -s -- --version v1.4.0`,
                  `${installCommand} -s -- --help`,
                ].join("\n")}
              />
              <p>
                With <code>--no-proxy</code>, the app is published on <code>127.0.0.1:3000</code> for Traefik, nginx or a
                Cloudflare Tunnel to forward to — terminate TLS there, since sessions use secure cookies.
              </p>

              <h2 id="docker-compose">Option B: Docker Compose</h2>
              <p>
                The same setup without the script, if you want to review every step. It uses the prebuilt image — no
                build and no repository checkout needed.
              </p>
              <CodeBlock
                title="Manual install"
                prompt
                code={[
                  "mkdir -p /opt/autoseo && cd /opt/autoseo",
                  `curl -fsSLO ${raw}/docker-compose.yml`,
                  `curl -fsSLO ${raw}/Caddyfile`,
                  `curl -fsSL ${raw}/.env.example -o .env`,
                  "",
                  "# Set DOMAIN and POSTGRES_PASSWORD (e.g. openssl rand -hex 24)",
                  "nano .env && chmod 600 .env",
                  "",
                  "docker compose pull",
                  "docker compose up -d",
                  "docker compose logs -f app   # shows the setup code",
                ].join("\n")}
              />
              <p>
                The compose file runs three services: <code>app</code>, <code>postgres</code> and <code>caddy</code>. Caddy
                is enabled by <code>COMPOSE_PROFILES=proxy</code> in <code>.env</code>; set it to empty to skip Caddy and
                point your own proxy at <code>127.0.0.1:3000</code>.
              </p>

              <h2 id="coolify">Option C: Coolify</h2>
              <p>Already running a Coolify server? Deploy AutoSEO straight from the repository:</p>
              <ol>
                <li>
                  Create a new resource → <strong>Docker Compose</strong> and point it at{" "}
                  <a href={site.github} target="_blank" rel="noopener">
                    {site.github.replace("https://", "")}
                  </a>{" "}
                  (build pack: Docker Compose, file <code>docker-compose.yml</code> at the repository root).
                </li>
                <li>
                  Set the domain of the <code>app</code> service (e.g. <code>https://seo.example.com</code>) and add the
                  environment variable <code>DOMAIN=seo.example.com</code>. Coolify generates the Postgres password
                  automatically.
                </li>
                <li>Deploy. Migrations run at boot and the setup code is printed to the logs.</li>
              </ol>
              <p>
                If all traffic reaches Coolify through Cloudflare&apos;s proxy, enable{" "}
                <strong>Admin → Authentication → Behind Cloudflare</strong> after setup so rate limits use the real client
                IP.
              </p>

              <h2 id="first-run">First-run setup</h2>
              <p>
                On first boot the app runs its database migrations and prints a one-time setup code to its logs (a new
                code on every restart until setup is done). The installer shows it for you; otherwise run{" "}
                <code>docker compose logs app</code>.
              </p>
              <CodeBlock
                title="docker compose logs app"
                copy={false}
                code={[
                  "╔════════════════════════════════════════╗",
                  "║  AutoSEO first-run setup               ║",
                  "║  Open https://seo.example.com/setup    ║",
                  "║  Setup code: 1234-5678                 ║",
                  "╚════════════════════════════════════════╝",
                ].join("\n")}
              />
              <p>
                Open <code>/setup</code>, enter the code, name your workspace and create the owner account — you are
                signed in immediately. Optionally restrict sign-ins to your company&apos;s email domains.
              </p>

              <h2 id="configure">Configure email, AI and DataForSEO</h2>
              <p>
                Everything beyond <code>DOMAIN</code> is stored in the database and configured in the admin panel at{" "}
                <code>/admin</code>:
              </p>
              <ul>
                <li>
                  <strong>Email</strong> (Admin → Email): SMTP or Amazon SES, sender address and a test email. Needed for
                  invitations and magic links.
                </li>
                <li>
                  <strong>AI providers</strong> (Admin → AI Providers): connect local Claude Code / Codex agents (below)
                  or add API keys for Anthropic, OpenAI, OpenRouter, Perplexity, Gemini, xAI, Mistral or DeepSeek.
                </li>
                <li>
                  <strong>DataForSEO</strong> (Admin → Data Providers): keyword research, SERPs, backlinks and tracking of
                  Google AI Overviews, AI Mode and Copilot. Pay-as-you-go, billed by DataForSEO.
                </li>
                <li>
                  <strong>Google OAuth</strong> (Admin → Data Providers): Search Console, GA4 and Google Sheets export.
                </li>
              </ul>
              <p>
                Also worth a look: Authentication (invite-only mode, allowed email domains, session length), Roles &amp;
                Permissions, and Limits &amp; Budgets for daily and monthly spend caps.
              </p>

              <h2 id="local-agents">Local agents (Claude Code / Codex)</h2>
              <p>
                AutoSEO can run all AI work on your own Claude Code or Codex subscription. Open{" "}
                <strong>Settings → Local Agents → Install agent</strong> in your instance, copy the one-liner for macOS/Linux
                or Windows, and run it on a machine that has <code>claude</code> and/or <code>codex</code> installed:
              </p>
              <CodeBlock
                title="Install a local agent"
                prompt
                code={
                  "curl -fsSL https://seo.example.com/install.sh | AUTOSEO_AGENT_TOKEN=… bash -s -- --host https://seo.example.com"
                }
              />
              <p>
                Agents connect over outbound HTTPS only (no open ports), start automatically, run each job in a fresh CLI
                session and update themselves — with signed releases — whenever you update AutoSEO.
              </p>

              <h2 id="updating">Updating</h2>
              <ul>
                <li>
                  <strong>Installer:</strong> <code>{installCommand} -s -- --update</code>
                </li>
                <li>
                  <strong>Docker Compose:</strong> <code>docker compose pull &amp;&amp; docker compose up -d</code> in{" "}
                  <code>/opt/autoseo</code>
                </li>
                <li>
                  <strong>Coolify:</strong> redeploy the resource
                </li>
              </ul>
              <p>Database migrations run automatically at boot, and connected local agents update themselves.</p>

              <h2 id="backups">Backups</h2>
              <p>Two Docker volumes hold everything that matters — back up both, and store copies off the server:</p>
              <ul>
                <li>
                  <code>autoseo-pg</code> — the PostgreSQL database.
                </li>
                <li>
                  <code>autoseo-data</code> — uploads, caches, the encryption key for stored secrets (
                  <code>secret.key</code>) and the agent release signing key. Losing <code>secret.key</code> makes stored
                  provider credentials unreadable.
                </li>
              </ul>
              <CodeBlock
                title="Backup"
                prompt
                code={[
                  "# Database dump",
                  "docker compose exec postgres pg_dump -U autoseo -d autoseo -Fc -f /tmp/autoseo.dump",
                  "docker compose cp postgres:/tmp/autoseo.dump ./autoseo-$(date +%F).dump",
                  "",
                  "# Data volume",
                  'docker run --rm -v autoseo_autoseo-data:/data -v "$PWD":/backup alpine \\',
                  "  tar czf /backup/autoseo-data-$(date +%F).tar.gz -C /data .",
                ].join("\n")}
              />
              <p>
                Run these in <code>/opt/autoseo</code>. Docker Compose prefixes volume names with the project name
                (<code>autoseo_</code> for the default install directory) — check yours with <code>docker volume ls</code>.
              </p>

              <h2 id="environment">Optional environment variables</h2>
              <p>
                Only <code>DOMAIN</code> is required. These optional bootstrap variables pre-configure an instance for
                scripted deployments; they are listed (commented out) in <code>.env</code>. Settings made in the admin
                panel always take precedence.
              </p>
              <div className="not-prose overflow-x-auto" tabIndex={0} role="region" aria-label="Environment variables">
                <table className="min-w-[32rem]">
                  <thead>
                    <tr>
                      <th scope="col">Variable</th>
                      <th scope="col">Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["AUTOSEO_OWNER_EMAIL", "Skips the setup code: the first boot creates this user as instance admin and workspace owner"],
                      ["AUTOSEO_OWNER_NAME", "Display name for that owner"],
                      ["AUTOSEO_WORKSPACE_NAME", "Name of the first workspace (default “My Workspace”)"],
                      ["AUTOSEO_SMTP_URL", "Default mail server until Admin → Email is configured, e.g. smtp://user:pass@host:587"],
                      ["AUTOSEO_MAIL_FROM", "Sender for the default mail server, e.g. AutoSEO <noreply@example.com>"],
                      ["AUTOSEO_VERSION", "Image tag to run (default latest)"],
                      ["APP_PORT", "Loopback port the app is published on (default 3000)"],
                    ].map(([name, purpose]) => (
                      <tr key={name}>
                        <td>
                          <code>{name}</code>
                        </td>
                        <td>{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 id="help">Help & managed hosting</h2>
              <p>
                The complete guide — including reverse-proxy examples for Traefik and nginx and a troubleshooting section —
                lives in{" "}
                <a href={`${site.github}/blob/main/docs/SELF_HOSTING.md`} target="_blank" rel="noopener">
                  docs/SELF_HOSTING.md
                </a>
                . Questions or bugs? Open a{" "}
                <a href={`${site.github}/discussions`} target="_blank" rel="noopener">
                  discussion
                </a>{" "}
                or an{" "}
                <a href={`${site.github}/issues`} target="_blank" rel="noopener">
                  issue
                </a>{" "}
                on GitHub.
              </p>
            </Prose>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold">Star the project</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Follow releases and help others discover AutoSEO.
                </p>
                <CtaLink href={site.github} variant="secondary" className="mt-5">
                  <GitHubIcon />
                  Star on GitHub
                </CtaLink>
              </div>
              <div className="rounded-2xl border bg-card p-6">
                <h2 className="font-semibold">Skip the server work</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  A private, managed instance with updates, SSL and email set up for you.
                </p>
                <CtaLink href="/signup" className="mt-5" arrow>
                  Start for {price}/month
                </CtaLink>
              </div>
            </div>
          </article>
        </div>
      </Container>
    </>
  );
}

function TocLinks({ className }: { className?: string }) {
  return (
    <ol className={className}>
      {toc.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {item.label}
          </a>
        </li>
      ))}
    </ol>
  );
}
