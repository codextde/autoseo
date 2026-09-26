import Link from "next/link";
import { JsonLd } from "@/components/marketing/json-ld";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/components/marketing/metadata";
import { breadcrumbs, graph } from "@/components/marketing/structured-data";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "Terms of service for AutoSEO Cloud by Codext GmbH: managed instances at $50/month via Stripe, monthly cancellation, acceptable use, data export and liability.",
  path: "/terms",
});

export default function TermsPage() {
  const { legal } = site;
  const price = `USD ${site.priceMonthlyUsd}`;
  return (
    <>
      <JsonLd data={graph(breadcrumbs([{ name: "Terms", path: "/terms" }]))} />
      <LegalPage
        crumb="Terms"
        title="Terms of service"
        subtitle="The terms for AutoSEO Cloud subscriptions. The open-source software itself is licensed under the MIT license."
      >
        <h2>1. Scope</h2>
        <p>
          These terms govern the AutoSEO Cloud service (the &ldquo;Service&rdquo;) provided by {legal.name},{" "}
          {legal.street}, {legal.postalCode} {legal.city}, Germany (&ldquo;we&rdquo;, &ldquo;us&rdquo;), to you (the
          &ldquo;Customer&rdquo;) via {site.host}. The Service is offered exclusively to businesses within the meaning
          of § 14 BGB, not to consumers. Conflicting or supplementary terms of the Customer do not apply unless we agree
          to them in writing.
        </p>

        <h2>2. The Service</h2>
        <p>
          We provide the Customer with a private, managed instance of the open-source AutoSEO software, reachable at a
          subdomain of {site.host} chosen by the Customer. The Service includes hosting of the instance with its own
          isolated database, TLS certificates, preconfigured email delivery for the instance, software updates, and
          support by email. The scope of features is that of the current AutoSEO release; features may change as the
          software evolves.
        </p>
        <p>
          The AutoSEO software is licensed under the MIT license. These terms do not restrict any rights granted by
          that license; they govern the hosting and management service only.
        </p>

        <h2>3. Account and contract</h2>
        <p>
          The Customer creates an account with an email address and signs in via one-time sign-in links. The contract
          for a subscription is concluded when the Customer completes checkout. The Customer must provide accurate
          information, keep access to their email account and instance secure, and is responsible for all activity
          under their account and instance, including users they invite.
        </p>

        <h2>4. Fees and payment</h2>
        <p>
          The fee is {price} per instance per month, plus VAT where applicable. Fees are billed monthly in advance and
          processed by our payment provider Stripe. Invoices are provided electronically. If a payment fails, we will
          notify the Customer and may suspend the instance if the amount remains unpaid. We may change prices with at
          least 30 days&apos; notice by email; the Customer may cancel before the change takes effect.
        </p>

        <h2>5. Term and cancellation</h2>
        <p>
          Subscriptions run month to month and renew automatically. The Customer can cancel at any time in the customer
          dashboard; cancellation takes effect at the end of the current billing period. Fees already paid for the
          current period are not refunded. We may terminate with 30 days&apos; notice to the end of a billing period.
          The right of both parties to terminate for good cause remains unaffected.
        </p>

        <h2>6. Third-party services, API keys and costs</h2>
        <p>
          AI features and SEO data depend on third-party services that the Customer connects to their instance, for
          example AI provider API keys, local Claude Code or Codex agents, DataForSEO, and Google accounts. The Customer
          is responsible for obtaining these services, for keeping their credentials secure, for complying with the
          providers&apos; terms, and for all costs they charge. Spend limits in AutoSEO are a convenience and do not
          guarantee that third-party costs cannot exceed them. We are not responsible for the availability, results or
          pricing of third-party services.
        </p>

        <h2>7. Acceptable use</h2>
        <p>The Customer shall not use the Service to:</p>
        <ul>
          <li>violate applicable law or the rights of third parties;</li>
          <li>send spam or unsolicited communications;</li>
          <li>store or distribute malicious code, or attack, probe or overload our or third-party systems;</li>
          <li>circumvent the isolation, limits or security measures of the Service;</li>
          <li>use third-party services connected to the instance in breach of their terms.</li>
        </ul>
        <p>
          We may suspend an instance if there are concrete indications of a violation or a threat to the security or
          stability of the Service, and will inform the Customer without undue delay.
        </p>

        <h2>8. Customer data, export and deletion</h2>
        <p>
          All data in the Customer&apos;s instance remains the Customer&apos;s. Where we process personal data on the
          Customer&apos;s behalf, we do so as a processor under Art. 28 GDPR; a data processing agreement is available on
          request. The Customer can export data at any time using the export features of the software, and we provide a
          full export of the instance database and data volume on request.
        </p>
        <p>
          When the subscription ends, the instance is stopped. We keep its data for 30 days so the Customer can
          resubscribe or request an export; afterwards the instance and all its data are permanently deleted.
        </p>

        <h2>9. Availability and support</h2>
        <p>
          We operate the Service with care and aim for high availability, but provide it on a best-effort basis without
          a guaranteed service level. Maintenance, updates and events beyond our control may cause interruptions; we try
          to schedule planned maintenance at times of low usage. Support is provided by email at{" "}
          <a href={`mailto:${legal.email}`}>{legal.email}</a>.
        </p>

        <h2>10. Liability</h2>
        <p>
          We are liable without limitation for intent and gross negligence, for injury to life, body or health, and
          under the German Product Liability Act. For slight negligence, we are liable only for breaches of essential
          contractual obligations (obligations whose fulfilment makes proper performance of the contract possible in the
          first place and on which the Customer may regularly rely), limited to the damage that is typical and
          foreseeable for this type of contract. Otherwise, our liability is excluded. These limitations also apply to
          our employees, representatives and agents.
        </p>

        <h2>11. Changes to these terms</h2>
        <p>
          We may amend these terms with effect for the future. We will inform the Customer of changes by email at least
          30 days before they take effect. If the Customer does not object before the effective date, the changes are
          deemed accepted; we will point out this consequence in our notice. If the Customer objects, either party may
          terminate the subscription as of the effective date.
        </p>

        <h2>12. Governing law and jurisdiction</h2>
        <p>
          These terms are governed by the laws of the Federal Republic of Germany, excluding the UN Convention on
          Contracts for the International Sale of Goods. If the Customer is a merchant, a legal entity under public law
          or a special fund under public law, the exclusive place of jurisdiction is our registered office. Should any
          provision of these terms be invalid, the validity of the remaining provisions is not affected.
        </p>
        <p>
          See also our <Link href="/privacy">privacy policy</Link> and <Link href="/imprint">imprint</Link>.
        </p>
      </LegalPage>
    </>
  );
}
