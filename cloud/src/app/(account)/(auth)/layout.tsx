import type { Metadata } from "next";
import { AuthShell } from "@/components/account/auth-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
