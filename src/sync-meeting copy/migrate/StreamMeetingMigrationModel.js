const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const mapping = require('./mapping.json');


const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamMeetingMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_MEETING_MIGRATION' });

    // Config bảng cũ
    this.oldConfig = tableMappings.meeting;

    this.oldDbName = this.oldConfig.oldDatabase;
    this.oldDbSchema = this.oldConfig.oldSchema;
    this.oldDbTable = this.oldConfig.oldTable;
    this.oldUserDb = this.oldConfig.oldUserDatabase || 'WSS_Content_eoffice';

    // Bảng staging tạm thời
    this.newDbName = this.oldConfig.newDatabase;
    this.newDbSchema = this.oldConfig.newSchema;
    this.newTableSync = 'meeting_sync_staging';
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging nếu chưa có.
   */
  async initialize() {
    console.log(`[StreamMeetingMigrationModel] Initializing...`);
    await super.initialize();
    await this.ensureStagingTableExists();
    await this.ensureMeetingsColumnsExist();
    await this.ensureDefaultRoomExists();
    console.log(`[StreamMeetingMigrationModel] Initialization complete.`);
  }


  async ensureMeetingsColumnsExist() {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const meetingsTable = `[${db}].[${schema}].[meetings]`;
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;
      const roomsTable = `[${db}].[${schema}].[meeting_rooms]`;

      console.log(`[StreamMeetingMigrationModel] Ensuring tables and columns exist...`);

      // 1. Cửa bảng meetings
      const meetingColQuery = `
      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'table_bak')
          ALTER TABLE ${meetingsTable} ADD table_bak INT NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'id_sp_bak')
          ALTER TABLE ${meetingsTable} ADD id_sp_bak NVARCHAR(255) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'sharepoint_version')
          ALTER TABLE ${meetingsTable} ADD sharepoint_version NVARCHAR(50) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'priority')
          ALTER TABLE ${meetingsTable} ADD [priority] NVARCHAR(50) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_date')
          ALTER TABLE ${meetingsTable} ADD [meeting_date] DATE NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_time')
          ALTER TABLE ${meetingsTable} ADD [meeting_time] NVARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_mode')
          ALTER TABLE ${meetingsTable} ADD [meeting_mode] NVARCHAR(50) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'conclusion')
          ALTER TABLE ${meetingsTable} ADD [conclusion] NVARCHAR(MAX) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'direct_command')
          ALTER TABLE ${meetingsTable} ADD [direct_command] NVARCHAR(MAX) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_state')
          ALTER TABLE ${meetingsTable} ADD [meeting_state] NVARCHAR(50) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'sharepoint_item_id')
          ALTER TABLE ${meetingsTable} ADD [sharepoint_item_id] NVARCHAR(255) NULL;

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_meetings_id_sp_bak')
          CREATE INDEX IX_meetings_id_sp_bak ON ${meetingsTable}(id_sp_bak);
      `;


      await this.queryNewDb(meetingColQuery);

      // 2. Tạo bảng meeting_units (Theo DDL yêu cầu + id_bak)
      const unitsTableQuery = `
      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = 'meeting_units')
      BEGIN
          CREATE TABLE ${unitsTable} (
              id uniqueidentifier DEFAULT newid() NOT NULL,
              id_bak nvarchar(255) NULL,
              meeting_id uniqueidentifier NULL,
              unit_id nvarchar(100) NOT NULL,
              seat_number nvarchar(50) NULL,
              room_id nvarchar(100) NULL,
              unit_state nvarchar(30) DEFAULT 'PENDING' NOT NULL,
              accept_join bit DEFAULT 0 NOT NULL,
              assign_participants bit DEFAULT 0 NOT NULL,
              seat_participants bit DEFAULT 0 NOT NULL,
              prepare_documents bit DEFAULT 0 NOT NULL,
              processby nvarchar(100) NULL,
              is_room_selected bit DEFAULT 0 NULL,
              CONSTRAINT PK_meeting_units PRIMARY KEY (id)
          );
          CREATE NONCLUSTERED INDEX idx_meeting_unit_meeting ON ${unitsTable}(meeting_id);
      END
      ELSE
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_units' AND COLUMN_NAME = 'id_bak')
              ALTER TABLE ${unitsTable} ADD id_bak nvarchar(255) NULL;
      END
      `;
      await this.queryNewDb(unitsTableQuery);

      // 3. Tạo bảng meeting_rooms (Nếu chưa có)
      const roomsTableQuery = `
      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = 'meeting_rooms')
      BEGIN
          CREATE TABLE ${roomsTable} (
              id nvarchar(100) PRIMARY KEY,
              name nvarchar(255) NOT NULL,
              location nvarchar(MAX) NULL,
              capacity int DEFAULT 0,
              status int DEFAULT 1,
              stage int DEFAULT 1,
              available_from datetime2 NULL,
              created_at datetime2 DEFAULT SYSUTCDATETIME(),
              updated_at datetime2 DEFAULT SYSUTCDATETIME(),
              image nvarchar(MAX) NULL,
              layout_type nvarchar(50) NULL,
              layout_rows int NULL,
              layout_seats int NULL,
              layout_blocks int NULL,
              total_seating int NULL,
              id_sp_bak nvarchar(255) NULL
          );
      END
      `;
      await this.queryNewDb(roomsTableQuery);

      console.log(`[StreamMeetingMigrationModel] [ensureMeetingsColumnsExist] OK`);
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] [ensureMeetingsColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureDefaultRoomExists() {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const roomsTable = `[${db}].[${schema}].[meeting_rooms]`;
      const room = mapping.room_default;

      if (!room || !room.id) return;

      console.log(`[StreamMeetingMigrationModel] Checking/Seeding default room: ${room.id} (${room.name})`);

      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${roomsTable} WHERE id = @id)
      BEGIN
          INSERT INTO ${roomsTable} (
              id, name, location, capacity, status, stage, available_from,
              created_at, updated_at, layout_type, layout_rows, layout_seats,
              layout_blocks, total_seating
          ) VALUES (
              @id, @name, @location, @capacity, @status, @stage, @available_from,
              @created_at, @updated_at, @layout_type, @layout_rows, @layout_seats,
              @layout_blocks, @total_seating
          );
          PRINT 'Default room seeded';
      END
      `;
      await this.queryNewDb(query, {
          id: room.id,
          name: room.name,
          location: room.location,
          capacity: room.capacity,
          status: room.status,
          stage: room.stage,
          available_from: room.available_from,
          created_at: room.created_at,
          updated_at: room.updated_at,
          layout_type: room.layout_type,
          layout_rows: room.layout_rows,
          layout_seats: room.layout_seats,
          layout_blocks: room.layout_blocks,
          total_seating: room.total_seating
      });

    } catch (err) {
        console.error(`[StreamMeetingMigrationModel] ensureDefaultRoomExists ERROR: ${err.message}`);
    }
  }


  /**
   * Tự động tạo bảng staging `meeting_sync_staging` trong DB mới nếu chưa tồn tại.
   */
    async ensureStagingTableExists() {
      try {
        const stagingTableRef = this.getStagingTableRef();
        console.log(`[StreamMeetingMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
        const schema = this.newDbSchema || 'dbo';
        const table = this.newTableSync;

        const createQuery = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
        BEGIN
            CREATE TABLE ${stagingTableRef} (
                [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
                [__sync_time] DATETIME2 NULL,
                [__sync_id_num] BIGINT NULL,
                [ID] BIGINT NOT NULL
            );
            CREATE UNIQUE INDEX IX_${table}_ID ON ${stagingTableRef}([ID]);
        END
        `;
        await this.queryNewDb(createQuery);

        // 2. Danh sách các cột cần đảm bảo (Tự động thêm nếu thiếu)
        const columnsToAdd = [
            { name: 'ListName', type: 'NVARCHAR(500)' },
            { name: 'CreatedDate', type: 'NVARCHAR(500)' },
            { name: 'ModifiedDate', type: 'NVARCHAR(500)' },
            { name: 'tp_Created', type: 'NVARCHAR(500)' },
            { name: 'tp_Modified', type: 'NVARCHAR(500)' },
            { name: 'Title', type: 'NVARCHAR(MAX)' },
            { name: 'StartDate', type: 'NVARCHAR(500)' },
            { name: 'EndDate', type: 'NVARCHAR(500)' },
            { name: 'Location', type: 'NVARCHAR(MAX)' },
            { name: 'Description', type: 'NVARCHAR(MAX)' },
            { name: 'Organizer', type: 'NVARCHAR(500)' },
            { name: 'AuthorName', type: 'NVARCHAR(500)' },
            { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
            { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
            { name: 'EditorName', type: 'NVARCHAR(500)' },
            { name: 'EditorAccount', type: 'NVARCHAR(500)' },
            { name: 'nvarchar4', type: 'NVARCHAR(MAX)' },
            { name: 'nvarchar6', type: 'NVARCHAR(MAX)' },
            { name: 'nvarchar7', type: 'NVARCHAR(MAX)' },
            { name: 'nvarchar10', type: 'NVARCHAR(MAX)' },
            { name: 'nvarchar14', type: 'NVARCHAR(MAX)' },
            { name: 'priority', type: 'NVARCHAR(MAX)' },
            { name: 'ThoiLuongGiay', type: 'INT' },
            { name: 'DocumentTitle', type: 'NVARCHAR(MAX)' }
        ];


        for (const col of columnsToAdd) {
            const alterQuery = `
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}')
            BEGIN
                ALTER TABLE ${stagingTableRef} ADD [${col.name}] ${col.type} NULL;
            END
            `;
            await this.queryNewDb(alterQuery);
        }

        console.log(`[StreamMeetingMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);

      } catch (err) {
        console.error(`[StreamMeetingMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
        throw err;
      }
    }

  getStagingTableRef() {
    const ref = this.newDbName
      ? `${this.newDbName}.${this.newDbSchema}.${this.newTableSync}`
      : `${this.newDbSchema}.${this.newTableSync}`;
    return ref;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return DEFAULT_SYNC_TIME;
    return dateValue.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.tp_Modified || row?.tp_Created || null;
    if (!raw) return null;
    const dateValue = new Date(raw);
    if (Number.isNaN(dateValue.getTime())) return null;
    return dateValue.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id_num ?? row?.ID ?? 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    console.log(`[StreamMeetingMigrationModel] Fetching list from old DB since ${lastSyncTime} (ID > ${lastSyncId})...`);

    const query = `
        SELECT TOP 500
            l.[tp_Title] AS ListName,
            ud.[tp_ID] AS ID,
            ud.[tp_Created] AS tp_Created,
            ud.[tp_Modified] AS tp_Modified,
            ui_author.[tp_Title] AS AuthorName,
            ui_author.[tp_Login] AS AuthorAccount,
            ui_author.[tp_Email] AS AuthorEmail,
            ui_editor.[tp_Title] AS EditorName,
            ui_editor.[tp_Login] AS EditorAccount,
            ud.[nvarchar1] AS Title,
            ud.[datetime1] AS StartDate,
            ud.[datetime2] AS EndDate,
            ud.[nvarchar2] AS Location,
            ud.[nvarchar3] AS Description,
            ud.[nvarchar4] AS nvarchar4,
            ud.[nvarchar5] AS priority,
            ud.[nvarchar6] AS nvarchar6,
            ud.[nvarchar7] AS nvarchar7,
            ud.[nvarchar10] AS nvarchar10,
            ud.[nvarchar14] AS nvarchar14,
            ci.[Title] AS DocumentTitle,

            -- Sync Tracking
            ud.[tp_Modified] AS __sync_time,
            ud.[tp_ID] AS __sync_id_num

        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        INNER JOIN [${this.oldDbName}].[dbo].[AllLists] l
            ON ud.[tp_ListId] = l.[tp_ID]
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author
            ON ud.[tp_Author] = ui_author.[tp_ID]
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor
            ON ud.[tp_Editor] = ui_editor.[tp_ID]
        LEFT JOIN [DataEOfficeSNP].[SNP].[CodeItem] ci
            ON ud.[tp_ID] = ci.[SPItemId]
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.[tp_IsCurrent] = 1
        AND ud.[tp_DeleteTransactionId] = 0x0
        AND (
            ud.[tp_Modified] > @lastSyncTime
            OR (
                ud.[tp_Modified] = @lastSyncTime
                AND ud.[tp_ID] > @lastSyncId
            )
        )
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
    `;

    const rows = await this.queryOldDb(query, {
      lastSyncTime,
      lastSyncId: Number(lastSyncId || 0)
    });
    console.log(`[StreamMeetingMigrationModel] Fetched ${rows.length} rows from old DB`);
    return rows;
  }

  async syncOldToStaging(rows, { transaction } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    console.log(`[StreamMeetingMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const internalColumns = new Set(['__sync_time', '__sync_id_num']);
    const columns = Object.keys(rows[0]).filter(c => !internalColumns.has(c));
    const keyColumn = 'ID';
    const stagingTableRef = this.getStagingTableRef();

    for (const row of rows) {
      const params = {};
      for (const column of columns) {
        params[column] = row[column] != null ? String(row[column]) : null;
      }
      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;
      const updateSet = columns.filter(c => c !== keyColumn).map(c => `[${c}] = @${c}`).join(', ');
      const query = `
      IF EXISTS (SELECT 1 FROM ${stagingTableRef} WHERE [${keyColumn}] = @${keyColumn})
      BEGIN
          UPDATE ${stagingTableRef} SET ${updateSet}, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num WHERE [${keyColumn}] = @${keyColumn}
      END
      ELSE
      BEGIN
          INSERT INTO ${stagingTableRef} (${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num)
          VALUES (${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num)
      END
      `;
      await this.queryNewDbTx(query, params, transaction);
    }
    console.log(`[StreamMeetingMigrationModel] Staging complete for ${rows.length} rows`);
    return { stagedCount: rows.length };
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId);
    const stageResult = await this.syncOldToStaging(rows);

    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;
    for (const row of rows) {
      const rowTime = this.extractRowSyncTime(row);
      const rowId = this.extractRowSyncId(row);
      if (!rowTime) continue;
      if (this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
        nextSyncTime = rowTime;
        nextSyncId = rowId;
      }
    }

    return {
      syncJobId, rows, totalCount: rows.length, stagedCount: Number(stageResult?.stagedCount || 0),
      lastSyncTime: nextSyncTime, lastSyncId: nextSyncId
    };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async fetchOneFromSource({ lastSyncTime, lastSyncId }) {
    const listIds = this.oldConfig.listIds || [];
    const listIdsStr = listIds.map(id => `'${id}'`).join(',');
    const query = `
        SELECT TOP 1
            ud.[tp_ID] AS ID,
            ud.[tp_Created] AS tp_Created,
            ud.[tp_Modified] AS tp_Modified,
            ui_author.[tp_Title] AS AuthorName,
            ui_author.[tp_Login] AS AuthorAccount,
            ui_author.[tp_Email] AS AuthorEmail,
            ui_editor.[tp_Title] AS EditorName,
            ui_editor.[tp_Login] AS EditorAccount,
            ud.[nvarchar1] AS Title,
            ud.[datetime1] AS StartDate,
            ud.[datetime2] AS EndDate,
            ud.[nvarchar2] AS Location,
            ud.[nvarchar3] AS Description,
            ud.[nvarchar4] AS nvarchar4,
            ud.[nvarchar5] AS priority,
            ud.[nvarchar6] AS nvarchar6,
            ud.[nvarchar7] AS nvarchar7,
            ud.[nvarchar10] AS nvarchar10,
            ud.[nvarchar14] AS nvarchar14,
            ci.[Title] AS DocumentTitle,
            ud.[tp_Modified] AS __sync_time,
            ud.[tp_ID] AS __sync_id_num
        FROM [${this.oldDbName}].[dbo].[AllUserData] ud
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_author ON ud.[tp_Author] = ui_author.[tp_ID]
        LEFT JOIN [${this.oldUserDb}].[dbo].[UserInfo] ui_editor ON ud.[tp_Editor] = ui_editor.[tp_ID]
        LEFT JOIN [DataEOfficeSNP].[SNP].[CodeItem] ci ON ud.[tp_ID] = ci.[SPItemId]
        WHERE ud.[tp_ListId] IN (${listIdsStr})
        AND ud.[tp_IsCurrent] = 1
        AND ud.[tp_DeleteTransactionId] = 0x0
        AND (ud.[tp_Modified] > @lastSyncTime OR (ud.[tp_Modified] = @lastSyncTime AND ud.[tp_ID] > @lastSyncId))
        ORDER BY ud.[tp_Modified] ASC, ud.[tp_ID] ASC
    `;
    const rows = await this.queryOldDb(query, { lastSyncTime, lastSyncId });
    return rows?.[0] || null;
  }

  async processOne(syncJobId) {
    console.log(`[StreamMeetingMigrationModel] processOne: Starting job ${syncJobId}`);
    const jobState = await this.getSyncJobState(syncJobId);
    if (!jobState) throw new Error(`Job state not found: ${syncJobId}`);

    const rowData = await this.fetchOneFromSource({
      lastSyncTime: this.normalizeSyncTime(jobState.last_sync_time || DEFAULT_SYNC_TIME),
      lastSyncId: Number(jobState.last_sync_id || 0)
    });

    if (!rowData) {
        console.log(`[StreamMeetingMigrationModel] processOne: No more data for job ${syncJobId}`);
        return { syncJobId, processed: false, done: true };
    }

    console.log(`[StreamMeetingMigrationModel] processOne: Processing row ID ${rowData.ID}`);
    await this.processRowData(rowData);

    await this.queryNewDb(
      `UPDATE sync_jobs SET total_processed = ISNULL(total_processed,0) + 1, total_success = ISNULL(total_success,0) + 1,
       last_sync_time = @lastSyncTime, last_sync_id = @lastSyncId WHERE job_id = @syncJobId`,
      { syncJobId, lastSyncTime: this.extractRowSyncTime(rowData), lastSyncId: this.extractRowSyncId(rowData) }
    );

    console.log(`[StreamMeetingMigrationModel] processOne: Successfully processed row ID ${rowData.ID}`);
    return { syncJobId, processed: true, done: false };
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');

    const recordId = String(rowData.ID);
    console.log(`[StreamMeetingMigrationModel] processRowData: recordId=${recordId}`);
    const { externalKey } = this.oldConfig;

    // --- SỬ DỤNG ROBUST RESOLVER MỚI (6 BƯỚC ƯU TIÊN + LOG CHI TIẾT) ---
    console.log(`[StreamMeetingMigrationModel] --- RESOLVING CREATOR/CHAIRMAN FOR ID: ${recordId} ---`);
    
    // Resolve Creator
    const creatorId = await this.helper.robustUserResolver(rowData, transaction);
    
    // Resolve Chairman (Sử dụng cùng logic 6 bước ưu tiên)
    const chairmanId = await this.helper.robustUserResolver(rowData, transaction);

    console.log(`[StreamMeetingMigrationModel] FINAL DECISION: Creator=${creatorId}, Chairman=${chairmanId}`);

    rowData.AuthorAccount = creatorId;
    rowData.chairman_id = chairmanId;
    rowData.created_by = creatorId; 



    // Mapping Secretary (Thư ký) from nvarchar14
    if (rowData.nvarchar14) {
        rowData.secretary_id = await this.helper.mapUserName(rowData.nvarchar14, transaction);
    }

    // Mapping Direct Command and Conclusion
    rowData.direct_command = rowData.DocumentTitle || null;
    rowData.conclusion = rowData.nvarchar7 || null;

    // Xử lý tách Ngày và Giờ từ StartDate
    if (rowData.StartDate) {
        const d = new Date(rowData.StartDate);
        if (!isNaN(d.getTime())) {
            // Định dạng: yyyy-MM-dd
            rowData.meeting_date = d.toISOString().split('T')[0];
            // Định dạng: HH:mm
            rowData.meeting_time = d.toTimeString().split(' ')[0].substring(0, 5);
            // Gán các trường started_at/ended_at nếu cần cho app
            rowData.started_at = rowData.StartDate;
            if (rowData.EndDate) rowData.ended_at = rowData.EndDate;

            // Map priority (Col 4 of sample) if possible
            // In SharePoint, priority is usually stored in nvarchar or specialized field
            // We assume it might be in nvarchar5 or similar if not provided, but let's stick to what we have

            console.log(`[StreamMeetingMigrationModel] Processed date: date=${rowData.meeting_date}, time=${rowData.meeting_time}`);
        }
    }

    // Explicitly map room_ids from Location if it contains comma-separated IDs
    if (rowData.Location && rowData.Location.includes('-')) {
        // SharePoint room items often look like "20260309094614-9QSLJL51"
        rowData.room_ids = rowData.Location;
    }

    // Meeting mode logic
    if (rowData.Location) {
        const loc = rowData.Location.toLowerCase();
        if (loc.includes('zoom') || loc.includes('online')) {
            rowData.meeting_mode = 'ONLINE';
        } else if (loc.includes('hybrid')) {
            rowData.meeting_mode = 'HYBRID';
        } else {
            rowData.meeting_mode = 'OFFLINE';
        }
    } else {
        rowData.meeting_mode = 'OFFLINE';
    }

    // Mark record from Meeting module
    rowData.table_bak = 1;

    const result = await this.upsertDataToNewDB(rowData, this.oldConfig, externalKey, recordId, transaction);
    console.log(`[StreamMeetingMigrationModel] Upsert result for recordId=${recordId}: ${result.action}, ID=${result.id}`);

    const meetingId = result.id;
    if (meetingId) {
        // Create 3-step Audit Trail (CREATE, TRINH_LICH, PHE_DUYET_LICH)
        // Create 3-step Audit Trail using resolved IDs
        await this.createDefaultAuditForMigration(meetingId, rowData.AuthorAccount, rowData.chairman_id, transaction);

        // Online Meeting Logic
        if (rowData.meeting_mode === 'ONLINE') {
            console.log(`[StreamMeetingMigrationModel] Creating online meeting for ID ${meetingId}`);
            await this.helper.createOnlineMeeting(meetingId, 'ZOOM', transaction);
        }

        // Recurrence helper (Standard behavior)
        await this.helper.createRecurrenceKhong(meetingId, rowData.StartDate, transaction);

        // NEW: Create meeting_units entry for the room/unit
        await this.ensureMeetingUnitExists(meetingId, rowData, transaction);
    }

    return {
        backupId: recordId,
        affected: result.affected,
        logs: [{ table: this.oldConfig.newTable, action: result.action }]
    };
  }

  async ensureMeetingUnitExists(meetingId, rowData, transaction = null) {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;

      const unitId = rowData.organizational_unit || mapping.defaults.ORG_UNIT;
      const roomId = rowData.room_ids || mapping.room_default.id;
      const idBak = String(rowData.ID);

      console.log(`[StreamMeetingMigrationModel] Ensuring meeting_units entry for meetingId=${meetingId}, roomId=${roomId}`);

      const query = `
      IF NOT EXISTS (SELECT 1 FROM ${unitsTable} WHERE meeting_id = @meetingId AND unit_id = @unitId)
      BEGIN
          INSERT INTO ${unitsTable} (
              id, id_bak, meeting_id, unit_id, room_id, unit_state,
              accept_join, assign_participants, seat_participants, prepare_documents, is_room_selected
          ) VALUES (
              NEWID(), @idBak, @meetingId, @unitId, @roomId, 'CONFIRMED',
              1, 1, 1, 1, 1
          );
      END
      `;
      await this.queryNewDbTx(query, {
          meetingId,
          unitId,
          roomId,
          idBak
      }, transaction);

    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] ensureMeetingUnitExists ERROR: ${err.message}`);
    }
  }


  // Remove createMeetingAudit as it's replaced by createDefaultAuditForMigration

  async getUnitIdByCode(code, transaction = null) {
      if (!code) return process.env.DEFAULT_RECEIVER_UNIT_ID || '68afb3a1cb36081f0bba5dd6';
      const dbName = this.newDbName || process.env.NEW_DB_NAME || 'app_tancang';
      try {
          const query = `
            SELECT TOP 1 id
            FROM [${dbName}].[dbo].[organization_units]
            WHERE [code] = @code OR [name] LIKE '%' + @code + '%'
          `;
          const results = await this.queryNewDbTx(query, { code }, transaction);
          const foundId = results?.[0]?.id;

          if (foundId) return foundId;

          // Fallback if not found
          const fallbackId = process.env.DEFAULT_RECEIVER_UNIT_ID || '68afb3a1cb36081f0bba5dd6';
          console.log(`[StreamMeetingMigrationModel] Unit not found for code: ${code}. Falling back to: ${fallbackId}`);
          return fallbackId;
      } catch (err) {
          console.error(`[StreamMeetingMigrationModel] [getUnitIdByCode] ERROR: ${err.message}`);
          return process.env.DEFAULT_RECEIVER_UNIT_ID || '68afbee3cb36081f0bbbef2edvdb';
      }
  }

  async createDefaultAuditForMigration(meetingId, creatorUserId, chairmanId, transaction = null) {
    const auditTable = `[${this.newDbName}].[dbo].[audit]`;
    const creatorId = creatorUserId || 'SYSTEM_MIGRATION';
    const finalChairmanId = chairmanId || 'eac9bcb6-efcd-4b23-a656-dd351037a138';

    // 1. Resolve IDs for specialized roles
    console.log(`[StreamMeetingMigrationModel] Resolving Audit Roles for ID ${meetingId}...`);
    const quanLyPhongId = await this.helper.syncAndMapUser('Quản lý phòng', transaction) || creatorId;
    const quanLyPhongHopId = await this.helper.syncAndMapUser('Quản lý phòng họp', transaction) || finalChairmanId;

    const query = `
      IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @meetingId AND action_code = 'CREATE')
      BEGIN
          INSERT INTO ${auditTable}
          (
            document_id, [time], user_id, display_name, role, action_code, from_node_id, to_node_id,
            details, origin_id, created_by, receiver, roleProcess, [action], stage_status,
            curStatusCode, type_document, created_at, updated_at
          )
          VALUES
          (
            @meetingId, SYSUTCDATETIME(), @creatorId, N'Người tạo', 'NGUOI_SOAN_LICH', 'CREATE',
            'Activity_1rl80cg', 'Activity_1rl80cg', '{"transferType":"to_person"}', NULL,
            @creatorId, @creatorId, 'processor', N'Tạo văn bản', 'DA_XU_LY', '1', 'Meeting',
            SYSUTCDATETIME(), SYSUTCDATETIME()
          ),
          (
            @meetingId, SYSUTCDATETIME(), @creatorId, N'Người tạo', 'NGUOI_SOAN_LICH',
            'TRINH_LICH', 'Activity_1rl80cg', 'Gateway_16pjuoq', '{"note":""}', 'migration_origin',
            @creatorId, @quanLyPhongId, 'processor', N'Chuyển Ban quản lý phòng', 'DONG_Y_PHE_DUYET',
            '2', 'Meeting', SYSUTCDATETIME(), SYSUTCDATETIME()
          ),
          (
            @meetingId, SYSUTCDATETIME(), @quanLyPhongHopId, N'Quản lý phòng họp', 'BAN_QUAN_LY_PHONG_HOP',
            'PHE_DUYET_LICH', 'Gateway_16pjuoq', 'Activity_18dmg6c', NULL, 'migration_origin',
            @creatorId, @quanLyPhongHopId, 'seat', N'Gán vị trí chỗ ngồi', 'CHUA_XU_LY',
            '3', 'Meeting', SYSUTCDATETIME(), SYSUTCDATETIME()
          );
      END
    `;
    console.log(`[StreamMeetingMigrationModel] Audit creation for meetingId ${meetingId} (Creator: ${creatorId}, Management: ${quanLyPhongId}, RoomMgmt: ${quanLyPhongHopId})`);
    try {
        await this.queryNewDbTx(query, { meetingId, creatorId, quanLyPhongId, quanLyPhongHopId }, transaction);
    } catch (err) {
        console.error(`[StreamMeetingMigrationModel] createDefaultAuditForMigration ERROR: ${err.message}`);
    }
  }


  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE
      FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    // Trả về Map [tên_cột_lowercase] -> [kiểu_dữ_liệu]
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), r.DATA_TYPE.toLowerCase()));
    return colMap;
  }

  async upsertDataToNewDB(rawData, config, externalKeyField, externalKeyValue, transaction) {
    const { newTable, newSchema, fieldMapping, defaultValues } = config;
    const existingCols = await this.getExistingColumns(newTable, newSchema);
    console.log(`[StreamMeetingMigrationModel] upsertDataToNewDB: table=${newTable}, externalKeyValue=${externalKeyValue}`);

    const params = {};
    const insertCols = [];
    const insertVals = [];
    const updateSet = [];

    // Tự động sinh ID nếu bảng có cột 'id' (case-insensitive) nhưng mapping không có
    if (existingCols.has('id') && !params.hasOwnProperty('id')) {
        const hasIdInMapping = Object.values(fieldMapping).some(v => v.toLowerCase() === 'id') ||
                              Object.keys(defaultValues || {}).some(v => v.toLowerCase() === 'id');
        if (!hasIdInMapping) {
            const newId = uuidv4().toUpperCase();
            params['id'] = newId;
            insertCols.push('[id]');
            insertVals.push('@id');
            // Thường không update ID
        }
    }

    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      if (!existingCols.has(newField.toLowerCase())) continue;
      const value = rawData[oldField];
      if (value === undefined || value === null) continue;
      params[newField] = value;
      insertCols.push(`[${newField}]`);
      insertVals.push(`@${newField}`);

      // 🔥 NEVER update ID or created_at
      if (newField.toLowerCase() !== 'id' && newField.toLowerCase() !== 'created_at') {
        updateSet.push(`[${newField}] = @${newField}`);
      }
    }

    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      if (!existingCols.has(newField.toLowerCase())) continue;
      if (!params.hasOwnProperty(newField)) {
        params[newField] = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
        insertCols.push(`[${newField}]`);
        insertVals.push(`@${newField}`);

        // 🔥 NEVER update ID or created_at
        if (newField.toLowerCase() !== 'id' && newField.toLowerCase() !== 'created_at') {
          updateSet.push(`[${newField}] = @${newField}`);
        }
      }
    }

    for (const [col, type] of existingCols.entries()) {
      if (!params.hasOwnProperty(col)) {
        // Tự động fake dữ liệu dựa trên kiểu dữ liệu của cột
        let fallback = null;
        if (type.includes('char') || type.includes('text')) {
          fallback = 'Chưa xác định (Auto-fake)';
        } else if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('numeric')) {
          fallback = 0;
        } else if (type.includes('date') || type.includes('time')) {
          fallback = new Date();
        } else if (type.includes('bit')) {
          fallback = 0;
        }

        if (fallback !== null) {
          params[col] = fallback;
          insertCols.push(`[${col}]`);
          insertVals.push(`@${col}`);
          if (col.toLowerCase() !== 'id' && col.toLowerCase() !== 'created_at') {
            updateSet.push(`[${col}] = @${col}`);
          }
        }
      }
    }

    params._externalKeyValue = externalKeyValue;
    console.log(`[StreamMeetingMigrationModel] upsertDataToNewDB params: ${JSON.stringify(params)}`);
    const tableRef = `[${this.newDbName}].[${newSchema}].[${newTable}]`;
    const query = `
      DECLARE @OutputTable TABLE (id NVARCHAR(255));
      DECLARE @affected INT;

      IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKeyField}] = @_externalKeyValue)
      BEGIN
          UPDATE ${tableRef} SET ${updateSet.length ? updateSet.join(', ') : `${externalKeyField} = ${externalKeyField}`}
          OUTPUT INSERTED.id INTO @OutputTable
          WHERE [${externalKeyField}] = @_externalKeyValue;

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'updated' AS action;
      END
      ELSE
      BEGIN
          INSERT INTO ${tableRef} (${insertCols.join(', ')})
          OUTPUT INSERTED.id INTO @OutputTable
          VALUES (${insertVals.join(', ')});

          SELECT @affected = @@ROWCOUNT;
          SELECT (SELECT TOP 1 id FROM @OutputTable) AS id, @affected AS affected, 'inserted' AS action;
      END
    `;
    const result = await this.queryNewDbTx(query, params, transaction);
    const row = Array.isArray(result) ? result[0] : result;
    console.log(`[StreamMeetingMigrationModel] queryNewDbTx result: action=${row?.action}, affected=${row?.affected}`);
    return { id: row?.id || null, action: row?.action || 'none', affected: Number(row?.affected || 0) };
  }
}

module.exports = StreamMeetingMigrationModel;
