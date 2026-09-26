# AutoSEO Cloud

The control plane behind **https://autoseo.codext.de**: marketing site, sign-up, Stripe billing and fully
automatic provisioning of one private AutoSEO instance per customer (`https://<slug>.autoseo.codext.de`) on
Coolify. The contract between the cloud and the instances (env vars, SSO token, service layout, DNS,
lifecycle) is documented in [`docs/MANAGED_INSTANCES.md`](../docs/MANAGED_INSTANCES.md).

Next.js 16 · Drizzle + PostgreSQL · Stripe · Coolify API · nodemailer.

## How it works

1. A customer signs up at `/signup` (magic link + 6-digit code, no passwords) and picks an address and a
   workspace name on `/dashboard`. The address is reserved (`pending_payment`) and the customer goes to
   Stripe Checkout ($50/month).
2. `checkout.session.completed` (webhook — or the success redirect, whichever comes first) links the
   subscription and marks the instance `provisioning`. Provisioning runs after the response:
   - finds/creates the Coolify project, then creates the service `autoseo-<slug>` from a generated Docker
     Compose file (app + PostgreSQL, no secrets inside) with the domain set through `urls`;
   - sets the environment through `PATCH /services/{uuid}/envs/bulk` (`DOMAIN`, owner email/name,
     workspace, `AUTOSEO_SMTP_URL`/`AUTOSEO_MAIL_FROM`, a per-instance `AUTOSEO_SSO_SECRET`, `AUTOSEO_CLOUD_URL`);
   - starts the service.
   Every step is idempotent and the service uuid is stored the moment it exists, so a retry continues where
   the last attempt stopped (a service left behind by a crash is adopted by name).
3. A background reconciler (every 30 s, started from `src/instrumentation.ts`) resumes unfinished
   provisioning with backoff, polls `https://<host>/api/health` and marks the instance `running` — the owner
   then gets a "Your AutoSEO instance is ready" email once. Running instances are health-checked every
   10 minutes; unpaid reservations are released after 25 hours.
4. "Open AutoSEO" signs a 2-minute SSO token with the instance's own secret and redirects to
   `https://<host>/auth/sso?token=…` — one click, no second login.
5. Subscription updates keep instances in sync: `active`/`trialing`/`past_due` → running (a stopped
   instance is started again), `unpaid`/`canceled`/`incomplete_expired`/`paused` → stopped (data is kept).
   `invoice.payment_failed` emails the customer a link to the billing portal.

Everything is recorded in the audit log (`/admin` → Events).

## Deploy on Coolify

1. **DNS** (Cloudflare), both `CNAME coolify-v4.codext.de`:
   - `autoseo.codext.de` (proxied)
   - `*.autoseo.codext.de` (**DNS only**, so Traefik can issue a certificate per customer host; the
     universal certificate doesn't cover second-level wildcards)
2. **New resource → Public/Private repository → Docker Compose** with **base directory `/cloud`**
   (uses `cloud/docker-compose.yml`, which builds `cloud/Dockerfile`).
3. Set the domain of the `cloud` service to `https://autoseo.codext.de` and the environment variables:
   - `ADMIN_EMAILS` — comma-separated emails that may open `/admin` (e.g. `you@codext.de`)
   - `DOMAIN` — defaults to `autoseo.codext.de`
   Coolify generates the database password (`SERVICE_PASSWORD_POSTGRES`). Migrations run automatically at boot.
4. Deploy, open `https://autoseo.codext.de/login` and sign in with an admin email. SMTP isn't configured
   yet, so the sign-in link and code are printed to the **container logs** (Coolify → Logs).
5. In **`/admin`**:
   - **Email** — SMTP host/port/user/password/from (Amazon SES works). "Save & verify", then "Send test
     email". Keep "Customer instances use the same SMTP server" on to give every instance working email.
   - **Stripe** — paste a secret key (`sk_live_…`/`sk_test_…` or a restricted `rk_…`) and "Save & connect".
     This reuses the price with lookup key `autoseo_cloud_monthly` (and its product) when it exists — otherwise
     it creates the "AutoSEO Cloud" product (tax code `txcd_10103000`) with a $50/month price (tax behavior
     exclusive) — plus the webhook endpoint `https://autoseo.codext.de/api/stripe/webhook` (signing secret
     stored encrypted) and a customer portal configuration. Idempotent — run it again any time.
     Options: trial days, automatic tax (default on; needs Stripe Tax), promotion codes.
   - **Coolify** — URL (default `https://coolify-v4.codext.de`), an API token (Keys & Tokens, with read,
     write and deploy permissions), project name, instance base domain, image and memory limit. Save,
     "Load servers" (picked automatically when there is only one), then "Test connection" (creates the
     project if needed).
6. Customers can now subscribe. `/admin` → Customers lets you provision/retry, start, stop, restart,
   redeploy (pulls the latest image) and delete instances (removes the service **including volumes** and
   cancels a still-active subscription).

Only `DOMAIN`, `ADMIN_EMAILS`, `DATABASE_URL` and `DATA_DIR` (plus optional `APP_URL`) are read from the
environment. All integration credentials live in the database, encrypted with AES-256-GCM using a key that
is generated on first boot at `DATA_DIR/secret.key` — **back up the `cloud-data` volume** together with the
database, otherwise stored credentials can't be decrypted.

## Local development

```bash
cd cloud
pnpm install
# a PostgreSQL database, e.g. in the repo's dev container:
psql postgres://autoseo:autoseo@localhost:54329/autoseo -c 'create database autoseo_cloud'
export DATABASE_URL=postgres://autoseo:autoseo@localhost:54329/autoseo_cloud
pnpm db:push                                  # sync the schema (production applies ./drizzle migrations)
DOMAIN=localhost:3200 ADMIN_EMAILS=you@example.com pnpm dev   # http://localhost:3200
```

Sign-in emails are printed to the terminal until SMTP is configured. Stripe can't create a webhook endpoint
for `localhost`: to test billing locally, expose the dev server through an HTTPS tunnel, start it with
`APP_URL=https://<tunnel-host>` and run "Save & connect" with a `sk_test_…` key.

| Command | |
|---|---|
| `pnpm dev` | dev server on port 3200 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | checks and unit tests (slug rules, SSO tokens, compose, SMTP URL, billing rules) |
| `AUTOSEO_SKIP_BOOT=1 pnpm build` | production build (no database needed) |
| `pnpm db:generate --name <change>` | create a migration after editing `src/server/db/schema.ts` |

## Layout

```
src/app/(marketing)/        marketing site
src/app/(account)/(auth)/   /login, /signup, /auth/verify
src/app/(account)/(app)/    /dashboard, /admin
src/app/api/                health, auth/verify, slug, instance/{status,open}, billing/portal, stripe/webhook
src/server/                 auth, settings, stripe, coolify, provisioning, reconciler, email, db
src/components/account/     dashboard + admin UI
drizzle/                    SQL migrations (applied at boot in production)
```
