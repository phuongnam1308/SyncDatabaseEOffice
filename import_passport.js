'use strict';

/**
 * import_passport.js
 * Chuyển đổi từ import_passport.py sang Node.js
 * Chức năng: Đọc file Excel hộ chiếu → Alter table → Insert vào SQL Server
 *
 * Thư viện cần cài thêm: xlsx
 *   npm install xlsx
 * Thư viện đã có sẵn: mssql, uuid
 */

const sql = require('mssql');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

// === CONFIGURATION ===
const SERVER   = process.env.NEW_DB_SERVER || '10.1.252.30';
const DATABASE = process.env.NEW_DB_NAME || 'DiOffice';
const UID      = process.env.NEW_DB_USER || 'admin_dioffice';
// Xử lý chuỗi password có chứa dấu nháy kép từ file .env
let pwdFromEnv = process.env.NEW_DB_PASSWORD || 'Admin#Di0ffice#9370';
if (pwdFromEnv.startsWith('"') && pwdFromEnv.endsWith('"')) {
  pwdFromEnv = pwdFromEnv.slice(1, -1);
}
const PWD      = pwdFromEnv;

const EXCEL_PATH = path.resolve(__dirname, 'ReportDSHoChieu.xlsx');
const BATCH_SIZE = 100;

// ---------------------------------------------------------------
// Logger đơn giản (giống logging.INFO của Python)
// ---------------------------------------------------------------
const logger = {
  info:    (...args) => console.log(`[${new Date().toISOString()}] INFO:`, ...args),
  warning: (...args) => console.log(`[${new Date().toISOString()}] WARN:`, ...args),
  error:   (...args) => console.error(`[${new Date().toISOString()}] ERROR:`, ...args),
};

// ---------------------------------------------------------------
// Kết nối SQL Server
// ---------------------------------------------------------------
const dbConfig = {
  server: SERVER,
  database: DATABASE,
  user: UID,
  password: PWD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
};

async function getConnection() {
  const pool = new sql.ConnectionPool(dbConfig);
  await pool.connect();
  return pool;
}

// ---------------------------------------------------------------
// Bước 1: Alter table – thêm cột mới nếu chưa tồn tại
// ---------------------------------------------------------------
async function alterTable(pool) {
  logger.info('--- Bước 1: Kiểm tra và cập nhật schema ---');

  const columnsToAdd = [
    { name: 'borrow_status', def: "nvarchar(50) NOT NULL DEFAULT 'NOT_BORROWED'" },
    { name: 'source_system', def: "nvarchar(50) NULL DEFAULT 'APP'" },
    { name: 'imported_at',   def: 'datetime2 NULL DEFAULT NULL' },
    { name: 'tb_bak',        def: 'int NULL DEFAULT 1' },
  ];

  for (const col of columnsToAdd) {
    const checkSql = `
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = '${col.name}'
      )
      BEGIN
        ALTER TABLE passports ADD ${col.name} ${col.def};
      END
    `;
    await pool.request().query(checkSql);
  }

  logger.info('Hoàn tất cập nhật schema.');
}

// ---------------------------------------------------------------
// Bước 2: Parse ngày VN (dd/MM/YYYY)
// ---------------------------------------------------------------
function parseVnDate(val) {
  if (val === null || val === undefined || val === '') return null;

  // Nếu đã là Date object (xlsx đôi khi trả về Date với cellDates: true)
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }

  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'nan') return null;

  // Regex bắt buộc định dạng DD/MM/YYYY (có thể dùng / hoặc -)
  const regex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
  const match = str.match(regex);
  if (match) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d) {
      return date;
    }
  }

  // Không hợp lệ DD/MM/YYYY
  return null;
}

// ---------------------------------------------------------------
// Bước 2: Đọc và xử lý dữ liệu Excel
function mapData(validDataRows) {
  logger.info('--- Bước 2: Tiền xử lý dữ liệu Excel ---');

  const passportTypeMap = {
    'Phổ thông':  'ORDINARY',
    'Công vụ':    'OFFICIAL',
    'Ngoại giao': 'DIPLOMATIC',
  };

  const usageStatusMap = {
    'Đang sử dụng': 'IN_USE',
    'Đã hết hạn':   'STORING',   // Hộ chiếu hết hạn → lưu trữ
    'Sắp hết hạn':  'EXPIRING_SOON',
    'Đã hoàn trả':  'RETURNED',
    'Không sử dụng':'STORING',
  };

  const borrowStatusMap = {
    'Không mượn': 'NOT_BORROWED',
    'Đang mượn':  'BORROWED',
  };

  const now = new Date();
  const processed = [];

  for (let i = 0; i < validDataRows.length; i++) {
    const row = validDataRows[i];
    
    // We assume row is already validated and not empty
    const pNumber = String(row[1] || '').trim();
    const fullName = String(row[2] || '').trim();
    const issueDate  = parseVnDate(row[3]);
    const expiryDate = parseVnDate(row[4]);
    const countries = String(row[5] || '').trim() || null;
    const uStatusExcel = String(row[6] || '').trim();
    const bStatusExcel = String(row[7] || '').trim();
    const unitName  = String(row[8] || '').trim() || null;
    const pTypeExcel   = String(row[9] || '').trim();

    const pType   = passportTypeMap[pTypeExcel] || Object.values(passportTypeMap).find(v => v.toLowerCase() === pTypeExcel.toLowerCase()) || 'ORDINARY';
    
    // Tìm key map không phân biệt hoa thường
    const findStatusMap = (map, val) => {
        const lowerVal = val.toLowerCase();
        for (const [k, v] of Object.entries(map)) {
            if (k.toLowerCase() === lowerVal) return v;
        }
        return null;
    };

    let uStatus = findStatusMap(usageStatusMap, uStatusExcel) || 'STORING';
    const bStatus = findStatusMap(borrowStatusMap, bStatusExcel) || 'NOT_BORROWED';

    // Nếu ngày hết hạn đã qua → bắt buộc lưu trữ (STORING), bất kể trạng thái Excel
    if (expiryDate && expiryDate < now) {
      uStatus = 'STORING';
    }

    processed.push({
      id:               uuidv4(),
      eoffice_account:  '',
      full_name:        fullName,
      passport_number:  pNumber,
      passport_type:    pType,
      issue_date:       issueDate,
      expiry_date:      expiryDate,
      countries_visited: countries,
      usage_status:     uStatus,
      borrow_status:    bStatus,
      unit_name:        unitName,
      nationality:      'Việt Nam',
      source_system:    'EXCEL_IMPORT',
      imported_at:      now,
      is_deleted:       0,
      created_at:       now,
      updated_at:       now,
    });
  }

  logger.info(`Đã tiền xử lý thành công ${processed.length} bản ghi.`);
  return processed;
}

// ---------------------------------------------------------------
// Hàm hỗ trợ bóc tách tên thật từ chuỗi có chứa chức danh (giống MigrationHelper)
// ---------------------------------------------------------------
function extractDisplayName(value) {
  try {
    if (!value) return null;
    let raw = String(value).trim();
    if (raw.toUpperCase() === "NULL") return null;

    // SharePoint format id;#name
    if (raw.includes(";#")) {
      const parts = raw.split(";#");
      if (parts.length >= 2) raw = parts[1].trim();
    }

    // Remove chức danh sau dấu - (vd: "Vũ Việt Hải - VP" -> "Vũ Việt Hải")
    raw = raw.split(/\s*[-–—]\s*/)[0].trim();

    // Remove nội dung trong ()
    raw = raw.replace(/\(.*?\)/g, "").trim();

    return raw || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Lấy thông tin user từ bảng users theo tên nhân viên
// ---------------------------------------------------------------
async function getUserInfo(pool, fullName) {
  if (!fullName) return null;
  try {
    const cleanName = extractDisplayName(fullName) || fullName.trim();
    
    const result = await pool.request()
      .input('val', sql.NVarChar, cleanName)
      .input('val_like', sql.NVarChar, cleanName + ' - %')
      .query(`
        SELECT TOP 1 
          id, username, email_user, phone_number_user, position, 
          organization_name, birthday, gender, identification_card
        FROM dbo.users 
        WHERE name = @val 
           OR name LIKE @val_like
           OR username = @val
           OR code_nd = @val
      `);
      
    if (result.recordset && result.recordset.length > 0) {
      return result.recordset[0];
    }
  } catch (e) {
    logger.error('Lỗi khi lấy thông tin user:', e.message);
  }
  return null;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------
async function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    logger.error(`Không tìm thấy file Excel tại: ${EXCEL_PATH}`);
    const out = { success: false, message: `Không tìm thấy file Excel: ${EXCEL_PATH}` };
    console.log(`JSON_RESULT:${JSON.stringify(out)}`);
    return;
  }

  let pool;
  try {
// --- KIỂM TRA ĐỊNH DẠNG FILE (VALIDATION) ---
    logger.info('--- Bước 1.5: Kiểm tra định dạng file ---');

    // 1. File không phải .xlsx
    if (!EXCEL_PATH.toLowerCase().endsWith('.xlsx')) {
      const out = { success: false, message: 'Lỗi: File không phải định dạng .xlsx' };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    // 2. Thiếu sheet Sheet1
    const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
    const hasSheet1 = workbook.SheetNames.some(s => s.replace(/\s+/g, '').toLowerCase() === 'sheet1');
    if (!hasSheet1) {
      const out = { success: false, message: 'Lỗi: File thiếu sheet có tên "Sheet1"' };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    // Đọc sheet đầu tiên (vì người dùng có thể đổi tên thành Sheet 1 nhưng vẫn ở vị trí đầu)
    // Hoặc đọc đúng Sheet1 nếu có
    const targetSheetName = workbook.SheetNames.find(s => s.replace(/\s+/g, '').toLowerCase() === 'sheet1') || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[targetSheetName];
    
    // Đọc toàn bộ dưới dạng array-of-arrays (không dùng header row)
    const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    if (!allRows || allRows.length < 2) {
      const out = { success: false, message: 'Lỗi: File không có dữ liệu.' };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    // Tự động tìm dòng header (tránh lỗi do khoảng trắng bị cắt)
    let headerRowIndex = -1;
    let headerRow = [];
    for (let i = 0; i < Math.min(allRows.length, 30); i++) {
      const row = allRows[i] || [];
      const rowStr = row.map(c => String(c || '').toLowerCase()).join('|');
      if ((rowStr.includes('hộ chiếu') || rowStr.includes('số hc') || rowStr.includes('mã hc')) && 
          (rowStr.includes('ngày cấp') || rowStr.includes('nhân viên') || rowStr.includes('họ tên'))) {
        headerRowIndex = i;
        headerRow = row;
        break;
      }
    }

    if (headerRowIndex === -1) {
      const out = { success: false, message: 'Lỗi: Không tìm thấy dòng tiêu đề (header) chứa "Hộ chiếu", "Ngày cấp". File Excel không đúng định dạng.' };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }
    
    // 3. Thiếu cột bắt buộc (10 cột)
    const requiredHeaders = [
      { index: 0, names: ['stt'] },
      { index: 1, names: ['số hộ chiếu', 'mã hộ chiếu', 'số hc'] },
      { index: 2, names: ['nhân viên', 'họ và tên', 'họ tên'] },
      { index: 3, names: ['ngày cấp'] },
      { index: 4, names: ['ngày hết hạn', 'ngày hết hiệu lực'] },
      { index: 5, names: ['các nước đã đi', 'nước đã đi'] },
      { index: 6, names: ['trạng thái sử dụng', 'tt sử dụng'] },
      { index: 7, names: ['trạng thái trả', 'trạng thái mượn', 'tt trả'] },
      { index: 8, names: ['đơn vị', 'phòng ban'] },
      { index: 9, names: ['loại hộ chiếu'] }
    ];

    const missingHeaders = [];
    for (const h of requiredHeaders) {
      const cellVal = String(headerRow[h.index] || '').trim().toLowerCase();
      // Kiểm tra xem cellVal có chứa bất kỳ tên nào hợp lệ không
      const isValid = h.names.some(name => cellVal.includes(name));
      if (!isValid) {
        missingHeaders.push(h.names[0]); // lấy tên chuẩn để báo lỗi
      }
    }

    if (missingHeaders.length > 0) {
      const errorMsg = 'File Excel thiếu cột bắt buộc hoặc sai vị trí:\n- ' + missingHeaders.join('\n- ');
      logger.error(errorMsg);
      const out = { success: false, message: errorMsg };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    logger.info('✅ Định dạng cột file hợp lệ. Bắt đầu validate dữ liệu từng dòng...');

    const dataRows = allRows.slice(headerRowIndex + 1); // dữ liệu thực bắt đầu từ sau dòng header
    
    const errorsList = [];
    const warningsList = [];
    const validDataRows = [];

    const allowedUsageStatus = ['đang sử dụng', 'đã hết hạn', 'sắp hết hạn', 'đã hoàn trả', 'không sử dụng'];
    const allowedReturnStatus = ['không mượn', 'đang mượn'];
    const allowedPassportType = ['phổ thông', 'công vụ', 'ngoại giao'];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = headerRowIndex + 2 + i; // Dòng trong Excel (1-based index)

      // Kiểm tra dòng trống
      if (row.every(c => c === null || c === undefined || c === '')) {
        continue;
      }

      const sttRaw = row[0];
      const pNumberRaw = row[1];
      const issueDateRaw = row[3];
      const expiryDateRaw = row[4];
      const uStatusExcel = String(row[6] || '').trim();
      const bStatusExcel = String(row[7] || '').trim();
      const pTypeExcel = String(row[9] || '').trim();

      const pNumber = String(pNumberRaw || '').trim();

      // Bỏ qua dòng tổng kết
      if (pNumber.toLowerCase().includes('tổng cộng') || pNumber.toLowerCase().includes('tổng số')) {
        continue;
      }

      let hasError = false;

      // 5. Số hộ chiếu rỗng hoặc sai format (vd: B9231440) -> Chặn
      if (!pNumber) {
        errorsList.push(`Dòng ${rowNum}: Số hộ chiếu bị rỗng.`);
        hasError = true;
      } else if (!/^[A-Z0-9]+$/i.test(pNumber.replace(/\s+/g, ''))) {
        errorsList.push(`Dòng ${rowNum}: Số hộ chiếu sai format (${pNumber}).`);
        hasError = true;
      }

      // 6. Ngày cấp / Ngày hết hiệu lực sai DD/MM/YYYY
      const issueDate = parseVnDate(issueDateRaw);
      const expiryDate = parseVnDate(expiryDateRaw);

      // Nếu có giá trị trong cell nhưng parse ra null tức là sai format (hoặc rỗng nhưng user bắt chặn)
      if (!issueDate) {
        errorsList.push(`Dòng ${rowNum}: Ngày cấp sai định dạng DD/MM/YYYY (${issueDateRaw || 'rỗng'}).`);
        hasError = true;
      }
      if (!expiryDate) {
        errorsList.push(`Dòng ${rowNum}: Ngày hết hiệu lực sai định dạng DD/MM/YYYY (${expiryDateRaw || 'rỗng'}).`);
        hasError = true;
      }

      // Bỏ qua check: Ngày hết hiệu lực < Ngày cấp (do dữ liệu thực tế có thể có ngoại lệ)
      // (Đã xoá validation này theo yêu cầu)

      // 8. Trạng thái sử dụng ngoài danh sách cho phép
      if (uStatusExcel && !allowedUsageStatus.includes(uStatusExcel.toLowerCase())) {
        errorsList.push(`Dòng ${rowNum}: Trạng thái sử dụng không hợp lệ (${uStatusExcel}).`);
        hasError = true;
      }

      // 9. Trạng thái trả / Loại hộ chiếu sai giá trị
      if (bStatusExcel && !allowedReturnStatus.includes(bStatusExcel.toLowerCase())) {
        errorsList.push(`Dòng ${rowNum}: Trạng thái trả không hợp lệ (${bStatusExcel}).`);
        hasError = true;
      }
      if (pTypeExcel && !allowedPassportType.includes(pTypeExcel.toLowerCase())) {
        errorsList.push(`Dòng ${rowNum}: Loại hộ chiếu không hợp lệ (${pTypeExcel}).`);
        hasError = true;
      }

      // 10. STT không phải số nguyên dương -> Cảnh báo
      const sttNum = Number(sttRaw);
      if (!sttRaw || !Number.isInteger(sttNum) || sttNum <= 0) {
        warningsList.push(`Dòng ${rowNum}: STT không phải số nguyên dương (${sttRaw}).`);
      }

      if (!hasError) {
        validDataRows.push(row);
      }
    }

    if (errorsList.length > 0) {
      let msg = 'Phát hiện lỗi dữ liệu, không thể import:\n- ' + errorsList.slice(0, 15).join('\n- ');
      if (errorsList.length > 15) {
        msg += `\n... và ${errorsList.length - 15} lỗi khác.`;
      }
      const out = { success: false, message: msg, errors: errorsList, warnings: warningsList };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    if (validDataRows.length === 0) {
      const out = { success: false, message: 'Lỗi: Không có dữ liệu hợp lệ để import.' };
      console.log(`JSON_RESULT:${JSON.stringify(out)}`);
      return;
    }

    const dataToInsert = mapData(validDataRows);

    // --- Kết nối DB ---
    pool = await getConnection();

    // Bước 1: Alter table
    await alterTable(pool);

    // Bước 3: Insert
    logger.info('--- Bước 3: Tiến hành Insert dữ liệu vào database ---');

    const total = dataToInsert.length;
    let insertedCount = 0;
    let updatedCount  = 0;
    const skipped = [];
    const errors   = [];

    for (let i = 0; i < dataToInsert.length; i++) {
      const item = dataToInsert[i];

      // Lấy thông tin user để mapping bổ sung
      const userInfo = await getUserInfo(pool, item.full_name);
      if (userInfo) {
        item.user_id = userInfo.id;
        item.eoffice_account = userInfo.username || '';
        item.email = userInfo.email_user;
        item.phone_number = userInfo.phone_number_user;
        item.position_title = userInfo.position;
        item.unit_name = item.unit_name || userInfo.organization_name;
        item.birthday = userInfo.birthday;
        item.gender = userInfo.gender;
        item.identification_card = userInfo.identification_card;
      }

      // Kiểm tra xem đã có hộ chiếu này trong hệ thống chưa
      const existsResult = await pool.request()
        .input('passport_number', sql.NVarChar, item.passport_number)
        .query('SELECT id FROM passports WHERE passport_number = @passport_number');

      const existingPassport = existsResult.recordset && existsResult.recordset[0];

      try {
        const request = pool.request()
          .input('eoffice_account',  sql.NVarChar,  item.eoffice_account)
          .input('full_name',        sql.NVarChar,  item.full_name)
          .input('passport_number',  sql.NVarChar,  item.passport_number)
          .input('passport_type',    sql.NVarChar,  item.passport_type)
          .input('issue_date',       sql.DateTime2, item.issue_date)
          .input('expiry_date',      sql.DateTime2, item.expiry_date)
          .input('countries_visited',sql.NVarChar,  item.countries_visited)
          .input('usage_status',     sql.NVarChar,  item.usage_status)
          .input('borrow_status',    sql.NVarChar,  item.borrow_status)
          .input('unit_name',        sql.NVarChar,  item.unit_name)
          .input('nationality',      sql.NVarChar,  item.nationality)
          .input('source_system',    sql.NVarChar,  item.source_system)
          .input('imported_at',      sql.DateTime2, item.imported_at)
          .input('is_deleted',       sql.Int,       item.is_deleted)
          .input('updated_at',       sql.DateTime2, item.updated_at)
          .input('user_id',          sql.NVarChar,  item.user_id)
          .input('email',            sql.NVarChar,  item.email)
          .input('phone_number',     sql.NVarChar,  item.phone_number)
          .input('position_title',   sql.NVarChar,  item.position_title)
          .input('birthday',         sql.DateTime2, item.birthday)
          .input('gender',           sql.NVarChar,  item.gender)
          .input('identification_card', sql.NVarChar, item.identification_card);

        if (existingPassport) {
          // --- CẬP NHẬT (UPDATE) ---
          item.id = existingPassport.id; // Giữ nguyên ID cũ
          await request
            .input('id', sql.NVarChar, item.id)
            .query(`
              UPDATE passports SET
                eoffice_account = @eoffice_account,
                full_name = @full_name,
                passport_type = @passport_type,
                issue_date = @issue_date,
                expiry_date = @expiry_date,
                countries_visited = @countries_visited,
                usage_status = @usage_status,
                borrow_status = @borrow_status,
                unit_name = @unit_name,
                nationality = @nationality,
                updated_at = @updated_at,
                user_id = @user_id,
                email = @email,
                phone_number = @phone_number,
                position_title = @position_title,
                birthday = @birthday,
                gender = @gender,
                identification_card = @identification_card,
                tb_bak = 1
              WHERE id = @id
            `);
          updatedCount++;
        } else {
          // --- THÊM MỚI (INSERT) ---
          await request
            .input('id',         sql.NVarChar,  item.id)
            .input('created_at', sql.DateTime2, item.created_at)
            .query(`
              INSERT INTO passports (
                id, eoffice_account, full_name, passport_number, passport_type,
                issue_date, expiry_date, countries_visited, usage_status,
                borrow_status, unit_name, nationality, source_system,
                imported_at, is_deleted, created_at, updated_at, user_id,
                email, phone_number, position_title, birthday, gender, 
                identification_card, tb_bak
              ) VALUES (
                @id, @eoffice_account, @full_name, @passport_number, @passport_type,
                @issue_date, @expiry_date, @countries_visited, @usage_status,
                @borrow_status, @unit_name, @nationality, @source_system,
                @imported_at, @is_deleted, @created_at, @updated_at, @user_id,
                @email, @phone_number, @position_title, @birthday, @gender,
                @identification_card, 1
              )
            `);
          insertedCount++;
        }

        // Sau khi tạo/cập nhật passport, cập nhật lại bảng passport_borrow_requests nếu có yêu cầu cũ đang chờ
        // So khớp linh hoạt: Vũ Việt Hải khớp với 'Vũ Việt Hải' hoặc 'Vũ Việt Hải - VP'
        if (item.user_id) {
          await pool.request()
            .input('passport_id',     sql.NVarChar, item.id)
            .input('passport_number', sql.NVarChar, item.passport_number)
            .input('passport_type',   sql.NVarChar, item.passport_type)
            .input('user_id',         sql.NVarChar, item.user_id)
            .input('full_name',       sql.NVarChar, item.full_name)
            .input('full_name_like',  sql.NVarChar, item.full_name + ' - %')
            .query(`
              UPDATE passport_borrow_requests 
              SET 
                passport_id = @passport_id,
                passport_number = @passport_number,
                passport_type = @passport_type,
                delegation_leader = @user_id
              WHERE tb_bak IS NOT NULL 
                AND passport_id IS NULL 
                AND (name_passport_request = @full_name OR name_passport_request LIKE @full_name_like)
            `);
        }
      } catch (e) {
        errors.push({
          passport_number: item.passport_number,
          full_name: item.full_name,
          reason: e.message,
        });
      }

      // Cập nhật tiến độ mỗi 10 dòng
      if ((i + 1) % 10 === 0 || (i + 1) === total) {
        process.stdout.write(
          `\rTiến độ: ${i + 1}/${total} (New: ${insertedCount}, Updated: ${updatedCount}, Errors: ${errors.length})`
        );
      }
    }

    process.stdout.write('\n');
    console.log('--- Báo cáo kết quả ---');
    console.log(`Thành công (Thêm mới): ${insertedCount}`);
    console.log(`Thành công (Cập nhật): ${updatedCount}`);
    console.log(`Lỗi                  : ${errors.length}`);

    // Bước 4: Xuất báo cáo lỗi nếu có (ghi JSON ra file thay vì Excel)
    let reportFile = null;
    if (errors.length > 0) {
      reportFile = path.join(__dirname, 'import_errors.json');
      fs.writeFileSync(reportFile, JSON.stringify(errors, null, 2), 'utf8');
      logger.info(`Đã lưu danh sách lỗi vào file: ${reportFile}`);
    }

    logger.info('Hoàn tất quá trình import.');

    const result = {
      success:     true,
      message:     warningsList.length > 0 ? "Import thành công nhưng có cảnh báo." : "Import thành công.",
      inserted:    insertedCount,
      updated:     updatedCount,
      errors:      errors.length,
      report_file: reportFile,
      warnings:    warningsList
    };
    console.log(`JSON_RESULT:${JSON.stringify(result)}`);

  } catch (e) {
    logger.error(`Lỗi hệ thống: ${e.message}`);
    const result = { success: false, message: e.message };
    console.log(`JSON_RESULT:${JSON.stringify(result)}`);
  } finally {
    if (pool) await pool.close();
  }
}

main();
