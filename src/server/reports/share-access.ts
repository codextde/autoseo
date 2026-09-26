import "server-only";
import { cookies } from "next/headers";
import { timingSafeEqualStr } from "@/server/crypto";
import { getReportByShareToken } from "./service";
import { SHARE_TOKEN_RE, shareCookieName, shareCookieValue } from "./share";

export type ShareAccess =
  | { state: "missing" }
  | { state: "locked"; title: string }
  | { state: "ok"; found: NonNullable<Awaited<ReturnType<typeof getReportByShareToken>>> };

/** Resolves a public share token (+ password cookie). Never throws for bad tokens. */
export async function getShareAccess(token: string): Promise<ShareAccess> {
  if (!SHARE_TOKEN_RE.test(token)) return { state: "missing" };
  const found = await getReportByShareToken(token);
  if (!found) return { state: "missing" };
  if (found.r.sharePasswordHash) {
    const jar = await cookies();
    const got = jar.get(shareCookieName(token))?.value ?? "";
    const expected = shareCookieValue(token, found.r.sharePasswordHash);
    if (!got || !timingSafeEqualStr(got, expected)) return { state: "locked", title: found.r.title };
  }
  return { state: "ok", found };
}
