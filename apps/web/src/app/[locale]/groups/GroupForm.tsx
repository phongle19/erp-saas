"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";

const GROUP_TYPES = [
  { value: "STATUTORY", label: "STATUTORY" },
  { value: "MANAGEMENT", label: "MANAGEMENT" },
];

export default function GroupForm() {
  const t = useTranslations("groups");
  const [name, setName] = useState("");
  const [type, setType] = useState("STATUTORY");
  const [reportingCurrency] = useState("VND");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const res = await api("/groups", {
      method: "POST",
      body: JSON.stringify({ name, type, reportingCurrency }),
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
        {t("type")}
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
        >
          {GROUP_TYPES.map((gt) => (
            <option key={gt.value} value={gt.value}>{gt.label}</option>
          ))}
        </select>
      </label>
      <label>
        — {/* name label from create key */}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder={t("create")}
          style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
        />
      </label>
      {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
      {success && <p style={{ color: "green", margin: 0 }}>OK</p>}
      <button type="submit" style={{ padding: "0.5rem", cursor: "pointer" }}>
        {t("create")}
      </button>
    </form>
  );
}
