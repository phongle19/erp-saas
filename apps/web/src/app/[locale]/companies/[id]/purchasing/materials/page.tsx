import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import MaterialForm from "./MaterialForm";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

type Material = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  inventoryAccountCode: string | null;
};

async function fetchMaterials(id: string): Promise<Material[]> {
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const base = process.env.API_URL ?? "http://localhost:3001";
    const res = await fetch(`${base}/companies/${id}/materials`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function MaterialsPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("purchasing");

  const materials = await fetchMaterials(id);

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
        <Link href={`/${locale}/companies/${id}/purchasing`}>
          ← {t("purchasing")}
        </Link>
      </p>
      <h1>{t("materials")}</h1>

      {materials.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic" }}>{t("noData")}</p>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
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
                <th style={thStyle}>{t("unit")}</th>
                <th style={thStyle}>{t("inventoryAccount")}</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle}>{m.code}</td>
                  <td style={tdStyle}>{m.name}</td>
                  <td style={tdStyle}>{m.unit ?? "—"}</td>
                  <td style={tdStyle}>{m.inventoryAccountCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "1.5rem 0" }} />
      <MaterialForm companyId={id} />
    </div>
  );
}
