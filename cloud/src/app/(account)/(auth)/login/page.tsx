import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/login-form";
import { getCurrentSession } from "@/server/auth/session";
import { safeNext } from "@/server/safe-next";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null) ?? undefined;
  if (await getCurrentSession()) redirect(next ?? "/dashboard");
  return <LoginForm mode="login" next={next} />;
}
