import type { EInvoiceIssueDoc, EInvoiceIssueResult } from './einvoice.types.js';

export type { EInvoiceIssueDoc, EInvoiceIssueResult };

/**
 * Pluggable e-invoice provider interface.
 *
 * Statutory basis:
 *   - Decree 123/2020/ND-CP Art. 14–19: provider (tổ chức cung cấp dịch vụ) obligations
 *   - Decree 70/2025/ND-CP: amendments to provider rules
 *   - Circular 78/2021/TT-BTC: technical standards for provider API integration
 *
 * Phase 2a: all implementations are stubs (no live network). The provider is
 * SELECTABLE per company via companies.einvoice_provider; the registry dispatches
 * to the correct stub, proving the selection mechanism works without a live API.
 */
export interface EInvoiceProvider {
  /** Provider identifier — matches the einvoice_provider DB enum. */
  readonly id: 'viettel' | 'vnpt' | 'misa';

  /**
   * Issue an e-invoice.
   *
   * In production this calls the provider's SOAP/REST API to sign + submit the
   * GDT-shaped document. The stub returns a deterministic fake result.
   *
   * @param doc  GDT-shaped issuance document (Circular 78/2021/TT-BTC Annex II).
   * @returns    Provider code, số hóa đơn, status, optional GDT message ID.
   */
  issue(doc: EInvoiceIssueDoc): Promise<EInvoiceIssueResult>;

  /**
   * Cancel an issued e-invoice.
   *
   * Under Decree 123/2020/ND-CP Art. 19, cancellation must be reported to GDT
   * within the prescribed period. The stub acknowledges immediately.
   *
   * @param providerCode  The code returned by issue(), used to identify the invoice.
   */
  cancel(providerCode: string): Promise<{ status: 'cancelled' }>;
}
