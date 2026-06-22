/**
 * Mẫu báo cáo tài chính theo Thông tư 133/2016/TT-BTC
 *
 * Source: Circular 133/2016/TT-BTC, Phụ lục 2 — Hệ thống báo cáo tài chính
 *   B01-DNN: Báo cáo tình hình tài chính (Balance Sheet)
 *   B02-DNN: Báo cáo kết quả hoạt động kinh doanh (Income Statement)
 *
 * VERIFY: line codes, Vietnamese labels, account mappings, and structure must be
 * verified against the official B01-DNN and B02-DNN form templates published in
 * Circular 133/2016/TT-BTC before production use.  See docs/open-questions.md.
 *
 * StatementLine rules:
 *  - leaf lines have `accounts` (prefix match + nature)
 *  - subtotal lines have `subtotalOf` (sum of listed codes)
 *  - level: 0 = section header, 1 = major group, 2 = line item, 3 = sub-line
 *
 * nature:
 *  'debit'  → take debit-side net balance (normal for assets, expenses)
 *  'credit' → take credit-side net balance (normal for liabilities, equity, revenue)
 */

import type { StatementTemplate } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// B01-DNN: Báo cáo tình hình tài chính (Balance Sheet)
// Circular 133/2016/TT-BTC, Phụ lục 2, Mẫu số B01-DNN
// ─────────────────────────────────────────────────────────────────────────────
const b01: StatementTemplate = {
  id: 'B01-DNN',
  title_vi: 'Báo cáo tình hình tài chính',

  lines: [
    // ═══════════════════════════════════════════════════════════════
    // PHẦN A: TÀI SẢN
    // ═══════════════════════════════════════════════════════════════
    { code: 'A',    label_vi: 'TÀI SẢN',                                                      level: 0, subtotalOf: ['A.I', 'A.II'] },

    // ── I. Tài sản ngắn hạn ──
    { code: 'A.I',  label_vi: 'I. Tài sản ngắn hạn',                                         level: 1, subtotalOf: ['A.I.1','A.I.2','A.I.3','A.I.4','A.I.5','A.I.6'] },

    { code: 'A.I.1',  label_vi: '1. Tiền và các khoản tương đương tiền',                     level: 2, accounts: { prefixes: ['111','112'], nature: 'debit' } },

    { code: 'A.I.2',  label_vi: '2. Các khoản đầu tư tài chính ngắn hạn',                   level: 2, subtotalOf: ['A.I.2a','A.I.2b'] },
    { code: 'A.I.2a', label_vi: '  - Chứng khoán kinh doanh',                               level: 3, accounts: { prefixes: ['121'], nature: 'debit' } },
    { code: 'A.I.2b', label_vi: '  - Đầu tư nắm giữ đến ngày đáo hạn',                     level: 3, accounts: { prefixes: ['128'], nature: 'debit' } },

    { code: 'A.I.3',  label_vi: '3. Các khoản phải thu ngắn hạn',                           level: 2, subtotalOf: ['A.I.3a','A.I.3b','A.I.3c','A.I.3d'] },
    { code: 'A.I.3a', label_vi: '  - Phải thu của khách hàng',                              level: 3, accounts: { prefixes: ['131'], nature: 'debit' } },
    { code: 'A.I.3b', label_vi: '  - Trả trước cho người bán ngắn hạn',                    level: 3, accounts: { prefixes: ['331'], nature: 'debit' } }, // debit balance of 331 = prepayment
    { code: 'A.I.3c', label_vi: '  - Phải thu khác',                                        level: 3, accounts: { prefixes: ['138'], nature: 'debit' } },
    { code: 'A.I.3d', label_vi: '  - Dự phòng phải thu khó đòi (*)',                       level: 3, accounts: { prefixes: ['139'], nature: 'credit' } }, // contra: credit balance reduces receivable

    { code: 'A.I.4',  label_vi: '4. Hàng tồn kho',                                          level: 2, subtotalOf: ['A.I.4a','A.I.4b'] },
    { code: 'A.I.4a', label_vi: '  - Hàng tồn kho',                                        level: 3, accounts: { prefixes: ['151','152','153','154','155','156','157','158'], nature: 'debit' } },
    { code: 'A.I.4b', label_vi: '  - Dự phòng giảm giá hàng tồn kho (*)',                 level: 3, accounts: { prefixes: ['2294'], nature: 'credit' } },

    { code: 'A.I.5',  label_vi: '5. Tài sản ngắn hạn khác',                                level: 2, subtotalOf: ['A.I.5a','A.I.5b'] },
    { code: 'A.I.5a', label_vi: '  - Chi phí trả trước ngắn hạn',                          level: 3, accounts: { prefixes: ['242'], nature: 'debit' } },
    { code: 'A.I.5b', label_vi: '  - Thuế GTGT được khấu trừ',                             level: 3, accounts: { prefixes: ['133'], nature: 'debit' } },

    { code: 'A.I.6',  label_vi: '6. Tạm ứng',                                               level: 2, accounts: { prefixes: ['141'], nature: 'debit' } },

    // ── II. Tài sản dài hạn ──
    { code: 'A.II',   label_vi: 'II. Tài sản dài hạn',                                      level: 1, subtotalOf: ['A.II.1','A.II.2','A.II.3','A.II.4','A.II.5'] },

    { code: 'A.II.1', label_vi: '1. Các khoản phải thu dài hạn',                            level: 2, accounts: { prefixes: ['136'], nature: 'debit' } },

    { code: 'A.II.2', label_vi: '2. Tài sản cố định',                                       level: 2, subtotalOf: ['A.II.2a','A.II.2b','A.II.2c','A.II.2d','A.II.2e','A.II.2f'] },
    { code: 'A.II.2a',label_vi: '  - Nguyên giá TSCĐ hữu hình',                            level: 3, accounts: { prefixes: ['211'], nature: 'debit' } },
    { code: 'A.II.2b',label_vi: '  - Hao mòn TSCĐ hữu hình (*)',                           level: 3, accounts: { prefixes: ['2141'], nature: 'credit' } },
    { code: 'A.II.2c',label_vi: '  - Nguyên giá TSCĐ thuê tài chính',                      level: 3, accounts: { prefixes: ['212'], nature: 'debit' } },
    { code: 'A.II.2d',label_vi: '  - Hao mòn TSCĐ thuê tài chính (*)',                     level: 3, accounts: { prefixes: ['2142'], nature: 'credit' } },
    { code: 'A.II.2e',label_vi: '  - Nguyên giá TSCĐ vô hình',                             level: 3, accounts: { prefixes: ['213'], nature: 'debit' } },
    { code: 'A.II.2f',label_vi: '  - Hao mòn TSCĐ vô hình (*)',                            level: 3, accounts: { prefixes: ['2143'], nature: 'credit' } },

    { code: 'A.II.3', label_vi: '3. Bất động sản đầu tư',                                   level: 2, accounts: { prefixes: ['217'], nature: 'debit' } },

    { code: 'A.II.4', label_vi: '4. Đầu tư tài chính dài hạn',                              level: 2, subtotalOf: ['A.II.4a','A.II.4b'] },
    { code: 'A.II.4a',label_vi: '  - Đầu tư góp vốn vào đơn vị khác',                     level: 3, accounts: { prefixes: ['228'], nature: 'debit' } },
    { code: 'A.II.4b',label_vi: '  - Dự phòng tổn thất đầu tư dài hạn (*)',               level: 3, accounts: { prefixes: ['2291','2292'], nature: 'credit' } },

    { code: 'A.II.5', label_vi: '5. Tài sản dài hạn khác',                                  level: 2, subtotalOf: ['A.II.5a','A.II.5b','A.II.5c'] },
    { code: 'A.II.5a',label_vi: '  - Chi phí trả trước dài hạn',                           level: 3, accounts: { prefixes: ['242'], nature: 'debit' } },
    { code: 'A.II.5b',label_vi: '  - Xây dựng cơ bản dở dang',                             level: 3, accounts: { prefixes: ['241'], nature: 'debit' } },
    { code: 'A.II.5c',label_vi: '  - Tài sản thuế thu nhập hoãn lại',                      level: 3, accounts: { prefixes: ['243'], nature: 'debit' } },

    // ── TỔNG TÀI SẢN ──
    { code: 'TOTAL_A', label_vi: 'TỔNG CỘNG TÀI SẢN',                                      level: 0, subtotalOf: ['A'] },

    // ═══════════════════════════════════════════════════════════════
    // PHẦN B: NGUỒN VỐN (LIABILITIES + EQUITY)
    // ═══════════════════════════════════════════════════════════════
    { code: 'B',      label_vi: 'NGUỒN VỐN',                                                level: 0, subtotalOf: ['B.I', 'B.II'] },

    // ── I. Nợ phải trả ──
    { code: 'B.I',    label_vi: 'I. Nợ phải trả',                                           level: 1, subtotalOf: ['B.I.1','B.I.2','B.I.3','B.I.4','B.I.5','B.I.6'] },

    { code: 'B.I.1',  label_vi: '1. Phải trả cho người bán ngắn hạn',                      level: 2, accounts: { prefixes: ['331'], nature: 'credit' } },

    { code: 'B.I.2',  label_vi: '2. Người mua trả tiền trước',                              level: 2, accounts: { prefixes: ['131'], nature: 'credit' } }, // credit balance of 131 = advance from customer

    { code: 'B.I.3',  label_vi: '3. Thuế và các khoản phải nộp Nhà nước',                  level: 2, accounts: { prefixes: ['333'], nature: 'credit' } },

    { code: 'B.I.4',  label_vi: '4. Phải trả người lao động',                              level: 2, accounts: { prefixes: ['334'], nature: 'credit' } },

    { code: 'B.I.5',  label_vi: '5. Chi phí phải trả và phải trả khác',                    level: 2, accounts: { prefixes: ['335','336','337','338'], nature: 'credit' } },

    { code: 'B.I.6',  label_vi: '6. Vay và nợ thuê tài chính',                              level: 2, accounts: { prefixes: ['341'], nature: 'credit' } },

    // ── II. Vốn chủ sở hữu ──
    { code: 'B.II',   label_vi: 'II. Vốn chủ sở hữu',                                      level: 1, subtotalOf: ['B.II.1','B.II.2','B.II.3','B.II.4','B.II.5'] },

    { code: 'B.II.1', label_vi: '1. Vốn đầu tư của chủ sở hữu',                            level: 2, accounts: { prefixes: ['411'], nature: 'credit' } },

    { code: 'B.II.2', label_vi: '2. Cổ phiếu quỹ (*)',                                     level: 2, accounts: { prefixes: ['419'], nature: 'debit' } }, // contra-equity debit balance

    { code: 'B.II.3', label_vi: '3. Chênh lệch tỷ giá hối đoái',                           level: 2, accounts: { prefixes: ['413'], nature: 'credit' } },

    { code: 'B.II.4', label_vi: '4. Các quỹ thuộc vốn chủ sở hữu',                         level: 2, accounts: { prefixes: ['418'], nature: 'credit' } },

    { code: 'B.II.5', label_vi: '5. Lợi nhuận sau thuế chưa phân phối',                    level: 2, accounts: { prefixes: ['421'], nature: 'credit' } },

    // ── TỔNG NGUỒN VỐN ──
    { code: 'TOTAL_B', label_vi: 'TỔNG CỘNG NGUỒN VỐN',                                    level: 0, subtotalOf: ['B'] },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// B02-DNN: Báo cáo kết quả hoạt động kinh doanh (Income Statement)
// Circular 133/2016/TT-BTC, Phụ lục 2, Mẫu số B02-DNN
// ─────────────────────────────────────────────────────────────────────────────
const b02: StatementTemplate = {
  id: 'B02-DNN',
  title_vi: 'Báo cáo kết quả hoạt động kinh doanh',

  lines: [
    // ── 1. Doanh thu bán hàng và cung cấp dịch vụ ──
    {
      code: '01', label_vi: '1. Doanh thu bán hàng và cung cấp dịch vụ',
      level: 1,
      accounts: { prefixes: ['511'], nature: 'credit' },
    },

    // ── 2. Các khoản giảm trừ doanh thu ──
    {
      code: '02', label_vi: '2. Các khoản giảm trừ doanh thu',
      level: 1,
      accounts: { prefixes: ['521'], nature: 'debit' },
    },

    // ── 10. Doanh thu thuần ──
    {
      code: '10', label_vi: '10. Doanh thu thuần về bán hàng và cung cấp dịch vụ (10 = 01 - 02)',
      level: 1,
      subtotalOf: ['01', '02_neg'],
    },
    // helper line: negate 02 so subtotal works correctly (02 is debit; subtract from 01)
    // Implementation note: the rendering engine must negate 'debit' lines when computing subtotals
    // of revenue sections; or the engine can treat 02 as already negative.
    // We express it with a direct formula: 10 = 01 - 02.
    // For simplicity the subtotalOf mechanism here expects the engine to handle sign conventions.

    // ── 11. Giá vốn hàng bán ──
    {
      code: '11', label_vi: '11. Giá vốn hàng bán',
      level: 1,
      accounts: { prefixes: ['632','631','611'], nature: 'debit' },
    },

    // ── 20. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ ──
    {
      code: '20', label_vi: '20. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ (20 = 10 - 11)',
      level: 1,
      subtotalOf: ['10', '11_neg'],
    },

    // ── 21. Doanh thu hoạt động tài chính ──
    {
      code: '21', label_vi: '21. Doanh thu hoạt động tài chính',
      level: 1,
      accounts: { prefixes: ['515'], nature: 'credit' },
    },

    // ── 22. Chi phí tài chính ──
    {
      code: '22', label_vi: '22. Chi phí tài chính',
      level: 1,
      accounts: { prefixes: ['635'], nature: 'debit' },
    },
    {
      code: '23', label_vi: '   Trong đó: Chi phí lãi vay',
      level: 2,
      accounts: { prefixes: ['635'], nature: 'debit' }, // sub-detail; same source
    },

    // ── 25. Chi phí quản lý kinh doanh ──
    {
      code: '25', label_vi: '25. Chi phí bán hàng',
      level: 1,
      accounts: { prefixes: ['641'], nature: 'debit' },
    },
    {
      code: '26', label_vi: '26. Chi phí quản lý kinh doanh',
      level: 1,
      accounts: { prefixes: ['642'], nature: 'debit' },
    },

    // ── 30. Lợi nhuận thuần từ hoạt động kinh doanh ──
    {
      code: '30', label_vi: '30. Lợi nhuận thuần từ hoạt động kinh doanh (30 = 20 + 21 - 22 - 25 - 26)',
      level: 1,
      subtotalOf: ['20', '21', '22_neg', '25_neg', '26_neg'],
    },

    // ── 31. Thu nhập khác ──
    {
      code: '31', label_vi: '31. Thu nhập khác',
      level: 1,
      accounts: { prefixes: ['711'], nature: 'credit' },
    },

    // ── 32. Chi phí khác ──
    {
      code: '32', label_vi: '32. Chi phí khác',
      level: 1,
      accounts: { prefixes: ['811'], nature: 'debit' },
    },

    // ── 40. Lợi nhuận khác ──
    {
      code: '40', label_vi: '40. Lợi nhuận khác (40 = 31 - 32)',
      level: 1,
      subtotalOf: ['31', '32_neg'],
    },

    // ── 50. Tổng lợi nhuận kế toán trước thuế ──
    {
      code: '50', label_vi: '50. Tổng lợi nhuận kế toán trước thuế (50 = 30 + 40)',
      level: 1,
      subtotalOf: ['30', '40'],
    },

    // ── 51. Chi phí thuế TNDN hiện hành ──
    {
      code: '51', label_vi: '51. Chi phí thuế thu nhập doanh nghiệp hiện hành',
      level: 1,
      accounts: { prefixes: ['8211'], nature: 'debit' },
    },

    // ── 52. Chi phí thuế TNDN hoãn lại ──
    {
      code: '52', label_vi: '52. Chi phí thuế thu nhập doanh nghiệp hoãn lại',
      level: 1,
      accounts: { prefixes: ['8212'], nature: 'debit' },
    },

    // ── 60. Lợi nhuận sau thuế thu nhập doanh nghiệp ──
    {
      code: '60', label_vi: '60. Lợi nhuận sau thuế thu nhập doanh nghiệp (60 = 50 - 51 - 52)',
      level: 1,
      subtotalOf: ['50', '51_neg', '52_neg'],
    },
  ],
};

/**
 * Exported statement templates for Circular 133.
 * Circular 133/2016/TT-BTC, Phụ lục 2.
 */
export const circular133Statements: StatementTemplate[] = [b01, b02];
