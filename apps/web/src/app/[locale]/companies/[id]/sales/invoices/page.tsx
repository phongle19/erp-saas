import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import InvoiceForm from "./InvoiceForm";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string }>;
};

type Partner = {
  id: string;
  code: string;
  name: string;
};

type Period = {
  id: string;
  periodNo: number;
  fiscalYear: number;
  startDate: string;
  endDate: string;
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

export default async function InvoicesPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("sales");

  const fy = fiscalYear ?? String(new Date().getFullYear());

  const [partners, periods] = await Promise.all([
    fetchPartners(id),
    fetchPeriods(id, fy),
  ]);

  const years = Array.from({ length: 5 }, (_, i) =>
    String(new Date().getFullYear() - i)
  );

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/sales`}>← {t("sales")}</Link>
      </p>
      <h1>{t("invoices")}</h1>

      {/* Note: no list-invoices endpoint exists yet — create + view AR for balances */}
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        Danh sách hóa đơn: xem{" "}
        <Link href={`/${locale}/companies/${id}/sales/ar?fiscalYear=${fy}`}>
          {t("ar")}
        </Link>{" "}
        để tra số dư phải thu.
      </p>

      {/* Fiscal year selector (affects period list) */}
      <form method="get" style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span>{t("fiscalYear")}</span>
          <select name="fiscalYear" defaultValue={fy} style={{ padding: "0.35rem" }}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={{ padding: "0.35rem 0.8rem", cursor: "pointer" }}>
          OK
        </button>
      </form>

      <InvoiceForm
        companyId={id}
        partners={partners}
        periods={periods}
      />
    </div>
  );
}
