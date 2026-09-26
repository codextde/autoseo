import { JsonLd } from "@/components/marketing/json-ld";
import { LegalPage } from "@/components/marketing/legal-page";
import { pageMetadata } from "@/components/marketing/metadata";
import { breadcrumbs, graph } from "@/components/marketing/structured-data";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Imprint (Impressum)",
  description:
    "Legal notice (Impressum) for AutoSEO and autoseo.codext.de: Codext GmbH, Wolpertshausen, Germany — managing director, commercial register, VAT ID and contact.",
  path: "/imprint",
});

export default function ImprintPage() {
  const { legal } = site;
  return (
    <>
      <JsonLd data={graph(breadcrumbs([{ name: "Imprint", path: "/imprint" }]))} />
      <LegalPage crumb="Imprint" title="Imprint (Impressum)" subtitle="Legal notice for autoseo.codext.de and AutoSEO Cloud.">
        <h2>Angaben gemäß § 5 DDG / Information pursuant to § 5 DDG</h2>
        <p>
          {legal.name}
          <br />
          {legal.street}
          <br />
          {legal.postalCode} {legal.city}
          <br />
          {legal.country}
        </p>

        <h2>Vertreten durch / Represented by</h2>
        <p>Geschäftsführer / Managing director: {legal.managingDirector}</p>

        <h2>Kontakt / Contact</h2>
        <p>
          Telefon / Phone: <a href={`tel:${legal.phone.replace(/\s+/g, "")}`}>{legal.phone}</a>
          <br />
          E-Mail / Email: <a href={`mailto:${legal.email}`}>{legal.email}</a>
        </p>

        <h2>Registereintrag / Commercial register</h2>
        <p>
          Registergericht / Register court: {legal.registerCourt}
          <br />
          Registernummer / Register number: {legal.registerNumber}
        </p>

        <h2>Umsatzsteuer-ID / VAT ID</h2>
        <p>
          Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz / VAT identification number pursuant to § 27a
          UStG: {legal.vatId}
        </p>

        <h2>Verantwortlich für den Inhalt / Responsible for content</h2>
        <p>
          Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV / Responsible for content pursuant to § 18 (2) MStV:
          <br />
          {legal.managingDirector}, {legal.street}, {legal.postalCode} {legal.city}
        </p>

        <h2>Geschäftskunden / Business customers</h2>
        <p>
          Unsere Angebote richten sich ausschließlich an Unternehmer im Sinne von § 14 BGB, nicht an Verbraucher.
          <br />
          Our offers are directed exclusively at businesses within the meaning of § 14 BGB, not at consumers.
        </p>
      </LegalPage>
    </>
  );
}
