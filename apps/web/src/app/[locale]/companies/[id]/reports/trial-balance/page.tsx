import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { formatVnd } from "@/lib/format";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string; through?: string }>;
};

type TBRow = {
  accountId: string;
  code: string;
  name: string;
  debit: string;
  credit: string;
  balance: string;
};

type TrialBalance = {
  fiscalYear: number;
  throughPeriodNo: number;
  rows: TBRow[];
  totals: { debit: string; credit: string };
};

async function fetchTrialBalance(
  id: string,
  fiscalYear: string,
  through: string
): Promise<TrialBalance | null> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(
      `${base}/companies/${id}/trial-balance?fiscalYear=${fiscalYear}&through=${through}`,
      { headers: { cookie }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function TrialBalancePage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear, through } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("reports");

  const fy = fiscalYear ?? String(new Date().getFullYear());
  const through_ = through ?? "12";

  const data = await fetchTrialBalance(id, fy, through_);

  const tdStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    textAlign: "right",
  };
  const tdLeftStyle: React.CSSProperties = { ...tdStyle, textAlign: "left" };
  const thStyle: React.CSSProperties = {
    ...tdStyle,
    background: "#f5f5f5",
    fontWeight: "bold",
  };
  const thLeftStyle: React.CSSProperties = { ...thStyle, textAlign: "left" };

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/reports?fiscalYear=${fy}&through=${through_}`}>
          ← {t("reports")}
        </Link>
      </p>
      <h1>{t("trialBalance")}</h1>
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        {t("fiscalYear")}: {fy} — {t("throughPeriod")}: {through_}
      </p>

      {!data || data.rows.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>{t("noData")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9em" }}>
            <thead>
              <tr>
                <th style={thLeftStyle}>{t("code")}</th>
                <th style={thLeftStyle}>{t("account")}</th>
                <th style={thStyle}>{t("debit")}</th>
                <th style={thStyle}>{t("credit")}</th>
                <th style={thStyle}>{t("balance")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.accountId}>
                  <td style={tdLeftStyle}>{row.code}</td>
                  <td style={tdLeftStyle}>{row.name}</td>
                  <td style={tdStyle}>{formatVnd(row.debit)}</td>
                  <td style={tdStyle}>{formatVnd(row.credit)}</td>
                  <td style={tdStyle}>{formatVnd(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: "bold", background: "#f5f5f5" }}>
                <td style={tdLeftStyle} colSpan={2}>{t("total")}</td>
                <td style={tdStyle}>{formatVnd(data.totals.debit)}</td>
                <td style={tdStyle}>{formatVnd(data.totals.credit)}</td>
                <td style={tdStyle}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
