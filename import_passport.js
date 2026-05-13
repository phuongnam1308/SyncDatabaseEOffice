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
// Bước 2: Parse ngày VN (dd/MM/yyyy)
// ---------------------------------------------------------------
function parseVnDate(val) {
  if (val === null || val === undefined || val === '') return null;

  // Nếu đã là Date object (xlsx đôi khi trả về Date)
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }

  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'nan') return null;

  // Thử format dd/MM/yyyy
  const parts = str.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
    if (!isNaN(date.getTime())) return date;
  }

  // Thử parse trực tiếp
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

// ---------------------------------------------------------------
// Bước 2: Đọc và xử lý dữ liệu Excel
// ---------------------------------------------------------------
function mapData(rows) {
  logger.info('--- Bước 2: Đọc và xử lý dữ liệu Excel ---');

  const passportTypeMap = {
    'Phổ thông':  'ORDINARY',
    'Công vụ':    'OFFICIAL',
    'Ngoại giao': 'DIPLOMATIC',
  };

  const usageStatusMap = {
    'Đang sử dụng': 'IN_USE',
    'Đã hết hạn':   'EXPIRED',
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

  // rows là mảng các mảng (array-of-arrays) vì header=None
  // Mapping cột theo Python:
  // 0: STT | 1: Số hộ chiếu | 2: Nhân viên | 3: Ngày cấp | 4: Ngày hết hạn
  // 5: Các nước đã đi | 6: Trạng thái sử dụng | 7: Trạng thái trả | 8: Đơn vị | 9: Loại hộ chiếu
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawPNumber = row[1];
    const pNumber = rawPNumber !== null && rawPNumber !== undefined ? String(rawPNumber).trim() : null;

    // Bỏ qua dòng rỗng/tổng kết
    if (
      !pNumber ||
      pNumber.toLowerCase() === 'nan' ||
      pNumber === '' ||
      pNumber === 'tổng cộng' ||
      pNumber === 'tổng số' ||
      !/\d/.test(pNumber) // không chứa số
    ) {
      continue;
    }

    const fullName = row[2] !== null && row[2] !== undefined ? String(row[2]).trim() : '';

    const issueDate  = parseVnDate(row[3]);
    const expiryDate = parseVnDate(row[4]);

    if (!issueDate || !expiryDate) {
      logger.warning(`Bỏ qua dòng ${i + 1}: Lỗi định dạng ngày tháng (${row[3]} - ${row[4]})`);
      continue;
    }

    const pTypeExcel   = row[9] !== null && row[9] !== undefined ? String(row[9]).trim() : '';
    const uStatusExcel = row[6] !== null && row[6] !== undefined ? String(row[6]).trim() : '';
    const bStatusExcel = row[7] !== null && row[7] !== undefined ? String(row[7]).trim() : '';

    const pType   = passportTypeMap[pTypeExcel]   || 'ORDINARY';
    const uStatus = usageStatusMap[uStatusExcel]  || 'STORING';
    const bStatus = borrowStatusMap[bStatusExcel] || 'NOT_BORROWED';

    const countries = row[5] !== null && row[5] !== undefined ? String(row[5]).trim() || null : null;
    const unitName  = row[8] !== null && row[8] !== undefined ? String(row[8]).trim() || null : null;

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
// Lấy user_id từ bảng users theo tên nhân viên
// ---------------------------------------------------------------
async function getUserId(pool, fullName) {
  if (!fullName) return null;
  try {
    const result = await pool.request()
      .input('name', sql.NVarChar, fullName)
      .query('SELECT TOP 1 id FROM dbo.users WHERE name = @name');
    if (result.recordset && result.recordset.length > 0) {
      return result.recordset[0].id;
    }
  } catch (e) {
    // bỏ qua lỗi tra user
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
    // --- Đọc Excel ---
    logger.info(`Đang đọc file Excel: ${EXCEL_PATH}`);
    const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Đọc toàn bộ dưới dạng array-of-arrays (không dùng header row)
    // skiprows=9 → bỏ 9 dòng đầu (header ở dòng 10, index 9)
    const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    // Bỏ 9 dòng đầu (index 0-8) và 1 dòng header (index 9)
    const dataRows = allRows.slice(10); // dữ liệu thực từ dòng thứ 11 (index 10)

    const dataToInsert = mapData(dataRows);

    // --- Kết nối DB ---
    pool = await getConnection();

    // Bước 1: Alter table
    await alterTable(pool);

    // Bước 3: Insert
    logger.info('--- Bước 3: Tiến hành Insert dữ liệu vào database ---');

    const total = dataToInsert.length;
    let insertedCount = 0;
    const skipped = [];
    const errors   = [];

    for (let i = 0; i < dataToInsert.length; i++) {
      const item = dataToInsert[i];

      // Lấy user_id
      item.user_id = await getUserId(pool, item.full_name);

      // Kiểm tra trùng lặp
      const existsResult = await pool.request()
        .input('passport_number', sql.NVarChar, item.passport_number)
        .query('SELECT id FROM passports WHERE passport_number = @passport_number');

      if (existsResult.recordset && existsResult.recordset.length > 0) {
        skipped.push({
          passport_number: item.passport_number,
          full_name: item.full_name,
          reason: 'Hộ chiếu đã tồn tại trong hệ thống',
        });
        continue;
      }

      try {
        await pool.request()
          .input('id',               sql.NVarChar,  item.id)
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
          .input('created_at',       sql.DateTime2, item.created_at)
          .input('updated_at',       sql.DateTime2, item.updated_at)
          .input('user_id',          sql.NVarChar,  item.user_id)
          .query(`
            INSERT INTO passports (
              id, eoffice_account, full_name, passport_number, passport_type,
              issue_date, expiry_date, countries_visited, usage_status,
              borrow_status, unit_name, nationality, source_system,
              imported_at, is_deleted, created_at, updated_at, user_id,
              tb_bak
            ) VALUES (
              @id, @eoffice_account, @full_name, @passport_number, @passport_type,
              @issue_date, @expiry_date, @countries_visited, @usage_status,
              @borrow_status, @unit_name, @nationality, @source_system,
              @imported_at, @is_deleted, @created_at, @updated_at, @user_id,
              1
            )
          `);
        insertedCount++;
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
          `\rTiến độ: ${i + 1}/${total} (Inserted: ${insertedCount}, Skipped: ${skipped.length}, Errors: ${errors.length})`
        );
      }
    }

    process.stdout.write('\n');
    console.log('--- Báo cáo kết quả ---');
    console.log(`Thành công : ${insertedCount}`);
    console.log(`Bỏ qua (Trùng): ${skipped.length}`);
    console.log(`Lỗi       : ${errors.length}`);

    // Bước 4: Xuất báo cáo lỗi nếu có (ghi JSON ra file thay vì Excel)
    let reportFile = null;
    if (skipped.length > 0 || errors.length > 0) {
      const allIssues = [...skipped, ...errors];
      reportFile = path.join(__dirname, 'import_errors.json');
      fs.writeFileSync(reportFile, JSON.stringify(allIssues, null, 2), 'utf8');
      logger.info(`Đã lưu danh sách lỗi/trùng vào file: ${reportFile}`);
    }

    logger.info('Hoàn tất quá trình import.');

    const result = {
      success:     true,
      inserted:    insertedCount,
      skipped:     skipped.length,
      errors:      errors.length,
      report_file: reportFile,
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
