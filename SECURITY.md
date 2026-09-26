# Security Policy

## Supported versions

AutoSEO ships continuously from `main`. There are no long-lived release branches, so security fixes are made
against, and support is provided for:

| Version | Supported |
|---|---|
| `main` (latest commit) | ✅ |
| Latest published image (`ghcr.io/codextde/autoseo:latest`) | ✅ |
| Older tagged images / commits | ❌ (please update — see `docs/SELF_HOSTING.md#updating`) |

If you're self-hosting, keep your instance reasonably current so you receive fixes promptly; there is no
backporting to older tags.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report privately through one of:

- **GitHub Security Advisories** — open one via the
  ["Report a vulnerability"](https://github.com/codextde/autoseo/security/advisories/new) button on this repo
  (preferred: it keeps the report private and lets us collaborate on a fix before disclosure).
- **Email** — [security@codext.de](mailto:security@codext.de). Please include steps to reproduce, affected
  version/commit, and impact. PGP is not required but we're happy to set up an encrypted channel on request.

### What to expect

- **Acknowledgement** within 2 business days.
- **Initial assessment** (severity, affected scope) within 5 business days.
- **Fix or mitigation** timeline communicated once triaged — we aim for critical issues within 7 days and
  everything else within 30 days, coordinated with you on disclosure timing.
- Credit in the advisory/release notes if you'd like it (or anonymity, if you'd prefer).

## Scope

In scope:

- The AutoSEO application (`src/`, `agent/`, `plugins/`), its Docker image, and the `deploy/` self-hosting
  assets (compose files, `install.sh`).
- Authentication, session handling, API/MCP authorization, secrets storage, and the local-agent protocol.
- AutoSEO Cloud (`cloud/`) provisioning/billing logic, to the extent it's part of this repository.

Out of scope:

- Vulnerabilities that require an attacker to already have admin/owner access to an instance (self-hosters
  control their own admin accounts).
- Denial-of-service via unauthenticated flooding of a self-hosted instance you don't operate.
- Third-party services AutoSEO integrates with (DataForSEO, Google, SMTP providers, AI model providers) —
  report those upstream.
- Issues only reproducible with an outdated/unsupported version (see table above).

## Security model overview

A few things worth knowing when auditing or reporting:

- **Authentication** is invite-only magic-link login plus one-time codes — no passwords. Sessions use
  `__Host-` cookies (Secure, HttpOnly, SameSite=Lax) and last up to a year, revocable per-device.
- **Tokens** (API keys, OAuth tokens, local-agent tokens) are stored as SHA-256 hashes only; the plaintext is
  shown once at creation time and never persisted.
- **Secrets at rest** (SMTP credentials, provider API keys, OAuth client secrets) are encrypted with
  AES-256-GCM using a key generated on first boot into the data volume (`DATA_DIR/secret.key`). Losing that
  file makes stored secrets unrecoverable — see `docs/SELF_HOSTING.md#backups`.
- **SSRF protection** — outbound requests triggered by integrations (webhooks, crawling, WordPress/Webflow
  publishing, etc.) block private/LAN/link-local addresses by default. Admins can explicitly allow specific
  internal hosts under Admin → Authentication.
- **CSP and other security headers** are set on every response; report a bypass as a vulnerability.
- **Rate limiting** uses `X-Real-IP`/`X-Forwarded-For` from the trusted reverse proxy by default; instances
  fully behind Cloudflare should enable "Behind Cloudflare" in Admin → Authentication so spoofable headers
  aren't trusted instead.
- **Local agents** (Claude Code / Codex) only make outbound HTTPS connections to your instance and open no
  inbound ports; agent releases are signed and the signature is verified before auto-update.

For the full picture, see the "Deploy with Coolify" → *Reverse proxy & security settings* section of the
[README](README.md).

## Managed hosting (AutoSEO Cloud)

If you're a customer of [AutoSEO Cloud](https://autoseo.codext.de) and believe your managed instance was
affected by a reported issue, contact info@codext.de directly and we'll patch and redeploy on your behalf.
