import "server-only";
import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Widget action the public pages render with; siteverify must echo it back. */
export const TURNSTILE_ACTION = "free_tool";

const resultSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export type TurnstileOutcome = "ok" | "failed" | "unavailable";

/**
 * Cloudflare Turnstile siteverify (open-seo `guardToolRequest`): the token must verify for one of our hostnames and
 * the `free_tool` action. 5 s timeout; network/HTTP problems fail closed as "unavailable".
 */
export async function verifyTurnstile(input: {
  secret: string;
  token: string | undefined;
  ip: string | null;
  hostnames: string[];
}): Promise<TurnstileOutcome> {
  if (!input.token || input.token.length > 2048) return "failed";
  try {
    const body = new URLSearchParams({ secret: input.secret, response: input.token });
    if (input.ip) body.set("remoteip", input.ip);
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) return "unavailable";
    const parsed = resultSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.success) return "failed";
    if (!parsed.data.hostname || !input.hostnames.includes(parsed.data.hostname.toLowerCase())) return "failed";
    if (parsed.data.action !== TURNSTILE_ACTION) return "failed";
    return "ok";
  } catch {
    return "unavailable";
  }
}
