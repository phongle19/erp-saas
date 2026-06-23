import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { formatVnd } from "@/lib/format";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

type InventoryRow = {
  materialId: string;
  code: string;
  name: string;
  qty: string;
  value: string;
  avgUnitCost: string;
};

type InventoryData = {
  rows: InventoryRow[];
  totalValue: string;
};

async function fetchInventory(id: string): Promise<InventoryData | null> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(`${base}/companies/${id}/inventory`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function InventoryPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("purchasing");

  const data = await fetchInventory(id);

  const thStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    background: "#f5f5f5",
    fontWeight: "bold",
    textAlign: "left",
  };
  const thRightStyle: React.CSSProperties = {
    ...thStyle,
    textAlign: "right",
  };
  const tdStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.4rem 0.6rem",
    textAlign: "left",
  };
  const tdRightStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right",
  };

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/purchasing`}>
          ← {t("purchasing")}
        </Link>
      </p>
      <h1>{t("inventory")}</h1>

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
                <th style={thStyle}>{t("name")}</th>
                <th style={thRightStyle}>{t("onHand")}</th>
                <th style={thRightStyle}>{t("value")} (₫)</th>
                <th style={thRightStyle}>{t("avgCost")} (₫)</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.materialId}>
                  <td style={tdStyle}>{row.code}</td>
                  <td style={tdStyle}>{row.name}</td>
                  <td style={tdRightStyle}>{row.qty}</td>
                  <td style={tdRightStyle}>{formatVnd(row.value)}</td>
                  <td style={tdRightStyle}>{formatVnd(row.avgUnitCost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: "bold", background: "#f5f5f5" }}>
                <td style={tdStyle} colSpan={3}>
                  {t("totalValue")}
                </td>
                <td style={tdRightStyle}>{formatVnd(data.totalValue)}</td>
                <td style={tdStyle}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
