import Link from "next/link";
import { Compass, Home, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBranding } from "@/server/branding";
import { BackButton, StatusScreen } from "@/features/admin/components/system-status-screen";

export const metadata = { title: "Page not found" };

export default async function NotFound() {
  const brand = await getBranding();
  return (
    <StatusScreen
      code="404"
      icon={<Compass className="size-5" />}
      brand={{ appName: brand.appName, logoUrl: brand.logoUrl }}
      title="This page doesn't exist"
      description="The link may be broken, the project may have been archived, or you may not have access to it."
      actions={
        <>
          <BackButton />
          <Button asChild size="lg" className="h-10 px-4">
            <Link href="/">
              <Home className="size-4" /> Go to dashboard
            </Link>
          </Button>
        </>
      }
      footer={
        brand.supportEmail ? (
          <a href={`mailto:${brand.supportEmail}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
            <Mail className="size-3.5" /> Need help? {brand.supportEmail}
          </a>
        ) : null
      }
    />
  );
}
