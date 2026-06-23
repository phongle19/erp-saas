import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EInvoiceProvider, EInvoiceIssueDoc, EInvoiceIssueResult } from '../provider.interface.js';

/**
 * MISA e-invoice provider stub.
 *
 * Phase 2a: no live network calls. Returns deterministic fake results with a
 * 'MISA-' prefix on the providerCode so tests can assert provider selection.
 *
 * In production, this would call MISA's e-invoice API (Circular 78/2021/TT-BTC
 * technical standard). Decree 123/2020/ND-CP Art. 14 designates MISA as an
 * authorised e-invoice service provider.
 *
 * Provider tag: 'MISA-' (MISA).
 */
@Injectable()
export class MisaStubProvider implements EInvoiceProvider {
  readonly id = 'misa' as const;

  async issue(doc: EInvoiceIssueDoc): Promise<EInvoiceIssueResult> {
    const token = randomBytes(6).toString('hex');
    const providerCode = `MISA-${token}`;
    const soHoaDon = `MISA${randomBytes(4).toString('hex').toUpperCase()}`;
    const gdtMessageId = `GDT-MISA-${randomBytes(8).toString('hex')}`;

    void doc;

    return {
      providerCode,
      soHoaDon,
      status: 'issued',
      gdtMessageId,
    };
  }

  async cancel(providerCode: string): Promise<{ status: 'cancelled' }> {
    void providerCode;
    return { status: 'cancelled' };
  }
}
