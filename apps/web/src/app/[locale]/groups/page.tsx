import { getTranslations, setRequestLocale } from "next-intl/server";
import GroupForm from "./GroupForm";

type Props = {
  params: Promise<{ locale: string }>;
};

type Group = {
  id: string;
  name: string;
  type: string;
  reportingCurrency: string;
};

async function fetchGroups(): Promise<Group[]> {
  try {
    const res = await fetch(
      `${process.env.API_URL ?? "http://localhost:3001"}/groups`,
      { credentials: "include", cache: "no-store" }
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function GroupsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("groups");
  const groups = await fetchGroups();

  const managementGroups = groups.filter((g) => g.type === "MANAGEMENT");
  const statutoryGroups = groups.filter((g) => g.type !== "MANAGEMENT");

  return (
    <div>
      {managementGroups.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2>{t("portfolio")}</h2>
          <ul>
            {managementGroups.map((g) => (
              <li key={g.id}>
                <strong>{g.name}</strong> — {g.reportingCurrency}
              </li>
            ))}
          </ul>
        </section>
      )}

      {statutoryGroups.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <ul>
            {statutoryGroups.map((g) => (
              <li key={g.id}>
                <strong>{g.name}</strong> — {g.type} ({g.reportingCurrency})
              </li>
            ))}
          </ul>
        </section>
      )}

      <hr style={{ margin: "1.5rem 0" }} />
      <h2>{t("create")}</h2>
      <GroupForm />
    </div>
  );
}
