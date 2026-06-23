"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { formatVnd } from "@/lib/format";

type Vendor = {
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

type Material = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
};

type PurchaseLine = {
  materialId: string;
  quantity: string;
  unitCostMinor: string;
  vatRuleType: string;
};

type CreatedPurchase = {
  id: string;
  subtotalMinor: string;
  vatMinor: string;
  totalMinor: string;
};

type Props = {
  companyId: string;
  vendors: Vendor[];
  periods: Period[];
  materials: Material[];
};

const VAT_RULES = [
  { value: "vat_rate", labelKey: "vat10" },
  { value: "vat_rate_reduced", labelKey: "vat8" },
  { value: "vat_rate_5", labelKey: "vat5" },
  { value: "vat_zero", labelKey: "vat0" },
  { value: "vat_exempt", labelKey: "vatExempt" },
] as const;

const emptyLine = (materialId = ""): PurchaseLine => ({
  materialId,
  quantity: "1",
  unitCostMinor: "0",
  vatRuleType: "vat_rate",
});

export default function PurchaseForm({
  companyId,
  vendors,
  periods,
  materials,
}: Props) {
  const t = useTranslations("purchasing");

  const [partnerId, setPartnerId] = useState(vendors[0]?.id ?? "");
  const [invoiceDate, setInvoiceDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState("");
  const [nonCashPayment, setNonCashPayment] = useState(false);
  const [lines, setLines] = useState<PurchaseLine[]>([
    emptyLine(materials[0]?.id ?? ""),
  ]);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [created, setCreated] = useState<CreatedPurchase | null>(null);

  function updateLine(idx: number, field: keyof PurchaseLine, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(materials[0]?.id ?? "")]);
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
      const res = await api(`/companies/${companyId}/purchase-invoices`, {
        method: "POST",
        body: JSON.stringify({
          partnerId,
          invoiceDate,
          periodId,
          vendorInvoiceNo: vendorInvoiceNo.trim() || undefined,
          nonCashPayment,
          lines: lines.map((l) => ({
            materialId: l.materialId,
            quantity: l.quantity,
            unitCostMinor: l.unitCostMinor,
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
        const inv: CreatedPurchase = await res.json();
        setCreated(inv);
        setStatus("ok");
        setLines([emptyLine(materials[0]?.id ?? "")]);
        setVendorInvoiceNo("");
        setNonCashPayment(false);
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
  const thStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.35rem 0.5rem",
    background: "#f5f5f5",
    fontWeight: "bold",
  };
  const tdStyle: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "0.35rem 0.5rem",
  };

  const noVendorsOrPeriods = vendors.length === 0 || periods.length === 0;
  const noMaterials = materials.length === 0;

  return (
    <div>
      <h2>{t("createPurchase")}</h2>

      {(noVendorsOrPeriods || noMaterials) && (
        <p style={{ color: "#c00" }}>
          {vendors.length === 0 && t("noVendorsYet")}
          {periods.length === 0 && t("noPeriodsYet")}
          {noMaterials && t("noMaterialsYet")}
          {t("createBeforePurchase")}
        </p>
      )}

      {!noVendorsOrPeriods && !noMaterials && (
        <form onSubmit={handleSubmit} style={{ maxWidth: "720px" }}>
          <label style={labelStyle}>
            <span>{t("vendor")}</span>
            <select
              style={inputStyle}
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              required
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
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
            <select
              style={inputStyle}
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              required
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("period")} {p.periodNo} / {p.fiscalYear} ({p.startDate} –{" "}
                  {p.endDate})
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            <span>{t("vendorInvoiceNo")}</span>
            <input
              style={inputStyle}
              value={vendorInvoiceNo}
              onChange={(e) => setVendorInvoiceNo(e.target.value)}
              maxLength={50}
            />
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "row",
              gap: "0.5rem",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <input
              type="checkbox"
              checked={nonCashPayment}
              onChange={(e) => setNonCashPayment(e.target.checked)}
            />
            <span>{t("nonCashPayment")}</span>
          </label>

          {/* Lines */}
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>{t("material")}</strong>
            <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: "0.88em",
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>{t("material")}</th>
                    <th style={thStyle}>{t("quantity")}</th>
                    <th style={thStyle}>{t("unitCost")}</th>
                    <th style={thStyle}>{t("inputVat")}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      <td style={tdStyle}>
                        <select
                          style={{ ...inputStyle, minWidth: "180px" }}
                          value={line.materialId}
                          onChange={(e) =>
                            updateLine(idx, "materialId", e.target.value)
                          }
                          required
                        >
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} — {m.name}
                              {m.unit ? ` (${m.unit})` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: "70px" }}
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(idx, "quantity", e.target.value)
                          }
                          required
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={{ ...inputStyle, width: "130px" }}
                          type="number"
                          min="0"
                          step="1"
                          value={line.unitCostMinor}
                          onChange={(e) =>
                            updateLine(idx, "unitCostMinor", e.target.value)
                          }
                          required
                        />
                      </td>
                      <td style={tdStyle}>
                        <select
                          style={inputStyle}
                          value={line.vatRuleType}
                          onChange={(e) =>
                            updateLine(idx, "vatRuleType", e.target.value)
                          }
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
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            style={{ cursor: "pointer" }}
                          >
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
              style={{
                marginTop: "0.5rem",
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
              }}
            >
              + {t("addLine")}
            </button>
          </div>

          <button
            type="submit"
            disabled={status === "saving"}
            style={{ padding: "0.4rem 1.2rem", cursor: "pointer" }}
          >
            {status === "saving" ? "..." : t("createPurchase")}
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
          <p style={{ margin: 0, fontWeight: "bold", color: "#2a2" }}>
            {t("invoiceIssued")}
          </p>
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
