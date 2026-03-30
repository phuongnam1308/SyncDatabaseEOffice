const logger = require("../../utils/logger");

// ═══════════════════════════════════════════════════════════════════
// BẢNG KEYWORD CHỨC DANH — Dùng để tra cứu user theo position
// ═══════════════════════════════════════════════════════════════════
const KEYWORDS = {
  ADMIN: ["admin", "quản trị viên"],
  GIAM_DOC: [
    "giám đốc", "tổng giám đốc", "giám đốc cn", "giám đốc trung tâm",
    "giám đốc nhân sự", "chủ tịch kiêm giám đốc", "chủ tịch hđqt",
    "chủ tịch hội đồng quản trị", "chủ tịch", "chính ủy", "tham mưu trưởng",
    "tmt", "phó tổng giám đốc", "cn chính trị", "đại phó", "hải đoàn trưởng",
    "phó chủ tịch hội đồng thành viên", "phó chủ tịch hđtv",
    "thành viên hđtv", "thành viên hội đồng thành viên",
    "thư ký thường trực hội đồng thành viên", "thư ký tổng giám đốc",
    "lãnh đạo", "tgđ"
  ],
  PHO_GIAM_DOC: [
    "phó giám đốc", "phó gđ", "phó gd", "phó chính ủy", "phó tham mưu trưởng"
  ],
  TRUONG_PHONG: [
    "trưởng phòng", "tp", "trưởng ban", "chánh văn phòng",
    "trưởng trung tâm", "trưởng chi nhánh", "trưởng ter", "quản đốc",
    "kế toán trưởng", "chủ nhiệm", "phụ trách phòng", "tp tài chính",
    "tp.điều độ", "tp.tchc", "quyền tpth", "trưởng dp", "dpa",
    "trưởng khu", "trưởng ban thương vụ", "trưởng ban giao nhận",
    "trạm trưởng", "trưởng trạm", "thuyền trưởng", "máy trưởng",
    "máy trưởng tàu khách", "xe trưởng", "trưởng depot",
    "trưởng văn phòng đại diện", "trưởng ttpp", "trưởng đhsx",
    "trưởng tmn", "xưởng trưởng", "trung đội trưởng",
    "trưởng trực ban", "trưởng khu kho hàng"
  ],
  PHO_TRUONG_PHONG: [
    "phó trưởng phòng", "ptp", "phó phòng", "phó ban",
    "phó chánh văn phòng", "phó trung tâm", "phó trưởng trung tâm",
    "phó trưởng chi nhánh", "phó ter", "phó terminal", "phó chủ nhiệm",
    "hải đội phó", "phó quản đốc", "p.hđt", "pp kế toán",
    "tổ trưởng", "đội trưởng", "trưởng kho", "trưởng ca", "bếp trưởng",
    "tiểu đội trưởng", "quản lý bếp", "tbsx", "trưởng tbsx",
    "trưởng khu kh", "xưởng phó", "phó chi nhánh", "phó depot",
    "phó trưởng khu kho hàng", "trung đội phó", "thuyền phó",
    "máy phó", "sĩ quan máy", "sĩ quan boong", "giám sát ca",
    "giám sát công trình", "giám sát chất lượng", "phó trưởng trực ban"
  ],
  VAN_THU: [
    "văn thư", "văn thư cục", "văn thư bảo mật",
    "bảo mật lưu trữ", "văn thư lưu trữ"
  ]
};

// ═══════════════════════════════════════════════════════════════════
// DANH SÁCH TÀI KHOẢN HỆ THỐNG — Bỏ qua, không đưa vào receiver
// ═══════════════════════════════════════════════════════════════════
const SYSTEM_ACCOUNT_PATTERNS = [
  /^eoffice\s*it/i,
  /^e-office\s*sp/i,
  /^sp[-_]?setup/i,
  /^system/i,
  /^admin$/i,
  /^sharepoint/i,
];

// ═══════════════════════════════════════════════════════════════════
// REGEX PATTERNS — Nhận diện nhóm hành động
// ═══════════════════════════════════════════════════════════════════

// Nhóm 1: Phân công & Giao việc
const RE_PHAN_CONG = /phân công|lập phiếu giải quyết/i;
const RE_DE_THUC_HIEN = /để thực hiện\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
const RE_DE_BIET = /để biết\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
const RE_DE_BAO_CAO = /để báo cáo\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
const RE_DON_VI = /đơn vị\s*(?:xử lý)?\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;

// Nhóm 2: Trình duyệt
const RE_TRINH = /trình\s+(chỉ huy|lãnh đạo|chủ tịch|ban tgđ|tổng giám đốc)/i;
const RE_CHO_Y_KIEN = /cho ý kiến|chỉ đạo/i;
const RE_QUYET_DINH = /^(đồng ý|từ chối|hiệu chỉnh|duyệt)/i;

// Nhóm 3: Phát hành & Điều phối
const RE_PHAT_HANH = /phát hành văn bản|chuyển phát hành/i;
const RE_CA_NHAN = /cá nhân\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
const RE_DON_VI_PHAT_HANH = /đơn vị\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
const RE_CHUYEN_VAN_THU = /chuyển cho văn thư|chuyển văn thư/i;
const RE_THU_HOI = /thu hồi/i;

// Nhóm 4: Trạng thái hệ thống
const RE_TRANG_THAI = /đăng ký văn bản|đã xem|cập nhật|hoàn tất|hoàn thành|lập hồ sơ|phản hồi công việc|văn bản từ/i;


class ReceiverParserService {
  /**
   * @param {Function} queryNewDbTxFn - Hàm query database mới (parameterized)
   * @param {Function} queryOldDbFn   - Hàm query database cũ
   * @param {Object}   [helper]       - MigrationHelper instance (dùng mapUserName)
   */
  constructor(queryNewDbTxFn, queryOldDbFn, helper = null) {
    this.queryNewDbTx = queryNewDbTxFn;
    this.queryOldDb = queryOldDbFn;
    this.helper = helper;
  }

  /**
   * Phân tích và tìm danh sách ID Users sẽ nhận thông báo (receivers)
   * dựa trên nội dung cột HanhDong.
   *
   * @param {Object} record       - Dòng dữ liệu từ bảng LuanChuyenVanBan
   * @param {Object} [transaction] - Transaction hiện tại (nếu có)
   * @returns {Promise<{receiverIds: string[], receiverUnitIds: string[], roleProcess: string}>}
   */
  async determineReceivers(record, transaction = null) {
    const hanhDong = (record.HanhDong || "").trim();
    const hanhDongLower = hanhDong.toLowerCase();
    const nguoiXuLyRaw = (record.NguoiXuLy || "").trim();

    // Làm sạch NguoiXuLy: loại bỏ tài khoản hệ thống và hậu tố phòng ban
    const nguoiXuLy = this._cleanNguoiXuLy(nguoiXuLyRaw);

    const receiverIds = new Set();
    const receiverUnitIds = new Set();
    let roleProcess = "VANTHU";
    let parsedRole = null; // Role của người nhận được bóc tách từ text

    // Bóc tách role mục tiêu từ HanhDong
    parsedRole = this._determineTargetRole(hanhDongLower);

    try {
      // ══════════════════════════════════════════════════════════════
      // NHÓM 3.1: PHÁT HÀNH VĂN BẢN (Cá nhân & Đơn vị)
      // ══════════════════════════════════════════════════════════════
      if (RE_PHAT_HANH.test(hanhDongLower)) {
        roleProcess = "BAN_HANH";

        // Bóc tách "Cá nhân: ..."
        const caNhanMatch = hanhDong.match(RE_CA_NHAN);
        if (caNhanMatch && caNhanMatch[1]) {
          const names = this._splitNames(caNhanMatch[1]);
          for (const name of names) {
            const users = await this._findUsersByName(name, transaction);
            users.forEach(u => receiverIds.add(String(u.id)));
          }
        }

        // Bóc tách "Đơn vị: ..."
        const donViMatch = hanhDong.match(RE_DON_VI_PHAT_HANH);
        if (donViMatch && donViMatch[1]) {
          const units = this._splitNames(donViMatch[1]);
          for (const unitName of units) {
            const unitUsers = await this._findUsersInDepartment(unitName, transaction);
            unitUsers.forEach(u => receiverUnitIds.add(String(u.id)));
          }
        }
      }

      // ══════════════════════════════════════════════════════════════
      // NHÓM 3.2: CHUYỂN CHO VĂN THƯ (Tra theo chức danh)
      // ══════════════════════════════════════════════════════════════
      else if (RE_CHUYEN_VAN_THU.test(hanhDongLower)) {
        roleProcess = "VANTHU";
        const users = await this._findUsersByPositionKeywords(KEYWORDS.VAN_THU, transaction);
        users.forEach(u => receiverIds.add(String(u.id)));
      }

      // ══════════════════════════════════════════════════════════════
      // NHÓM 2: TRÌNH DUYỆT & XIN Ý KIẾN
      // ══════════════════════════════════════════════════════════════
      else if (RE_TRINH.test(hanhDongLower)) {
        roleProcess = "TRINH_KY";
        // Trình cho lãnh đạo ⇒ tìm user có chức danh Giám đốc / Phó GĐ
        const combinedKw = [...KEYWORDS.GIAM_DOC, ...KEYWORDS.PHO_GIAM_DOC];
        const users = await this._findUsersByPositionKeywords(combinedKw, transaction);
        users.forEach(u => receiverIds.add(String(u.id)));
      }
      else if (RE_CHO_Y_KIEN.test(hanhDongLower)) {
        roleProcess = "CHO_Y_KIEN";
        // Lãnh đạo cho ý kiến ⇒ tìm Giám đốc, PGĐ, Trưởng phòng
        const combinedKw = [
          ...KEYWORDS.GIAM_DOC,
          ...KEYWORDS.PHO_GIAM_DOC,
          ...KEYWORDS.TRUONG_PHONG
        ];
        const users = await this._findUsersByPositionKeywords(combinedKw, transaction);
        users.forEach(u => receiverIds.add(String(u.id)));
      }
      else if (RE_QUYET_DINH.test(hanhDongLower)) {
        roleProcess = "QUYET_DINH";
        // Quyết định trực tiếp ⇒ receiver là chính NguoiXuLy
        if (nguoiXuLy) {
          const users = await this._findUsersByName(nguoiXuLy, transaction);
          users.forEach(u => receiverIds.add(String(u.id)));
        }
      }

      // ══════════════════════════════════════════════════════════════
      // NHÓM 1: PHÂN CÔNG & GIAO VIỆC
      // ══════════════════════════════════════════════════════════════
      else if (RE_PHAN_CONG.test(hanhDongLower)) {
        roleProcess = "processor";

        // 1.1 - Để thực hiện
        const thucHienMatch = hanhDong.match(RE_DE_THUC_HIEN);
        if (thucHienMatch && thucHienMatch[1]) {
          const names = this._splitNames(thucHienMatch[1]);
          for (const name of names) {
            const users = await this._findUsersByName(name, transaction);
            users.forEach(u => receiverIds.add(String(u.id)));
          }
        }

        // 1.2 - Để biết (CC)
        const deBietMatch = hanhDong.match(RE_DE_BIET);
        if (deBietMatch && deBietMatch[1]) {
          roleProcess = "viewer";
          const names = this._splitNames(deBietMatch[1]);
          for (const name of names) {
            const users = await this._findUsersByName(name, transaction);
            users.forEach(u => receiverIds.add(String(u.id)));
          }
        }

        // 1.3 - Để báo cáo
        const baoCaoMatch = hanhDong.match(RE_DE_BAO_CAO);
        if (baoCaoMatch && baoCaoMatch[1]) {
          const names = this._splitNames(baoCaoMatch[1]);
          for (const name of names) {
            const users = await this._findUsersByName(name, transaction);
            users.forEach(u => receiverIds.add(String(u.id)));
          }
        }

        // 1.4 - Đơn vị
        const donViMatch = hanhDong.match(RE_DON_VI);
        if (donViMatch && donViMatch[1]) {
          const units = this._splitNames(donViMatch[1]);
          for (const unitName of units) {
            const unitUsers = await this._findUsersInDepartment(unitName, transaction);
            unitUsers.forEach(u => receiverUnitIds.add(String(u.id)));
          }
        }
      }

      // ══════════════════════════════════════════════════════════════
      // NHÓM 3.3 (Thu hồi) & NHÓM 4 (Trạng thái hệ thống)
      // ══════════════════════════════════════════════════════════════
      else if (RE_THU_HOI.test(hanhDongLower) || RE_TRANG_THAI.test(hanhDongLower)) {
        roleProcess = "VANTHU";
        if (nguoiXuLy) {
          const users = await this._findUsersByName(nguoiXuLy, transaction);
          users.forEach(u => receiverIds.add(String(u.id)));
        }
      }

      // ══════════════════════════════════════════════════════════════
      // FALLBACK: Không khớp nhóm nào ⇒ dùng NguoiXuLy
      // ══════════════════════════════════════════════════════════════
      else {
        if (nguoiXuLy) {
          const users = await this._findUsersByName(nguoiXuLy, transaction);
          users.forEach(u => receiverIds.add(String(u.id)));
        }
      }

      return {
        receiverIds: Array.from(receiverIds),
        receiverUnitIds: Array.from(receiverUnitIds),
        roleProcess,
        parsedRole
      };
    } catch (err) {
      logger.error(`[ReceiverParserService] Error in determineReceivers: ${err.message}`);
      return {
        receiverIds: [],
        receiverUnitIds: [],
        roleProcess: "VANTHU",
        parsedRole: null
      };
    }
  }

  /**
   * Xác định role mục tiêu (receiver role) dựa trên từ khóa trong hành động.
   * @param {string} hanhDongLower - Nội dung hành động đã chuyển thường.
   * @returns {string|null} - Key của role (GIAM_DOC, VANTHU, ...)
   * @private
   */
  _determineTargetRole(hanhDongLower) {
    if (!hanhDongLower) return null;

    // Ưu tiên 1: Chuyển/Trình cho lãnh đạo cao nhất
    const isGiamDoc = KEYWORDS.GIAM_DOC.some(kw => hanhDongLower.includes(kw));
    if (isGiamDoc && (hanhDongLower.includes("trình") || hanhDongLower.includes("chuyển"))) {
      return "GIAM_DOC";
    }

    // Ưu tiên 2: Văn thư
    const isVanThu = KEYWORDS.VAN_THU.some(kw => hanhDongLower.includes(kw));
    if (isVanThu) {
      return "VANTHU";
    }

    // Ưu tiên 3: Phó giám đốc
    const isPhoGiamDoc = KEYWORDS.PHO_GIAM_DOC.some(kw => hanhDongLower.includes(kw));
    if (isPhoGiamDoc && (hanhDongLower.includes("trình") || hanhDongLower.includes("chuyển"))) {
      return "PHO_GIAM_DOC";
    }

    // Ưu tiên 4: Chánh văn phòng
    if (hanhDongLower.includes("chánh văn phòng") || hanhDongLower.includes("cvp")) {
      return "CHANH_VAN_PHONG";
    }

    // Ưu tiên 5: Trưởng phòng
    const isTruongPhong = KEYWORDS.TRUONG_PHONG.some(kw => hanhDongLower.includes(kw));
    if (isTruongPhong && hanhDongLower.includes("chuyển")) {
      return "TRUONG_PHONG";
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HELPER: Làm sạch cột NguoiXuLy
  //  "Phạm Thị Sáu - VP" → "Phạm Thị Sáu"
  //  "Eoffice IT.Văn thư"  → null (tài khoản hệ thống)
  //  "E-Office SPSetup"    → null (tài khoản hệ thống)
  // ═══════════════════════════════════════════════════════════════════
  _cleanNguoiXuLy(raw) {
    if (!raw || typeof raw !== "string") return null;

    let cleaned = raw.trim();
    if (!cleaned) return null;

    // Kiểm tra tài khoản hệ thống → bỏ qua
    if (this._isSystemAccount(cleaned)) {
      return null;
    }

    // Loại bỏ hậu tố phòng ban: "Phạm Thị Sáu - VP" → "Phạm Thị Sáu"
    const dashIdx = cleaned.indexOf(" - ");
    if (dashIdx > 0) {
      cleaned = cleaned.substring(0, dashIdx).trim();
    }

    // Loại bỏ prefix SharePoint: "i:0#.w|domain\\user" → "user"
    if (cleaned.includes("|")) {
      cleaned = cleaned.split("|").pop().trim();
    }
    if (cleaned.includes("\\")) {
      cleaned = cleaned.split("\\").pop().trim();
    }

    return cleaned || null;
  }

  /**
   * Kiểm tra xem tên có phải tài khoản hệ thống không
   */
  _isSystemAccount(name) {
    if (!name) return true;
    return SYSTEM_ACCOUNT_PATTERNS.some(pattern => pattern.test(name.trim()));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HELPER: Tách danh sách tên từ chuỗi
  // ═══════════════════════════════════════════════════════════════════
  _splitNames(raw) {
    if (!raw || typeof raw !== "string") return [];

    return raw
      .replace(/<[^>]*>/g, "")           // Xóa HTML tags
      .split(/[;,]/)                     // Tách theo dấu ; hoặc ,
      .map(n => {
        let cleaned = n.trim();
        // Loại bỏ phần "- Chức vụ" nếu có (VD: "Nguyễn Văn A - TP Kế hoạch")
        const dashIdx = cleaned.indexOf(" - ");
        if (dashIdx > 0) cleaned = cleaned.substring(0, dashIdx).trim();
        // Loại bỏ số thứ tự đầu dòng (VD: "1. Nguyễn Văn A")
        cleaned = cleaned.replace(/^\d+[.)]\s*/, "");
        return cleaned;
      })
      .filter(n => n && n.length >= 2 && !this._isSystemAccount(n));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  QUERY: Tìm users theo tên — Ưu tiên dùng MigrationHelper.mapUserName
  // ═══════════════════════════════════════════════════════════════════
  async _findUsersByName(nameValue, transaction = null) {
    if (!nameValue || typeof nameValue !== "string") return [];

    // Làm sạch tên trước khi tra cứu
    let cleanName = nameValue.trim();
    if (!cleanName) return [];

    // Loại bỏ tài khoản hệ thống
    if (this._isSystemAccount(cleanName)) return [];

    // Loại bỏ hậu tố phòng ban "- VP", "- KHDT"
    const dashIdx = cleanName.indexOf(" - ");
    if (dashIdx > 0) cleanName = cleanName.substring(0, dashIdx).trim();

    try {
      // ── Ưu tiên 1: Dùng MigrationHelper.mapUserName (logic tra cứu mạnh nhất) ──
      if (this.helper && typeof this.helper.mapUserName === "function") {
        const userId = await this.helper.mapUserName(cleanName, transaction);
        if (userId) {
          return [{ id: userId }];
        }
      }

      // ── Ưu tiên 2: Fallback tìm trực tiếp theo name, FullName, username ──
      const exactQuery = `
        SELECT TOP 5 [id]
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE (
          [name] = @nameVal
          OR [FullName] = @nameVal
          OR [username] = @nameVal
        )
      `;

      let rows = await this.queryNewDbTx(
        exactQuery,
        { nameVal: cleanName },
        transaction
      );

      // ── Ưu tiên 3: Tìm gần đúng bằng LIKE ──
      if (!rows || rows.length === 0) {
        const likeQuery = `
          SELECT TOP 5 [id]
          FROM ${process.env.NEW_DB_NAME}.dbo.users
          WHERE (
            [name] LIKE @namePattern
            OR [FullName] LIKE @namePattern
          )
        `;
        rows = await this.queryNewDbTx(
          likeQuery,
          { namePattern: `%${cleanName}%` },
          transaction
        );
      }

      return rows || [];
    } catch (e) {
      logger.warn(`[ReceiverParser] _findUsersByName error for "${cleanName}": ${e.message}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  QUERY: Tìm users theo chức danh (position LIKE keyword)
  // ═══════════════════════════════════════════════════════════════════
  async _findUsersByPositionKeywords(keywordsArr, transaction = null) {
    if (!Array.isArray(keywordsArr) || keywordsArr.length === 0) return [];

    try {
      // Tạo điều kiện OR bằng parameterized query
      const conditions = [];
      const params = {};

      keywordsArr.forEach((kw, idx) => {
        const paramName = `kw${idx}`;
        conditions.push(`[position] LIKE @${paramName}`);
        params[paramName] = `%${kw}%`;
      });

      const query = `
        SELECT [id]
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE (${conditions.join(" OR ")})
      `;

      const rows = await this.queryNewDbTx(query, params, transaction);
      return rows || [];
    } catch (e) {
      logger.warn(`[ReceiverParser] _findUsersByPositionKeywords error: ${e.message}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  QUERY: Tìm users thuộc một đơn vị / phòng ban
  // ═══════════════════════════════════════════════════════════════════
  async _findUsersInDepartment(orgName, transaction = null) {
    if (!orgName || typeof orgName !== "string") return [];

    const cleanOrg = orgName.trim();
    if (!cleanOrg) return [];

    try {
      // Tìm user thuộc đơn vị dựa trên cột Department và organization_name (LIKE gần đúng)
      const query = `
        SELECT [id]
        FROM ${process.env.NEW_DB_NAME}.dbo.users
        WHERE (
          [Department] LIKE @orgPattern
          OR [organization_name] LIKE @orgPattern
        )
      `;

      const rows = await this.queryNewDbTx(
        query,
        { orgPattern: `%${cleanOrg}%` },
        transaction
      );

      if (rows && rows.length > 0) {
        logger.info(`[ReceiverParser] Tìm thấy ${rows.length} user thuộc đơn vị "${cleanOrg}"`);
      }

      return rows || [];
    } catch (e) {
      logger.warn(`[ReceiverParser] _findUsersInDepartment error for "${cleanOrg}": ${e.message}`);
      return [];
    }
  }
}

module.exports = ReceiverParserService;
