import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { getSetting } from "@/server/settings";
import { magicLinkEmail } from "@/server/email/templates";
import { appUrl } from "@/server/email";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { EmailSettings } from "@/features/admin/components/email-settings";

export const metadata = { title: "Email · Admin" };

export default async function AdminEmailPage() {
  const ctx = await requireAdmin();
  const [smtp, auth] = await Promise.all([getAdminSettings("smtp"), getSetting("auth")]);
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
      <EmailSettings smtp={smtp} adminEmail={ctx.user.email} previewHtml={preview.html} />
    </AdminPage>
  );
}
