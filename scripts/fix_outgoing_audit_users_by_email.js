/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER TRONG 3 BẢNG VĂN BẢN ĐI (OutgoingDocument):
 * HỖ TRỢ CẢ VĂN BẢN ĐI BAN HÀNH (LuanChuyenVanBan, audit) VÀ DỰ THẢO VĂN BẢN ĐI (CodeItem, SLAStepDetail_sync).
 *   1. dbo.audit (type_document = 'OutgoingDocument')
 *   2. dbo.outgoing_assignment
 *   3. dbo.outgoing_current_state
 * HỖ TRỢ CHẠY THEO NĂM (--year), FILE STATE CURSOR, IN-MEMORY CACHING CỰC NHANH VÀ SINGLE T-SQL BATCH UPDATE.
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

// File trạng thái được cô lập theo năm để chạy song song
const stateFileName = targetYear ? `state_outgoing_audit_${targetYear}.json` : 'state_outgoing_audit.json';
const STATE_FILE = path.join(__dirname, stateFileName);

// Khởi tạo trạng thái mặc định
let state = {
  lastYear: targetYear || 2012,
  lastCreatedAt: null,
  lastId: 0,
  failedRecords: []
};

// Đọc trạng thái cũ từ file nếu có
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log(`ℹ️ Đã nạp file trạng thái: Tiếp tục từ năm ${state.lastYear}, lastCreatedAt ${state.lastCreatedAt}, lastId ${state.lastId}. Số bản ghi lỗi tích lũy: ${state.failedRecords?.length || 0}`);
  } catch (err) {
    console.warn('⚠️ Lỗi đọc file trạng thái, dùng cấu hình mặc định:', err.message);
  }
}

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

async function main() {
  console.log('=================================================================');
  console.log('=== KÍCH HOẠT SCRIPT BULK FIX OUTGOING AUDIT (BAN HÀNH & DỰ THẢO CODEITEM) ===');
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
  const idToEmailMap = new Map();       // ID/AccountID -> email (lower)
  let profileCount = 0;

  for (const row of profilesList) {
    const email = String(row.Email).trim().toLowerCase();
    if (!email.includes('@')) continue;

    profileCount++;
    if (row.ID) {
      idToEmailMap.set(String(row.ID).trim(), email);
      profileToEmailMap.set(String(row.ID).trim().toLowerCase(), email);
    }
    if (row.AccountID) {
      idToEmailMap.set(String(row.AccountID).trim(), email);
      profileToEmailMap.set(String(row.AccountID).trim().toLowerCase(), email);
    }
    if (row.StaffID) {
      idToEmailMap.set(String(row.StaffID).trim(), email);
      profileToEmailMap.set(String(row.StaffID).trim().toLowerCase(), email);
    }
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
        cleaned = cleaned.replace(/[)"'}\]]+$/g, '').trim();
        return cleaned;
      })
      .filter(n => n && n.length >= 2 && !/^(eoffice\s*it|e-office\s*sp|sp[-_]?setup|system|admin$|sharepoint)/i.test(n.trim()));
  }

  function parseHanhDongNames(hanhDong) {
    const result = { processor: [], viewer: [], supporter: [], units: [] };
    if (!hanhDong || typeof hanhDong !== 'string') return result;

    let text = hanhDong.trim();
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

    // 1. Direct O(1) email lookup from idToEmailMap / profileToEmailMap
    let targetEmail = idToEmailMap.get(strVal) || profileToEmailMap.get(strLower);

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

  // 3. Quét từng Partition năm (2012 -> 2030) trong dbo.audit cho type_document = 'OutgoingDocument'
  console.log('[3/4] Bắt đầu rà soát và cập nhật audit, outgoing_assignment & outgoing_current_state theo Partition từng năm (2012 -> 2030)...');

  const START_YEAR = targetYear || state.lastYear || 2012;
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
        AND type_document = 'OutgoingDocument'
        AND (
          table_backups LIKE 'LuanChuyenVanBan%' 
          OR table_backups LIKE 'audit%' 
          OR table_backups = 'CodeItem' 
          OR table_backups = 'SLAStepDetail_sync'
        )
    `);

    const yearTotal = countRes.recordset[0].total;
    if (yearTotal === 0) {
      if (!targetYear) {
        state.lastYear = year + 1;
        state.lastCreatedAt = null;
        state.lastId = 0;
        saveState();
      }
      continue;
    }

    console.log(`\n📅 --- NĂM ${year}: Phát hiện ${yearTotal} bản ghi audit [OutgoingDocument (Ban hành & Dự thảo)] ---`);

    let yearUpdated = 0;
    let yearSkipped = 0;
    let yearNotFound = 0;
    let processedInYear = 0;

    let lastCreatedAt = (year === state.lastYear) ? state.lastCreatedAt : null;
    let lastId = (year === state.lastYear) ? (state.lastId || 0) : 0;

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
        SELECT TOP (@batchSize) id, origin_id, table_backups, display_name, user_id, created_by, receiver, receiver_unit, roleProcess, action_code, action, document_id, created_at, stage_status
        FROM dbo.audit
        WHERE (created_at >= @startDate AND created_at < @endDate)
          AND (
            @lastCreatedAt IS NULL 
            OR (created_at > @lastCreatedAt) 
            OR (created_at = @lastCreatedAt AND id > @lastId)
          )
          AND type_document = 'OutgoingDocument'
          AND (
            table_backups LIKE 'LuanChuyenVanBan%' 
            OR table_backups LIKE 'audit%' 
            OR table_backups = 'CodeItem' 
            OR table_backups = 'SLAStepDetail_sync'
          )
        ORDER BY created_at ASC, id ASC
      `);

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;
      const fetchAuditMs = (performance.now() - t1).toFixed(1);

      lastCreatedAt = rows[rows.length - 1].created_at;
      lastId = rows[rows.length - 1].id;

      // 2. Query Old DB theo từng nhóm bảng nguồn (Luân chuyển, CodeItem, SLAStepDetail)
      const t2 = performance.now();
      const tableToOriginIdsMap = new Map();
      const codeItemOriginIds = new Set();
      const slaStepItemIds = new Set();

      for (const r of rows) {
        if (!r.origin_id) continue;
        const tb = String(r.table_backups || '').trim();

        if (tb === 'CodeItem') {
          codeItemOriginIds.add(String(r.origin_id).trim());
        } else if (tb === 'SLAStepDetail_sync') {
          const match = String(r.origin_id).match(/^sla_step_(\d+)_(\d+)_/);
          if (match) {
            slaStepItemIds.add(match[1]);
          }
        } else if (tb) {
          if (!tableToOriginIdsMap.has(tb)) {
            tableToOriginIdsMap.set(tb, new Set());
          }
          tableToOriginIdsMap.get(tb).add(String(r.origin_id).trim());
        }
      }

      // 2a. Query Bảng Luân chuyển văn bản cũ
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
          } catch (err) {}
        }
      }

      // 2b. Query Bảng Dự thảo [SNP].[CodeItem] từ DB Cũ
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

      // 2c. Query Bảng [SNP].[SLAStepDetail] và [SNP].[SLAStepDetail_History] từ DB Cũ
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
      const queryOldDbMs = (performance.now() - t2).toFixed(1);

      // 3. Pre-resolve Batch Cache RAM
      const t3 = performance.now();
      const batchNamesSet = new Set();
      const batchUnitsSet = new Set();
      const parsedHanhDongMap = new Map();

      for (const a of rows) {
        const tb = String(a.table_backups || '').trim();

        if (tb === 'CodeItem') {
          const oldCI = batchCodeItemMap.get(String(a.origin_id).trim());
          if (oldCI) {
            const rawCreator = oldCI.CreatedBy || oldCI.CBNV || '';
            if (rawCreator) batchNamesSet.add(String(rawCreator).trim());
          }
          if (a.display_name) batchNamesSet.add(a.display_name);
        } else if (tb === 'SLAStepDetail_sync') {
          const match = String(a.origin_id).match(/^sla_step_(\d+)_(\d+)_(.+)$/i);
          if (match) {
            const recordId = match[1];
            const stepVal = match[2];
            const oldCreatedBy = match[3];

            const key = `${recordId}_${stepVal}`;
            const stepRec = batchSlaStepsMap.get(key);
            const oldActorId = stepRec?.UserID || stepRec?.CreatedBy || oldCreatedBy;
            if (oldActorId) batchNamesSet.add(String(oldActorId).trim());
          }
          if (a.display_name) batchNamesSet.add(a.display_name);
        } else {
          const key = `${tb}_${String(a.origin_id).trim()}`;
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
        }

        if (a.receiver) batchNamesSet.add(a.receiver);
        if (a.receiver_unit) batchUnitsSet.add(a.receiver_unit);
      }

      await Promise.all([
        ...Array.from(batchNamesSet).map(n => resolveUserNameToId(n)),
        ...Array.from(batchUnitsSet).map(u => resolveUnitNameToId(u))
      ]);
      const preResolveMs = (performance.now() - t3).toFixed(1);

      // 4. In-Memory Record Mapping
      const t4 = performance.now();
      const updates = [];

      for (const a of rows) {
        const tb = String(a.table_backups || '').trim();
        let searchKey = '';

        if (tb === 'CodeItem') {
          const oldCI = batchCodeItemMap.get(String(a.origin_id).trim());
          searchKey = oldCI?.CreatedBy || oldCI?.CBNV || a.display_name || '';
        } else if (tb === 'SLAStepDetail_sync') {
          const match = String(a.origin_id).match(/^sla_step_(\d+)_(\d+)_(.+)$/i);
          if (match) {
            const recordId = match[1];
            const stepVal = match[2];
            const oldCreatedBy = match[3];

            const key = `${recordId}_${stepVal}`;
            const stepRec = batchSlaStepsMap.get(key);
            searchKey = stepRec?.UserID || stepRec?.CreatedBy || oldCreatedBy || a.display_name || '';
          } else {
            searchKey = a.display_name || '';
          }
        } else {
          const key = `${tb}_${String(a.origin_id).trim()}`;
          const oldRecord = batchOldRecordMap.get(key);
          const rawNguoiXuLyFromOldDb = oldRecord?.NguoiXuLy ? String(oldRecord.NguoiXuLy).trim() : null;
          searchKey = rawNguoiXuLyFromOldDb || a.display_name || '';
        }

        if (!searchKey) {
          yearNotFound++;
          continue;
        }

        const correctUserId = await resolveUserNameToId(searchKey);

        if (correctUserId) {
          const targetEmail = idToEmailMap.get(String(searchKey).trim()) || profileToEmailMap.get(searchKey.trim().toLowerCase());
          const matchedUser = (targetEmail ? emailToUserInfoMap.get(targetEmail) : null) || userIdToUserInfoMap.get(String(correctUserId).toLowerCase());
          const correctDisplayName = matchedUser?.name || a.display_name || searchKey.split(/\s*[-–—(]\s*/)[0].trim();

          let correctReceiver = null;
          let correctReceiverUnit = null;

          const key = `${tb}_${String(a.origin_id).trim()}`;
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
            continue;
          }

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
            const isCreator = ['CREATE', 'TONG_HOP', 'SOAN_THAO'].includes(String(up.actionCode || '').toUpperCase()) ? 1 : 0;
            const createdAtStr = up.createdAt ? (up.createdAt.toISOString ? up.createdAt.toISOString() : String(up.createdAt)) : null;

            return `(${up.id}, ${escId(up.correctUserId)}, ${escId(up.correctUserId)}, ${escStr(up.correctDisplayName)}, ${escId(up.correctReceiver)}, ${escId(up.correctReceiverUnit)}, ${escId(up.documentId)}, ${escStr(createdAtStr)}, ${escId(up.stageStatus || 'CHUA_XU_LY')}, ${escId(up.roleProcess || 'VANTHU')}, ${escId(up.actionCode)}, ${isCreator}, ${isAssignmentUpdate})`;
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
              is_assignment_update INT
            );

            CREATE INDEX IX_AuditUpdates_Assign ON #AuditUpdates(is_assignment_update, document_id, receiver, role_process);

            INSERT INTO #AuditUpdates (
              id, user_id, created_by, display_name, receiver, receiver_unit, document_id, created_at, stage_status, role_process, action_code, is_creator, is_assignment_update
            ) VALUES ${valuesSql.join(',')};

            UPDATE a
            SET a.user_id = u.user_id,
                a.created_by = u.created_by,
                a.display_name = u.display_name,
                a.receiver = u.receiver,
                a.receiver_unit = u.receiver_unit,
                a.type_document = 'OutgoingDocument'
            FROM dbo.audit a
            INNER JOIN #AuditUpdates u ON a.id = u.id
            WHERE (a.created_at >= @startDate AND a.created_at < @endDate);

            -- Xóa các bản ghi phân công cũ bằng INNER JOIN từ #AuditUpdates
            DELETE target
            FROM dbo.outgoing_assignment target
            INNER JOIN #AuditUpdates src ON src.is_assignment_update = 1
              AND target.document_id = src.document_id
              AND target.receiver = src.receiver
              AND target.role_process = src.role_process
            WHERE target.last_audit_id <> src.id;

            -- Xóa các bản ghi phân công liên kết với last_audit_id đang được cập nhật
            DELETE target
            FROM dbo.outgoing_assignment target
            INNER JOIN #AuditUpdates src ON src.is_assignment_update = 1
              AND target.last_audit_id = src.id
            WHERE (target.created_at >= @startDate AND target.created_at < @endDate);

            WITH LatestUpdates AS (
              SELECT 
                document_id, receiver, role_process, stage_status, created_at, id AS last_audit_id, receiver_unit, is_creator
              FROM (
                SELECT 
                  document_id, receiver, role_process, stage_status, created_at, id, receiver_unit, is_creator,
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

            UPDATE target
            SET target.current_receiver = src.receiver,
                target.current_role_process = src.role_process,
                target.current_stage_status = src.stage_status,
                target.current_action_code = src.action_code,
                target.updated_at = SYSDATETIME()
            FROM dbo.outgoing_current_state target
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

      // Cập nhật state cursor
      state.lastYear = year;
      state.lastCreatedAt = lastCreatedAt ? (lastCreatedAt.toISOString ? lastCreatedAt.toISOString() : String(lastCreatedAt)) : null;
      state.lastId = lastId;
      saveState();

      batchOldRecordMap.clear();
      codeItemOriginIds.clear();
      slaStepItemIds.clear();
      tableToOriginIdsMap.clear();

      console.log(` ⏱️ [Batch ${rows.length} dòng] Tổng: ${batchDurationMs}ms (1.Fetch Audit: ${fetchAuditMs}ms | 2.Query OldDB: ${queryOldDbMs}ms | 3.PreResolve: ${preResolveMs}ms | 4.Mapping: ${inMemoryMappingMs}ms | 5.Bulk Update: ${bulkUpdateMs}ms)`);
      console.log(` -> Năm ${year}: Đã rà soát ${processedInYear}/${yearTotal} dòng (Đã cập nhật mới: ${yearUpdated}, Đã chuẩn sẵn: ${yearSkipped})`);
    }

    if (!targetYear) {
      state.lastYear = year + 1;
      state.lastCreatedAt = null;
      state.lastId = 0;
      saveState();
    }

    grandTotalProcessed += yearTotal;
    grandTotalUpdated += yearUpdated;
    grandTotalSkipped += yearSkipped;
    grandTotalNotFound += yearNotFound;
  }

  console.log('\n=================================================================');
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION VĂN BẢN ĐI (2012 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [OutgoingDocument]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật toàn bộ (audit, outgoing_assignment, outgoing_current_state): ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix outgoing audit:', err);
  process.exit(1);
});
