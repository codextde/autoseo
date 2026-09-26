"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requestLogin, verifyLoginCode, verifyLoginToken } from "@/server/auth/login";
import { acceptInvitationToken } from "@/server/auth/membership";
import { completeSetup, needsSetup } from "@/server/setup";

export type LoginState =
  | { step: "email"; error?: string; email?: string }
  | { step: "sent"; email: string; transport: "smtp" | "log"; error?: string };

export async function requestLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const next = String(formData.get("next") ?? "") || null;
  const res = await requestLogin(email, next);
  if (!res.ok) return { step: "email", error: res.error, email };
  return { step: "sent", email: res.email, transport: res.transport };
}

export async function verifyCodeAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "");
  const res = await verifyLoginCode(email, code);
  if (!res.ok) return { step: "sent", email, transport: "smtp", error: res.error };
  redirect(res.redirectTo);
}

export async function confirmMagicLinkAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const res = await verifyLoginToken(token);
  if (!res.ok) return { error: res.error };
  redirect(res.redirectTo);
}

export async function acceptInviteAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const res = await acceptInvitationToken(token);
  if (!res.ok) {
    // Existing accounts accept invitations by signing in (login auto-accepts pending invites).
    if ("needsLogin" in res && res.needsLogin) redirect(`/login?next=${encodeURIComponent("/")}`);
    return { error: res.error };
  }
  redirect("/");
}

const setupSchema = z.object({
  code: z.string().trim().min(4, "Enter the setup code from the server logs"),
  appName: z.string().trim().min(1).max(60),
  workspaceName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  allowedDomains: z.string().default(""),
});

export async function completeSetupAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  if (!(await needsSetup())) redirect("/");
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  try {
    await completeSetup({
      ...parsed.data,
      allowedDomains: parsed.data.allowedDomains.split(/[\s,;]+/).filter(Boolean),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Setup failed" };
  }
  redirect("/onboarding");
}
