"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

type Props = { companyId: string };

export default function CustomerForm({ companyId }: Props) {
  const t = useTranslations("sales");
  const tCommon = useTranslations("common");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [partnerType, setPartnerType] = useState<"customer" | "vendor" | "both">("customer");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await api(`/companies/${companyId}/partners`, {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          taxCode: taxCode.trim() || undefined,
          partnerType,
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
        setTaxCode("");
        setPartnerType("customer");
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
      <h2>{t("createCustomer")}</h2>
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
        <span>{t("taxCode")}</span>
        <input
          style={inputStyle}
          value={taxCode}
          onChange={(e) => setTaxCode(e.target.value)}
          maxLength={20}
        />
      </label>
      <label style={labelStyle}>
        <span>{t("partnerType")}</span>
        <select
          style={inputStyle}
          value={partnerType}
          onChange={(e) => setPartnerType(e.target.value as "customer" | "vendor" | "both")}
        >
          <option value="customer">{t("partnerCustomer")}</option>
          <option value="vendor">{t("partnerVendor")}</option>
          <option value="both">{t("partnerBoth")}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={status === "saving"}
        style={{ padding: "0.4rem 1.2rem", cursor: "pointer" }}
      >
        {status === "saving" ? "..." : t("createCustomer")}
      </button>
      {status === "ok" && (
        <p style={{ color: "green", marginTop: "0.5rem" }}>{tCommon("saved")}</p>
      )}
      {status === "error" && (
        <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMsg}</p>
      )}
    </form>
  );
}
