import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import CustomerForm from "./CustomerForm";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

type Partner = {
  id: string;
  code: string;
  name: string;
  taxCode: string | null;
  partnerType: string | null;
};

async function fetchPartners(id: string): Promise<Partner[]> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(`${base}/companies/${id}/partners`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function CustomersPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sales");

  const partners = await fetchPartners(id);

  const thStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    background: "#f5f5f5",
    fontWeight: "bold",
    textAlign: "left",
  };
  const tdStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    textAlign: "left",
  };

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/sales`}>← {t("sales")}</Link>
      </p>
      <h1>{t("customers")}</h1>

      {partners.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>{t("noData")}</p>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9em" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("code")}</th>
                <th style={thStyle}>{t("name")}</th>
                <th style={thStyle}>{t("taxCode")}</th>
                <th style={thStyle}>{t("partnerType")}</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.code}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.taxCode ?? "—"}</td>
                  <td style={tdStyle}>{p.partnerType ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "1.5rem 0" }} />
      <CustomerForm companyId={id} />
    </div>
  );
}
