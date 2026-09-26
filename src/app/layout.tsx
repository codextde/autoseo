import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/app/theme-provider";
import { getBranding } from "@/server/branding";
import { brandCss } from "@/features/admin/brand-css";
import "./globals.css";

// Every page depends on instance data (branding, settings, the database); nothing may be prerendered
// at image build time, when no database exists.
export const dynamic = "force-dynamic";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBranding();
  return {
    title: { default: brand.appName, template: `%s · ${brand.appName}` },
    description: brand.tagline,
    icons: brand.faviconUrl ? [{ url: brand.faviconUrl }] : [{ url: "/brand/icon.svg", type: "image/svg+xml" }],
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const brand = await getBranding();
  const css = brandCss(brand);
  return (
    <html lang={brand.defaultLocale} suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        {/* Branding colors from Admin → Branding (hex-validated, no user HTML). */}
        {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster position="top-center" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
