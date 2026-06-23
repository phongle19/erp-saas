import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { getRegimeConfig } from "@erp/config-regimes";
import CompanyList from "./CompanyList";

type Props = {
  params: Promise<{ locale: string }>;
};

type Company = {
  id: string;
  name: string;
  regime: string;
  functionalCurrency: string;
};

async function fetchCompanies(): Promise<Company[]> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(`${base}/companies`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function safeRegimeLabel(regime: string): string {
  try {
    return getRegimeConfig(regime as Parameters<typeof getRegimeConfig>[0]).label;
  } catch {
    return regime;
  }
}

export default async function CompaniesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("companies");
  const tReports = await getTranslations("reports");
  const companies = await fetchCompanies();

  return (
    <div>
      <h1>{t("list")}</h1>
      {companies.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {companies.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.5rem" }}>
              <strong>{c.name}</strong> — {safeRegimeLabel(c.regime)} ({c.functionalCurrency}){" "}
              <Link href={`/${locale}/companies/${c.id}/reports`}>
                [{tReports("reports")}]
              </Link>
            </li>
          ))}
        </ul>
      )}
      <hr style={{ margin: "1.5rem 0" }} />
      <h2>{t("create")}</h2>
      <CompanyList />
    </div>
  );
}
