import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

type Props = {
  params: Promise<{ locale: string }>;
};

// Locale index (e.g. `/vi`, `/en`). The app has no dashboard yet, so the
// natural entry point is the login screen. Without this page the locale root
// 404s, which means the root redirect (`/` -> `/vi`) lands on a 404.
export default async function LocaleIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(`/${locale}/login`);
}
