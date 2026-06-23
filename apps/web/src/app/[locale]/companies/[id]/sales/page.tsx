import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function SalesPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sales");

  const tdStyle: React.CSSProperties = { padding: "0.5rem 0" };

  return (
    <div>
      <h1>{t("sales")}</h1>
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/sales/customers`}>
            {t("customers")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/sales/invoices`}>
            {t("invoices")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/sales/ar`}>
            {t("ar")}
          </Link>
        </li>
      </ul>
    </div>
  );
}
