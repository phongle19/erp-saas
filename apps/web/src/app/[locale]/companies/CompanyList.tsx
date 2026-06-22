"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";

const REGIMES = [
  { value: "TT200", label: "TT200" },
  { value: "TT133", label: "TT133" },
  { value: "TT75", label: "TT75" },
  { value: "IFRS", label: "IFRS" },
];

export default function CompanyList() {
  const t = useTranslations("companies");
  const [name, setName] = useState("");
  const [regime, setRegime] = useState("TT200");
  const [functionalCurrency] = useState("VND");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const res = await api("/companies", {
      method: "POST",
      body: JSON.stringify({ name, regime, functionalCurrency }),
    });
    if (res.ok) {
      setSuccess(true);
      setName("");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data?.message ?? `Error ${res.status}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 400 }}>
      <label>
        {t("name")}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
        />
      </label>
      <label>
        {t("regime")}
        <select
          value={regime}
          onChange={(e) => setRegime(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
        >
          {REGIMES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </label>
      {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
      {success && <p style={{ color: "green", margin: 0 }}>OK</p>}
      <button type="submit" style={{ padding: "0.5rem", cursor: "pointer" }}>
        {t("create")}
      </button>
    </form>
  );
}
