import { describe, it, expect } from 'vitest';
import { getStatementTemplates } from './registry.js';
import type { StatementTemplate, StatementLine } from './types.js';

describe('Statement Templates — Circular 133', () => {
  const templates = getStatementTemplates('circular_133');
  const ids = templates.map(t => t.id);

  it('has both B01-DNN and B02-DNN templates', () => {
    expect(ids).toContain('B01-DNN');
    expect(ids).toContain('B02-DNN');
  });

  it('each template has a non-empty Vietnamese title', () => {
    for (const t of templates) {
      expect(t.title_vi.trim().length, `empty title on ${t.id}`).toBeGreaterThan(0);
    }
  });

  it('each template has at least one line', () => {
    for (const t of templates) {
      expect(t.lines.length, `${t.id} has no lines`).toBeGreaterThan(0);
    }
  });

  for (const template of [undefined]) {
    // placeholder — per-template checks below
    void template;
  }

  function getTemplate(id: StatementTemplate['id']): StatementTemplate {
    const t = templates.find(x => x.id === id);
    if (!t) throw new Error(`template ${id} not found`);
    return t;
  }

  // ── B01-DNN checks ──
  describe('B01-DNN (Balance Sheet)', () => {
    const bs = getTemplate('B01-DNN');
    const lineByCode = new Map(bs.lines.map(l => [l.code, l]));

    it('line codes are unique within the template', () => {
      expect(lineByCode.size).toBe(bs.lines.length);
    });

    it('every line has a non-empty Vietnamese label', () => {
      for (const l of bs.lines) {
        expect(l.label_vi.trim().length, `empty label on line ${l.code}`).toBeGreaterThan(0);
      }
    });

    it('every line has a numeric level >= 0', () => {
      for (const l of bs.lines) {
        expect(l.level, `negative level on ${l.code}`).toBeGreaterThanOrEqual(0);
      }
    });

    it('every subtotalOf child code exists in the template', () => {
      for (const l of bs.lines) {
        if (l.subtotalOf) {
          for (const child of l.subtotalOf) {
            // Allow _neg suffix convention for sign-flip helpers; strip it
            const base = child.replace(/_neg$/, '');
            expect(lineByCode.has(base), `subtotalOf child '${child}' (base '${base}') not found in B01-DNN`).toBe(true);
          }
        }
      }
    });

    it('every non-subtotal leaf line has accounts', () => {
      for (const l of bs.lines) {
        if (!l.subtotalOf) {
          expect(l.accounts, `leaf line ${l.code} missing accounts`).toBeDefined();
          expect(l.accounts!.prefixes.length, `line ${l.code} has no prefixes`).toBeGreaterThan(0);
        }
      }
    });

    it('has an asset total line (TOTAL_A or similar)', () => {
      const totalA = bs.lines.find(l => l.code === 'TOTAL_A' || l.label_vi.includes('TỔNG CỘNG TÀI SẢN'));
      expect(totalA, 'no TỔNG CỘNG TÀI SẢN line found').toBeDefined();
    });

    it('has a liabilities+equity total line (TOTAL_B or similar)', () => {
      const totalB = bs.lines.find(l => l.code === 'TOTAL_B' || l.label_vi.includes('TỔNG CỘNG NGUỒN VỐN'));
      expect(totalB, 'no TỔNG CỘNG NGUỒN VỐN line found').toBeDefined();
    });

    it('has an asset section (A or A.I)', () => {
      const assetSection = bs.lines.find(l => l.code === 'A' || l.code === 'A.I');
      expect(assetSection).toBeDefined();
    });

    it('has a liability section (B.I)', () => {
      const liabSection = bs.lines.find(l => l.code === 'B.I');
      expect(liabSection).toBeDefined();
    });

    it('has an equity section (B.II)', () => {
      const eqSection = bs.lines.find(l => l.code === 'B.II');
      expect(eqSection).toBeDefined();
    });
  });

  // ── B02-DNN checks ──
  describe('B02-DNN (Income Statement)', () => {
    const is = getTemplate('B02-DNN');
    const lineByCode = new Map(is.lines.map(l => [l.code, l]));

    it('line codes are unique within the template', () => {
      expect(lineByCode.size).toBe(is.lines.length);
    });

    it('every line has a non-empty Vietnamese label', () => {
      for (const l of is.lines) {
        expect(l.label_vi.trim().length, `empty label on line ${l.code}`).toBeGreaterThan(0);
      }
    });

    it('every subtotalOf child code exists in the template (stripping _neg)', () => {
      for (const l of is.lines) {
        if (l.subtotalOf) {
          for (const child of l.subtotalOf) {
            const base = child.replace(/_neg$/, '');
            expect(lineByCode.has(base), `subtotalOf child '${child}' (base '${base}') not found in B02-DNN`).toBe(true);
          }
        }
      }
    });

    it('every non-subtotal leaf line has accounts', () => {
      for (const l of is.lines) {
        if (!l.subtotalOf) {
          expect(l.accounts, `leaf line ${l.code} missing accounts`).toBeDefined();
          expect(l.accounts!.prefixes.length, `line ${l.code} has no prefixes`).toBeGreaterThan(0);
        }
      }
    });

    it('has revenue line 01 (Doanh thu bán hàng)', () => {
      expect(lineByCode.has('01'), 'missing line 01').toBe(true);
      expect(lineByCode.get('01')!.accounts?.prefixes).toContain('511');
    });

    it('has COGS line 11 (Giá vốn hàng bán)', () => {
      expect(lineByCode.has('11'), 'missing line 11').toBe(true);
    });

    it('has profit-after-tax line 60', () => {
      expect(lineByCode.has('60'), 'missing line 60 (lợi nhuận sau thuế)').toBe(true);
      const l60 = lineByCode.get('60') as StatementLine;
      expect(l60.subtotalOf, 'line 60 should be a subtotal').toBeDefined();
    });

    it('has CIT expense lines 51 and/or 52', () => {
      const hasCIT = lineByCode.has('51') || lineByCode.has('52');
      expect(hasCIT, 'no CIT expense line found').toBe(true);
    });
  });
});

describe('getStatementTemplates — unknown regime', () => {
  it('throws on unknown regime', () => {
    // @ts-expect-error testing runtime guard
    expect(() => getStatementTemplates('circular_999')).toThrow(/unknown regime/i);
  });
});
