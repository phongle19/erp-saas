"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { formatVnd } from "@/lib/format";

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

type IssueLine = {
  materialId: string;
  quantity: string;
};

type CreatedIssue = {
  id: string;
  cogsMinor: string;
};

type Props = {
  companyId: string;
  periods: Period[];
  materials: Material[];
};

const REASONS = [
  { value: "production", labelKey: "reasonProduction" },
  { value: "spoilage", labelKey: "reasonSpoilage" },
  { value: "internal", labelKey: "reasonInternal" },
  { value: "other", labelKey: "reasonOther" },
] as const;

const emptyLine = (materialId = ""): IssueLine => ({
  materialId,
  quantity: "1",
});

export default function GoodsIssueForm({ companyId, periods, materials }: Props) {
  const t = useTranslations("purchasing");

  const [issueDate, setIssueDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [reason, setReason] = useState<string>("production");
  const [lines, setLines] = useState<IssueLine[]>([
    emptyLine(materials[0]?.id ?? ""),
  ]);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [created, setCreated] = useState<CreatedIssue | null>(null);

  function updateLine(idx: number, field: keyof IssueLine, value: string) {
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
    if (!periodId) return;
    setStatus("saving");
    setErrorMsg("");
    setCreated(null);
    try {
      const res = await api(`/companies/${companyId}/goods-issues`, {
        method: "POST",
        body: JSON.stringify({
          issueDate,
          periodId,
          reason,
          lines: lines.map((l) => ({
            materialId: l.materialId,
            quantity: l.quantity,
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
        const issue: CreatedIssue = await res.json();
        setCreated(issue);
        setStatus("ok");
        setLines([emptyLine(materials[0]?.id ?? "")]);
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

  const noPeriodsOrMaterials = periods.length === 0 || materials.length === 0;

  return (
    <div>
      <h2>{t("createGoodsIssue")}</h2>

      {noPeriodsOrMaterials && (
        <p style={{ color: "#c00" }}>
          {periods.length === 0 && t("noPeriodsYet")}
          {materials.length === 0 && t("noMaterialsYet")}
          {t("createBeforeIssue")}
        </p>
      )}

      {!noPeriodsOrMaterials && (
        <form onSubmit={handleSubmit} style={{ maxWidth: "640px" }}>
          <label style={labelStyle}>
            <span>{t("issueDate")}</span>
            <input
              type="date"
              style={inputStyle}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
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
            <span>{t("reason")}</span>
            <select
              style={inputStyle}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
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
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx}>
                      <td style={tdStyle}>
                        <select
                          style={{ ...inputStyle, minWidth: "200px" }}
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
                          style={{ ...inputStyle, width: "80px" }}
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
            {status === "saving" ? "..." : t("createGoodsIssue")}
          </button>

          {status === "error" && (
            <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMsg}</p>
          )}
        </form>
      )}

      {/* Created goods issue summary */}
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
            {t("issueDone")}
          </p>
          <p style={{ margin: "0.25rem 0", fontWeight: "bold" }}>
            {t("cogsLabel")}: {formatVnd(created.cogsMinor)}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85em", color: "#666" }}>
            ID: {created.id}
          </p>
        </div>
      )}
    </div>
  );
}
