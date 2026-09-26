#!/usr/bin/env node
// Dev helper: mints a session for the first instance admin and prints a curl-ready cookie.
// Usage: node scripts/dev-session.mjs [email]
import crypto from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://autoseo:autoseo@localhost:54329/autoseo");
const email = process.argv[2];
const [user] = email
  ? await sql`select id, email from users where email = ${email} limit 1`
  : await sql`select id, email from users where is_instance_admin = true order by created_at limit 1`;
if (!user) {
  console.error("No user found. Complete /setup first.");
  process.exit(1);
}
const token = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(token).digest("hex");
const id = "ses_dev" + crypto.randomBytes(6).toString("hex");
await sql`insert into sessions (id, user_id, token_hash, device_label, expires_at) values (${id}, ${user.id}, ${hash}, 'dev-session script', now() + interval '30 days')`;
console.log(`autoseo_session=${token}`);
await sql.end();
