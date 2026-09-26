import Link from "next/link";
import { JsonLd } from "@/components/marketing/json-ld";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/components/marketing/metadata";
import { breadcrumbs, graph } from "@/components/marketing/structured-data";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How Codext GmbH processes personal data for autoseo.codext.de and AutoSEO Cloud: hosting in Germany, Stripe payments, sign-in emails, no tracking, your rights.",
  path: "/privacy",
});

export default function PrivacyPage() {
  const { legal } = site;
  return (
    <>
      <JsonLd data={graph(breadcrumbs([{ name: "Privacy", path: "/privacy" }]))} />
      <LegalPage
        crumb="Privacy"
        title="Privacy policy"
        subtitle="We collect as little personal data as possible. No analytics, no tracking, no advertising cookies."
      >
        <h2>1. Controller</h2>
        <p>The controller within the meaning of the General Data Protection Regulation (GDPR) is:</p>
        <p>
          {legal.name}
          <br />
          {legal.street}, {legal.postalCode} {legal.city}, Germany
          <br />
          Managing director: {legal.managingDirector}
          <br />
          Email: <a href={`mailto:${legal.email}`}>{legal.email}</a> · Phone: {legal.phone}
        </p>

        <h2>2. Scope</h2>
        <p>
          This policy covers the website {site.host} (including its sign-up, login and customer dashboard) and the AutoSEO
          Cloud service. It does not cover self-hosted installations of the open-source AutoSEO software: whoever
          operates such an installation is responsible for the data processed in it.
        </p>

        <h2>3. Hosting and server logs</h2>
        <p>
          The website and all AutoSEO Cloud instances run on servers located in Germany, provided by Hetzner Online GmbH,
          Industriestr. 25, 91710 Gunzenhausen, Germany. We operate and deploy the applications ourselves with the
          open-source platform Coolify on these servers. Hetzner acts as our processor under a data processing
          agreement (Art. 28 GDPR).
        </p>
        <p>
          When you access the website, our servers process technical data that your browser transmits automatically:
          IP address, date and time of the request, requested URL, referrer, HTTP status and user agent. We process this
          data to deliver the website and to keep it secure and stable (Art. 6(1)(f) GDPR). Log data is kept only as long
          as necessary for these purposes.
        </p>

        <h2>4. Cloudflare (DNS and CDN)</h2>
        <p>
          We use Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA, for DNS and as a content delivery
          network and security proxy for {site.host}. Requests to the website pass through Cloudflare&apos;s network,
          which processes your IP address and request data to deliver content and protect against attacks. Customer
          instances under *.{site.host} only use Cloudflare for DNS resolution; their traffic is not proxied. Legal
          basis is our legitimate interest in a secure and fast website (Art. 6(1)(f) GDPR). Cloudflare is certified
          under the EU-U.S. Data Privacy Framework; in addition, the EU Standard Contractual Clauses apply. More
          information:{" "}
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">
            cloudflare.com/privacypolicy
          </a>
          .
        </p>

        <h2>5. Account and magic-link sign-in</h2>
        <p>
          To create an account, you only provide your email address. We send you a one-time sign-in link (magic link)
          instead of using passwords. We store your email address, the instance address you choose, your subscription
          status and security-relevant events (such as sign-ins). This is necessary to provide the service you
          requested (Art. 6(1)(b) GDPR).
        </p>
        <p>
          Transactional emails — sign-in links, provisioning notices and billing messages — are sent through an email
          delivery provider acting as our processor. We do not send newsletters or marketing emails.
        </p>

        <h2>6. Payments via Stripe</h2>
        <p>
          Subscriptions are paid through Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock,
          Dublin, D02 H210, Ireland. When you check out, you enter your payment details directly with Stripe; we never
          see or store full card numbers. Stripe shares with us the information we need for billing and bookkeeping,
          such as name, email, billing address, VAT ID, payment status and the last digits of the payment method. Legal
          bases are the performance of the contract (Art. 6(1)(b) GDPR) and our statutory retention obligations (Art.
          6(1)(c) GDPR). Stripe may process data in the USA; data transfers are covered by the EU-U.S. Data Privacy
          Framework and Standard Contractual Clauses. More information:{" "}
          <a href="https://stripe.com/privacy" target="_blank" rel="noopener">
            stripe.com/privacy
          </a>
          .
        </p>

        <h2>7. Cookies and local storage</h2>
        <p>
          We only use strictly necessary cookies: after you sign in, a session cookie (HttpOnly, Secure) keeps you
          logged in, and short-lived cookies may protect sign-in and checkout flows. Your light or dark mode preference is
          stored in your browser&apos;s local storage and never sent to us. These are exempt from consent under § 25(2)
          TDDDG. We do not use analytics, tracking pixels, advertising cookies or third-party embeds. Fonts are served
          from our own servers.
        </p>

        <h2>8. Data in your AutoSEO Cloud instance</h2>
        <p>
          Each AutoSEO Cloud customer gets an isolated instance with its own database and data volume. For personal
          data that you and your users store or process in your instance (for example team members, clients or tracked
          content), you are the controller and we act as your processor under Art. 28 GDPR. We provide a data
          processing agreement on request — just email <a href={`mailto:${legal.email}`}>{legal.email}</a>.
        </p>
        <p>
          Third-party services that you connect to your instance — such as AI providers, DataForSEO, Google Search
          Console or Google Analytics — receive data according to your configuration and are engaged by you under their
          own terms.
        </p>

        <h2>9. Contacting us</h2>
        <p>
          If you contact us by email, we process your message and contact details to answer your request (Art. 6(1)(b)
          or (f) GDPR) and delete them when they are no longer needed, unless statutory retention obligations apply.
        </p>

        <h2>10. Links to GitHub and other sites</h2>
        <p>
          Our website links to the AutoSEO repository on GitHub and other external sites. No data is transferred to
          these sites until you click a link; after that, the provider&apos;s privacy policy applies.
        </p>

        <h2>11. Retention</h2>
        <p>
          We keep account data for as long as you have an account. After your subscription ends, your instance is
          stopped and its data is deleted after 30 days. Invoices and bookkeeping records are retained for the periods
          required by German commercial and tax law (up to 10 years, § 257 HGB, § 147 AO).
        </p>

        <h2>12. Your rights</h2>
        <p>Under the GDPR, you have the right to:</p>
        <ul>
          <li>access your personal data (Art. 15 GDPR),</li>
          <li>rectification of inaccurate data (Art. 16 GDPR),</li>
          <li>erasure (Art. 17 GDPR) and restriction of processing (Art. 18 GDPR),</li>
          <li>data portability (Art. 20 GDPR),</li>
          <li>object to processing based on legitimate interests (Art. 21 GDPR),</li>
          <li>withdraw any consent you have given, with effect for the future (Art. 7(3) GDPR).</li>
        </ul>
        <p>
          To exercise these rights, email <a href={`mailto:${legal.email}`}>{legal.email}</a>. You also have the right
          to lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), for example the authority
          responsible for us: Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg,
          Lautenschlagerstraße 20, 70173 Stuttgart, Germany.
        </p>

        <h2>13. Security</h2>
        <p>
          All connections are encrypted with TLS. Within AutoSEO, stored secrets are encrypted with AES-256-GCM, and API
          keys and tokens are stored only as hashes. Each Cloud instance runs isolated with its own database.
        </p>

        <h2>14. Changes</h2>
        <p>
          We update this policy when our services or legal requirements change. The current version is always available
          on this page. See also our <Link href="/terms">terms of service</Link> and <Link href="/imprint">imprint</Link>.
        </p>
      </LegalPage>
    </>
  );
}
