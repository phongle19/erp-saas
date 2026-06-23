/**
 * Hệ thống tài khoản kế toán theo Thông tư 88/2021/TT-BTC
 * Chế độ kế toán hộ kinh doanh, cá nhân kinh doanh
 *
 * Source: Circular 88/2021/TT-BTC — Ministry of Finance, Vietnam
 *
 * VERIFY: codes, Vietnamese names, and completeness must be verified against the
 * official circular text before production use. See docs/open-questions.md.
 *
 * Note on regime nature:
 * Thông tư 88/2021/TT-BTC establishes a simplified accounting regime for household
 * businesses (hộ kinh doanh) and individual businesses (cá nhân kinh doanh).
 * Instead of the full enterprise double-entry system, TT88 prescribes a small set
 * of accounting books (sổ kế toán) and a correspondingly compact account set.
 * The accounts below represent the principal accounts/categories defined by TT88.
 * Household businesses with revenue below the simplified threshold may use cash-basis
 * receipts/disbursements books rather than a full ledger.
 *
 * Type mapping:
 *  - Class 1: current assets → 'asset'
 *  - Class 2: fixed assets → 'asset'
 *  - Class 3: liabilities → 'liability'
 *  - Class 4: equity/owner capital → 'equity'
 *  - Class 5: revenue → 'revenue'
 *  - Class 6: expenses → 'expense'
 *  - Class 9: profit determination → 'expense'
 */

import type { AccountSeed } from '../types.js';

// Circular 88/2021/TT-BTC — Phụ lục Hệ thống tài khoản kế toán hộ kinh doanh
export const circular88Accounts: AccountSeed[] = [
  // ─── LỚP 1: TÀI SẢN ────────────────────────────────────────────────────
  // TT88 uses a simplified cash/bank account structure
  { code: '111',  name: 'Tiền mặt',                                              type: 'asset' },
  { code: '112',  name: 'Tiền gửi ngân hàng',                                    type: 'asset' },

  { code: '131',  name: 'Phải thu của khách hàng',                               type: 'asset' },

  { code: '138',  name: 'Phải thu khác',                                          type: 'asset' },

  { code: '141',  name: 'Tạm ứng',                                               type: 'asset' },

  { code: '152',  name: 'Nguyên liệu, vật liệu',                                 type: 'asset' },

  { code: '153',  name: 'Công cụ, dụng cụ',                                      type: 'asset' },

  { code: '154',  name: 'Chi phí sản xuất, kinh doanh dở dang',                  type: 'asset' },

  { code: '155',  name: 'Thành phẩm',                                            type: 'asset' },

  { code: '156',  name: 'Hàng hóa',                                              type: 'asset' },

  // ─── LỚP 2: TÀI SẢN CỐ ĐỊNH ────────────────────────────────────────────
  { code: '211',  name: 'Tài sản cố định hữu hình',                              type: 'asset' },

  { code: '213',  name: 'Tài sản cố định vô hình',                               type: 'asset' },

  // 214: accumulated depreciation — contra-asset but modeled as 'asset'
  { code: '214',  name: 'Hao mòn tài sản cố định',                               type: 'asset' }, // contra-asset

  { code: '241',  name: 'Xây dựng cơ bản dở dang',                               type: 'asset' },

  { code: '242',  name: 'Chi phí trả trước',                                      type: 'asset' },

  // ─── LỚP 3: NỢ PHẢI TRẢ ────────────────────────────────────────────────
  { code: '331',  name: 'Phải trả cho người bán',                                type: 'liability' },

  { code: '333',  name: 'Thuế và các khoản phải nộp Nhà nước',                  type: 'liability' },
  { code: '3331', name: 'Thuế giá trị gia tăng phải nộp',                       type: 'liability', parentCode: '333' },
  { code: '3334', name: 'Thuế thu nhập doanh nghiệp / thu nhập cá nhân',        type: 'liability', parentCode: '333' },
  { code: '3338', name: 'Các loại thuế khác',                                    type: 'liability', parentCode: '333' },
  { code: '3339', name: 'Phí, lệ phí và các khoản phải nộp khác',              type: 'liability', parentCode: '333' },

  { code: '334',  name: 'Phải trả người lao động',                              type: 'liability' },

  { code: '338',  name: 'Phải trả, phải nộp khác',                              type: 'liability' },
  { code: '3382', name: 'Kinh phí công đoàn',                                    type: 'liability', parentCode: '338' },
  { code: '3383', name: 'Bảo hiểm xã hội',                                      type: 'liability', parentCode: '338' },
  { code: '3384', name: 'Bảo hiểm y tế',                                        type: 'liability', parentCode: '338' },
  { code: '3388', name: 'Phải trả, phải nộp khác',                              type: 'liability', parentCode: '338' },

  { code: '341',  name: 'Vay và nợ phải trả',                                   type: 'liability' },

  // ─── LỚP 4: VỐN CHỦ SỞ HỮU / VỐN CHỦ HỘ KINH DOANH ───────────────────
  // TT88: uses a single "Vốn chủ hộ kinh doanh" account
  { code: '411',  name: 'Vốn chủ hộ kinh doanh',                                type: 'equity' },

  { code: '421',  name: 'Lợi nhuận chưa phân phối',                             type: 'equity' },

  // ─── LỚP 5: DOANH THU ───────────────────────────────────────────────────
  { code: '511',  name: 'Doanh thu bán hàng và cung cấp dịch vụ',              type: 'revenue' },
  { code: '5111', name: 'Doanh thu bán hàng hóa',                               type: 'revenue', parentCode: '511' },
  { code: '5112', name: 'Doanh thu bán thành phẩm',                             type: 'revenue', parentCode: '511' },
  { code: '5113', name: 'Doanh thu cung cấp dịch vụ',                           type: 'revenue', parentCode: '511' },

  { code: '515',  name: 'Doanh thu hoạt động tài chính',                         type: 'revenue' },

  { code: '711',  name: 'Thu nhập khác',                                         type: 'revenue' },

  // ─── LỚP 6: CHI PHÍ ─────────────────────────────────────────────────────
  { code: '632',  name: 'Giá vốn hàng bán',                                     type: 'expense' },

  { code: '635',  name: 'Chi phí tài chính',                                    type: 'expense' },

  // TT88 simplifies: uses 642 for all operating expenses (no separate 641)
  { code: '642',  name: 'Chi phí hoạt động kinh doanh',                         type: 'expense' },

  { code: '811',  name: 'Chi phí khác',                                          type: 'expense' },

  // ─── LỚP 9: XÁC ĐỊNH KẾT QUẢ ────────────────────────────────────────────
  // P&L clearing account; closed to 421 each period
  { code: '911',  name: 'Xác định kết quả kinh doanh',                         type: 'expense' },
];
