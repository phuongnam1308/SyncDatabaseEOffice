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
const { performance } = require('perf_hooks');

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
  const userIdToUserInfoMap = new Map(); // id (lower) -> { id, name }
  const nameToUserMap = new Map();       // name (lower) -> { id, name }
  let newUserCount = 0;

  for (const u of usersList) {
    if (u.id) {
      userIdToUserInfoMap.set(String(u.id).toLowerCase(), u);
    }
    if (u.name) {
      nameToUserMap.set(String(u.name).trim().toLowerCase(), u);
    }
    if (u.email_user) {
      const email = String(u.email_user).trim().toLowerCase();
      if (email.includes('@')) {
        emailToUserInfoMap.set(email, { id: u.id, name: u.name });
        newUserCount++;
      }
    }
  }
  console.log(`-> Đã nạp thành công ${newUserCount} User Info vào bộ nhớ RAM.\n`);

  const userIdSet = new Set();
  for (const u of usersList) {
    if (u.id) userIdSet.add(String(u.id).toLowerCase());
  }

  const userNameToIdCache = new Map(); // keyLower -> resolved userId
  const unitNameToIdCache = new Map(); // keyLower -> resolved unitId

  const RE_DE_THUC_HIEN = /để thực hiện\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
  const RE_DE_BIET = /để biết\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
  const RE_DE_BAO_CAO = /để báo cáo\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
  const RE_DON_VI = /đơn vị\s*(?:xử lý)?\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
  const RE_CA_NHAN = /cá nhân\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;
  const RE_DON_VI_PHAT_HANH = /đơn vị\s*:\s*(.*?)(?:<br\s*\/?>|$)/i;

  function splitNamesRaw(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .replace(/<[^>]*>/g, '')
      .split(/[;,]/)
      .map(n => {
        let cleaned = n.trim();
        cleaned = cleaned.replace(/^\d+[.)]\s*/, '');
        // Loại bỏ ký tự ngoặc đóng, ngoặc nhọn, ngoặc kép thừa ở cuối chuỗi
        cleaned = cleaned.replace(/[)"'}\]]+$/g, '').trim();
        return cleaned;
      })
      .filter(n => n && n.length >= 2 && !/^(eoffice\s*it|e-office\s*sp|sp[-_]?setup|system|admin$|sharepoint)/i.test(n.trim()));
  }

  function parseHanhDongNames(hanhDong) {
    const result = { processor: [], viewer: [], supporter: [], units: [] };
    if (!hanhDong || typeof hanhDong !== 'string') return result;

    let text = hanhDong.trim();
    // Giải mã nếu hanhDong là một chuỗi JSON (ví dụ: {"note": "...", "isTransferOption": true})
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsedObj = JSON.parse(text);
        if (parsedObj && parsedObj.note) {
          text = String(parsedObj.note).trim();
        } else if (parsedObj && parsedObj.HanhDong) {
          text = String(parsedObj.HanhDong).trim();
        }
      } catch (e) {}
    }

    const thucHienMatch = text.match(RE_DE_THUC_HIEN);
    if (thucHienMatch && thucHienMatch[1]) {
      result.processor.push(...splitNamesRaw(thucHienMatch[1]));
    }

    const deBietMatch = text.match(RE_DE_BIET);
    if (deBietMatch && deBietMatch[1]) {
      result.viewer.push(...splitNamesRaw(deBietMatch[1]));
    }

    const baoCaoMatch = text.match(RE_DE_BAO_CAO);
    if (baoCaoMatch && baoCaoMatch[1]) {
      result.supporter.push(...splitNamesRaw(baoCaoMatch[1]));
    }

    const caNhanMatch = text.match(RE_CA_NHAN);
    if (caNhanMatch && caNhanMatch[1]) {
      result.processor.push(...splitNamesRaw(caNhanMatch[1]));
    }

    const donViMatch = text.match(RE_DON_VI) || text.match(RE_DON_VI_PHAT_HANH);
    if (donViMatch && donViMatch[1]) {
      result.units.push(...splitNamesRaw(donViMatch[1]));
    }

    return result;
  }

  async function resolveUserNameToId(rawKey) {
    if (!rawKey) return null;
    let strVal = String(rawKey).trim();
    if (strVal.startsWith('[') && strVal.endsWith(']')) {
      try {
        const arr = JSON.parse(strVal);
        if (arr && arr.length > 0) strVal = String(arr[0]).trim();
      } catch (e) {}
    }
    if (!strVal) return null;

    const strLower = strVal.toLowerCase();
    if (userNameToIdCache.has(strLower)) {
      return userNameToIdCache.get(strLower);
    }

    if (userIdSet.has(strLower)) {
      userNameToIdCache.set(strLower, strVal);
      return strVal;
    }

    // 1. Direct O(1) email lookup from profileToEmailMap
    let targetEmail = profileToEmailMap.get(strLower);

    // 2. Clean key email lookup from profileToEmailMap
    if (!targetEmail) {
      const cleanKey = strVal.split(/\s*[-–—(]\s*/)[0].trim().replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, '').trim().toLowerCase();
      targetEmail = profileToEmailMap.get(cleanKey);
    }

    let matchedUser = null;
    if (targetEmail) {
      matchedUser = emailToUserInfoMap.get(targetEmail);
    }

    // 3. Direct/Clean O(1) name lookup from nameToUserMap
    if (!matchedUser) {
      matchedUser = nameToUserMap.get(strLower);
      if (!matchedUser) {
        const cleanKey = strVal.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
        matchedUser = nameToUserMap.get(cleanKey);
      }
    }

    let resId = matchedUser?.id || null;

    // 4. Fallback DB lookup if not in RAM
    if (!resId && helper && typeof helper.mapUserName === 'function') {
      try {
        resId = await helper.mapUserName(strVal);
      } catch (e) {}
    }

    userNameToIdCache.set(strLower, resId);
    return resId;
  }

  async function resolveUnitNameToId(unitName) {
    if (!unitName) return null;
    let strVal = String(unitName).trim();
    if (strVal.startsWith('[') && strVal.endsWith(']')) {
      try {
        const arr = JSON.parse(strVal);
        if (arr && arr.length > 0) strVal = String(arr[0]).trim();
      } catch (e) {}
    }
    if (!strVal) return null;

    const strLower = strVal.toLowerCase();
    if (unitNameToIdCache.has(strLower)) {
      return unitNameToIdCache.get(strLower);
    }

    let unitId = null;
    if (helper && typeof helper.mapSenderUnitId === 'function') {
      try {
        unitId = await helper.mapSenderUnitId(strVal);
      } catch (e) {}
    }

    unitNameToIdCache.set(strLower, unitId);
    return unitId;
  }

  // 3. Quét từng Partition năm (2012 -> 2030) trong dbo.audit cho type_document = 'IncomingDocument'
  console.log('[3/4] Bắt đầu rà soát và cập nhật audit, incomming_assignment & incomming_current_state theo Partition từng năm (2012 -> 2030)...');

  const START_YEAR = targetYear || 2012;
  const END_YEAR = targetYear || 2030;
  const BATCH_SIZE = 500;

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

    let lastCreatedAt = null;
    let lastId = 0;

    while (true) {
      const batchStartTime = performance.now();

      // 1. Fetch SQL Audit
      const t1 = performance.now();
      const pageReq = newPool.request();
      pageReq.input('startDate', startDate);
      pageReq.input('endDate', endDate);
      pageReq.input('lastCreatedAt', lastCreatedAt);
      pageReq.input('lastId', lastId);
      pageReq.input('batchSize', BATCH_SIZE);

      const pageRes = await pageReq.query(`
        SELECT TOP (@batchSize) id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action, document_id, created_at, stage_status
        FROM dbo.audit
        WHERE (created_at >= @startDate AND created_at < @endDate)
          AND (
            @lastCreatedAt IS NULL 
            OR (created_at > @lastCreatedAt) 
            OR (created_at = @lastCreatedAt AND id > @lastId)
          )
          AND type_document = 'IncomingDocument'
          AND (table_backups LIKE 'LuanChuyenVanBan%' OR table_backups LIKE 'audit%')
        ORDER BY created_at ASC, id ASC
      `);

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;
      const fetchAuditMs = (performance.now() - t1).toFixed(1);

      lastCreatedAt = rows[rows.length - 1].created_at;
      lastId = rows[rows.length - 1].id;

      // 2. Query Old DB
      const t2 = performance.now();
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
      const queryOldDbMs = (performance.now() - t2).toFixed(1);

      // 3. Pre-resolve Batch Cache RAM
      const t3 = performance.now();
      const batchNamesSet = new Set();
      const batchUnitsSet = new Set();
      const parsedHanhDongMap = new Map();

      for (const a of rows) {
        const key = `${String(a.table_backups).trim()}_${String(a.origin_id).trim()}`;
        const oldRecord = batchOldRecordMap.get(key);
        const rawNguoiXuLyFromOldDb = oldRecord?.NguoiXuLy ? String(oldRecord.NguoiXuLy).trim() : null;
        const searchKey = rawNguoiXuLyFromOldDb || a.display_name || '';

        if (searchKey) batchNamesSet.add(searchKey);

        if (oldRecord && oldRecord.HanhDong) {
          const parsed = parseHanhDongNames(oldRecord.HanhDong);
          parsedHanhDongMap.set(key, parsed);
          parsed.processor.forEach(n => batchNamesSet.add(n));
          parsed.viewer.forEach(n => batchNamesSet.add(n));
          parsed.supporter.forEach(n => batchNamesSet.add(n));
          parsed.units.forEach(u => batchUnitsSet.add(u));
        }

        if (a.receiver) batchNamesSet.add(a.receiver);
        if (a.receiver_unit) batchUnitsSet.add(a.receiver_unit);
      }

      // Tra cứu Gom nhóm Batch song song vào Cache RAM
      await Promise.all([
        ...Array.from(batchNamesSet).map(n => resolveUserNameToId(n)),
        ...Array.from(batchUnitsSet).map(u => resolveUnitNameToId(u))
      ]);
      const preResolveMs = (performance.now() - t3).toFixed(1);

      // 4. In-Memory Record Mapping
      const t4 = performance.now();
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

        const correctUserId = await resolveUserNameToId(searchKey);

        if (correctUserId) {
          const targetEmail = profileToEmailMap.get(searchKey.trim().toLowerCase());
          const matchedUser = (targetEmail ? emailToUserInfoMap.get(targetEmail) : null) || userIdToUserInfoMap.get(String(correctUserId).toLowerCase());
          const correctDisplayName = matchedUser?.name || searchKey.split(/\s*[-–—(]\s*/)[0].trim();

          let correctReceiver = null;
          let correctReceiverUnit = null;

          const detailedReceivers = parsedHanhDongMap.get(key);
          if (detailedReceivers) {
            if (a.roleProcess === 'viewer' || (a.action && a.action.includes('Để biết'))) {
              if (detailedReceivers.viewer.length > 0) {
                correctReceiver = await resolveUserNameToId(detailedReceivers.viewer[0]);
              }
            } else if (a.roleProcess === 'supporter' || (a.action && a.action.includes('Phối hợp'))) {
              if (detailedReceivers.supporter.length > 0) {
                correctReceiver = await resolveUserNameToId(detailedReceivers.supporter[0]);
              }
            } else if (a.roleProcess === 'processor' || (a.action && (a.action.includes('Thực hiện') || a.action.includes('Xử lý')))) {
              if (detailedReceivers.processor.length > 0) {
                correctReceiver = await resolveUserNameToId(detailedReceivers.processor[0]);
              }
            }

            if (detailedReceivers.units.length > 0) {
              correctReceiverUnit = await resolveUnitNameToId(detailedReceivers.units[0]);
            }
          }

          // Fallback 1: Tra cứu từ a.receiver cũ
          if (!correctReceiver && a.receiver) {
            correctReceiver = await resolveUserNameToId(a.receiver);
          }

          // Fallback 2: Nếu receiver vẫn NULL -> gán bằng chính correctUserId của sender
          if (!correctReceiver) {
            correctReceiver = correctUserId;
          }

          // Chuẩn hóa receiver_unit
          if (!correctReceiverUnit && a.receiver_unit) {
            correctReceiverUnit = await resolveUnitNameToId(a.receiver_unit);
          }

          const isDifferent = (
            a.user_id !== correctUserId ||
            a.created_by !== correctUserId ||
            a.display_name !== correctDisplayName ||
            a.receiver !== correctReceiver ||
            a.receiver_unit !== correctReceiverUnit
          );

          if (!isDifferent) {
            yearSkipped++;
            continue; // Bản ghi đã chuẩn từ trước, không cần đẩy vào Bulk SQL Update
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
      const inMemoryMappingMs = (performance.now() - t4).toFixed(1);

      // 5. Single T-SQL Bulk Update
      const t5 = performance.now();
      if (updates.length > 0) {
        const transaction = newPool.transaction();
        await transaction.begin();

        try {
          const req = transaction.request();
          req.input('startDate', startDate);
          req.input('endDate', endDate);

          const latestKeyMap = new Map();
          updates.forEach(up => {
            if (up.documentId && up.correctReceiver) {
              const key = `${String(up.documentId).toLowerCase()}_${String(up.correctReceiver).toLowerCase()}_${String(up.roleProcess || 'VANTHU').toLowerCase()}`;
              latestKeyMap.set(key, up.id);
            }
          });

          function escStr(val) {
            if (val == null) return 'NULL';
            return "N'" + String(val).replace(/'/g, "''") + "'";
          }
          function escId(val) {
            if (val == null) return 'NULL';
            return "'" + String(val).replace(/'/g, "''") + "'";
          }

          const valuesSql = updates.map(up => {
            const key = `${String(up.documentId).toLowerCase()}_${String(up.correctReceiver).toLowerCase()}_${String(up.roleProcess || 'VANTHU').toLowerCase()}`;
            const isAssignmentUpdate = (latestKeyMap.get(key) === up.id) ? 1 : 0;
            const createdAtStr = up.createdAt ? (up.createdAt.toISOString ? up.createdAt.toISOString() : String(up.createdAt)) : null;

            return `(${up.id}, ${escId(up.correctUserId)}, ${escId(up.correctUserId)}, ${escStr(up.correctDisplayName)}, ${escId(up.correctReceiver)}, ${escId(up.correctReceiverUnit)}, ${escId(up.documentId)}, ${escStr(createdAtStr)}, ${escId(up.stageStatus || 'CHUA_XU_LY')}, ${escId(up.roleProcess || 'VANTHU')}, ${isAssignmentUpdate})`;
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
              is_assignment_update INT
            );

            CREATE INDEX IX_AuditUpdates_Assign ON #AuditUpdates(is_assignment_update, document_id, receiver, role_process);

            INSERT INTO #AuditUpdates (
              id, user_id, created_by, display_name, receiver, receiver_unit, document_id, created_at, stage_status, role_process, is_assignment_update
            ) VALUES ${valuesSql.join(',')};

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

            -- 3.5 Xóa các bản ghi phân công cũ bằng INNER JOIN từ #AuditUpdates (tận dụng Index seek)
            DELETE target
            FROM dbo.incomming_assignment target
            INNER JOIN #AuditUpdates src ON src.is_assignment_update = 1
              AND target.document_id = src.document_id
              AND target.receiver = src.receiver
              AND target.role_process = src.role_process
            WHERE target.last_audit_id <> src.id;

            -- 3.6 Xóa các bản ghi phân công liên kết với last_audit_id đang được cập nhật
            DELETE target
            FROM dbo.incomming_assignment target
            INNER JOIN #AuditUpdates src ON src.is_assignment_update = 1
              AND target.last_audit_id = src.id
            WHERE (target.created_at >= @startDate AND target.created_at < @endDate);

            WITH LatestUpdates AS (
              SELECT 
                document_id, receiver, role_process, stage_status, created_at, id AS last_audit_id
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
          yearUpdated += updates.length;
        } catch (err) {
          console.error(`❌ Lỗi thực tế xảy ra khi bulk update batch năm ${year}:`, err);
          try {
            await transaction.rollback();
          } catch (rollbackErr) {}
        }
      }
      const bulkUpdateMs = (performance.now() - t5).toFixed(1);

      const batchDurationMs = (performance.now() - batchStartTime).toFixed(1);
      processedInYear += rows.length;

      // Giải phóng RAM sau mỗi Batch
      batchOldRecordMap.clear();
      tableToOriginIdsMap.clear();

      console.log(` ⏱️ [Batch ${rows.length} dòng] Tổng: ${batchDurationMs}ms (1.Fetch Audit: ${fetchAuditMs}ms | 2.Query OldDB: ${queryOldDbMs}ms | 3.PreResolve: ${preResolveMs}ms | 4.Mapping: ${inMemoryMappingMs}ms | 5.Bulk Update: ${bulkUpdateMs}ms)`);
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
