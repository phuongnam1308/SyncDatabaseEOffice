/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER TRONG 3 BẢNG:
 *   1. dbo.audit
 *   2. dbo.incomming_assignment
 *   3. dbo.incomming_current_state
 * TRONG BẢNG AUDIT CỦA VĂN BẢN ĐẾN (type_document = 'IncomingDocument')
 * GỘP TẤT CẢ LỆNH VÀO 1 SQL BATCH CHẠY TRÊN CÙNG 1 REQUEST ĐỂ TRÁNH LỖI SESSION CONNECTION
 */

require('dotenv').config();
const dbConnection = require('../db/connection');
const MigrationHelper = require('../src/helpers/MigrationHelper');
const ReceiverParserService = require('../src/sync-audit/ReceiverParserService');
const fs = require('fs');
const path = require('path');

// Xử lý tham số dòng lệnh --year
const args = process.argv.slice(2);
let targetYear = null;
const yearArgIdx = args.findIndex(arg => arg === '--year');
if (yearArgIdx !== -1 && args[yearArgIdx + 1]) {
  targetYear = parseInt(args[yearArgIdx + 1], 10);
}

async function main() {
  console.log('=================================================================');
  console.log('=== KÍCH HOẠT SCRIPT BULK FIX AUDIT, ASSIGNMENT & CURRENT STATE ===');
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

  const profilesCachePath = path.join(__dirname, 'profiles_cache.json');
  const usersCachePath = path.join(__dirname, 'users_cache.json');

  // 1. Nạp bản đồ Email từ DB Cũ (dbo.PersonalProfile)
  let profilesList = [];
  if (fs.existsSync(profilesCachePath)) {
    console.log(`[1/4] Đang nạp bản đồ Email từ file cache: ${profilesCachePath}...`);
    try {
      profilesList = JSON.parse(fs.readFileSync(profilesCachePath, 'utf8'));
      console.log(`-> Đã nạp thành công ${profilesList.length} Profile từ cache.`);
    } catch (err) {
      console.error('❌ Lỗi khi đọc file cache profile, sẽ nạp từ database:', err);
      profilesList = [];
    }
  }

  if (profilesList.length === 0) {
    console.log('[1/4] Đang nạp bản đồ Email từ DB Cũ (dbo.PersonalProfile)...');
    const oldProfilesRes = await oldPool.request().query(`
      SELECT ID, AccountID, FullName, StaffID, Email
      FROM dbo.PersonalProfile
      WHERE Email IS NOT NULL AND LTRIM(RTRIM(Email)) <> ''
    `);
    profilesList = oldProfilesRes.recordset;
    try {
      fs.writeFileSync(profilesCachePath, JSON.stringify(profilesList, null, 2), 'utf8');
      console.log(`-> Đã lưu ${profilesList.length} Profile vào file cache.`);
    } catch (err) {
      console.error('❌ Không thể lưu file cache profile:', err);
    }
  }

  const profileToEmailMap = new Map(); // key (lower) -> email (lower)
  let profileCount = 0;

  for (const row of profilesList) {
    const email = String(row.Email).trim().toLowerCase();
    if (!email.includes('@')) continue;

    profileCount++;
    if (row.ID) profileToEmailMap.set(String(row.ID).trim().toLowerCase(), email);
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
  console.log(`-> Đã nạp thành công ${profileCount} Email vào bộ nhớ RAM.\n`);

  // 2. Nạp bản đồ Users từ DB Mới (dbo.users)
  let usersList = [];
  if (fs.existsSync(usersCachePath)) {
    console.log(`[2/4] Đang nạp bản đồ Users từ file cache: ${usersCachePath}...`);
    try {
      usersList = JSON.parse(fs.readFileSync(usersCachePath, 'utf8'));
      console.log(`-> Đã nạp thành công ${usersList.length} User từ cache.`);
    } catch (err) {
      console.error('❌ Lỗi khi đọc file cache users, sẽ nạp từ database:', err);
      usersList = [];
    }
  }

  if (usersList.length === 0) {
    console.log('[2/4] Đang nạp bản đồ User ID & Tên hiển thị từ DB Mới (dbo.users) với status = 1...');
    const newUsersRes = await newPool.request().query(`
      SELECT id, email_user, name FROM dbo.users WHERE status = 1
    `);
    usersList = newUsersRes.recordset;
    try {
      fs.writeFileSync(usersCachePath, JSON.stringify(usersList, null, 2), 'utf8');
      console.log(`-> Đã lưu ${usersList.length} User vào file cache.`);
    } catch (err) {
      console.error('❌ Không thể lưu file cache users:', err);
    }
  }

  const emailToUserInfoMap = new Map(); // email (lower) -> { id, name }
  let newUserCount = 0;

  for (const u of usersList) {
    if (u.email_user) {
      const email = String(u.email_user).trim().toLowerCase();
      if (email.includes('@')) {
        emailToUserInfoMap.set(email, { id: u.id, name: u.name });
        newUserCount++;
      }
    }
  }
  console.log(`-> Đã nạp thành công ${newUserCount} User Info vào bộ nhớ RAM.\n`);

  // 3. Quét từng Partition năm (2012 -> 2030) trong dbo.audit cho type_document = 'IncomingDocument'
  console.log('[3/4] Bắt đầu rà soát và cập nhật audit, incomming_assignment & incomming_current_state theo Partition từng năm (2012 -> 2030)...');

  const START_YEAR = targetYear || 2012;
  const END_YEAR = targetYear || 2030;
  const BATCH_SIZE = 100;

  let grandTotalProcessed = 0;
  let grandTotalUpdated = 0;
  let grandTotalSkipped = 0;
  let grandTotalNotFound = 0;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const startDate = `${year}-01-01 00:00:00`;
    const endDate = `${year + 1}-01-01 00:00:00`;

    const countReq = newPool.request();
    countReq.input('startDate', startDate);
    countReq.input('endDate', endDate);
    const countRes = await countReq.query(`
      SELECT COUNT(1) AS total 
      FROM dbo.audit 
      WHERE (created_at >= @startDate AND created_at < @endDate)
        AND type_document = 'IncomingDocument'
        AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
    `);

    const yearTotal = countRes.recordset[0].total;
    if (yearTotal === 0) continue;

    console.log(`\n📅 --- NĂM ${year}: Phát hiện ${yearTotal} bản ghi audit [IncomingDocument] ---`);

    let yearUpdated = 0;
    let yearSkipped = 0;
    let yearNotFound = 0;
    let processedInYear = 0;

    while (true) {
      const pageReq = newPool.request();
      pageReq.input('startDate', startDate);
      pageReq.input('endDate', endDate);

      const pageRes = await pageReq.query(`
        SELECT TOP (${BATCH_SIZE}) id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action, document_id, created_at, stage_status
        FROM dbo.audit
        WHERE (created_at >= @startDate AND created_at < @endDate)
          AND type_document = 'IncomingDocument'
          AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
        ORDER BY id ASC
      `);

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;

      // Gom nhóm origin_id theo table_backups để query Batch IN sang DB Cũ
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

      // Map tạm thời trong Batch: `${tableName}_${origin_id}` -> Record Object
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
            // Bỏ qua nếu bảng không tồn tại trong DB Cũ
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

        // BƯỚC 1: Tra cứu Sender Email theo TÊN ĐẦY ĐỦ CHUẨN NGUYÊN BẢN
        let targetEmail = profileToEmailMap.get(searchKey.trim().toLowerCase());

        // BƯỚC 2: Loại bỏ hậu tố/danh xưng nếu chưa có
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

        // BƯỚC FALLBACK TẠI NEW DB
        if (!matchedUserInfo) {
          const cleanKey = searchKey.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
          if (cleanKey && cleanKey.length >= 2) {
            for (const u of usersList) {
              if (u.name && (u.name.toLowerCase().includes(cleanKey) || cleanKey.includes(u.name.toLowerCase()))) {
                matchedUserInfo = { id: u.id, name: u.name };
                break;
              }
            }
          }
        }

        if (matchedUserInfo && matchedUserInfo.id) {
          const correctUserId = matchedUserInfo.id;
          const correctDisplayName = matchedUserInfo.name || searchKey.split(/\s*[-–—(]\s*/)[0].trim();

          // ── BÓC TÁCH RECEIVER CHUẨN DỰA TRÊN HANHDONG GỐC VÀ ROLEPROCESS ──
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
              // Bỏ qua nếu parse lỗi
            }
          }

          // Fallback 1: Tra cứu từ a.receiver cũ qua helper nếu chưa tìm thấy qua HanhDong
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

          // Fallback 2: Nếu receiver vẫn NULL -> gán bằng chính correctUserId của sender
          if (!correctReceiver) {
            correctReceiver = correctUserId;
          }

          // Chuẩn hóa receiver_unit
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

          // Kiểm tra xem có cần update thông tin hay không, nhưng luôn đẩy vào updates để cập nhật type_document
          const isDifferent = (
            a.user_id !== correctUserId ||
            a.created_by !== correctUserId ||
            a.display_name !== correctDisplayName ||
            a.receiver !== correctReceiver ||
            a.receiver_unit !== correctReceiverUnit
          );

          if (!isDifferent) {
            yearSkipped++;
          }

          updates.push({
            id: a.id,
            documentId: a.document_id,
            createdAt: a.created_at,
            stageStatus: a.stage_status,
            roleProcess: a.roleProcess,
            correctUserId,
            correctDisplayName,
            correctReceiver,
            correctReceiverUnit
          });
        } else {
          yearNotFound++;
        }
      }

      // THỰC HIỆN BATCH UPDATE SỬ DỤNG BẢNG TẠM THỜI (Gộp thành 1 T-SQL Batch duy nhất)
      if (updates.length > 0) {
        // Chia nhỏ cập nhật thành các phần tối đa 100 bản ghi để không vượt quá giới hạn 2100 tham số của SQL
        const chunkSize = 100;
        for (let chunkIdx = 0; chunkIdx < updates.length; chunkIdx += chunkSize) {
          const chunk = updates.slice(chunkIdx, chunkIdx + chunkSize);

          const transaction = newPool.transaction();
          await transaction.begin();

          try {
            const req = transaction.request();
            req.input('startDate', startDate);
            req.input('endDate', endDate);

            // Xác định xem bản ghi nào là mới nhất cho mỗi nhóm (document_id, receiver, role_process) trong chunk
            const latestKeyMap = new Map();
            chunk.forEach(up => {
              if (up.documentId && up.correctReceiver) {
                const key = `${String(up.documentId).toLowerCase()}_${String(up.correctReceiver).toLowerCase()}_${String(up.roleProcess || 'VANTHU').toLowerCase()}`;
                latestKeyMap.set(key, up.id);
              }
            });

            const valuesSql = [];
            chunk.forEach((up, idx) => {
              const key = `${String(up.documentId).toLowerCase()}_${String(up.correctReceiver).toLowerCase()}_${String(up.roleProcess || 'VANTHU').toLowerCase()}`;
              const isAssignmentUpdate = (latestKeyMap.get(key) === up.id) ? 1 : 0;

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
              req.input(`is_assignment_update_${idx}`, isAssignmentUpdate);

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
                @is_assignment_update_${idx}
              )`);
            });

            // Gộp tất cả lệnh SQL vào 1 Batch duy nhất chạy trên cùng Connection Session của transaction
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
                is_assignment_update INT
              );

              INSERT INTO #AuditUpdates (
                id, user_id, created_by, display_name, receiver, receiver_unit, document_id, created_at, stage_status, role_process, is_assignment_update
              ) VALUES ${valuesSql.join(',')};

              -- 3. Bulk UPDATE dbo.audit (Lọc phân vùng trước)
              UPDATE a
              SET a.user_id = u.user_id,
                  a.created_by = u.created_by,
                  a.display_name = u.display_name,
                  a.receiver = u.receiver,
                  a.receiver_unit = u.receiver_unit,
                  a.type_document = 'IncommingDocument'
              FROM dbo.audit a
              INNER JOIN #AuditUpdates u ON a.id = u.id
              WHERE (a.created_at >= @startDate AND a.created_at < @endDate);

              -- 3.5 Xóa các bản ghi phân công cũ trong CSDL để tránh trùng lặp khóa chính (PK)
              DELETE target
              FROM dbo.incomming_assignment target
              WHERE EXISTS (
                SELECT 1 
                FROM #AuditUpdates src
                WHERE src.is_assignment_update = 1
                  AND src.document_id = target.document_id
                  AND src.receiver = target.receiver
                  AND src.role_process = target.role_process
                  AND src.id <> target.last_audit_id
              );

              -- 3.6 Xóa các bản ghi phân công liên kết với last_audit_id đang được cập nhật
              DELETE target
              FROM dbo.incomming_assignment target
              INNER JOIN #AuditUpdates src ON target.last_audit_id = src.id
              WHERE src.is_assignment_update = 1
                AND (target.created_at >= @startDate AND target.created_at < @endDate);

              -- 5. Bulk MERGE dbo.incomming_assignment (sử dụng CTE để lọc trùng lặp case-insensitive)
              WITH LatestUpdates AS (
                SELECT 
                  document_id, 
                  receiver, 
                  role_process, 
                  stage_status, 
                  created_at, 
                  id AS last_audit_id
                FROM (
                  SELECT 
                    document_id, receiver, role_process, stage_status, created_at, id,
                    ROW_NUMBER() OVER (
                      PARTITION BY document_id, receiver, role_process 
                      ORDER BY id DESC
                    ) as rn
                  FROM #AuditUpdates
                  WHERE is_assignment_update = 1
                    AND document_id IS NOT NULL 
                    AND receiver IS NOT NULL
                ) t
                WHERE rn = 1
              )
              MERGE dbo.incomming_assignment AS target
              USING LatestUpdates AS src
              ON target.document_id = src.document_id 
                 AND target.receiver = src.receiver 
                 AND target.role_process = src.role_process
              WHEN MATCHED THEN
                UPDATE SET target.stage_status = src.stage_status,
                           target.last_audit_id = src.last_audit_id
              WHEN NOT MATCHED THEN
                INSERT (document_id, receiver, role_process, stage_status, created_at, last_audit_id)
                VALUES (src.document_id, src.receiver, src.role_process, src.stage_status, src.created_at, src.last_audit_id);

              -- 6. Bulk UPDATE dbo.incomming_current_state
              UPDATE target
              SET target.current_receiver = src.receiver,
                  target.current_role_process = src.role_process,
                  target.current_stage_status = src.stage_status
              FROM dbo.incomming_current_state target
              INNER JOIN #AuditUpdates src ON target.document_id = src.document_id AND target.last_audit_id = src.id
              WHERE src.is_assignment_update = 1;

              DROP TABLE #AuditUpdates;
            `;

            await req.query(sqlBatch);
            await transaction.commit();
            yearUpdated += chunk.length;
          } catch (err) {
            console.error(`❌ Lỗi thực tế xảy ra khi bulk update batch năm ${year} tại processedInYear ${processedInYear}:`, err);
            try {
              await transaction.rollback();
            } catch (rollbackErr) {
              // Bỏ qua lỗi rollback khi transaction đã bị hủy/abort trước đó bởi SQL Server
            }
          }
        }
      }

      // Giải phóng RAM sau mỗi Batch
      batchOldRecordMap.clear();
      tableToOriginIdsMap.clear();

      processedInYear += rows.length;
      console.log(` -> Năm ${year}: Đã rà soát ${processedInYear}/${yearTotal} dòng (Đã cập nhật mới: ${yearUpdated}, Đã chuẩn sẵn: ${yearSkipped})`);
    }

    grandTotalProcessed += yearTotal;
    grandTotalUpdated += yearUpdated;
    grandTotalSkipped += yearSkipped;
    grandTotalNotFound += yearNotFound;
  }

  console.log('\n=================================================================');
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION (2013 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [IncomingDocument]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật toàn bộ (audit, assignment, current_state): ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix audit:', err);
  process.exit(1);
});
