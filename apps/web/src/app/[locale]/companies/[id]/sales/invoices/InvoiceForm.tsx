"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { formatVnd } from "@/lib/format";

type Partner = {
  id: string;
  code: string;
  name: string;
};

type Period = {
  id: string;
  periodNo: number;
  fiscalYear: number;
  startDate: string;
  endDate: string;
};

type InvoiceLine = {
  description: string;
  quantity: string;
  unitPriceMinor: string;
  vatRuleType: string;
};

type CreatedInvoice = {
  id: string;
  invoiceNo: string | null;
  subtotalMinor: string;
  vatMinor: string;
  totalMinor: string;
};

type Props = {
  companyId: string;
  partners: Partner[];
  periods: Period[];
};

const VAT_RULES = [
  { value: "vat_rate", labelKey: "vat10" },
  { value: "vat_rate_reduced", labelKey: "vat8" },
  { value: "vat_rate_5", labelKey: "vat5" },
  { value: "vat_zero", labelKey: "vat0" },
  { value: "vat_exempt", labelKey: "vatExempt" },
] as const;

const emptyLine = (): InvoiceLine => ({
  description: "",
  quantity: "1",
  unitPriceMinor: "0",
  vatRuleType: "vat_rate",
});

export default function InvoiceForm({ companyId, partners, periods }: Props) {
  const t = useTranslations("sales");

  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  const [invoiceDate, setInvoiceDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([emptyLine()]);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [created, setCreated] = useState<CreatedInvoice | null>(null);

  function updateLine(idx: number, field: keyof InvoiceLine, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerId || !periodId) return;
    setStatus("saving");
    setErrorMsg("");
    setCreated(null);
    try {
      const res = await api(`/companies/${companyId}/sales-invoices`, {
        method: "POST",
        body: JSON.stringify({
          partnerId,
          invoiceDate,
          periodId,
          description: description.trim() || undefined,
          lines: lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            vatRuleType: l.vatRuleType,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          typeof data?.message === "string"
            ? data.message
            : JSON.stringify(data?.message ?? `HTTP ${res.status}`);
        setErrorMsg(msg);
        setStatus("error");
      } else {
        const inv: CreatedInvoice = await res.json();
        setCreated(inv);
        setStatus("ok");
        setLines([emptyLine()]);
        setDescription("");
      }
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  }

  const inputStyle: React.CSSProperties = { padding: "0.4rem", width: "100%", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" };
  const thStyle: React.CSSProperties = { border: "1px solid #ccc", padding: "0.35rem 0.5rem", background: "#f5f5f5", fontWeight: "bold" };
  const tdStyle: React.CSSProperties = { border: "1px solid #ccc", padding: "0.35rem 0.5rem" };

  const noPartnersOrPeriods = partners.length === 0 || periods.length === 0;

  return (
    <div>
      <h2>{t("createInvoice")}</h2>

      {noPartnersOrPeriods && (
        <p style={{ color: "#c00" }}>
          {partners.length === 0 && t("noCustomersYet")}
          {periods.length === 0 && t("noPeriodsYet")}
          {t("createBeforeInvoice")}
        </p>
      )}

      {!noPartnersOrPeriods && (
        <form onSubmit={handleSubmit} style={{ maxWidth: "680px" }}>
          <label style={labelStyle}>
            <span>{t("customer")}</span>
            <select style={inputStyle} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span>{t("invoiceDate")}</span>
            <input
              type="date"
              style={inputStyle}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
            />
          </label>

          <label style={labelStyle}>
            <span>{t("period")}</span>
            <select style={inputStyle} value={periodId} onChange={(e) => setPeriodId(e.target.value)} required>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("period")} {p.periodNo} / {p.fiscalYear} ({p.startDate} – {p.endDate})
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span>{t("invoiceDesc")}</span>
            <input
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={255}
            />
          </label>

          {/* Lines */}
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>{t("lineDescription")}</strong>
            <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.88em" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("lineDescription")}</th>
                    <th style={thStyle}>{t("quantity")}</th>
                    <th style={thStyle}>{t("unitPrice")} (đ)</th>
                    <th style={thStyle}>{t("vatRate")}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, minWidth: "160px" }}
                          value={line.description}
                          onChange={(e) => updateLine(idx, "description", e.target.value)}
                          required
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: "70px" }}
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                          required
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: "120px" }}
                          type="number"
                          min="0"
                          step="1"
                          value={line.unitPriceMinor}
                          onChange={(e) => updateLine(idx, "unitPriceMinor", e.target.value)}
                          required
                        />
                      </td>
                      <td style={tdStyle}>
                        <select
                          style={inputStyle}
                          value={line.vatRuleType}
                          onChange={(e) => updateLine(idx, "vatRuleType", e.target.value)}
                        >
                          {VAT_RULES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {t(r.labelKey)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(idx)} style={{ cursor: "pointer" }}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addLine}
              style={{ marginTop: "0.5rem", padding: "0.3rem 0.8rem", cursor: "pointer" }}
            >
              + {t("addLine")}
            </button>
          </div>

          <button
            type="submit"
            disabled={status === "saving"}
            style={{ padding: "0.4rem 1.2rem", cursor: "pointer" }}
          >
            {status === "saving" ? "..." : t("createInvoice")}
          </button>

          {status === "error" && (
            <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMsg}</p>
          )}
        </form>
      )}

      {/* Created invoice summary */}
      {created && (
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            border: "1px solid #4a4",
            borderRadius: "4px",
            maxWidth: "420px",
          }}
        >
          <p style={{ margin: 0, fontWeight: "bold", color: "#2a2" }}>{t("invoiceIssued")}</p>
          {created.invoiceNo && (
            <p style={{ margin: "0.25rem 0" }}>{t("invoiceNoLabel")}{created.invoiceNo}</p>
          )}
          <p style={{ margin: "0.25rem 0" }}>
            {t("subtotal")}: {formatVnd(created.subtotalMinor)}
          </p>
          <p style={{ margin: "0.25rem 0" }}>
            {t("vat")}: {formatVnd(created.vatMinor)}
          </p>
          <p style={{ margin: "0.25rem 0", fontWeight: "bold" }}>
            {t("total")}: {formatVnd(created.totalMinor)}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85em", color: "#666" }}>
            ID: {created.id}
          </p>
        </div>
      )}
    </div>
  );
}
