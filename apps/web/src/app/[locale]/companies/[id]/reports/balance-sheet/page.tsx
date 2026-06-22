import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { formatVnd } from "@/lib/format";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string; through?: string }>;
};

type StatementLine = {
  code: string;
  label_vi: string;
  level: number;
  amount: string;
};

type Statement = {
  id: string;
  title_vi: string;
  lines: StatementLine[];
};

async function fetchStatement(
  id: string,
  fiscalYear: string,
  through: string
): Promise<Statement | null> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(
      `${base}/companies/${id}/statements/balance-sheet?fiscalYear=${fiscalYear}&through=${through}`,
      { headers: { cookie }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function BalanceSheetPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear, through } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("reports");

  const fy = fiscalYear ?? String(new Date().getFullYear());
  const through_ = through ?? "12";

  const data = await fetchStatement(id, fy, through_);

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/reports?fiscalYear=${fy}&through=${through_}`}>
          ← {t("reports")}
        </Link>
      </p>
      <h1>{t("balanceSheet")} (B01-DNN)</h1>
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        {t("fiscalYear")}: {fy} — {t("throughPeriod")}: {through_}
      </p>

      {!data || data.lines.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>{t("noData")}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9em" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", background: "#f5f5f5", textAlign: "left" }}>
                {t("code")}
              </th>
              <th style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", background: "#f5f5f5", textAlign: "left" }}>
                {data.title_vi}
              </th>
              <th style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", background: "#f5f5f5", textAlign: "right" }}>
                {t("balance")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => (
              <tr key={i} style={{ fontWeight: line.level === 0 ? "bold" : undefined }}>
                <td style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {line.code}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", paddingLeft: `${0.6 + line.level * 1.2}rem` }}>
                  {line.label_vi}
                </td>
                <td style={{ border: "1px solid #ccc", padding: "0.4rem 0.6rem", textAlign: "right" }}>
                  {line.amount != null ? formatVnd(line.amount) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
