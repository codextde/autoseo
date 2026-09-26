"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users } from "@/server/db/schema";
import { requestLogin, verifyLoginCode } from "@/server/auth/login";
import { assertUser, AuthError } from "@/server/auth/guards";
import { destroyCurrentSession, revokeAllSessions } from "@/server/auth/session";
import { getUserInstance } from "@/server/instances";
import { isSubscriptionLive } from "@/server/billing-rules";
import { deleteInstance } from "@/server/provisioning";
import { BillingError, settleCheckoutSession } from "@/server/stripe";
import { logEvent } from "@/server/events";

export type LoginState =
  | { step: "email"; error?: string; email?: string }
  | { step: "sent"; email: string; transport: "smtp" | "log"; error?: string };

export async function requestLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const next = String(formData.get("next") ?? "") || null;
  const mode = formData.get("mode") === "signup" ? "signup" : "login";
  const res = await requestLogin(email, next, mode);
  if (!res.ok) return { step: "email", error: res.error, email };
  return { step: "sent", email: res.email, transport: res.transport };
}

export async function verifyCodeAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "");
  const res = await verifyLoginCode(email, code);
  const transport = prev.step === "sent" ? prev.transport : "smtp";
  if (!res.ok) return { step: "sent", email, transport, error: res.error };
  redirect(res.redirectTo);
}

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

export async function signOutEverywhereAction(): Promise<void> {
  const { user } = await assertUser();
  await revokeAllSessions(user.id);
  await destroyCurrentSession();
  await logEvent("auth.signed_out_everywhere", { userId: user.id });
  redirect("/login");
}

export type ActionResult = { ok?: boolean; error?: string; message?: string };

/** Deletes the account (and a leftover instance incl. its data). Not possible while a subscription is live. */
export async function deleteAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const { user } = await assertUser();
    if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== user.email) {
      return { error: "Type your email address to confirm." };
    }
    const instance = await getUserInstance(user.id);
    if (instance && isSubscriptionLive(instance.subscriptionStatus)) {
      return {
        error:
          "You still have an active subscription. Cancel it under “Manage billing” first — you can delete your account once it has ended.",
      };
    }
    if (instance) {
      if (instance.status === "pending_payment") {
        if ((await settleCheckoutSession(instance)) === "paid") {
          return { error: "Your payment just went through, so your instance is being set up. Cancel the subscription first to delete your account." };
        }
        await db.delete(instances).where(eq(instances.id, instance.id));
      } else {
        const res = await deleteInstance(instance, `customer:${user.id}`);
        if (!res.ok) return { error: "We couldn't remove your instance data right now. Please contact support." };
      }
    }
    await logEvent("account.deleted", { userId: user.id, data: { email: user.email, instanceId: instance?.id ?? null } });
    await revokeAllSessions(user.id);
    await db.delete(users).where(eq(users.id, user.id));
    await destroyCurrentSession();
  } catch (err) {
    if (err instanceof AuthError || err instanceof BillingError) return { error: err.message };
    console.error("[account] delete failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/");
}
