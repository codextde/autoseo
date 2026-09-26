import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { getSetting } from "@/server/settings";
import { magicLinkEmail } from "@/server/email/templates";
import { appUrl, usesDefaultMailServer } from "@/server/email";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { EmailSettings } from "@/features/admin/components/email-settings";

export const metadata = { title: "Email · Admin" };

export default async function AdminEmailPage() {
  const ctx = await requireAdmin();
  const [smtp, auth, platformDefault] = await Promise.all([getAdminSettings("smtp"), getSetting("auth"), usesDefaultMailServer()]);
  const preview = await magicLinkEmail({
    url: appUrl("/auth/verify?token=preview"),
    code: "428913",
    minutes: auth.magicLinkMinutes,
    ip: "203.0.113.7",
    userAgent: "Chrome on macOS",
  });
  return (
    <AdminPage
      title="Email"
      description="Delivery for magic sign-in links and invitations. Works with Amazon SES or any SMTP server."
    >
      {platformDefault && (
        <Alert className="mb-4">
          <AlertDescription>
            Email already works: this instance sends through the default mail server configured by your hosting
            platform. Enable your own SMTP server below only if you want to send from your own domain.
          </AlertDescription>
        </Alert>
      )}
      <EmailSettings smtp={smtp} adminEmail={ctx.user.email} previewHtml={preview.html} />
    </AdminPage>
  );
}
