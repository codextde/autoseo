import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/login-form";
import { getCurrentSession } from "@/server/auth/session";
import { safeNext } from "@/server/safe-next";

export const metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null) ?? undefined;
  if (await getCurrentSession()) redirect(next ?? "/dashboard");
  return <LoginForm mode="signup" next={next} />;
}
