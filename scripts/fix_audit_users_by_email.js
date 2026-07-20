/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER IN AUDIT
 * (user_id, created_by, display_name, receiver, receiver_unit)
 * TRONG BẢNG AUDIT CỦA VĂN BẢN ĐẾN (type_document = 'IncomingDocument')
 * BÓC TÁCH CHI TIẾT THEO HANHDONG GỐC VÀ ROLEPROCESS ĐỂ SỬA LỖI NÊU GAN SAI RECEIVER
 */

require('dotenv').config();
const dbConnection = require('../db/connection');
const MigrationHelper = require('../src/helpers/MigrationHelper');
const ReceiverParserService = require('../src/sync-audit/ReceiverParserService');

async function main() {
  console.log('=================================================================');
  console.log('=== KÍCH HOẠT SCRIPT FIX AUDIT USER & RECEIVER (INCOMING DOCUMENT) ===');
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

  const profileToEmailMap = new Map(); // key (lower) -> email (lower)
  let profileCount = 0;

  for (const row of oldProfilesRes.recordset) {
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
  console.log(`-> Đã nạp thành công ${profileCount} Email từ DB Cũ vào bộ nhớ RAM.\n`);

  // 2. Nạp bản đồ Users từ DB Mới (dbo.users)
  console.log('[2/4] Đang nạp bản đồ User ID & Tên hiển thị từ DB Mới (dbo.users)...');
  const newUsersRes = await newPool.request().query(`
    SELECT id, email_user, name FROM dbo.users
  `);

  const emailToUserInfoMap = new Map(); // email (lower) -> { id, name }
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

  // 3. Quét từng Partition năm (2013 -> 2030) trong dbo.audit cho type_document = 'IncomingDocument'
  console.log('[3/4] Bắt đầu rà soát và cập nhật user_id, created_by, display_name & receiver theo Partition từng năm (2013 -> 2030)...');

  const START_YEAR = 2013;
  const END_YEAR = 2030;
  const BATCH_SIZE = 2000;

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

    let offset = 0;
    let yearUpdated = 0;
    let yearSkipped = 0;
    let yearNotFound = 0;

    while (offset < yearTotal) {
      const pageReq = newPool.request();
      pageReq.input('startDate', startDate);
      pageReq.input('endDate', endDate);

      const pageRes = await pageReq.query(`
        SELECT id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action
        FROM dbo.audit
        WHERE (created_at >= @startDate AND created_at < @endDate)
          AND type_document = 'IncomingDocument'
          AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
        ORDER BY id ASC
        OFFSET ${offset} ROWS FETCH NEXT ${BATCH_SIZE} ROWS ONLY
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
            for (const u of newUsersRes.recordset) {
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

          // Kiểm tra xem có cần update không
          if (
            a.user_id !== correctUserId ||
            a.created_by !== correctUserId ||
            a.display_name !== correctDisplayName ||
            a.receiver !== correctReceiver ||
            a.receiver_unit !== correctReceiverUnit
          ) {
            updates.push({
              id: a.id,
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

      // Thực hiện Batch Update đồng bộ 5 cột: user_id, created_by, display_name, receiver, receiver_unit
      if (updates.length > 0) {
        const transaction = newPool.transaction();
        await transaction.begin();

        try {
          for (const up of updates) {
            const req = transaction.request();
            req.input('userId', up.correctUserId);
            req.input('displayName', up.correctDisplayName);
            req.input('receiver', up.correctReceiver);
            req.input('receiverUnit', up.correctReceiverUnit);
            req.input('id', up.id);
            await req.query(`
              UPDATE dbo.audit 
              SET user_id = @userId, 
                  created_by = @userId, 
                  display_name = @displayName,
                  receiver = @receiver,
                  receiver_unit = @receiverUnit
              WHERE id = @id
            `);
          }
          await transaction.commit();
          yearUpdated += updates.length;
        } catch (err) {
          await transaction.rollback();
          console.error(`❌ Lỗi khi update batch năm ${year} tại offset ${offset}:`, err.message);
        }
      }

      // Giải phóng RAM sau mỗi Batch
      batchOldRecordMap.clear();
      tableToOriginIdsMap.clear();

      offset += rows.length;
      console.log(` -> Năm ${year}: ${offset}/${yearTotal} dòng (Đã cập nhật mới: ${yearUpdated}, Đã chuẩn sẵn: ${yearSkipped})`);
    }

    grandTotalProcessed += yearTotal;
    grandTotalUpdated += yearUpdated;
    grandTotalSkipped += yearSkipped;
    grandTotalNotFound += yearNotFound;
  }

  console.log('\n=================================================================');
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION (2013 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [IncomingDocument]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật toàn bộ (user_id, created_by, display_name, receiver, receiver_unit): ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix audit:', err);
  process.exit(1);
});
