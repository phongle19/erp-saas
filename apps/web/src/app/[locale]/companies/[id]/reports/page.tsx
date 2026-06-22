import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string; through?: string }>;
};

type Period = {
  periodNo: number;
  fiscalYear: number;
  startDate: string;
  endDate: string;
};

async function fetchPeriods(id: string, fiscalYear: string): Promise<Period[]> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(
      `${base}/companies/${id}/periods?fiscalYear=${fiscalYear}`,
      { headers: { cookie }, cache: "no-store" }
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear, through } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("reports");
  const tCommon = await getTranslations("common");

  const currentYear = new Date().getFullYear();
  const fy = fiscalYear ?? String(currentYear);
  const periods = await fetchPeriods(id, fy);
  const through_ = through ?? (periods.length > 0 ? String(periods[periods.length - 1].periodNo) : "12");

  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  return (
    <div>
      <h1>{t("reports")}</h1>

      {/* Controls */}
      <form method="get" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span>{t("fiscalYear")}</span>
          <select name="fiscalYear" defaultValue={fy} style={{ padding: "0.4rem" }}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span>{t("throughPeriod")}</span>
          <select name="through" defaultValue={through_} style={{ padding: "0.4rem" }}>
            {periods.length > 0
              ? periods.map((p) => (
                  <option key={p.periodNo} value={String(p.periodNo)}>
                    {t("throughPeriod")} {p.periodNo} ({p.startDate} – {p.endDate})
                  </option>
                ))
              : Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {t("throughPeriod")} {i + 1}
                  </option>
                ))}
          </select>
        </label>
        <button type="submit" style={{ padding: "0.4rem 1rem", cursor: "pointer" }}>
          {tCommon("ok")}
        </button>
      </form>

      {/* Report links */}
      <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem", listStyle: "none", padding: 0 }}>
        <li>
          <Link href={`/${locale}/companies/${id}/reports/trial-balance?fiscalYear=${fy}&through=${through_}`}>
            {t("trialBalance")}
          </Link>
        </li>
        <li>
          <Link href={`/${locale}/companies/${id}/reports/balance-sheet?fiscalYear=${fy}&through=${through_}`}>
            {t("balanceSheet")} (B01-DNN)
          </Link>
        </li>
        <li>
          <Link href={`/${locale}/companies/${id}/reports/income-statement?fiscalYear=${fy}&through=${through_}`}>
            {t("incomeStatement")} (B02-DNN)
          </Link>
        </li>
      </ul>
    </div>
  );
}
