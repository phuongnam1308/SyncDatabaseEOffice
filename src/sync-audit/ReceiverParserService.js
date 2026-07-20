const config = require("../config");
const logger = require("../../utils/logger");

// ═══════════════════════════════════════════════════════════════════
// BẢNG KEYWORD CHỨC DANH — Dùng để tra cứu user theo position
// ═══════════════════════════════════════════════════════════════════
const KEYWORDS = config.KEYWORDS;

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
    parsedRole = this._determineTargetRole(hanhDongLower, nguoiXuLyRaw);

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
            // Refactor: Lưu Department ID thay vì User IDs
            if (this.helper) {
              const unitId = await this.helper.mapSenderUnitId(unitName, transaction);
              if (unitId) receiverUnitIds.add(String(unitId));
            } else {
              // Fallback if no helper
              const unitUsers = await this._findUsersInDepartment(unitName, transaction);
              unitUsers.forEach(u => receiverUnitIds.add(String(u.id)));
            }
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
            // Refactor: Lưu Department ID thay vì User IDs
            if (this.helper) {
              const unitId = await this.helper.mapSenderUnitId(unitName, transaction);
              if (unitId) receiverUnitIds.add(String(unitId));
            } else {
              // Fallback
              const unitUsers = await this._findUsersInDepartment(unitName, transaction);
              unitUsers.forEach(u => receiverUnitIds.add(String(u.id)));
            }
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
   * Bóc tách chi tiết người nhận theo từng vai trò cụ thể (processor, viewer, supporter)
   * Phục vụ cho việc sửa lỗi và gán lại receiver chuẩn cho các bản ghi audit đã bị gán sai trước đây.
   */
  async determineReceiversDetailed(record, transaction = null) {
    const hanhDong = (record.HanhDong || "").trim();
    const hanhDongLower = hanhDong.toLowerCase();

    const result = {
      processor: [],
      viewer: [],
      supporter: [],
      units: []
    };

    try {
      // 1. "Để thực hiện" -> processor
      const thucHienMatch = hanhDong.match(RE_DE_THUC_HIEN);
      if (thucHienMatch && thucHienMatch[1]) {
        const names = this._splitNames(thucHienMatch[1]);
        for (const name of names) {
          const users = await this._findUsersByName(name, transaction);
          users.forEach(u => result.processor.push(String(u.id)));
        }
      }

      // 2. "Để biết" -> viewer
      const deBietMatch = hanhDong.match(RE_DE_BIET);
      if (deBietMatch && deBietMatch[1]) {
        const names = this._splitNames(deBietMatch[1]);
        for (const name of names) {
          const users = await this._findUsersByName(name, transaction);
          users.forEach(u => result.viewer.push(String(u.id)));
        }
      }

      // 3. "Để báo cáo" -> supporter
      const baoCaoMatch = hanhDong.match(RE_DE_BAO_CAO);
      if (baoCaoMatch && baoCaoMatch[1]) {
        const names = this._splitNames(baoCaoMatch[1]);
        for (const name of names) {
          const users = await this._findUsersByName(name, transaction);
          users.forEach(u => result.supporter.push(String(u.id)));
        }
      }

      // 4. "Cá nhân: ..." -> processor
      const caNhanMatch = hanhDong.match(RE_CA_NHAN);
      if (caNhanMatch && caNhanMatch[1]) {
        const names = this._splitNames(caNhanMatch[1]);
        for (const name of names) {
          const users = await this._findUsersByName(name, transaction);
          users.forEach(u => result.processor.push(String(u.id)));
        }
      }

      // 5. "Đơn vị: ..." -> units
      const donViMatch = hanhDong.match(RE_DON_VI) || hanhDong.match(RE_DON_VI_PHAT_HANH);
      if (donViMatch && donViMatch[1]) {
        const units = this._splitNames(donViMatch[1]);
        for (const unitName of units) {
          if (this.helper) {
            const unitId = await this.helper.mapSenderUnitId(unitName, transaction);
            if (unitId) result.units.push(String(unitId));
          }
        }
      }
    } catch (err) {
      logger.error(`[ReceiverParserService] Error in determineReceiversDetailed: ${err.message}`);
    }

    return result;
  }

  /**
   * Xác định role mục tiêu (receiver role) dựa trên từ khóa trong hành động.
   * @param {string} hanhDongLower - Nội dung hành động đã chuyển thường.
   * @returns {string|null} - Key của role (GIAM_DOC, VANTHU, ...)
   * @private
   */
  _determineTargetRole(hanhDongLower, nguoiXuLyRaw) {
    const targetStr = hanhDongLower || "";
    const nguoiXuLyStr = (nguoiXuLyRaw || "").toLowerCase();

    if (!targetStr && !nguoiXuLyStr) return "CAN_BO";

    const checkStr = (str, roleKeys) => roleKeys.some(kw => str.includes(kw));

    // Bước 1: Ưu tiên tìm trong Nội dung hành động (hanhDong) trước theo thứ tự
    if (checkStr(targetStr, KEYWORDS.GIAM_DOC)) return "GIAM_DOC";
    if (checkStr(targetStr, KEYWORDS.VAN_THU)) return "VAN_THU";
    if (checkStr(targetStr, KEYWORDS.PHO_GIAM_DOC)) return "PHO_GIAM_DOC";
    if (checkStr(targetStr, KEYWORDS.CHANH_VAN_PHONG)) return "CHANH_VAN_PHONG";
    if (checkStr(targetStr, KEYWORDS.PHO_CHANH_VAN_PHONG)) return "PHO_CHANH_VAN_PHONG";
    if (checkStr(targetStr, KEYWORDS.TRUONG_PHONG)) return "TRUONG_PHONG";
    if (checkStr(targetStr, KEYWORDS.PHO_TRUONG_PHONG)) return "PHO_TRUONG_PHONG";

    // Bước 2: Fallback tìm trong NguoiTao / NguoiXuLy nếu không khớp gì ở Bước 1
    if (checkStr(nguoiXuLyStr, KEYWORDS.GIAM_DOC)) return "GIAM_DOC";
    if (checkStr(nguoiXuLyStr, KEYWORDS.VAN_THU)) return "VAN_THU";
    if (checkStr(nguoiXuLyStr, KEYWORDS.PHO_GIAM_DOC)) return "PHO_GIAM_DOC";
    if (checkStr(nguoiXuLyStr, KEYWORDS.CHANH_VAN_PHONG)) return "CHANH_VAN_PHONG";
    if (checkStr(nguoiXuLyStr, KEYWORDS.PHO_CHANH_VAN_PHONG)) return "PHO_CHANH_VAN_PHONG";
    if (checkStr(nguoiXuLyStr, KEYWORDS.TRUONG_PHONG)) return "TRUONG_PHONG";
    if (checkStr(nguoiXuLyStr, KEYWORDS.PHO_TRUONG_PHONG)) return "PHO_TRUONG_PHONG";

    // Bước 3: Cuối cùng fallback về Cán bộ
    return "CAN_BO";
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
