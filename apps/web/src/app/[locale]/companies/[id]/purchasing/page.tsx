import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function PurchasingPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("purchasing");

  const tdStyle: React.CSSProperties = { padding: "0.5rem 0" };

  return (
    <div>
      <h1>{t("purchasing")}</h1>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/purchasing/materials`}>
            {t("materials")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/purchasing/inventory`}>
            {t("inventory")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/purchasing/purchases`}>
            {t("purchases")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/purchasing/ap`}>
            {t("ap")}
          </Link>
        </li>
        <li style={tdStyle}>
          <Link href={`/${locale}/companies/${id}/purchasing/goods-issues`}>
            {t("goodsIssues")}
          </Link>
        </li>
      </ul>
    </div>
  );
}
