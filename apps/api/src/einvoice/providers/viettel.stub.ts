import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EInvoiceProvider, EInvoiceIssueDoc, EInvoiceIssueResult } from '../provider.interface.js';

/**
 * Viettel e-invoice provider stub.
 *
 * Phase 2a: no live network calls. Returns deterministic fake results with a
 * 'VT-' prefix on the providerCode so tests can assert provider selection.
 *
 * In production, this would call Viettel's HEIN API (Circular 78/2021/TT-BTC
 * technical standard). Decree 123/2020/ND-CP Art. 14 designates Viettel as an
 * authorised e-invoice service provider.
 *
 * Provider tag: 'VT-' (Viettel).
 */
@Injectable()
export class ViettelStubProvider implements EInvoiceProvider {
  readonly id = 'viettel' as const;

  async issue(doc: EInvoiceIssueDoc): Promise<EInvoiceIssueResult> {
    const token = randomBytes(6).toString('hex');
    const providerCode = `VT-${token}`;
    // Số hóa đơn: derived from the seller MST + a random suffix (stub-only).
    // Real providers assign a sequential number from the registered series.
    const soHoaDon = `VT${randomBytes(4).toString('hex').toUpperCase()}`;
    const gdtMessageId = `GDT-VT-${randomBytes(8).toString('hex')}`;

    // Suppress unused-variable lint: doc is required by the interface for
    // real implementations that build the SOAP/REST payload from it.
    void doc;

    return {
      providerCode,
      soHoaDon,
      status: 'issued',
      gdtMessageId,
    };
  }

  async cancel(providerCode: string): Promise<{ status: 'cancelled' }> {
    // Stub: acknowledge immediately. Real impl would call Viettel's cancellation API.
    void providerCode;
    return { status: 'cancelled' };
  }
}
