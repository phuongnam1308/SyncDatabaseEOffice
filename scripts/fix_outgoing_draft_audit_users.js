/**
 * SCRIPT CẬP NHẬT/SỬA LỖI TOÀN BỘ THÔNG TIN USER VÀ RECEIVER TRONG 3 BẢNG CỦA DỰ THẢO VĂN BẢN ĐI (Draft OutgoingDocument):
 *   1. dbo.audit (type_document = 'OutgoingDocument')
 *   2. dbo.outgoing_assignment
 *   3. dbo.outgoing_current_state
 * TRONG BẢNG AUDIT CỦA DỰ THẢO (table_backups = 'CodeItem' hoặc 'SLAStepDetail_sync')
 * HỖ TRỢ CHẠY THEO NĂM (--year), FILE STATE CURSOR, IN-MEMORY CACHING CỰC NHANH VÀ SINGLE T-SQL BATCH UPDATE.
 */

require('dotenv').config();
const dbConnection = require('../db/connection');
const MigrationHelper = require('../src/helpers/MigrationHelper');
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
const stateFileName = targetYear ? `state_draft_audit_${targetYear}.json` : 'state_draft_audit.json';
const STATE_FILE = path.join(__dirname, stateFileName);

// Khởi tạo trạng thái mặc định
let state = {
  lastYear: targetYear || 2012,
  lastCreatedAt: null,
  lastId: 0,
  failedRecords: []
};

// Đọc trạng thái cũ từ file
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
  console.log('=== KÍCH HOẠT SCRIPT BULK FIX DRAFT AUDIT & ASSIGNMENT & STATE (CODEITEM) ===');
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

  const profileToEmailMap = new Map();
  const idToEmailMap = new Map();
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

  const emailToUserInfoMap = new Map();
  const userIdToUserInfoMap = new Map();
  const nameToUserMap = new Map();
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

  const userNameToIdCache = new Map();
  const unitNameToIdCache = new Map();

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

    let targetEmail = idToEmailMap.get(strVal) || profileToEmailMap.get(strLower);

    if (!targetEmail) {
      const cleanKey = strVal.split(/\s*[-–—(]\s*/)[0].trim().replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, '').trim().toLowerCase();
      targetEmail = profileToEmailMap.get(cleanKey);
    }

    let matchedUser = null;
    if (targetEmail) {
      matchedUser = emailToUserInfoMap.get(targetEmail);
    }

    if (!matchedUser) {
      matchedUser = nameToUserMap.get(strLower);
      if (!matchedUser) {
        const cleanKey = strVal.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
        matchedUser = nameToUserMap.get(cleanKey);
      }
    }

    let resId = matchedUser?.id || null;

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

  // 3. Quét từng Partition năm (2012 -> 2030) trong dbo.audit cho Draft Outgoing (CodeItem, SLAStepDetail_sync)
  console.log('[3/4] Bắt đầu rà soát và cập nhật audit, outgoing_assignment & outgoing_current_state cho Dự thảo văn bản đi...');

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
        AND (table_backups = 'CodeItem' OR table_backups = 'SLAStepDetail_sync')
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

    console.log(`\n📅 --- NĂM ${year}: Phát hiện ${yearTotal} bản ghi audit dự thảo [OutgoingDocument] ---`);

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
          AND (table_backups = 'CodeItem' OR table_backups = 'SLAStepDetail_sync')
        ORDER BY created_at ASC, id ASC
      `);

      const rows = pageRes.recordset;
      if (!rows || rows.length === 0) break;
      const fetchAuditMs = (performance.now() - t1).toFixed(1);

      lastCreatedAt = rows[rows.length - 1].created_at;
      lastId = rows[rows.length - 1].id;

      // 2. Query Old DB
      const t2 = performance.now();
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
        }
      }

      // Fetch CodeItem
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

      // Fetch SLAStepDetail
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

          let correctReceiver = correctUserId;
          let correctReceiverUnit = a.receiver_unit ? await resolveUnitNameToId(a.receiver_unit) : null;

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

            DELETE target
            FROM dbo.outgoing_assignment target
            INNER JOIN #AuditUpdates src ON src.is_assignment_update = 1
              AND target.document_id = src.document_id
              AND target.receiver = src.receiver
              AND target.role_process = src.role_process
            WHERE target.last_audit_id <> src.id;

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
          console.error(`❌ Lỗi thực tế xảy ra khi bulk update batch dự thảo năm ${year}:`, err);
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

      codeItemOriginIds.clear();
      slaStepItemIds.clear();

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
  console.log('=== HOÀN TẤT TRUY NGƯỢC VÀ CẬP NHẬT TẤT CẢ PARTITION DỰ THẢO VĂN BẢN ĐI (2012 - 2030) ===');
  console.log(`- Tổng số bản ghi rà soát [Draft Outgoing]: ${grandTotalProcessed}`);
  console.log(`- Số bản ghi đã cập nhật toàn bộ (audit, outgoing_assignment, outgoing_current_state): ${grandTotalUpdated}`);
  console.log(`- Số bản ghi đã chuẩn sẵn từ trước: ${grandTotalSkipped}`);
  console.log(`- Số bản ghi không tra cứu được Email/Name: ${grandTotalNotFound}`);
  console.log('=================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Lỗi khi chạy script fix draft audit:', err);
  process.exit(1);
});
