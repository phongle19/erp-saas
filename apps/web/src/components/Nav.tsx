"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

export default function Nav() {
  const t = useTranslations();
  const params = useParams();
  const locale = params.locale as string;
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push(`/${locale}/login`);
  }

  return (
    <nav
      style={{
        display: "flex",
        gap: "1rem",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid #ccc",
        alignItems: "center",
      }}
    >
      <strong>{t("app.title")}</strong>
      <Link href={`/${locale}/companies`}>{t("nav.companies")}</Link>
      <Link href={`/${locale}/groups`}>{t("nav.groups")}</Link>
      <button
        onClick={handleLogout}
        style={{ marginLeft: "auto", cursor: "pointer" }}
      >
        {t("auth.logout")}
      </button>
    </nav>
  );
}
