import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import PurchaseForm from "./PurchaseForm";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ fiscalYear?: string }>;
};

type Partner = {
  id: string;
  code: string;
  name: string;
  partnerType: string | null;
};

type Period = {
  id: string;
  periodNo: number;
  fiscalYear: number;
  startDate: string;
  endDate: string;
};

type Material = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
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

export default async function PurchasesPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { fiscalYear } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("purchasing");

  const fy = fiscalYear ?? String(new Date().getFullYear());

  const [allPartners, periods, materials] = await Promise.all([
    fetchPartners(id),
    fetchPeriods(id, fy),
    fetchMaterials(id),
  ]);

  // Filter to vendors only (partnerType vendor or both)
  const vendors = allPartners.filter(
    (p) => p.partnerType === "vendor" || p.partnerType === "both"
  );

  const years = Array.from({ length: 5 }, (_, i) =>
    String(new Date().getFullYear() - i)
  );

  return (
    <div>
      <p>
        <Link href={`/${locale}/companies/${id}/purchasing`}>
          ← {t("purchasing")}
        </Link>
      </p>
      <h1>{t("purchases")}</h1>

      {/* Note: no list-purchase-invoices endpoint — create here + view AP for balances */}
      <p style={{ color: "#666", fontSize: "0.9em" }}>
        {t.rich("purchaseListNote", {
          link: (chunks) => (
            <Link href={`/${locale}/companies/${id}/purchasing/ap?fiscalYear=${fy}`}>
              {chunks}
            </Link>
          ),
        })}
      </p>

      {/* Fiscal year selector (affects period list) */}
      <form
        method="get"
        style={{
          marginBottom: "1rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span>{t("fiscalYear")}</span>
          <select
            name="fiscalYear"
            defaultValue={fy}
            style={{ padding: "0.35rem" }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{ padding: "0.35rem 0.8rem", cursor: "pointer" }}
        >
          OK
        </button>
      </form>

      <PurchaseForm
        companyId={id}
        vendors={vendors}
        periods={periods}
        materials={materials}
      />
    </div>
  );
}
