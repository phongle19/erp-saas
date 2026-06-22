/**
 * Hệ thống tài khoản kế toán theo Thông tư 133/2016/TT-BTC
 * Phụ lục 1 – Hệ thống tài khoản kế toán doanh nghiệp nhỏ và vừa
 *
 * Source: Circular 133/2016/TT-BTC, Phụ lục 1 — Ministry of Finance, Vietnam
 *
 * VERIFY: codes, Vietnamese names, and completeness must be verified against the
 * official circular text before production use.  See docs/open-questions.md.
 *
 * Notes on type mapping:
 *  - Class 1 (1xx): current assets → 'asset'
 *  - Class 2 (2xx): long-term assets → 'asset'  (214/229 are contra-asset but modeled as 'asset')
 *  - Class 3 (3xx): liabilities → 'liability'
 *  - Class 4 (4xx): equity → 'equity'
 *  - Class 5 (5xx): revenue → 'revenue'
 *  - Class 6 (6xx): cost/expense → 'expense'
 *  - Class 7 (7xx): other income → 'revenue'
 *  - Class 8 (8xx): other expense / CIT → 'expense'
 *  - Class 9 (9xx): profit-determination account → 'expense' (closes to 421)
 *  - Class 0 (0xx): off-balance-sheet memorandum accounts → modeled as 'asset' with comment
 */

import type { AccountSeed } from '../types.js';

// Circular 133/2016/TT-BTC, Phụ lục 1
export const circular133Accounts: AccountSeed[] = [
  // ─── LỚP 1: TÀI SẢN NGẮN HẠN ──────────────────────────────────────────
  { code: '111',  name: 'Tiền mặt',                                              type: 'asset' },
  { code: '1111', name: 'Tiền Việt Nam',                                          type: 'asset', parentCode: '111' },
  { code: '1112', name: 'Ngoại tệ',                                               type: 'asset', parentCode: '111' },

  { code: '112',  name: 'Tiền gửi ngân hàng',                                     type: 'asset' },
  { code: '1121', name: 'Tiền Việt Nam',                                          type: 'asset', parentCode: '112' },
  { code: '1122', name: 'Ngoại tệ',                                               type: 'asset', parentCode: '112' },

  { code: '121',  name: 'Chứng khoán kinh doanh',                                 type: 'asset' },

  { code: '128',  name: 'Đầu tư nắm giữ đến ngày đáo hạn',                       type: 'asset' },
  { code: '1281', name: 'Tiền gửi có kỳ hạn',                                    type: 'asset', parentCode: '128' },
  { code: '1282', name: 'Trái phiếu',                                             type: 'asset', parentCode: '128' },
  { code: '1288', name: 'Các khoản đầu tư nắm giữ đến ngày đáo hạn khác',       type: 'asset', parentCode: '128' },

  { code: '131',  name: 'Phải thu của khách hàng',                               type: 'asset' },

  { code: '133',  name: 'Thuế giá trị gia tăng được khấu trừ',                   type: 'asset' },
  { code: '1331', name: 'Thuế GTGT được khấu trừ của hàng hóa, dịch vụ',        type: 'asset', parentCode: '133' },
  { code: '1332', name: 'Thuế GTGT được khấu trừ của tài sản cố định',           type: 'asset', parentCode: '133' },

  { code: '136',  name: 'Phải thu nội bộ',                                        type: 'asset' },
  { code: '1361', name: 'Vốn kinh doanh ở đơn vị trực thuộc',                   type: 'asset', parentCode: '136' },
  { code: '1368', name: 'Phải thu nội bộ khác',                                   type: 'asset', parentCode: '136' },

  { code: '138',  name: 'Phải thu khác',                                          type: 'asset' },
  { code: '1381', name: 'Tài sản thiếu chờ xử lý',                              type: 'asset', parentCode: '138' },
  { code: '1385', name: 'Phải thu về cổ phần hóa',                               type: 'asset', parentCode: '138' },
  { code: '1388', name: 'Phải thu khác',                                          type: 'asset', parentCode: '138' },

  { code: '139',  name: 'Dự phòng phải thu khó đòi',                             type: 'asset' }, // contra-asset; credit-nature but modeled as asset

  { code: '141',  name: 'Tạm ứng',                                               type: 'asset' },

  { code: '151',  name: 'Hàng mua đang đi đường',                                type: 'asset' },

  { code: '152',  name: 'Nguyên liệu, vật liệu',                                 type: 'asset' },

  { code: '153',  name: 'Công cụ, dụng cụ',                                      type: 'asset' },
  { code: '1531', name: 'Công cụ, dụng cụ',                                      type: 'asset', parentCode: '153' },
  { code: '1532', name: 'Bao bì luân chuyển',                                    type: 'asset', parentCode: '153' },
  { code: '1533', name: 'Đồ dùng cho thuê',                                      type: 'asset', parentCode: '153' },

  { code: '154',  name: 'Chi phí sản xuất, kinh doanh dở dang',                  type: 'asset' },

  { code: '155',  name: 'Thành phẩm',                                            type: 'asset' },

  { code: '156',  name: 'Hàng hóa',                                              type: 'asset' },
  { code: '1561', name: 'Giá mua hàng hóa',                                      type: 'asset', parentCode: '156' },
  { code: '1562', name: 'Chi phí thu mua hàng hóa',                             type: 'asset', parentCode: '156' },

  { code: '157',  name: 'Hàng gửi đi bán',                                       type: 'asset' },

  { code: '158',  name: 'Hàng hóa kho bảo thuế',                                type: 'asset' },

  // ─── LỚP 2: TÀI SẢN DÀI HẠN ────────────────────────────────────────────
  { code: '211',  name: 'Tài sản cố định hữu hình',                              type: 'asset' },
  { code: '2111', name: 'Nhà cửa, vật kiến trúc',                               type: 'asset', parentCode: '211' },
  { code: '2112', name: 'Máy móc, thiết bị',                                     type: 'asset', parentCode: '211' },
  { code: '2113', name: 'Phương tiện vận tải, truyền dẫn',                       type: 'asset', parentCode: '211' },
  { code: '2114', name: 'Thiết bị, dụng cụ quản lý',                            type: 'asset', parentCode: '211' },
  { code: '2115', name: 'Cây lâu năm, súc vật làm việc và cho sản phẩm',        type: 'asset', parentCode: '211' },
  { code: '2118', name: 'Tài sản cố định khác',                                  type: 'asset', parentCode: '211' },

  // TT133 does not separate TK 212 (TSCĐ thuê tài chính) as a separate top-level; included here per common practice
  { code: '212',  name: 'Tài sản cố định thuê tài chính',                       type: 'asset' },

  { code: '213',  name: 'Tài sản cố định vô hình',                               type: 'asset' },
  { code: '2131', name: 'Quyền sử dụng đất',                                     type: 'asset', parentCode: '213' },
  { code: '2132', name: 'Quyền phát hành',                                       type: 'asset', parentCode: '213' },
  { code: '2133', name: 'Bản quyền, bằng sáng chế',                             type: 'asset', parentCode: '213' },
  { code: '2134', name: 'Nhãn hiệu hàng hóa',                                    type: 'asset', parentCode: '213' },
  { code: '2135', name: 'Phần mềm máy vi tính',                                  type: 'asset', parentCode: '213' },
  { code: '2136', name: 'Giấy phép và giấy phép nhượng quyền',                  type: 'asset', parentCode: '213' },
  { code: '2138', name: 'Tài sản cố định vô hình khác',                          type: 'asset', parentCode: '213' },

  // 214: Hao mòn và khấu hao TSCĐ — contra-asset (credit balance); modeled as 'asset' with note
  // Per TT133, TK 214 accumulates depreciation; its credit balance offsets 211/212/213.
  { code: '214',  name: 'Hao mòn và khấu hao tài sản cố định',                  type: 'asset' }, // contra-asset
  { code: '2141', name: 'Hao mòn tài sản cố định hữu hình',                     type: 'asset', parentCode: '214' },
  { code: '2142', name: 'Hao mòn tài sản cố định thuê tài chính',               type: 'asset', parentCode: '214' },
  { code: '2143', name: 'Hao mòn tài sản cố định vô hình',                      type: 'asset', parentCode: '214' },

  { code: '217',  name: 'Bất động sản đầu tư',                                   type: 'asset' },

  // 228: Đầu tư dài hạn khác (TT133 merges several investment accounts)
  { code: '228',  name: 'Đầu tư góp vốn vào đơn vị khác',                       type: 'asset' },
  { code: '2281', name: 'Đầu tư vào công ty con',                                type: 'asset', parentCode: '228' },
  { code: '2282', name: 'Vốn góp vào cơ sở kinh doanh đồng kiểm soát',         type: 'asset', parentCode: '228' },
  { code: '2283', name: 'Đầu tư vào công ty liên kết',                           type: 'asset', parentCode: '228' },
  { code: '2288', name: 'Đầu tư góp vốn vào đơn vị khác',                       type: 'asset', parentCode: '228' },

  // 229: Dự phòng tổn thất tài sản — contra-asset; credit balance
  { code: '229',  name: 'Dự phòng tổn thất tài sản',                             type: 'asset' }, // contra-asset
  { code: '2291', name: 'Dự phòng giảm giá chứng khoán kinh doanh',             type: 'asset', parentCode: '229' },
  { code: '2292', name: 'Dự phòng tổn thất đầu tư vào đơn vị khác',            type: 'asset', parentCode: '229' },
  { code: '2293', name: 'Dự phòng phải thu khó đòi dài hạn',                    type: 'asset', parentCode: '229' },
  { code: '2294', name: 'Dự phòng giảm giá hàng tồn kho',                       type: 'asset', parentCode: '229' },

  { code: '241',  name: 'Xây dựng cơ bản dở dang',                               type: 'asset' },

  { code: '242',  name: 'Chi phí trả trước dài hạn',                             type: 'asset' },

  { code: '243',  name: 'Tài sản thuế thu nhập hoãn lại',                       type: 'asset' },

  // ─── LỚP 3: NỢ PHẢI TRẢ ────────────────────────────────────────────────
  { code: '331',  name: 'Phải trả cho người bán',                                type: 'liability' },

  { code: '333',  name: 'Thuế và các khoản phải nộp Nhà nước',                  type: 'liability' },
  { code: '3331', name: 'Thuế giá trị gia tăng phải nộp',                       type: 'liability', parentCode: '333' },
  { code: '33311',name: 'Thuế GTGT đầu ra',                                     type: 'liability', parentCode: '3331' },
  { code: '33312',name: 'Thuế GTGT hàng nhập khẩu',                             type: 'liability', parentCode: '3331' },
  { code: '3332', name: 'Thuế tiêu thụ đặc biệt',                               type: 'liability', parentCode: '333' },
  { code: '3333', name: 'Thuế xuất nhập khẩu',                                  type: 'liability', parentCode: '333' },
  { code: '3334', name: 'Thuế thu nhập doanh nghiệp',                           type: 'liability', parentCode: '333' },
  { code: '3335', name: 'Thuế thu nhập cá nhân',                                type: 'liability', parentCode: '333' },
  { code: '3336', name: 'Thuế tài nguyên',                                       type: 'liability', parentCode: '333' },
  { code: '3337', name: 'Thuế nhà đất, tiền thuê đất',                          type: 'liability', parentCode: '333' },
  { code: '3338', name: 'Các loại thuế khác',                                    type: 'liability', parentCode: '333' },
  { code: '3339', name: 'Phí, lệ phí và các khoản phải nộp khác',              type: 'liability', parentCode: '333' },

  { code: '334',  name: 'Phải trả người lao động',                              type: 'liability' },
  { code: '3341', name: 'Phải trả công nhân viên',                              type: 'liability', parentCode: '334' },
  { code: '3348', name: 'Phải trả người lao động khác',                         type: 'liability', parentCode: '334' },

  { code: '335',  name: 'Chi phí phải trả',                                      type: 'liability' },

  { code: '336',  name: 'Phải trả nội bộ',                                       type: 'liability' },

  { code: '337',  name: 'Thanh toán theo tiến độ kế hoạch hợp đồng xây dựng',  type: 'liability' },

  { code: '338',  name: 'Phải trả, phải nộp khác',                              type: 'liability' },
  { code: '3381', name: 'Tài sản thừa chờ giải quyết',                          type: 'liability', parentCode: '338' },
  { code: '3382', name: 'Kinh phí công đoàn',                                    type: 'liability', parentCode: '338' },
  { code: '3383', name: 'Bảo hiểm xã hội',                                      type: 'liability', parentCode: '338' },
  { code: '3384', name: 'Bảo hiểm y tế',                                        type: 'liability', parentCode: '338' },
  { code: '3385', name: 'Phải trả về cổ phần hóa',                              type: 'liability', parentCode: '338' },
  { code: '3386', name: 'Nhận ký quỹ, ký cược',                                 type: 'liability', parentCode: '338' },
  { code: '3387', name: 'Doanh thu chưa thực hiện',                              type: 'liability', parentCode: '338' },
  { code: '3388', name: 'Phải trả, phải nộp khác',                              type: 'liability', parentCode: '338' },
  { code: '3389', name: 'Bảo hiểm thất nghiệp',                                 type: 'liability', parentCode: '338' },

  { code: '341',  name: 'Vay và nợ thuê tài chính',                              type: 'liability' },
  { code: '3411', name: 'Các khoản đi vay',                                      type: 'liability', parentCode: '341' },
  { code: '3412', name: 'Nợ thuê tài chính',                                     type: 'liability', parentCode: '341' },

  { code: '343',  name: 'Trái phiếu phát hành',                                  type: 'liability' },
  { code: '3431', name: 'Mệnh giá trái phiếu',                                   type: 'liability', parentCode: '343' },
  { code: '3432', name: 'Chiết khấu trái phiếu',                                 type: 'liability', parentCode: '343' },
  { code: '3433', name: 'Phụ trội trái phiếu',                                   type: 'liability', parentCode: '343' },

  { code: '347',  name: 'Thuế thu nhập hoãn lại phải trả',                      type: 'liability' },

  { code: '352',  name: 'Dự phòng phải trả',                                     type: 'liability' },

  { code: '353',  name: 'Quỹ khen thưởng, phúc lợi',                             type: 'liability' },
  { code: '3531', name: 'Quỹ khen thưởng',                                       type: 'liability', parentCode: '353' },
  { code: '3532', name: 'Quỹ phúc lợi',                                          type: 'liability', parentCode: '353' },
  { code: '3533', name: 'Quỹ phúc lợi đã hình thành tài sản cố định',          type: 'liability', parentCode: '353' },
  { code: '3534', name: 'Quỹ thưởng ban quản lý điều hành công ty',            type: 'liability', parentCode: '353' },

  { code: '356',  name: 'Quỹ phát triển khoa học và công nghệ',                 type: 'liability' },
  { code: '3561', name: 'Quỹ phát triển khoa học và công nghệ',                 type: 'liability', parentCode: '356' },
  { code: '3562', name: 'Quỹ phát triển khoa học và công nghệ đã hình thành TSCĐ', type: 'liability', parentCode: '356' },

  // ─── LỚP 4: VỐN CHỦ SỞ HỮU ─────────────────────────────────────────────
  { code: '411',  name: 'Vốn đầu tư của chủ sở hữu',                            type: 'equity' },
  { code: '4111', name: 'Vốn góp của chủ sở hữu',                               type: 'equity', parentCode: '411' },
  { code: '4112', name: 'Thặng dư vốn cổ phần',                                 type: 'equity', parentCode: '411' },
  { code: '4113', name: 'Vốn khác',                                              type: 'equity', parentCode: '411' },

  { code: '413',  name: 'Chênh lệch tỷ giá hối đoái',                           type: 'equity' },

  { code: '418',  name: 'Các quỹ thuộc vốn chủ sở hữu',                         type: 'equity' },

  { code: '419',  name: 'Cổ phiếu quỹ',                                         type: 'equity' }, // contra-equity (debit balance)

  { code: '421',  name: 'Lợi nhuận sau thuế chưa phân phối',                    type: 'equity' },
  { code: '4211', name: 'Lợi nhuận sau thuế chưa phân phối năm trước',          type: 'equity', parentCode: '421' },
  { code: '4212', name: 'Lợi nhuận sau thuế chưa phân phối năm nay',            type: 'equity', parentCode: '421' },

  { code: '441',  name: 'Nguồn vốn đầu tư xây dựng cơ bản',                    type: 'equity' },

  { code: '461',  name: 'Nguồn kinh phí sự nghiệp',                              type: 'equity' },
  { code: '4611', name: 'Nguồn kinh phí năm trước',                             type: 'equity', parentCode: '461' },
  { code: '4612', name: 'Nguồn kinh phí năm nay',                               type: 'equity', parentCode: '461' },

  { code: '466',  name: 'Nguồn kinh phí đã hình thành tài sản cố định',        type: 'equity' },

  // ─── LỚP 5: DOANH THU ───────────────────────────────────────────────────
  { code: '511',  name: 'Doanh thu bán hàng và cung cấp dịch vụ',              type: 'revenue' },
  { code: '5111', name: 'Doanh thu bán hàng hóa',                               type: 'revenue', parentCode: '511' },
  { code: '5112', name: 'Doanh thu bán các thành phẩm',                         type: 'revenue', parentCode: '511' },
  { code: '5113', name: 'Doanh thu cung cấp dịch vụ',                           type: 'revenue', parentCode: '511' },
  { code: '5114', name: 'Doanh thu trợ cấp, trợ giá',                           type: 'revenue', parentCode: '511' },
  { code: '5117', name: 'Doanh thu kinh doanh bất động sản đầu tư',             type: 'revenue', parentCode: '511' },

  { code: '515',  name: 'Doanh thu hoạt động tài chính',                         type: 'revenue' },

  { code: '521',  name: 'Các khoản giảm trừ doanh thu',                          type: 'revenue' }, // contra-revenue (debit balance)
  { code: '5211', name: 'Chiết khấu thương mại',                                 type: 'revenue', parentCode: '521' },
  { code: '5212', name: 'Hàng bán bị trả lại',                                  type: 'revenue', parentCode: '521' },
  { code: '5213', name: 'Giảm giá hàng bán',                                    type: 'revenue', parentCode: '521' },

  // ─── LỚP 6: CHI PHÍ ─────────────────────────────────────────────────────
  // TT133 uses 611 for purchases under periodic inventory; 632 under perpetual
  { code: '611',  name: 'Mua hàng',                                              type: 'expense' }, // periodic inventory method
  { code: '6111', name: 'Mua nguyên liệu, vật liệu',                            type: 'expense', parentCode: '611' },
  { code: '6112', name: 'Mua hàng hóa',                                         type: 'expense', parentCode: '611' },

  { code: '631',  name: 'Giá thành sản xuất',                                   type: 'expense' },

  { code: '632',  name: 'Giá vốn hàng bán',                                     type: 'expense' },

  { code: '635',  name: 'Chi phí tài chính',                                    type: 'expense' },

  // TT133 does not have separate 641/642; uses 642 for all selling + admin expenses
  // (or separates into 641 bán hàng / 642 QLDN — both are valid under TT133 guidance)
  { code: '641',  name: 'Chi phí bán hàng',                                     type: 'expense' },

  { code: '642',  name: 'Chi phí quản lý kinh doanh',                           type: 'expense' },

  // ─── LỚP 7: THU NHẬP KHÁC ───────────────────────────────────────────────
  { code: '711',  name: 'Thu nhập khác',                                         type: 'revenue' },

  // ─── LỚP 8: CHI PHÍ KHÁC ────────────────────────────────────────────────
  { code: '811',  name: 'Chi phí khác',                                          type: 'expense' },

  // 821: Chi phí thuế thu nhập doanh nghiệp
  { code: '821',  name: 'Chi phí thuế thu nhập doanh nghiệp',                  type: 'expense' },
  { code: '8211', name: 'Chi phí thuế thu nhập doanh nghiệp hiện hành',        type: 'expense', parentCode: '821' },
  { code: '8212', name: 'Chi phí thuế thu nhập doanh nghiệp hoãn lại',         type: 'expense', parentCode: '821' },

  // ─── LỚP 9: XÁC ĐỊNH KẾT QUẢ KINH DOANH ────────────────────────────────
  // 911 is a determination/clearing account; closed to 421 each period.
  // Modeled as 'expense' as it absorbs all P&L and closes to equity.
  { code: '911',  name: 'Xác định kết quả kinh doanh',                         type: 'expense' }, // P&L clearing account

  // ─── LỚP 0: TÀI KHOẢN NGOÀI BẢNG CÂN ĐỐI KẾ TOÁN ──────────────────────
  // Off-balance-sheet memorandum accounts; modeled as 'asset' with this note.
  // These do not participate in double-entry balancing.
  { code: '001',  name: 'Tài sản thuê ngoài',                                   type: 'asset' }, // off-balance
  { code: '002',  name: 'Vật tư, hàng hóa nhận giữ hộ, nhận gia công',        type: 'asset' }, // off-balance
  { code: '003',  name: 'Hàng hóa nhận bán hộ, nhận ký gửi, ký cược',         type: 'asset' }, // off-balance
  { code: '004',  name: 'Nợ khó đòi đã xử lý',                                 type: 'asset' }, // off-balance
  { code: '007',  name: 'Ngoại tệ các loại',                                    type: 'asset' }, // off-balance
  { code: '008',  name: 'Dự toán chi sự nghiệp, dự án',                        type: 'asset' }, // off-balance
];
