/**
 * GDT-shaped e-invoice issuance document types.
 *
 * Statutory basis:
 *   - Decree 123/2020/ND-CP (e-invoice framework)
 *   - Decree 70/2025/ND-CP (amendments to 123/2020)
 *   - Circular 78/2021/TT-BTC (e-invoice implementation guidance)
 *
 * These types represent the data shape required for electronic invoice issuance.
 * Real mẫu số / ký hiệu values are assigned by the provider/GDT portal at registration;
 * the stubs use placeholder values as noted in the service.
 */

export interface EInvoiceIssueItem {
  /** Line item description (tên hàng hóa, dịch vụ). */
  description: string;
  /** Quantity (số lượng) — bigint serialized as string on wire. */
  quantity: string;
  /** Unit price before VAT, minor units (đơn giá) — bigint as string. */
  unitPrice: string;
  /** Net line amount before VAT, minor units (thành tiền chưa thuế) — bigint as string. */
  lineNet: string;
  /** VAT rate percent, e.g. 10, 8, 5, 0. */
  vatRatePct: number;
  /** VAT amount, minor units (tiền thuế GTGT) — bigint as string. */
  vatAmount: string;
}

export interface EInvoiceSeller {
  /** Mã số thuế người bán (Seller Tax Code / MST). */
  mst: string;
  /** Tên doanh nghiệp người bán. */
  name: string;
  /** Địa chỉ người bán. */
  address: string;
}

export interface EInvoiceBuyer {
  /** Mã số thuế người mua (Buyer Tax Code / MST). May be empty for consumers. */
  mst: string;
  /** Tên người mua. */
  name: string;
  /** Địa chỉ người mua. */
  address: string;
}

/**
 * GDT-shaped issuance document (Decree 123/2020/ND-CP, Circular 78/2021/TT-BTC).
 * Sent to the provider's issuance endpoint (or stub) for signing + submission to GDT.
 */
export interface EInvoiceIssueDoc {
  seller: EInvoiceSeller;
  buyer: EInvoiceBuyer;
  /** Mẫu số — form code per Circular 78/2021/TT-BTC, Annex I. */
  mauSo: string;
  /**
   * Ký hiệu — serial symbol identifying the invoice series.
   * Real values come from provider registration with GDT. Stub uses placeholder.
   */
  kyHieu: string;
  /** ISO 4217 currency code (e.g. 'VND'). */
  currency: string;
  items: EInvoiceIssueItem[];
  /** Sum of all lineNet amounts, minor units — bigint as string. */
  subtotal: string;
  /** Total VAT, minor units — bigint as string. */
  vat: string;
  /** Grand total (subtotal + vat), minor units — bigint as string. */
  total: string;
}

/** Result returned by a provider after issuance. */
export interface EInvoiceIssueResult {
  /** Provider-specific transaction/document code (e.g. 'VT-abc123'). */
  providerCode: string;
  /**
   * Số hóa đơn (invoice serial number) assigned by the provider.
   * Under Decree 123/2020/ND-CP Art. 10, the số hóa đơn is a sequential number.
   */
  soHoaDon: string;
  status: 'issued' | 'failed';
  /** GDT portal message ID for traceability. */
  gdtMessageId?: string;
}
