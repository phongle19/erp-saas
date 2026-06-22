import { getTranslations, setRequestLocale } from "next-intl/server";
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
    const res = await fetch(
      `${process.env.API_URL ?? "http://localhost:3001"}/companies`,
      { credentials: "include", cache: "no-store" }
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function CompaniesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("companies");
  const companies = await fetchCompanies();

  return (
    <div>
      <h1>{t("list")}</h1>
      {companies.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {companies.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong> — {c.regime} ({c.functionalCurrency})
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
