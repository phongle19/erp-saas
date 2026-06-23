"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

type Props = { companyId: string };

const INVENTORY_ACCOUNTS = ["156", "152"] as const;

export default function MaterialForm({ companyId }: Props) {
  const t = useTranslations("purchasing");
  const tCommon = useTranslations("common");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [inventoryAccountCode, setInventoryAccountCode] = useState<
    "156" | "152"
  >("156");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await api(`/companies/${companyId}/materials`, {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          unit: unit.trim() || undefined,
          inventoryAccountCode,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorMsg(data?.message ?? `HTTP ${res.status}`);
        setStatus("error");
      } else {
        setStatus("ok");
        setCode("");
        setName("");
        setUnit("");
        setInventoryAccountCode("156");
      }
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: "0.4rem",
    width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    marginBottom: "0.75rem",
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "420px" }}>
      <h2>{t("createMaterial")}</h2>
      <label style={labelStyle}>
        <span>{t("code")}</span>
        <input
          style={inputStyle}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          maxLength={50}
        />
      </label>
      <label style={labelStyle}>
        <span>{t("name")}</span>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        <span>{t("unit")}</span>
        <input
          style={inputStyle}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          maxLength={20}
        />
      </label>
      <label style={labelStyle}>
        <span>{t("inventoryAccount")}</span>
        <select
          style={inputStyle}
          value={inventoryAccountCode}
          onChange={(e) =>
            setInventoryAccountCode(e.target.value as "156" | "152")
          }
        >
          {INVENTORY_ACCOUNTS.map((acc) => (
            <option key={acc} value={acc}>
              {acc}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={status === "saving"}
        style={{ padding: "0.4rem 1.2rem", cursor: "pointer" }}
      >
        {status === "saving" ? "..." : t("createMaterial")}
      </button>
      {status === "ok" && (
        <p style={{ color: "green", marginTop: "0.5rem" }}>
          {tCommon("saved")}
        </p>
      )}
      {status === "error" && (
        <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMsg}</p>
      )}
    </form>
  );
}
