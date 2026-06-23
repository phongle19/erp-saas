import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ViettelStubProvider } from './providers/viettel.stub.js';
import { VnptStubProvider } from './providers/vnpt.stub.js';
import { MisaStubProvider } from './providers/misa.stub.js';
import type { EInvoiceProvider } from './provider.interface.js';

type ProviderId = 'viettel' | 'vnpt' | 'misa';

/**
 * Registry that maps a provider id (matching the einvoice_provider DB enum)
 * to the corresponding provider implementation.
 *
 * The company's `einvoice_provider` column selects which provider handles
 * issuance; the registry dispatches to that provider. Swapping a stub for a
 * live implementation requires only replacing the entry here — no service or
 * controller changes needed.
 *
 * Decree 123/2020/ND-CP Art. 14: taxpayers may choose from GDT-authorised
 * e-invoice service providers.
 */
@Injectable()
export class EInvoiceProviderRegistry {
  private readonly providers: Map<ProviderId, EInvoiceProvider>;

  constructor(
    viettel: ViettelStubProvider,
    vnpt: VnptStubProvider,
    misa: MisaStubProvider,
  ) {
    this.providers = new Map<ProviderId, EInvoiceProvider>([
      ['viettel', viettel],
      ['vnpt', vnpt],
      ['misa', misa],
    ]);
  }

  /**
   * Retrieve the provider by id.
   * @throws InternalServerErrorException if the id is not registered (should
   *         never happen if the DB enum and this registry stay in sync).
   */
  getProvider(id: ProviderId): EInvoiceProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new InternalServerErrorException(
        `e-invoice provider '${id}' is not registered`,
      );
    }
    return provider;
  }
}
