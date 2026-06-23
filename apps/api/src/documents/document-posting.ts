import { Injectable } from '@nestjs/common';
import {
  PostingEngineService,
  type PostInput,
  type ReverseOptions,
} from '../accounting/posting-engine.service.js';

export interface PostDocumentResult {
  /** The id of the posted journal entry; store on the document row. */
  journalEntryId: string;
}

export interface ReverseDocumentResult {
  /** The id of the newly-created reversing journal entry. */
  reversalEntryId: string;
}

/**
 * Thin helper that document services (sales invoices, receipts, etc.) use for
 * the post→store-journalEntryId and cancel→reverse patterns, so those two
 * operations live in one tested place rather than being duplicated across A5/A6.
 *
 * Delegates entirely to PostingEngineService; the engine owns all GL invariants
 * (balance check, period check, draft→posted sequence, immutability).
 *
 * Partner-awareness flows through transparently: callers set `partnerId` on
 * individual lines in `PostInput`; the engine writes it to `journal_lines` and
 * preserves it on reversals automatically.
 */
@Injectable()
export class DocumentPostingService {
  constructor(private readonly engine: PostingEngineService) {}

  /**
   * Post a document to the GL.
   * Returns the `journalEntryId` the caller should store on its document row.
   */
  async postDocument(input: PostInput): Promise<PostDocumentResult> {
    const entry = await this.engine.post(input);
    return { journalEntryId: entry.id };
  }

  /**
   * Reverse a previously-posted document entry (e.g. on cancellation).
   * Returns the `reversalEntryId` the caller may store on its document row.
   * The engine preserves each line's `partnerId` on the reversal automatically.
   */
  async reverseDocument(
    journalEntryId: string,
    opts?: ReverseOptions,
  ): Promise<ReverseDocumentResult> {
    const reversal = await this.engine.reverse(journalEntryId, opts);
    return { reversalEntryId: reversal.id };
  }
}
