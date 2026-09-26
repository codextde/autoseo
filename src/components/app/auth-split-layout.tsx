import Link from "next/link";
import { getBranding } from "@/server/branding";
import { Logo } from "./logo";
import { DottedGlobe } from "./dotted-globe";

export async function AuthSplitLayout({
  children,
  aside,
  topRight,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  topRight?: React.ReactNode;
}) {
  const brand = await getBranding();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col bg-background px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo name={brand.appName} src={brand.logoUrl || undefined} />
          </Link>
          {topRight}
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground sm:text-left">
          © {new Date().getFullYear()} {brand.appName} · Self-hosted
        </p>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-[oklch(0.965_0.004_95)] dark:bg-[oklch(0.17_0.004_95)] lg:block">
        <div className="bg-dots absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 top-[12%] mx-auto aspect-square w-[88%] max-w-[720px]">
          <DottedGlobe />
        </div>
        <div className="absolute inset-x-10 bottom-10">{aside}</div>
      </div>
    </div>
  );
}
