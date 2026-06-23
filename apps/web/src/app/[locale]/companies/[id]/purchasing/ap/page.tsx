import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { formatVnd } from "@/lib/format";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string; through?: string }>;
};

type ApVendorRow = {
  partnerCode: string | null;
  partnerName: string | null;
  debit: string;
  credit: string;
  balance: string;
};

type ApData = {
  rows: ApVendorRow[];
  total: string;
};

async function fetchAp(
  id: string,
  fiscalYear: string,
  through: string
): Promise<ApData | null> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(
      `${base}/companies/${id}/ap?fiscalYear=${fiscalYear}&through=${through}`,
      { headers: { cookie }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function ApPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear, through } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("purchasing");

  const currentYear = new Date().getFullYear();
  const fy = fiscalYear ?? String(currentYear);
  const through_ = through ?? "12";

  const data = await fetchAp(id, fy, through_);

  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1));

  const thStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    background: "#f5f5f5",
    fontWeight: "bold",
    textAlign: "left",
  };
  const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
  const tdStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    textAlign: "left",
  };
  const tdRightStyle: React.CSSProperties = { ...tdStyle, textAlign: "right" };

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/purchasing`}>
          ← {t("purchasing")}
        </Link>
      </p>
      <h1>{t("ap")}</h1>
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        {t("fiscalYear")}: {fy} — {t("throughPeriod")}: {through_}
      </p>

      {/* Controls */}
      <form
        method="get"
        style={{
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
          alignItems: "flex-end",
        }}
      >
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <span>{t("fiscalYear")}</span>
          <select
            name="fiscalYear"
            defaultValue={fy}
            style={{ padding: "0.4rem" }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
        >
          <span>{t("throughPeriod")}</span>
          <select
            name="through"
            defaultValue={through_}
            style={{ padding: "0.4rem" }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {t("throughPeriod")} {m}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{ padding: "0.4rem 1rem", cursor: "pointer" }}
        >
          OK
        </button>
      </form>

      {!data || data.rows?.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>{t("noData")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: "0.9em",
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>{t("code")}</th>
                <th style={thStyle}>{t("vendor")}</th>
                <th style={thRightStyle}>{t("debit")}</th>
                <th style={thRightStyle}>{t("credit")}</th>
                <th style={thRightStyle}>{t("balance")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, idx) => (
                <tr key={row.partnerCode ?? idx}>
                  <td style={tdStyle}>{row.partnerCode ?? "—"}</td>
                  <td style={tdStyle}>
                    {row.partnerName ?? t("unknownVendor")}
                  </td>
                  <td style={tdRightStyle}>{formatVnd(row.debit)}</td>
                  <td style={tdRightStyle}>{formatVnd(row.credit)}</td>
                  <td style={tdRightStyle}>{formatVnd(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: "bold", background: "#f5f5f5" }}>
                <td style={tdStyle} colSpan={2}>
                  {t("totalValue")}
                </td>
                <td style={tdRightStyle}></td>
                <td style={tdRightStyle}></td>
                <td style={tdRightStyle}>{formatVnd(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
