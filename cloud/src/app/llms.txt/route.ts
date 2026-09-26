import { engines, featureRows, homeFaq, installCommand, instanceHost, overview, price, seoSuite } from "@/components/marketing/content";
import { absoluteUrl, site } from "@/lib/site";

export const dynamic = "force-static";

/** llms.txt (https://llmstxt.org): a plain-markdown summary of the product for AI assistants and answer engines. */
export function GET() {
  const body = `# ${site.name}

> ${site.name} is an open-source (MIT) AI visibility (GEO) and SEO platform by ${site.company}. It tracks how AI answer engines mention and cite a brand — ${engines.map((e) => e.name).join(", ")} — alongside keyword research, rank tracking, backlinks, site audits, Search Console, GA4, content optimization and white-label reports. Self-host it for free or get a private, fully managed instance (AutoSEO Cloud) for ${price}/month.

## Key facts

- License: MIT. Source code: ${site.github}
- Self-hosted: free forever, every feature, runs on any Linux server with Docker. Docker image: \`${site.image}:latest\`. One-line installer: \`${installCommand}\`
- AutoSEO Cloud: ${price} per instance per month, billed monthly via Stripe, cancel anytime. Private instance at ${instanceHost} with its own isolated database, SSL, email delivery, automatic updates and email support. Unlimited users, projects and workspaces. Prices exclude VAT where applicable; business customers only.
- AI work runs on the customer's own Claude Code or Codex CLI through lightweight local agents, or on their own API keys (Anthropic, OpenAI, OpenRouter, Perplexity, Gemini, xAI, Mistral, DeepSeek). DataForSEO is optional, pay-as-you-go.
- Cloud instances are hosted in Germany. No vendor lock-in: cloud instances run the same open-source image and can be exported to a self-hosted server.

## Features

${overview.items.map((item) => `- **${item.title}:** ${item.body}`).join("\n")}

### Details

${[...featureRows, seoSuite].map((f) => `- **${f.eyebrow}:** ${f.bullets.join("; ")}.`).join("\n")}

## Pages

- [Home](${absoluteUrl("/")}): product overview, features, comparison and FAQ
- [Pricing](${absoluteUrl("/pricing")}): self-hosted (free) vs. Cloud (${price}/month) and billing FAQ
- [Self-hosting guide](${absoluteUrl("/self-hosting")}): installer, Docker Compose, Coolify, updates and backups
- [GitHub repository](${site.github}): source code, issues and README
- [Sign up](${absoluteUrl("/signup")}): start an AutoSEO Cloud subscription
- [Imprint](${absoluteUrl("/imprint")}), [Privacy policy](${absoluteUrl("/privacy")}), [Terms of service](${absoluteUrl("/terms")})

## FAQ

${homeFaq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
