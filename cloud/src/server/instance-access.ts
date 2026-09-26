import "server-only";
import type { User } from "@/server/db/schema";
import { getUserInstance } from "@/server/instances";
import { getInstanceSsoSecret } from "@/server/provisioning";
import { signSsoToken, ssoUrl } from "@/server/sso";
import { logEvent } from "@/server/events";
import { rateLimit } from "@/server/rate-limit";

/**
 * URL that signs the owner into their instance (MANAGED_INSTANCES.md → SSO): a token signed with the
 * instance's own secret, valid for 2 minutes. Null when the instance isn't running.
 */
export async function instanceSsoRedirect(user: User): Promise<string | null> {
  const instance = await getUserInstance(user.id);
  if (!instance || instance.status !== "running") return null;
  if (!rateLimit(`sso:${user.id}`, 30, 60 * 60 * 1000)) return null;
  const secret = await getInstanceSsoSecret(instance);
  if (!secret) return null;
  const token = signSsoToken(secret, user.email);
  await logEvent("instance.sso", { userId: user.id, instanceId: instance.id });
  return ssoUrl(instance.host, token);
}
