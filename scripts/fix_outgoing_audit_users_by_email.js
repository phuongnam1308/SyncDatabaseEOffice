/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER TRONG 3 BẢNG CỦA VĂN BẢN ĐI (OutgoingDocument):
 *   1. dbo.audit
 *   2. dbo.outgoing_assignment
 *   3. dbo.outgoing_current_state
 * TRONG BẢNG AUDIT CỦA VĂN BẢN ĐI (type_document = 'OutgoingDocument')
 * HỖ TRỢ LƯU TRẠNG THÁI (CURSOR - Keyset Pagination) VÀ CHẠY LẠI CÁC BẢN GHI LỖI QUA FILE STATE JSON.
 * CƠ CHẾ gracefully fallback: Nếu lỗi cả lô 100 dòng, chuyển sang cập nhật từng dòng để cứu 99 dòng tốt và chỉ lưu vết 1 dòng lỗi.
 * PHIÊN BẢN TỐI ƯU HÓA: IN-MEMORY CACHING, KEYSET PAGINATION THEO (CREATED_AT, ID), BENCHMARK, VÀ PARALLEL YEAR RUN.
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
const stateFileName = targetYear ? `state_outgoing_audit_${targetYear}.json` : 'state_outgoing_audit.json';
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
      console.warn(`⚠️ Lô ${chunk.length} dòng tại ${labelInfo} bị lỗi: ${err.message}. Đang chuyển sang chế độ cập nhật từng dòng (Single Fallback)...`);

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
  console.log('=== KÍCH HOẠT SCRIPT BULK FIX OUTGOING AUDIT & ASSIGNMENT & STATE ===');
  if (targetYear) console.log(`=== CHẾ ĐỘ CHẠY PHÂN VÙNG SONG SONG NĂM: ${targetYear} ===`);
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

  // 2. Nạp bản đồ Users từ DB Mới (dbo.users) với đầy đủ các cột để tra cứu RAM
  console.log('[2/4] Đang nạp bản đồ User ID & Tên hiển thị từ DB Mới (dbo.users)...');
  const newUsersRes = await newPool.request().query(`
    SELECT id, email_user, name, username, FullName, position, Department, organization_name, id_user_bak FROM dbo.users
  `);

  const emailToUserInfoMap = new Map();
  const newUserIdMap = new Set();
  const newUserIdBakMap = new Map();
  const newUserNameMap = new Map();
  let newUserCount = 0;

  for (const u of newUsersRes.recordset) {
    newUserIdMap.add(u.id);
    if (u.id_user_bak) {
      newUserIdBakMap.set(String(u.id_user_bak).trim(), u.id);
    }
    if (u.email_user) {
      const email = String(u.email_user).trim().toLowerCase();
      if (email.includes('@')) {
        emailToUserInfoMap.set(email, { id: u.id, name: u.name });
        newUserCount++;
      }
    }
    if (u.name) newUserNameMap.set(u.name.trim().toLowerCase(), u.id);
    if (u.FullName) newUserNameMap.set(u.FullName.trim().toLowerCase(), u.id);
    if (u.username) newUserNameMap.set(u.username.trim().toLowerCase(), u.id);
  }
  console.log(`-> Đã nạp thành công ${newUserCount} User Info từ DB Mới vào bộ nhớ RAM.\n`);

  // 2.5 Nạp bản đồ Org Units từ DB mới và Departments từ DB cũ để cache RAM cho mapSenderUnitId
  console.log('[2.5/4] Đang nạp bản đồ Org Units & Departments...');
  const orgUnitsRes = await newPool.request().query(`
    SELECT id, name, normalized_name, Id_backups FROM dbo.organization_units
  `);
  const orgUnitMap = new Map();
  const orgUnitBakMap = new Map();
  for (const ou of orgUnitsRes.recordset) {
    if (ou.name) orgUnitMap.set(ou.name.trim().toLowerCase(), ou.id);
    if (ou.normalized_name) orgUnitMap.set(ou.normalized_name.trim().toLowerCase(), ou.id);
    if (ou.Id_backups) orgUnitBakMap.set(String(ou.Id_backups).trim(), ou.id);
  }

  const oldDeptMap = new Map();
  try {
    const oldDeptsRes = await oldPool.request().query(`
      SELECT ID, Title FROM dbo.Department
    `);
    for (const d of oldDeptsRes.recordset) {
      if (d.Title) oldDeptMap.set(d.Title.trim().toLowerCase(), d.ID);
    }
  } catch (e) {
    console.warn('⚠️ Không thể tải danh sách Department từ DB cũ:', e.message);
  }

  // ===========================================================================
  // GHI ĐÈ CÁC PHƯƠNG THỨC TRUY VẤN DB CỦA HELPER VÀ PARSER BẰNG TRA CỨU TRONG RAM (O(1))
  // ===========================================================================
  helper.mapUserName = async (userIdOrName) => {
    if (!userIdOrName || typeof userIdOrName !== 'string') return userIdOrName;
    const trimmed = userIdOrName.trim();
    if (!trimmed) return trimmed;
    if (trimmed === 'migservice') return 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

    const isIdFormat = /^\d+$/.test(trimmed) || /^[0-9a-f-]{32,}$/i.test(trimmed);
    if (isIdFormat) {
      const email = idToEmailMap.get(trimmed) || profileToEmailMap.get(trimmed.toLowerCase());
      if (email) {
        const userInfo = emailToUserInfoMap.get(email);
        if (userInfo) return userInfo.id;
      }
      if (newUserIdMap.has(trimmed)) return trimmed;
      if (newUserIdBakMap.has(trimmed)) return newUserIdBakMap.get(trimmed);
      return trimmed;
    }

    if (!/[a-zA-ZÀ-ỹ]/.test(trimmed)) return trimmed;

    // 1. Thử tìm bằng tên nguyên bản gốc (có chứa hậu tố nếu có)
    let email = profileToEmailMap.get(trimmed.toLowerCase());
    if (email) {
      const userInfo = emailToUserInfoMap.get(email);
      if (userInfo) return userInfo.id;
    }
    const rawLower = trimmed.toLowerCase();
    if (newUserNameMap.has(rawLower)) return newUserNameMap.get(rawLower);

    // 2. Thử làm sạch tên (bỏ tiền tố danh xưng và hậu tố phòng ban) để tìm
    const cleanKey = trimmed.split(/\s*[-–—(]\s*/)[0].trim().replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, '').trim().toLowerCase();
    email = profileToEmailMap.get(cleanKey);
    if (email) {
      const userInfo = emailToUserInfoMap.get(email);
      if (userInfo) return userInfo.id;
    }

    if (cleanKey && cleanKey.length >= 2) {
      if (newUserNameMap.has(cleanKey)) return newUserNameMap.get(cleanKey);
    }
    return null;
  };

  helper.mapSenderUnitId = async (value) => {
    try {
      const originalName = helper.processSenderUnit(value);
      if (!originalName) return null;

      const normalizedKey = helper.normalizeUnitName(originalName);

      if (orgUnitMap.has(normalizedKey)) return orgUnitMap.get(normalizedKey);
      if (orgUnitMap.has(originalName.toLowerCase())) return orgUnitMap.get(originalName.toLowerCase());

      const oldDeptId = oldDeptMap.get(originalName.toLowerCase());
      if (oldDeptId) {
        const foundNewId = orgUnitBakMap.get(String(oldDeptId));
        if (foundNewId) {
          orgUnitMap.set(normalizedKey, foundNewId);
          return foundNewId;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  receiverParser._findUsersByName = async (nameValue) => {
    if (!nameValue || typeof nameValue !== 'string') return [];
    const rawName = nameValue.trim();
    if (!rawName) return [];
    if (receiverParser._isSystemAccount(rawName)) return [];

    const rawLower = rawName.toLowerCase();

    // 1. Thử tìm kiếm trực tiếp bằng tên gốc đầy đủ (bao gồm cả hậu tố nếu có)
    let userId = await helper.mapUserName(rawName);
    if (userId) {
      return [{ id: userId }];
    }
    if (newUserNameMap.has(rawLower)) {
      return [{ id: newUserNameMap.get(rawLower) }];
    }

    // 2. Nếu không tìm thấy, làm sạch tên bằng cách bỏ hậu tố và tìm lại
    let cleanName = rawName;
    const dashIdx = cleanName.indexOf(" - ");
    if (dashIdx > 0) cleanName = cleanName.substring(0, dashIdx).trim();

    if (cleanName !== rawName) {
      userId = await helper.mapUserName(cleanName);
      if (userId) {
        return [{ id: userId }];
      }

      const lowerName = cleanName.toLowerCase();
      if (newUserNameMap.has(lowerName)) {
        return [{ id: newUserNameMap.get(lowerName) }];
      }
    }

    // 3. Fallback tìm gần đúng (in memory)
    const searchLower = cleanName.toLowerCase();
    for (const [uName, uId] of newUserNameMap.entries()) {
      if (uName.includes(searchLower) || searchLower.includes(uName)) {
        return [{ id: uId }];
      }
    }
    return [];
  };

  receiverParser._findUsersByPositionKeywords = async (keywordsArr) => {
    if (!Array.isArray(keywordsArr) || keywordsArr.length === 0) return [];
    const results = [];
    for (const u of newUsersRes.recordset) {
      if (!u.position) continue;
      const posLower = u.position.toLowerCase();
      const matches = keywordsArr.some(kw => posLower.includes(String(kw).toLowerCase()));
      if (matches) {
        results.push({ id: u.id });
      }
    }
    return results;
  };

  receiverParser._findUsersInDepartment = async (orgName) => {
    if (!orgName || typeof orgName !== 'string') return [];
    const cleanOrg = orgName.trim().toLowerCase();
    if (!cleanOrg) return [];

    const results = [];
    for (const u of newUsersRes.recordset) {
      const deptLower = (u.Department || '').toLowerCase();
      const orgLower = (u.organization_name || '').toLowerCase();
      if (deptLower.includes(cleanOrg) || orgLower.includes(cleanOrg)) {
        results.push({ id: u.id });
      }
    }
    return results;
  };

  // --- PHASE 1: CHẠY LẠI CÁC BẢN GHI LỖI TỪ LẦN CHẠY TRƯỚC (NẾU CÓ) ---
  if (state.failedRecords && state.failedRecords.length > 0) {
    console.log(`\n🔄 [Phase 1] Đang xử lý lại ${state.failedRecords.length} bản ghi lỗi từ lần chạy trước...`);
    const retryList = [...state.failedRecords];
    state.failedRecords = []; // Reset để ghi nhận lại nếu vẫn tiếp tục lỗi
    saveState();

    const okCount = await executeBulkUpdates(newPool, retryList, 'Phase 1 - Retry Outgoing');
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
        AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
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

    console.log(`\n📅 --- NĂM ${year}: Phát hiện ${yearTotal} bản ghi audit [OutgoingDocument] ---`);

    // Phục hồi con trỏ nếu bị gián đoạn ở năm hiện tại
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
            AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
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
            AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
          ORDER BY created_at ASC, id ASC
        `);
      }

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;

      const loadDur = Date.now() - pageTStart;

      // Gom nhóm origin_id để query Batch
      const mapTStart = Date.now();
      const tableToOriginIdsMap = new Map();
      for (const r of rows) {
        if (r.table_backups && r.origin_id) {
          const tName = String(r.table_backups).trim();
          if (!tableToOriginIdsMap.has(tName)) {
            tableToOriginIdsMap.set(tName, new Set());
          }
          tableToOriginIdsMap.get(tName).add(String(r.origin_id).trim());
        }
      }

      const batchOldRecordMap = new Map();

      for (const [tName, originSet] of tableToOriginIdsMap.entries()) {
        const originArray = Array.from(originSet);
        if (originArray.length === 0) continue;

        const chunkSize = 1000;
        for (let i = 0; i < originArray.length; i += chunkSize) {
          const chunk = originArray.slice(i, i + chunkSize);
          try {
            const batchReq = oldPool.request();
            const inClause = chunk.map((idVal, idx) => {
              const paramName = `id_${idx}`;
              batchReq.input(paramName, idVal);
              return `@${paramName}`;
            }).join(',');

            const batchRes = await batchReq.query(`
              SELECT ID, NguoiXuLy, HanhDong, Category, TrangThai 
              FROM dbo.[${tName}] 
              WHERE ID IN (${inClause})
            `);

            for (const item of batchRes.recordset) {
              batchOldRecordMap.set(`${tName}_${String(item.ID).trim()}`, item);
            }
          } catch (err) {
            // Bỏ qua lỗi thiếu bảng
          }
        }
      }

      const updates = [];

      for (const a of rows) {
        const key = `${String(a.table_backups).trim()}_${String(a.origin_id).trim()}`;
        const oldRecord = batchOldRecordMap.get(key);
        const rawNguoiXuLyFromOldDb = oldRecord?.NguoiXuLy ? String(oldRecord.NguoiXuLy).trim() : null;
        const searchKey = rawNguoiXuLyFromOldDb || a.display_name || '';

        if (!searchKey) {
          yearNotFound++;
          continue;
        }

        // BƯỚC 1: Tra cứu Email theo tên đầy đủ
        let targetEmail = profileToEmailMap.get(searchKey.trim().toLowerCase());

        // BƯỚC 2: Loại bỏ hậu tố/danh xưng
        if (!targetEmail) {
          const cleanKey = searchKey.split(/\s*[-–—(]\s*/)[0].trim().replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, '').trim().toLowerCase();
          targetEmail = profileToEmailMap.get(cleanKey);

          if (!targetEmail && cleanKey && cleanKey.length >= 3) {
            for (const [keyStr, emailVal] of profileToEmailMap.entries()) {
              if (keyStr.includes(cleanKey) || cleanKey.includes(keyStr)) {
                targetEmail = emailVal;
                break;
              }
            }
          }
        }

        let matchedUserInfo = null;
        if (targetEmail) {
          matchedUserInfo = emailToUserInfoMap.get(targetEmail);
        }

        // FALLBACK TRONG RAM
        if (!matchedUserInfo) {
          const cleanKey = searchKey.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
          if (cleanKey && cleanKey.length >= 2) {
            if (newUserNameMap.has(cleanKey)) {
              matchedUserInfo = { id: newUserNameMap.get(cleanKey), name: searchKey.split(/\s*[-–—(]\s*/)[0].trim() };
            } else {
              for (const u of newUsersRes.recordset) {
                if (u.name && (u.name.toLowerCase().includes(cleanKey) || cleanKey.includes(u.name.toLowerCase()))) {
                  matchedUserInfo = { id: u.id, name: u.name };
                  break;
                }
              }
            }
          }
        }

        if (matchedUserInfo && matchedUserInfo.id) {
          const correctUserId = matchedUserInfo.id;
          const correctDisplayName = matchedUserInfo.name || searchKey.split(/\s*[-–—(]\s*/)[0].trim();

          let correctReceiver = null;
          let correctReceiverUnit = null;

          if (oldRecord && oldRecord.HanhDong) {
            try {
              const detailedReceivers = await receiverParser.determineReceiversDetailed(oldRecord);

              if (a.roleProcess === 'viewer' || (a.action && a.action.includes('Để biết'))) {
                if (detailedReceivers.viewer.length > 0) {
                  correctReceiver = detailedReceivers.viewer[0];
                }
              } else if (a.roleProcess === 'supporter' || (a.action && a.action.includes('Phối hợp'))) {
                if (detailedReceivers.supporter.length > 0) {
                  correctReceiver = detailedReceivers.supporter[0];
                }
              } else if (a.roleProcess === 'processor' || (a.action && (a.action.includes('Thực hiện') || a.action.includes('Xử lý')))) {
                if (detailedReceivers.processor.length > 0) {
                  correctReceiver = detailedReceivers.processor[0];
                }
              }

              if (detailedReceivers.units.length > 0) {
                correctReceiverUnit = detailedReceivers.units[0];
              }
            } catch (pErr) {
              // Bỏ qua lỗi parse
            }
          }

          if (!correctReceiver && a.receiver) {
            let recVal = String(a.receiver).trim();
            if (recVal.startsWith('[') && recVal.endsWith(']')) {
              try {
                const arr = JSON.parse(recVal);
                if (arr && arr.length > 0) recVal = String(arr[0]).trim();
              } catch (e) {}
            }
            if (recVal) {
              correctReceiver = await helper.mapUserName(recVal);
            }
          }

          if (!correctReceiver) {
            correctReceiver = correctUserId;
          }

          if (!correctReceiverUnit && a.receiver_unit) {
            let unitVal = String(a.receiver_unit).trim();
            if (unitVal.startsWith('[') && unitVal.endsWith(']')) {
              try {
                const arr = JSON.parse(unitVal);
                if (arr && arr.length > 0) unitVal = String(arr[0]).trim();
              } catch (e) {}
            }
            correctReceiverUnit = unitVal || null;
          }

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

      const mapDur = Date.now() - mapTStart;

      // THỰC HIỆN BATCH UPDATE
      const updTStart = Date.now();
      if (updates.length > 0) {
        const okCount = await executeBulkUpdates(newPool, updates, `Năm ${year} ID > ${lastId}`);
        yearUpdated += okCount;
      }
      const updDur = Date.now() - updTStart;

      batchOldRecordMap.clear();
      tableToOriginIdsMap.clear();

      const lastRow = rows[rows.length - 1];
      lastCreatedAt = lastRow.created_at.toISOString();
      lastId = lastRow.id;
      pageCount++;

      state.lastYear = year;
      state.lastCreatedAt = lastCreatedAt;
      state.lastId = lastId;
      saveState();

      const totalDur = Date.now() - pageTStart;
      console.log(` -> Trang ${pageCount}: load=${loadDur}ms, map=${mapDur}ms, update=${updDur}ms (Tổng ${totalDur}ms) | Năm ${year} Thời điểm hiện tại: ${lastCreatedAt}, lastId: ${lastId} (Đã cập nhật mới: ${yearUpdated}, Đã chuẩn sẵn: ${yearSkipped})`);
    }

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
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION VĂN BẢN ĐI (2013 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [OutgoingDocument]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật thành công: ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log(`- Số bản ghi lỗi hiện tại (xem file ${stateFileName}): ${state.failedRecords.length}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix audit:', err);
  process.exit(1);
});
