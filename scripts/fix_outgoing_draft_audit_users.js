/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER TRONG 3 BẢNG CỦA DỰ THẢO VĂN BẢN ĐI (Draft OutgoingDocument):
 *   1. dbo.audit
 *   2. dbo.outgoing_assignment
 *   3. dbo.outgoing_current_state
 * TRONG BẢNG AUDIT CỦA DỰ THẢO (table_backups = 'CodeItem' hoặc 'SLAStepDetail_sync')
 * HỖ TRỢ LƯU TRẠNG THÁI (CURSOR) VÀ CHẠY LẠI CÁC BẢN GHI LỖI QUA FILE STATE JSON.
 * CƠ CHẾ gracefully fallback: Nếu lỗi cả lô 100 dòng, chuyển sang cập nhật từng dòng để cứu 99 dòng tốt và chỉ lưu vết 1 dòng lỗi.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbConnection = require('../db/connection');
const MigrationHelper = require('../src/helpers/MigrationHelper');
const ReceiverParserService = require('../src/sync-audit/ReceiverParserService');

// Xử lý tham số dòng lệnh --year
const args = process.argv.slice(2);
let targetYear = null;
const yearArgIdx = args.findIndex(arg => arg === '--year');
if (yearArgIdx !== -1 && args[yearArgIdx + 1]) {
  targetYear = parseInt(args[yearArgIdx + 1], 10);
}

// File trạng thái được cô lập theo năm để chạy song song
const stateFileName = targetYear ? `state_draft_audit_${targetYear}.json` : 'state_draft_audit.json';
const STATE_FILE = path.join(__dirname, stateFileName);

// Khởi tạo trạng thái mặc định
let state = {
  lastYear: targetYear || 2013,
  lastCreatedAt: null,
  lastId: 0,
  failedRecords: []
};

// Đọc trạng thái cũ từ file
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log(`ℹ️ Đã nạp file trạng thái: Tiếp tục từ năm ${state.lastYear}, lastCreatedAt ${state.lastCreatedAt}, lastId ${state.lastId}. Số bản ghi lỗi tích lũy: ${state.failedRecords.length}`);
  } catch (err) {
    console.warn('⚠️ Lỗi đọc file trạng thái, dùng cấu hình mặc định:', err.message);
  }
}

// Đảm bảo năm đồng bộ khớp với tham số dòng lệnh nếu được set cứng
if (targetYear) {
  state.lastYear = targetYear;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Lỗi ghi file trạng thái:', err.message);
  }
}

// Hàm phụ để bulk update một mảng các updates sử dụng bảng tạm #AuditUpdates
async function executeBulkUpdates(newPool, updates, labelInfo) {
  const chunkSize = 100;
  let successCount = 0;

  for (let chunkIdx = 0; chunkIdx < updates.length; chunkIdx += chunkSize) {
    const chunk = updates.slice(chunkIdx, chunkIdx + chunkSize);
    const transaction = newPool.transaction();
    await transaction.begin();

    try {
      const req = transaction.request();
      const valuesSql = [];

      chunk.forEach((up, idx) => {
        const itemYear = new Date(up.createdAt || new Date()).getFullYear();
        const startD = `${itemYear}-01-01 00:00:00`;
        const endD = `${itemYear + 1}-01-01 00:00:00`;
        const isCreator = ['CREATE', 'TONG_HOP', 'SOAN_THAO'].includes(up.actionCode) ? 1 : 0;

        req.input(`id_${idx}`, up.id);
        req.input(`user_id_${idx}`, up.correctUserId);
        req.input(`created_by_${idx}`, up.correctUserId);
        req.input(`display_name_${idx}`, up.correctDisplayName);
        req.input(`receiver_${idx}`, up.correctReceiver);
        req.input(`receiver_unit_${idx}`, up.correctReceiverUnit);
        req.input(`document_id_${idx}`, up.documentId || null);
        req.input(`created_at_${idx}`, up.createdAt || new Date());
        req.input(`stage_status_${idx}`, up.stageStatus || 'CHUA_XU_LY');
        req.input(`role_process_${idx}`, up.roleProcess || 'VANTHU');
        req.input(`action_code_${idx}`, up.actionCode || null);
        req.input(`is_creator_${idx}`, isCreator);
        req.input(`start_date_${idx}`, startD);
        req.input(`end_date_${idx}`, endD);

        valuesSql.push(`(
          @id_${idx},
          @user_id_${idx},
          @created_by_${idx},
          @display_name_${idx},
          @receiver_${idx},
          @receiver_unit_${idx},
          @document_id_${idx},
          @created_at_${idx},
          @stage_status_${idx},
          @role_process_${idx},
          @action_code_${idx},
          @is_creator_${idx},
          @start_date_${idx},
          @end_date_${idx}
        )`);
      });

      const sqlBatch = `
        CREATE TABLE #AuditUpdates (
          id INT PRIMARY KEY,
          user_id VARCHAR(100),
          created_by VARCHAR(100),
          display_name NVARCHAR(255),
          receiver VARCHAR(100),
          receiver_unit VARCHAR(100),
          document_id VARCHAR(100),
          created_at DATETIME2,
          stage_status VARCHAR(50),
          role_process VARCHAR(50),
          action_code VARCHAR(100),
          is_creator INT,
          start_date DATETIME2,
          end_date DATETIME2
        );

        INSERT INTO #AuditUpdates (
          id, user_id, created_by, display_name, receiver, receiver_unit, document_id, created_at, stage_status, role_process, action_code, is_creator, start_date, end_date
        ) VALUES ${valuesSql.join(',')};

        -- 3. Bulk UPDATE dbo.audit (Lọc phân vùng động từ bảng tạm)
        UPDATE a
        SET a.user_id = u.user_id,
            a.created_by = u.created_by,
            a.display_name = u.display_name,
            a.receiver = u.receiver,
            a.receiver_unit = u.receiver_unit
        FROM dbo.audit a
        INNER JOIN #AuditUpdates u ON a.id = u.id
        WHERE (a.created_at >= u.start_date AND a.created_at < u.end_date);

        -- 3.5 Xóa các bản ghi phân công cũ để tránh trùng lặp khóa chính (PK)
        -- Bao gồm: (1) Trùng với bản ghi đã có sẵn trong DB, hoặc (2) Trùng với bản ghi khác trong cùng lô cập nhật
        DELETE target
        FROM dbo.outgoing_assignment target
        INNER JOIN #AuditUpdates src ON target.last_audit_id = src.id
        WHERE EXISTS (
          SELECT 1 
          FROM dbo.outgoing_assignment dup
          WHERE dup.document_id = target.document_id
            AND dup.receiver = src.receiver
            AND dup.role_process = src.role_process
            AND dup.last_audit_id <> target.last_audit_id
        ) OR EXISTS (
          SELECT 1 
          FROM #AuditUpdates newer
          WHERE newer.document_id = target.document_id
            AND newer.receiver = src.receiver
            AND newer.role_process = src.role_process
            AND newer.id > target.last_audit_id
        );


        -- 4. Bulk UPDATE dbo.outgoing_assignment (Lọc phân vùng động)
        UPDATE target
        SET target.receiver = src.receiver,
            target.role_process = src.role_process,
            target.stage_status = src.stage_status,
            target.receiver_unit = src.receiver_unit,
            target.is_creator = src.is_creator,
            target.updated_at = SYSDATETIME()
        FROM dbo.outgoing_assignment target
        INNER JOIN #AuditUpdates src ON target.last_audit_id = src.id
        WHERE (target.created_at >= src.start_date AND target.created_at < src.end_date);

        -- 5. Bulk MERGE dbo.outgoing_assignment
        WITH LatestUpdates AS (
          SELECT 
            document_id, 
            receiver, 
            role_process, 
            stage_status, 
            created_at, 
            id AS last_audit_id,
            receiver_unit,
            is_creator
          FROM (
            SELECT 
              document_id, receiver, role_process, stage_status, created_at, id, receiver_unit, is_creator,
              ROW_NUMBER() OVER (
                PARTITION BY document_id, receiver, role_process 
                ORDER BY id DESC
              ) as rn
            FROM #AuditUpdates
            WHERE document_id IS NOT NULL AND receiver IS NOT NULL
          ) t
          WHERE rn = 1
        )
        MERGE dbo.outgoing_assignment AS target
        USING LatestUpdates AS src
        ON target.document_id = src.document_id 
           AND target.receiver = src.receiver 
           AND target.role_process = src.role_process
        WHEN MATCHED THEN
          UPDATE SET target.stage_status = src.stage_status,
                     target.last_audit_id = src.last_audit_id,
                     target.receiver_unit = src.receiver_unit,
                     target.is_creator = src.is_creator,
                     target.updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (document_id, receiver, role_process, stage_status, created_at, last_audit_id, receiver_unit, is_creator, table_backups)
          VALUES (src.document_id, src.receiver, src.role_process, src.stage_status, src.created_at, src.last_audit_id, src.receiver_unit, src.is_creator, 'outgoing_assignment');

        -- 6. Bulk UPDATE dbo.outgoing_current_state
        UPDATE target
        SET target.current_receiver = src.receiver,
            target.current_role_process = src.role_process,
            target.current_stage_status = src.stage_status,
            target.current_action_code = src.action_code,
            target.updated_at = SYSDATETIME()
        FROM dbo.outgoing_current_state target
        INNER JOIN #AuditUpdates src ON target.document_id = src.document_id AND target.last_audit_id = src.id;

        DROP TABLE #AuditUpdates;
      `;

      await req.query(sqlBatch);
      await transaction.commit();
      successCount += chunk.length;
    } catch (err) {
      await transaction.rollback();
      console.warn(`⚠️ Lỗi lô ${chunk.length} dòng tại ${labelInfo}: ${err.message}. Đang chuyển sang chế độ cập nhật từng dòng (Single Fallback)...`);

      // CHẾ ĐỘ FALLBACK TỪNG DÒNG (Single fallback mode)
      for (const up of chunk) {
        const singleTx = newPool.transaction();
        await singleTx.begin();

        try {
          const reqSingle = singleTx.request();
          const itemYear = new Date(up.createdAt || new Date()).getFullYear();
          const startD = `${itemYear}-01-01 00:00:00`;
          const endD = `${itemYear + 1}-01-01 00:00:00`;
          const isCreator = ['CREATE', 'TONG_HOP', 'SOAN_THAO'].includes(up.actionCode) ? 1 : 0;

          reqSingle.input('id', up.id);
          reqSingle.input('userId', up.correctUserId);
          reqSingle.input('displayName', up.correctDisplayName);
          reqSingle.input('receiver', up.correctReceiver);
          reqSingle.input('receiverUnit', up.correctReceiverUnit);
          reqSingle.input('documentId', up.documentId || null);
          reqSingle.input('createdAt', up.createdAt || new Date());
          reqSingle.input('stageStatus', up.stageStatus || 'CHUA_XU_LY');
          reqSingle.input('roleProcess', up.roleProcess || 'VANTHU');
          reqSingle.input('actionCode', up.actionCode || null);
          reqSingle.input('isCreator', isCreator);
          reqSingle.input('startDate', startD);
          reqSingle.input('endDate', endD);

          const singleSql = `
            -- 1. Cập nhật dbo.audit
            UPDATE dbo.audit
            SET user_id = @userId,
                created_by = @userId,
                display_name = @displayName,
                receiver = @receiver,
                receiver_unit = @receiverUnit
            WHERE id = @id AND (created_at >= @startDate AND created_at < @endDate);

            -- 2. Cập nhật dbo.outgoing_assignment
            UPDATE dbo.outgoing_assignment
            SET receiver = @receiver,
                role_process = @roleProcess,
                stage_status = @stageStatus,
                receiver_unit = @receiverUnit,
                is_creator = @isCreator,
                updated_at = SYSDATETIME()
            WHERE last_audit_id = @id AND (created_at >= @startDate AND created_at < @endDate);

            IF @@ROWCOUNT = 0 AND @documentId IS NOT NULL AND @receiver IS NOT NULL
            BEGIN
              MERGE dbo.outgoing_assignment AS target
              USING (SELECT @documentId AS document_id, @receiver AS receiver, @roleProcess AS role_process) AS src
              ON target.document_id = src.document_id 
                 AND target.receiver = src.receiver 
                 AND target.role_process = src.role_process
              WHEN MATCHED THEN
                UPDATE SET target.stage_status = @stageStatus,
                           target.last_audit_id = @id,
                           target.receiver_unit = @receiverUnit,
                           target.is_creator = @isCreator,
                           target.updated_at = SYSDATETIME()
              WHEN NOT MATCHED THEN
                INSERT (document_id, receiver, role_process, stage_status, created_at, last_audit_id, receiver_unit, is_creator, table_backups)
                VALUES (src.document_id, src.receiver, src.role_process, @stageStatus, @createdAt, @id, @receiverUnit, @isCreator, 'outgoing_assignment');
            END

            -- 3. Cập nhật dbo.outgoing_current_state
            IF @documentId IS NOT NULL
            BEGIN
              UPDATE dbo.outgoing_current_state
              SET current_receiver = @receiver,
                  current_role_process = @roleProcess,
                  current_stage_status = @stageStatus,
                  current_action_code = @actionCode,
                  updated_at = SYSDATETIME()
              WHERE document_id = @documentId AND last_audit_id = @id;
            END
          `;

          await reqSingle.query(singleSql);
          await singleTx.commit();
          successCount++;
        } catch (sErr) {
          await singleTx.rollback();
          
          const isPkViolation = sErr.message.includes("Violation of PRIMARY KEY constraint") || 
                              sErr.message.includes("Cannot insert duplicate key");

          if (isPkViolation) {
            console.warn(`⚠️ Bỏ qua lỗi khóa chính trùng lặp (PK) cho bản ghi ID ${up.id} (Tài liệu: ${up.documentId}, Receiver: ${up.correctReceiver})`);
            successCount++;
          } else {
            console.error(`❌ Bản ghi ID ${up.id} lỗi thực tế:`, sErr.message);

            // Chỉ lưu vết đúng bản ghi bị lỗi này
            if (!state.failedRecords.some(f => f.id === up.id)) {
              state.failedRecords.push({
                ...up,
                error: sErr.message,
                failedAt: new Date().toISOString()
              });
            }
            saveState();
          }
        }
      }
    }
  }
  return successCount;
}

async function main() {
  console.log('=================================================================');
  console.log('=== KÍCH HOẠT SCRIPT BULK FIX DRAFT AUDIT & ASSIGNMENT & STATE ===');
  console.log('=================================================================\n');

  console.log('Connecting to databases...');
  await dbConnection.connectAll();

  const oldPool = dbConnection.getOldPool();
  const newPool = dbConnection.getNewPool();

  if (!oldPool || !newPool) {
    console.error('❌ Không thể kết nối đến CSDL Cũ hoặc CSDL Mới!');
    process.exit(1);
  }

  // Khởi tạo MigrationHelper & ReceiverParserService
  const helper = new MigrationHelper(
    (query, params) => {
      const req = newPool.request();
      if (params) {
        Object.keys(params).forEach(k => req.input(k, params[k]));
      }
      return req.query(query).then(r => r.recordset);
    },
    (query, params) => {
      const req = oldPool.request();
      if (params) {
        Object.keys(params).forEach(k => req.input(k, params[k]));
      }
      return req.query(query).then(r => r.recordset);
    }
  );

  const receiverParser = new ReceiverParserService(
    (query, params) => {
      const req = newPool.request();
      if (params) {
        Object.keys(params).forEach(k => req.input(k, params[k]));
      }
      return req.query(query).then(r => r.recordset);
    },
    (query, params) => {
      const req = oldPool.request();
      if (params) {
        Object.keys(params).forEach(k => req.input(k, params[k]));
      }
      return req.query(query).then(r => r.recordset);
    },
    helper
  );

  // 1. Nạp bản đồ Email từ DB Cũ (dbo.PersonalProfile)
  console.log('[1/4] Đang nạp bản đồ Email từ DB Cũ (dbo.PersonalProfile)...');
  const oldProfilesRes = await oldPool.request().query(`
    SELECT ID, AccountID, FullName, StaffID, Email
    FROM dbo.PersonalProfile
    WHERE Email IS NOT NULL AND LTRIM(RTRIM(Email)) <> ''
  `);

  const profileToEmailMap = new Map();
  const idToEmailMap = new Map();
  let profileCount = 0;

  for (const row of oldProfilesRes.recordset) {
    const email = String(row.Email).trim().toLowerCase();
    if (!email.includes('@')) continue;

    profileCount++;
    if (row.ID) {
      idToEmailMap.set(String(row.ID).trim(), email);
      profileToEmailMap.set(String(row.ID).trim().toLowerCase(), email);
    }
    if (row.AccountID) profileToEmailMap.set(String(row.AccountID).trim().toLowerCase(), email);
    if (row.StaffID) profileToEmailMap.set(String(row.StaffID).trim().toLowerCase(), email);
    if (row.FullName) {
      profileToEmailMap.set(String(row.FullName).trim().toLowerCase(), email);
      const cleanName = String(row.FullName).split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
      if (!profileToEmailMap.has(cleanName)) {
        profileToEmailMap.set(cleanName, email);
      }
    }
  }
  console.log(`-> Đã nạp thành công ${profileCount} Email từ DB Cũ vào bộ nhớ RAM.\n`);

  // 2. Nạp bản đồ Users từ DB Mới (dbo.users)
  console.log('[2/4] Đang nạp bản đồ User ID & Tên hiển thị từ DB Mới (dbo.users)...');
  const newUsersRes = await newPool.request().query(`
    SELECT id, email_user, name FROM dbo.users
  `);

  const emailToUserInfoMap = new Map();
  let newUserCount = 0;

  for (const u of newUsersRes.recordset) {
    if (u.email_user) {
      const email = String(u.email_user).trim().toLowerCase();
      if (email.includes('@')) {
        emailToUserInfoMap.set(email, { id: u.id, name: u.name });
        newUserCount++;
      }
    }
  }
  console.log(`-> Đã nạp thành công ${newUserCount} User Info từ DB Mới vào bộ nhớ RAM.\n`);

  // --- PHASE 1: CHẠY LẠI CÁC BẢN GHI LỖI TỪ LẦN CHẠY TRƯỚC (NẾU CÓ) ---
  if (state.failedRecords && state.failedRecords.length > 0) {
    console.log(`🔄 [Phase 1] Đang xử lý lại ${state.failedRecords.length} bản ghi lỗi từ lần chạy trước...`);
    const retryList = [...state.failedRecords];
    state.failedRecords = []; // Reset để ghi nhận lại nếu vẫn tiếp tục lỗi
    saveState();

    const okCount = await executeBulkUpdates(newPool, retryList, 'Phase 1 - Retry Draft');
    console.log(`-> Đã sửa thành công: ${okCount}/${retryList.length} bản ghi lỗi cũ. Còn lại ${retryList.length - okCount} bản ghi tiếp tục lỗi.\n`);
  }

  // --- PHASE 2: QUÉT TIẾP TỤC THEO CON TRỎ NĂM VÀ KEYSET PAGINATION (CREATED_AT, ID) ---
  console.log('[3/4] Bắt đầu rà soát tiến trình chính theo phân vùng năm (2013 -> 2030)...');

  const START_YEAR = targetYear || 2013;
  const END_YEAR = targetYear || 2030;
  const BATCH_SIZE = 2000;

  let grandTotalProcessed = 0;
  let grandTotalUpdated = 0;
  let grandTotalSkipped = 0;
  let grandTotalNotFound = 0;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    // Nếu không chạy song song, kiểm tra năm hoàn thành
    if (!targetYear && year < state.lastYear) {
      console.log(`⏭️ Bỏ qua năm ${year} (Đã xử lý xong ở lần chạy trước)`);
      continue;
    }

    const startDate = `${year}-01-01 00:00:00`;
    const endDate = `${year + 1}-01-01 00:00:00`;

    const countReq = newPool.request();
    countReq.input('startDate', startDate);
    countReq.input('endDate', endDate);
    const countRes = await countReq.query(`
      SELECT COUNT(1) AS total 
      FROM dbo.audit 
      WHERE (created_at >= @startDate AND created_at < @endDate)
        AND type_document = 'OutgoingDocument'
        AND (table_backups = 'CodeItem' OR table_backups = 'SLAStepDetail_sync')
    `);

    const yearTotal = countRes.recordset[0].total;
    if (yearTotal === 0) {
      if (year === state.lastYear) {
        state.lastCreatedAt = null;
        state.lastId = 0;
        state.lastYear = year + 1;
        saveState();
      }
      continue;
    }

    console.log(`\n📅 --- NĂM ${year}: Phát hiện ${yearTotal} bản ghi audit dự thảo [OutgoingDocument] ---`);

    // Phục hồi con trỏ nếu đang ở năm cũ bị gián đoạn
    let lastCreatedAt = null;
    let lastId = 0;
    if (year === state.lastYear) {
      lastCreatedAt = state.lastCreatedAt;
      lastId = state.lastId || 0;
      if (lastCreatedAt) {
        console.log(`⏭️ Tiếp tục từ thời điểm ${lastCreatedAt}, lastId ${lastId}...`);
      }
    }

    let yearUpdated = 0;
    let yearSkipped = 0;
    let yearNotFound = 0;
    let pageCount = 0;

    while (true) {
      const pageTStart = Date.now();

      const pageReq = newPool.request();
      pageReq.input('startDate', startDate);
      pageReq.input('endDate', endDate);
      let pageRes;
      if (lastCreatedAt) {
        pageReq.input('lastCreatedAt', new Date(lastCreatedAt));
        pageReq.input('lastId', lastId);
        pageRes = await pageReq.query(`
          SELECT TOP (${BATCH_SIZE}) id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action_code, action, document_id, created_at, stage_status
          FROM dbo.audit
          WHERE (created_at >= @startDate AND created_at < @endDate)
            AND type_document = 'OutgoingDocument'
            AND (table_backups = 'CodeItem' OR table_backups = 'SLAStepDetail_sync')
            AND (
              (created_at > @lastCreatedAt)
              OR (created_at = @lastCreatedAt AND id > @lastId)
            )
          ORDER BY created_at ASC, id ASC
        `);
      } else {
        pageRes = await pageReq.query(`
          SELECT TOP (${BATCH_SIZE}) id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action_code, action, document_id, created_at, stage_status
          FROM dbo.audit
          WHERE (created_at >= @startDate AND created_at < @endDate)
            AND type_document = 'OutgoingDocument'
            AND (table_backups = 'CodeItem' OR table_backups = 'SLAStepDetail_sync')
          ORDER BY created_at ASC, id ASC
        `);
      }

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;

      // Chia các dòng thành 2 nhóm: CodeItem và SLAStepDetail_sync
      const codeItemOriginIds = new Set();
      const slaStepItemIds = new Set();

      for (const r of rows) {
        if (!r.origin_id) continue;
        const tb = String(r.table_backups).trim();

        if (tb === 'CodeItem') {
          codeItemOriginIds.add(String(r.origin_id).trim());
        } else if (tb === 'SLAStepDetail_sync') {
          const match = String(r.origin_id).match(/^sla_step_(\d+)_(\d+)_/);
          if (match) {
            const recordId = match[1];
            slaStepItemIds.add(recordId);
          }
        }
      }

      // 1. Fetch dữ liệu từ SNP.CodeItem ở DB Cũ
      const batchCodeItemMap = new Map();
      if (codeItemOriginIds.size > 0) {
        const arr = Array.from(codeItemOriginIds);
        const chunkSize = 1000;
        for (let i = 0; i < arr.length; i += chunkSize) {
          const chunk = arr.slice(i, i + chunkSize);
          try {
            const reqCI = oldPool.request();
            const inClause = chunk.map((idVal, idx) => {
              reqCI.input(`ci_${idx}`, parseInt(idVal, 10));
              return `@ci_${idx}`;
            }).join(',');

            const resCI = await reqCI.query(`
              SELECT ID, CreatedBy, CBNV, Approver 
              FROM [SNP].[CodeItem] 
              WHERE ID IN (${inClause})
            `);

            for (const item of resCI.recordset) {
              batchCodeItemMap.set(String(item.ID), item);
            }
          } catch (e) {}
        }
      }

      // 2. Fetch dữ liệu từ [SNP].[SLAStepDetail] và [SNP].[SLAStepDetail_History] ở DB Cũ
      const batchSlaStepsMap = new Map();
      if (slaStepItemIds.size > 0) {
        const arr = Array.from(slaStepItemIds);
        const chunkSize = 500;
        for (let i = 0; i < arr.length; i += chunkSize) {
          const chunk = arr.slice(i, i + chunkSize);
          try {
            const reqSLA = oldPool.request();
            const inClause = chunk.map((idVal, idx) => {
              reqSLA.input('itemId_' + idx, parseInt(idVal, 10));
              return '@itemId_' + idx;
            }).join(',');

            const resSLA = await reqSLA.query(`
              SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy
              FROM (
                SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy FROM [SNP].[SLAStepDetail] WHERE ItemID IN (${inClause})
                UNION ALL
                SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy FROM [SNP].[SLAStepDetail_History] WHERE ItemID IN (${inClause})
              ) s
            `);

            for (const item of resSLA.recordset) {
              const key = `${item.ItemID}_${item.Step}`;
              batchSlaStepsMap.set(key, item);
            }
          } catch (e) {}
        }
      }

      const updates = [];

      for (const a of rows) {
        const tb = String(a.table_backups).trim();
        let targetEmail = null;
        let originalActorName = null;

        if (tb === 'CodeItem') {
          const oldCI = batchCodeItemMap.get(String(a.origin_id).trim());
          if (oldCI) {
            const rawCreator = oldCI.CreatedBy || oldCI.CBNV || '';
            originalActorName = rawCreator;
            targetEmail = idToEmailMap.get(String(rawCreator).trim()) || profileToEmailMap.get(String(rawCreator).trim().toLowerCase());
          }
        } else if (tb === 'SLAStepDetail_sync') {
          const match = String(a.origin_id).match(/^sla_step_(\d+)_(\d+)_\w+/);
          if (match) {
            const recordId = match[1];
            const stepVal = match[2];
            const oldCreatedBy = match[3];

            const key = `${recordId}_${stepVal}`;
            const stepRec = batchSlaStepsMap.get(key);

            if (stepRec) {
              const oldActorId = stepRec.UserID || stepRec.CreatedBy || oldCreatedBy;
              originalActorName = `User ID ${oldActorId}`;
              targetEmail = idToEmailMap.get(String(oldActorId).trim());
            } else {
              targetEmail = idToEmailMap.get(String(oldCreatedBy).trim());
            }
          }
        }

        if (!targetEmail && originalActorName) {
          const cleanKey = originalActorName.split(/\s*[-–—(]\s*/)[0].trim().replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, '').trim().toLowerCase();
          targetEmail = profileToEmailMap.get(cleanKey);
        }

        let matchedUserInfo = null;
        if (targetEmail) {
          matchedUserInfo = emailToUserInfoMap.get(targetEmail);
        }

        if (!matchedUserInfo && a.display_name) {
          const cleanName = String(a.display_name).split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
          if (cleanName && cleanName.length >= 2) {
            for (const u of newUsersRes.recordset) {
              if (u.name && (u.name.toLowerCase().includes(cleanName) || cleanName.includes(u.name.toLowerCase()))) {
                matchedUserInfo = { id: u.id, name: u.name };
                break;
              }
            }
          }
        }

        if (matchedUserInfo && matchedUserInfo.id) {
          const correctUserId = matchedUserInfo.id;
          const correctDisplayName = matchedUserInfo.name || a.display_name || 'Người dùng hệ thống';

          let correctReceiver = correctUserId;
          let correctReceiverUnit = a.receiver_unit || null;

          if (
            a.user_id !== correctUserId ||
            a.created_by !== correctUserId ||
            a.display_name !== correctDisplayName ||
            a.receiver !== correctReceiver ||
            a.receiver_unit !== correctReceiverUnit
          ) {
            updates.push({
              id: a.id,
              documentId: a.document_id,
              createdAt: a.created_at,
              stageStatus: a.stage_status,
              roleProcess: a.roleProcess,
              actionCode: a.action_code,
              correctUserId,
              correctDisplayName,
              correctReceiver,
              correctReceiverUnit
            });
          } else {
            yearSkipped++;
          }
        } else {
          yearNotFound++;
        }
      }

      // THỰC HIỆN BATCH UPDATE
      if (updates.length > 0) {
        const okCount = await executeBulkUpdates(newPool, updates, `Năm ${year} ID > ${lastId}`);
        yearUpdated += okCount;
      }

      // Giải phóng RAM sau mỗi Batch
      batchOldRecordMap.clear();
      codeItemOriginIds.clear();
      slaStepItemIds.clear();

      const lastRow = rows[rows.length - 1];
      lastCreatedAt = lastRow.created_at.toISOString();
      lastId = lastRow.id;
      pageCount++;

      // Cập nhật trạng thái con trỏ và lưu file
      state.lastYear = year;
      state.lastCreatedAt = lastCreatedAt;
      state.lastId = lastId;
      saveState();

      console.log(` -> Trang ${pageCount}: Năm ${year} Thời điểm hiện tại: ${lastCreatedAt}, lastId: ${lastId} (Đã cập nhật mới: ${yearUpdated}, Đã chuẩn sẵn: ${yearSkipped})`);
    }

    // Kết thúc 1 năm trọn vẹn, reset con trỏ về 0 cho năm kế tiếp
    state.lastYear = year + 1;
    state.lastCreatedAt = null;
    state.lastId = 0;
    saveState();

    grandTotalProcessed += yearTotal;
    grandTotalUpdated += yearUpdated;
    grandTotalSkipped += yearSkipped;
    grandTotalNotFound += yearNotFound;
  }

  console.log('\n=================================================================');
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION DỰ THẢO VĂN BẢN ĐI (2013 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [Draft Outgoing]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật thành công: ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log(`- Số bản ghi lỗi hiện tại (xem file state_draft_audit.json): ${state.failedRecords.length}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix audit:', err);
  process.exit(1);
});
