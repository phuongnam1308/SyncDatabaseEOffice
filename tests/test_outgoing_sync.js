/**
 * test_outgoing_sync.js
 * ────────────────────────────────────────────────────────────────────────────
 * Script kiểm thử multi-table sync cho VĂN BẢN ĐI.
 * Xác minh dữ liệu nhất quán giữa 3 bảng:
 *   - audit
 *   - outgoing_assignment
 *   - outgoing_current_state
 *
 * Cách chạy:
 *   node tests/test_outgoing_sync.js [documentId]
 *   Ví dụ: node tests/test_outgoing_sync.js 1234
 *
 * Nếu không truyền documentId, script sẽ tự lấy 5 document_id đầu tiên
 * từ bảng outgoing_documents để kiểm tra.
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config();
const sql = require('mssql');

// ─── Màu sắc terminal ────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};
const ok   = (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const fail = (msg) => console.log(`  ${C.red}✗${C.reset} ${msg}`);
const info = (msg) => console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`);
const warn = (msg) => console.log(`  ${C.yellow}⚠${C.reset} ${msg}`);
const head = (msg) => console.log(`\n${C.bold}${C.cyan}${msg}${C.reset}\n${'─'.repeat(70)}`);

// ─── Kết nối DB mới ──────────────────────────────────────────────────────────
async function getNewDbPool() {
  const config = {
    user:     process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    server:   process.env.NEW_DB_HOST,
    port:     Number(process.env.NEW_DB_PORT || 1433),
    database: process.env.NEW_DB_NAME,
    options:  { encrypt: false, trustServerCertificate: true },
    requestTimeout: 60000,
  };
  const pool = await sql.connect(config);
  return pool;
}

async function query(pool, sql_text, params = {}) {
  const request = pool.request();
  for (const [k, v] of Object.entries(params)) {
    request.input(k, v);
  }
  const result = await request.query(sql_text);
  return result.recordset;
}

// ─── Lấy danh sách documentId mẫu ───────────────────────────────────────────
async function getSampleDocumentIds(pool, limit = 5) {
  const rows = await query(
    pool,
    `SELECT TOP ${limit} document_id FROM dbo.outgoing_documents ORDER BY created_at DESC`
  );
  return rows.map(r => r.document_id);
}

// ─── Kiểm tra 1 document_id ──────────────────────────────────────────────────
async function checkDocument(pool, documentId) {
  const dbName = process.env.NEW_DB_NAME;
  let passed = 0;
  let failed = 0;

  console.log(`\n  Document ID: ${C.bold}${documentId}${C.reset}`);

  // 1. Kiểm tra audit có ít nhất 1 bản ghi
  const auditRows = await query(
    pool,
    `SELECT COUNT(1) AS cnt FROM ${dbName}.dbo.audit WHERE document_id = @docId`,
    { docId: documentId }
  );
  const auditCount = Number(auditRows[0]?.cnt || 0);
  if (auditCount > 0) {
    ok(`audit: ${auditCount} bản ghi`);
    passed++;
  } else {
    fail(`audit: KHÔNG có bản ghi nào`);
    failed++;
  }

  // 2. Kiểm tra outgoing_assignment có ít nhất 1 bản ghi
  const assignRows = await query(
    pool,
    `SELECT COUNT(1) AS cnt FROM ${dbName}.dbo.outgoing_assignment WHERE document_id = @docId`,
    { docId: documentId }
  );
  const assignCount = Number(assignRows[0]?.cnt || 0);
  if (assignCount > 0) {
    ok(`outgoing_assignment: ${assignCount} bản ghi`);
    passed++;
  } else {
    warn(`outgoing_assignment: chưa có dữ liệu (document có thể chưa sync)`);
    // Không fail cứng vì document mới chỉ có thể chưa có assignment
  }

  // 3. Kiểm tra outgoing_current_state tồn tại
  const stateRows = await query(
    pool,
    `SELECT * FROM ${dbName}.dbo.outgoing_current_state WHERE document_id = @docId`,
    { docId: documentId }
  );
  const state = stateRows[0];
  if (state) {
    ok(`outgoing_current_state: tồn tại`);
    passed++;

    // 3a. Kiểm tra current_stage_status không rỗng
    if (state.current_stage_status) {
      ok(`  ↳ current_stage_status = ${state.current_stage_status}`);
      passed++;
    } else {
      fail(`  ↳ current_stage_status bị NULL`);
      failed++;
    }

    // 3b. Kiểm tra last_audit_time không null
    if (state.last_audit_time) {
      ok(`  ↳ last_audit_time = ${state.last_audit_time}`);
      passed++;
    } else {
      warn(`  ↳ last_audit_time là NULL`);
    }

    // 3c. Kiểm tra flags nhất quán:
    //     has_ban_hanh → is_completed_doc phải = 1
    if (state.has_ban_hanh && !state.is_completed_doc) {
      fail(`  ↳ has_ban_hanh=1 nhưng is_completed_doc=0 (không nhất quán!)`);
      failed++;
    } else {
      ok(`  ↳ Flags nhất quán (has_ban_hanh=${state.has_ban_hanh}, is_completed_doc=${state.is_completed_doc})`);
      passed++;
    }

    // 3d. Kiểm tra last_audit_id có tồn tại trong bảng audit
    if (state.last_audit_id) {
      const auditCheck = await query(
        pool,
        `SELECT TOP 1 id FROM ${dbName}.dbo.audit WHERE id = @aid`,
        { aid: state.last_audit_id }
      );
      if (auditCheck.length > 0) {
        ok(`  ↳ last_audit_id=${state.last_audit_id} tồn tại trong audit`);
        passed++;
      } else {
        fail(`  ↳ last_audit_id=${state.last_audit_id} KHÔNG tồn tại trong audit (FK bị vỡ!)`);
        failed++;
      }
    }
  } else {
    warn(`outgoing_current_state: chưa có dữ liệu (document chưa được sync qua SyncOutgoingAuditModel)`);
  }

  // 4. Nhất quán giữa outgoing_assignment.last_audit_id ↔ audit
  if (assignCount > 0) {
    const orphanAssign = await query(
      pool,
      `SELECT COUNT(1) AS cnt
       FROM ${dbName}.dbo.outgoing_assignment oa
       WHERE oa.document_id = @docId
         AND oa.last_audit_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${dbName}.dbo.audit a WHERE a.id = oa.last_audit_id
         )`,
      { docId: documentId }
    );
    const orphanCount = Number(orphanAssign[0]?.cnt || 0);
    if (orphanCount === 0) {
      ok(`outgoing_assignment ↔ audit: tất cả last_audit_id đều hợp lệ`);
      passed++;
    } else {
      fail(`outgoing_assignment ↔ audit: ${orphanCount} bản ghi có last_audit_id bị mồ côi (orphan)`);
      failed++;
    }
  }

  return { passed, failed };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  head('🔍  KIỂM THỬ MULTI-TABLE SYNC — VĂN BẢN ĐI');

  const argDocId = process.argv[2];

  let pool;
  try {
    info('Đang kết nối DB mới...');
    pool = await getNewDbPool();
    ok(`Kết nối thành công đến ${process.env.NEW_DB_HOST}/${process.env.NEW_DB_NAME}`);
  } catch (err) {
    fail(`Không thể kết nối DB: ${err.message}`);
    process.exit(1);
  }

  let documentIds = [];
  if (argDocId) {
    documentIds = [argDocId];
    info(`Kiểm tra document có ID chỉ định: ${argDocId}`);
  } else {
    info('Không có documentId, lấy 5 document mới nhất từ outgoing_documents...');
    try {
      documentIds = await getSampleDocumentIds(pool, 5);
    } catch (err) {
      fail(`Không lấy được document mẫu: ${err.message}`);
      await pool.close();
      process.exit(1);
    }
    info(`Tìm thấy ${documentIds.length} document: ${documentIds.join(', ')}`);
  }

  if (documentIds.length === 0) {
    warn('Không có document nào để kiểm tra. Hãy chạy sync trước.');
    await pool.close();
    process.exit(0);
  }

  head('📋  KẾT QUẢ KIỂM TRA TỪNG DOCUMENT');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const docId of documentIds) {
    try {
      const { passed, failed } = await checkDocument(pool, docId);
      totalPassed += passed;
      totalFailed += failed;
    } catch (err) {
      fail(`Lỗi khi kiểm tra document ${docId}: ${err.message}`);
      totalFailed++;
    }
  }

  head('📊  TỔNG KẾT');
  console.log(`  Tổng kiểm tra: ${C.bold}${totalPassed + totalFailed}${C.reset}`);
  console.log(`  ${C.green}✓ Passed: ${totalPassed}${C.reset}`);
  if (totalFailed > 0) {
    console.log(`  ${C.red}✗ Failed: ${totalFailed}${C.reset}`);
  } else {
    console.log(`  ${C.green}✗ Failed: 0${C.reset}`);
  }
  console.log();

  await pool.close();

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n${C.red}Lỗi không mong muốn:${C.reset}`, err.message);
  process.exit(1);
});
