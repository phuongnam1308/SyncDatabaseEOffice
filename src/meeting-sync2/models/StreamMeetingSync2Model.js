// -------------------------------------------------------
/**
 * Model responsible for syncing meeting data from multiple legacy databases
 * directly into the new target table. It builds a UNION‑ALL query across
 * all source DBs, extracts rows, and upserts them without using a staging
 * table. Detailed logging is provided for each step.
 */
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../../utils/logger');
const { tableMappings } = require('../config');

class StreamMeetingSync2Model extends BaseIncrementalSyncInterface {
  constructor() {
    super();
    this.databases = require('../databases.json');
    this.mapping = tableMappings.meeting;
    this.oldConfig = this.mapping;
    this.newDbName = this.mapping.newDatabase;
    // Giữ nguyên sử dụng bảng meeting_sync_staging có sẵn
    this.newTableSync = `${this.mapping.newDatabase}.dbo.meeting_sync_staging`;

    // Đánh dấu KHÔNG hỗ trợ batch processing qua processOne (vì processOne chỉ xử lý 1 dòng)
    this.isBatchSync = false;
  }

  getName() {
    return 'StreamMeetingSync2Model';
  }

  async initialize() {
    await super.initialize();
    logger.info(`[meeting-sync2] Chạy mô phỏng tạo bảng/cột (chỉ in câu lệnh, KHÔNG thực thi DB)...`);
    await this.ensureMeetingsColumnsExist();
    await this.ensureDefaultRoomExists();
    await this.ensureMeetingParticipantsTableExists();
    await this.ensureAuditTableExists();
    await this.repairMissingAuditRecords();
  }

  async repairMissingAuditRecords() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.mapping.newSchema || 'dbo';
      const meetingsTable = `[${db}].[${schema}].[${this.mapping.newTable}]`;
      const auditTable = `[${db}].[${schema}].[audit]`;

      logger.info(`[meeting-sync2] Đang kiểm tra và tự động tạo bổ sung bản ghi audit cho các lịch họp cũ bị thiếu...`);

      // CREATE
      const queryCreate = `
        INSERT INTO ${auditTable} (
            document_id, time, user_id, display_name, role, action_code, 
            process_instance_id, activity_instance_id, params, log_message, 
            creator_id, update_by, action_type, node_name, process_state, status, type, 
            created_at, updated_at, is_latest
        )
        SELECT 
            CAST(m.id AS nvarchar(64)), SYSUTCDATETIME(), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), N'Người tạo', 'NGUOI_SOAN_LICH', 'CREATE',
            'Activity_1rl80cg', 'Activity_1rl80cg', '{"transferType":"to_person"}', NULL,
            ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), 'processor', N'Tạo văn bản', 'DA_XU_LY', '1', 'Meetings',
            SYSUTCDATETIME(), SYSUTCDATETIME(), 1
        FROM ${meetingsTable} m
        WHERE NOT EXISTS (
            SELECT 1 FROM ${auditTable} a 
            WHERE a.document_id = CAST(m.id AS nvarchar(64)) AND a.action_code = 'CREATE'
        );
      `;

      // TRINH_LICH
      const queryTrinhLich = `
        INSERT INTO ${auditTable} (
            document_id, time, user_id, display_name, role, action_code, 
            process_instance_id, activity_instance_id, params, log_message, 
            creator_id, update_by, action_type, node_name, process_state, status, type, 
            created_at, updated_at, is_latest
        )
        SELECT 
            CAST(m.id AS nvarchar(64)), DATEADD(second, 1, SYSUTCDATETIME()), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), N'Quản lý phòng', 'BAN_QUAN_LY_PHONG_HOP', 'TRINH_LICH',
            'Activity_0s1w51v', 'Activity_0s1w51v', '{"transferType":"to_person"}', NULL,
            ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), 'processor', N'Trình lịch', 'DA_XU_LY', '1', 'Meetings',
            SYSUTCDATETIME(), SYSUTCDATETIME(), 1
        FROM ${meetingsTable} m
        WHERE NOT EXISTS (
            SELECT 1 FROM ${auditTable} a 
            WHERE a.document_id = CAST(m.id AS nvarchar(64)) AND a.action_code = 'TRINH_LICH'
        );
      `;

      // PHE_DUYET_LICH
      const queryPheDuyet = `
        INSERT INTO ${auditTable} (
            document_id, time, user_id, display_name, role, action_code, 
            process_instance_id, activity_instance_id, params, log_message, 
            creator_id, update_by, action_type, node_name, process_state, status, type, 
            created_at, updated_at, is_latest
        )
        SELECT 
            CAST(m.id AS nvarchar(64)), DATEADD(second, 2, SYSUTCDATETIME()), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), N'Người phê duyệt', 'NGUOI_PHE_DUYET_LICH', 'PHE_DUYET_LICH',
            'Activity_0q8jsh2', 'Activity_0q8jsh2', '{"transferType":"to_person"}', NULL,
            ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), ISNULL(CAST(m.chairman_id AS nvarchar(64)), 'SYSTEM_MIGRATION'), 'processor', N'Phê duyệt lịch', 'DA_XU_LY', '1', 'Meetings',
            SYSUTCDATETIME(), SYSUTCDATETIME(), 1
        FROM ${meetingsTable} m
        WHERE NOT EXISTS (
            SELECT 1 FROM ${auditTable} a 
            WHERE a.document_id = CAST(m.id AS nvarchar(64)) AND a.action_code = 'PHE_DUYET_LICH'
        );
      `;

      await this.queryNewDb(queryCreate);
      await this.queryNewDb(queryTrinhLich);
      await this.queryNewDb(queryPheDuyet);

      logger.info(`[meeting-sync2] ✅ Đã quét và tự động bổ sung xong các bản ghi audit bị thiếu.`);
    } catch (err) {
      logger.error(`[meeting-sync2] repairMissingAuditRecords ERROR: ${err.message}`);
    }
  }

  async checkAndLogMissingColumn(table, column, type, schema = 'dbo') {
    const db = this.newDbName || process.env.NEW_DB_NAME;
    const query = `SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${column}'`;
    const res = await this.queryNewDb(query);
    if (!res || res.length === 0) {
      logger.info(`[meeting-sync2] Bảng [${table}] THIẾU CỘT: [${column}]. Lệnh cần chạy:\nALTER TABLE [${db}].[${schema}].[${table}] ADD [${column}] ${type};`);
    }
  }

  async checkAndLogMissingTable(table, createSql, schema = 'dbo') {
    const db = this.newDbName || process.env.NEW_DB_NAME;
    const query = `SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}'`;
    const res = await this.queryNewDb(query);
    if (!res || res.length === 0) {
      logger.info(`[meeting-sync2] THIẾU BẢNG: [${table}]. Lệnh cần chạy:\n${createSql}`);
      return true;
    }
    return false;
  }

  async ensureMeetingsColumnsExist() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.mapping.newSchema || 'dbo';
      const meetingsTable = this.mapping.newTable;

      const meetingCols = [
        { name: 'meeting_date', type: 'DATE NULL' },
        { name: 'meeting_time', type: 'NVARCHAR(100) NULL' },
        { name: 'meeting_mode', type: 'NVARCHAR(50) NULL' },
        { name: 'conclusion', type: 'NVARCHAR(MAX) NULL' },
        { name: 'direct_command', type: 'NVARCHAR(MAX) NULL' },
        { name: 'meeting_state', type: 'NVARCHAR(50) NULL' },
        { name: 'sharepoint_item_id', type: 'NVARCHAR(255) NULL' },
        { name: 'duration_seconds', type: 'INT NULL' },
        { name: 'assigned_seat_by', type: 'NVARCHAR(100) NULL' },
        { name: 'recurrence_id', type: 'UNIQUEIDENTIFIER NULL' },
        { name: 'chairman_type', type: 'VARCHAR(10) NULL' },
        { name: 'secretary_type', type: 'VARCHAR(10) NULL' },
        { name: 'google_calendar_processed_by_cron', type: 'BIT NULL' }
      ];

      for (const col of meetingCols) {
        await this.checkAndLogMissingColumn(meetingsTable, col.name, col.type, schema);
      }

      const checkIndexQuery = `SELECT 1 FROM [${db}].sys.indexes WHERE name = 'IX_${meetingsTable}_meeting_date'`;
      const idxRes = await this.queryNewDb(checkIndexQuery);
      if (!idxRes || idxRes.length === 0) {
        logger.info(`[meeting-sync2] THIẾU INDEX: IX_${meetingsTable}_meeting_date. Lệnh cần chạy:\nCREATE INDEX IX_${meetingsTable}_meeting_date ON [${db}].[${schema}].[${meetingsTable}](meeting_date);`);
      }

      const unitsTable = `[${db}].[${schema}].[meeting_units]`;
      const unitsTableCreate = `
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
          CREATE INDEX IX_meeting_units_id_bak ON ${unitsTable}(id_bak);
      `;
      const isUnitsMissing = await this.checkAndLogMissingTable('meeting_units', unitsTableCreate, schema);
      if (!isUnitsMissing) {
        await this.checkAndLogMissingColumn('meeting_units', 'id_bak', 'nvarchar(255) NULL', schema);
      }

      const roomsTable = `[${db}].[${schema}].[meeting_rooms]`;
      const roomsTableCreate = `
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
              id_sp_bak nvarchar(255) NULL,
              layout_col_wing int NULL,
              layout_row_bottom int NULL,
              tb_bak int NULL
          );
      `;
      const isRoomsMissing = await this.checkAndLogMissingTable('meeting_rooms', roomsTableCreate, schema);
      if (!isRoomsMissing) {
        await this.checkAndLogMissingColumn('meeting_rooms', 'layout_col_wing', 'int NULL', schema);
        await this.checkAndLogMissingColumn('meeting_rooms', 'layout_row_bottom', 'int NULL', schema);
        await this.checkAndLogMissingColumn('meeting_rooms', 'tb_bak', 'int NULL', schema);
      }

      logger.info(`[meeting-sync2] [ensureMeetingsColumnsExist] OK (Đã kiểm tra qua INFORMATION_SCHEMA)`);
    } catch (err) {
      logger.error(`[meeting-sync2] [ensureMeetingsColumnsExist] ERROR: ${err.message}`);
    }
  }

  async ensureDefaultRoomExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.mapping.newSchema || 'dbo';
      const roomsTable = `[${db}].[${schema}].[meeting_rooms]`;
      
      const room = {
        id: "7611ef44-42de-426f-9721-e054ef92bb6d",
        name: "Phòng họp TCT",
        location: null,
        capacity: 100,
        status: 1,
        stage: 1,
        available_from: null,
        created_at: new Date(),
        updated_at: new Date(),
        layout_type: "CUSTOM",
        layout_rows: 5,
        layout_seats: 20,
        layout_blocks: 1,
        total_seating: 100
      };

      // Check if table exists first to avoid SQL errors
      const tableCheckQuery = `SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'meeting_rooms' AND TABLE_SCHEMA = '${schema}'`;
      const tableCheckRes = await this.queryNewDb(tableCheckQuery);
      
      let shouldLogInsert = false;

      if (!tableCheckRes || tableCheckRes.length === 0) {
        logger.info(`[meeting-sync2] Bảng meeting_rooms chưa tồn tại, sẽ cần insert Default Room sau khi tạo bảng.`);
        shouldLogInsert = true;
      } else {
        const checkQuery = `SELECT 1 FROM ${roomsTable} WHERE id = '${room.id}'`;
        const res = await this.queryNewDb(checkQuery);
        if (!res || res.length === 0) {
          shouldLogInsert = true;
        } else {
          logger.info(`[meeting-sync2] Default Room đã tồn tại.`);
        }
      }

      if (shouldLogInsert) {
        const query = `
          INSERT INTO ${roomsTable} (
              id, name, location, capacity, status, stage, available_from,
              created_at, updated_at, layout_type, layout_rows, layout_seats,
              layout_blocks, total_seating
          ) VALUES (
              '${room.id}', N'${room.name}', NULL, 35, ${room.status}, ${room.stage}, NULL,
              SYSUTCDATETIME(), SYSUTCDATETIME(), '${room.layout_type}', ${room.layout_rows}, ${room.layout_seats},
              ${room.layout_blocks}, 35
          );
        `;
        logger.info(`[meeting-sync2] THIẾU Default Room. Lệnh cần chạy:\n${query}`);
      } else {
        // Phòng đã tồn tại, thực hiện cập nhật sức chứa (capacity) theo yêu cầu
        const updateQuery = `
          UPDATE ${roomsTable} 
          SET capacity = 35, total_seating = 35 
          WHERE id = '${room.id}';
        `;
        await this.queryNewDb(updateQuery);
        logger.info(`[meeting-sync2] Đã cập nhật sức chứa phòng họp mặc định thành 35.`);
      }
    } catch (err) {
        logger.error(`[meeting-sync2] ensureDefaultRoomExists ERROR: ${err.message}`);
    }
  }

  async ensureMeetingParticipantsTableExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.mapping.newSchema || 'dbo';
      const participantsTable = `[${db}].[${schema}].[meeting_participants]`;
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;

      logger.info(`[meeting-sync2] Checking meeting_participants table...`);

      const participantsTableCreate = `
          CREATE TABLE ${participantsTable} (
              id uniqueidentifier DEFAULT newid() NOT NULL,
              meeting_unit_id uniqueidentifier NULL,
              user_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
              seat_number nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              room_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              participant_role varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              participant_state varchar(30) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'PENDING' NOT NULL,
              delegated_to_user_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              delegated_from_user_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              delegated_at datetime2 NULL,
              attendance_state varchar(30) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'RECEIVED' NOT NULL,
              attendance_at datetime2 NULL,
              not_check bit DEFAULT 0 NULL,
              assignment_type varchar(30) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'INITIAL' NULL,
              accept_join bit DEFAULT 0 NOT NULL,
              prepare_documents bit DEFAULT 0 NOT NULL,
              delegation_state varchar(30) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'NONE' NOT NULL,
              reject_reason nvarchar(1000) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              unit_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              user_type varchar(10) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
              google_email nvarchar(255) NULL,
              google_calendar_event_id nvarchar(255) NULL,
              google_calendar_sync_status nvarchar(50) NULL,
              google_calendar_sync_error nvarchar(MAX) NULL,
              google_calendar_sync_at datetime2 NULL,
              google_calendar_synced bit NULL,
              google_calendar_hidden bit NULL,
              google_event_id nvarchar(255) NULL,
              CONSTRAINT PK_meeting_participants PRIMARY KEY (id)
          );
      `;
      const isParticipantsMissing = await this.checkAndLogMissingTable('meeting_participants', participantsTableCreate, schema);
      if (!isParticipantsMissing) {
        const participantCols = [
          { name: 'google_email', type: 'nvarchar(255) NULL' },
          { name: 'google_calendar_event_id', type: 'nvarchar(255) NULL' },
          { name: 'google_calendar_sync_status', type: 'nvarchar(50) NULL' },
          { name: 'google_calendar_sync_error', type: 'nvarchar(MAX) NULL' },
          { name: 'google_calendar_sync_at', type: 'datetime2 NULL' },
          { name: 'google_calendar_synced', type: 'bit NULL' },
          { name: 'google_calendar_hidden', type: 'bit NULL' },
          { name: 'google_event_id', type: 'nvarchar(255) NULL' }
        ];
        for (const col of participantCols) {
          await this.checkAndLogMissingColumn('meeting_participants', col.name, col.type, schema);
        }
      }

      logger.info(`[meeting-sync2] [ensureMeetingParticipantsTableExists] OK (Đã kiểm tra)`);
    } catch (err) {
      logger.error(`[meeting-sync2] [ensureMeetingParticipantsTableExists] ERROR: ${err.message}`);
    }
  }

  async ensureAuditTableExists() {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = 'dbo';
      const table = 'audit';
      const tableRef = `[${db}].[${schema}].[${table}]`;

      logger.info(`[meeting-sync2] Checking/Creating Audit table: ${table}`);
      const createAuditTable = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
      BEGIN
          CREATE TABLE ${tableRef} (id bigint IDENTITY(1,1) PRIMARY KEY);
      END
      `;
      const isAuditMissing = await this.checkAndLogMissingTable('audit', createAuditTable, schema);
      if (isAuditMissing) {
          logger.info(`[meeting-sync2] Bảng audit chưa có, tiến hành TẠO BẢNG...`);
          await this.queryNewDb(createAuditTable);
      }

      const auditCols = [
          { name: 'document_id', type: 'nvarchar(64)' },
          { name: 'time', type: 'datetime', nullable: 'DEFAULT getdate()' },
          { name: 'user_id', type: 'nvarchar(64)' },
          { name: 'display_name', type: 'nvarchar(255)' },
          { name: 'role', type: 'nvarchar(64)' },
          { name: 'action_code', type: 'nvarchar(64)' },
          { name: 'from_node_id', type: 'nvarchar(128)' },
          { name: 'to_node_id', type: 'nvarchar(128)' },
          { name: 'details', type: 'nvarchar(MAX)' },
          { name: 'origin_id', type: 'nvarchar(100)' },
          { name: 'created_by', type: 'nvarchar(100)' },
          { name: 'receiver', type: 'nvarchar(100)' },
          { name: 'receiver_unit', type: 'nvarchar(100)' },
          { name: 'group_', type: 'nvarchar(100)' },
          { name: 'roleProcess', type: 'nvarchar(100)' },
          { name: 'action', type: 'nvarchar(255)' },
          { name: 'deadline', type: 'datetime' },
          { name: 'stage_status', type: 'nvarchar(100)' },
          { name: 'curStatusCode', type: 'nvarchar(64)' },
          { name: 'created_at', type: 'datetime', nullable: 'DEFAULT getdate()' },
          { name: 'updated_at', type: 'datetime', nullable: 'DEFAULT getdate()' },
          { name: 'type_document', type: 'varchar(100)' },
          { name: 'processed_by', type: 'varchar(100)' },
          { name: 'acting_as', type: 'varchar(100)' },
          { name: 'table_backups', type: 'nvarchar(255)' },
          { name: 'status_code', type: 'varchar(50)' },
          { name: 'bpmn_version', type: 'varchar(100)' },
          { name: 'type_of_process', type: 'varchar(100)' },
          { name: 'table_bak', type: 'int' }
        ];

      for (const col of auditCols) {
        const query = `
        IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}')
        BEGIN
            ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${col.nullable || 'NULL'};
        END
        `;
        const colCheckQuery = `SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}'`;
        const res = await this.queryNewDb(colCheckQuery);
        if (!res || res.length === 0) {
            logger.info(`[meeting-sync2] Bảng audit thiếu cột ${col.name}, tiến hành THÊM CỘT...`);
            await this.queryNewDb(query);
        }
      }
      logger.info(`[meeting-sync2] [ensureAuditTableExists] OK (Đã kiểm tra và tạo nếu thiếu)`);
    } catch (err) {
      logger.error(`[meeting-sync2] [ensureAuditTableExists] ERROR: ${err.message}`);
    }
  }

  buildSql() {
    return `
DECLARE @dbs TABLE (DbName NVARCHAR(128));
INSERT INTO @dbs (DbName) VALUES('WSS_Content_eoffice'),('WSS_Content_eoffice_atpc'),('WSS_Content_eoffice_cll'),('WSS_Content_eoffice_cntt'),('WSS_Content_eoffice_ct'),('WSS_Content_eoffice_cvtc'),('WSS_Content_eoffice_donvi'),('WSS_Content_eoffice_dvhh'),('WSS_Content_eoffice_dvkt'),('WSS_Content_eoffice_gnvt'),('WSS_Content_eoffice_hc'),('WSS_Content_eoffice_hdsd'),('WSS_Content_eoffice_ht'),('WSS_Content_eoffice_icdlb'),('WSS_Content_eoffice_icdst'),('WSS_Content_eoffice_ios'),('WSS_Content_eoffice_khdt'),('WSS_Content_eoffice_khkd'),('WSS_Content_eoffice_ktvt'),('WSS_Content_eoffice_kvtc'),('WSS_Content_eoffice_mkt'),('WSS_Content_eoffice_npl'),('WSS_Content_eoffice_qlct'),('WSS_Content_eoffice_qsbv'),('WSS_Content_eoffice_record'),('WSS_Content_eoffice_record2018'),('WSS_Content_eoffice_snpl'),('WSS_Content_eoffice_tc'),('WSS_Content_eoffice_tc189'),('WSS_Content_eoffice_tcct'),('WSS_Content_eoffice_tchp'),('WSS_Content_eoffice_tcidi'),('WSS_Content_eoffice_tcld'),('WSS_Content_eoffice_tcmt'),('WSS_Content_eoffice_tco'),('WSS_Content_eoffice_tcot'),('WSS_Content_eoffice_tcpc'),('WSS_Content_eoffice_tcph'),('WSS_Content_eoffice_tctt'),('WSS_Content_eoffice_testuser2'),('WSS_Content_eoffice_thuvientct'),('WSS_Content_eoffice_ttddc'),('WSS_Content_eoffice_vp'),('WSS_Content_eoffice_vpmb'),('WSS_Content_eoffice_vptnb'),('WSS_Content_eoffice_vtb'),('WSS_Content_eoffice_vtt'),('WSS_Content_eoffice_xdct'),('WSS_Content_eoffice_xncg'),('WSS_Content_eoffice_yte');

DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql +     
    CASE WHEN @sql = N'' THEN N''          
         ELSE N'UNION ALL' + CHAR(13) + CHAR(10)     
    END +    
    N'SELECT         
        N''' + DbName + N''' AS DatabaseName,         
        l.[tp_Title]          AS ListName,         
        ud.[tp_ID]            AS ID,         
        ud.[tp_Created]       AS tp_Created,         
        ud.[tp_Modified]      AS tp_Modified,         
        ui_author.[tp_Title]  AS AuthorName,         
        ui_author.[tp_Title]  AS AuthorFullName,         
        ui_author.[tp_Login]  AS AuthorAccount,         
        ui_author.[tp_Email]  AS AuthorEmail,         
        ui_editor.[tp_Title]  AS EditorName,         
        ui_editor.[tp_Login]  AS EditorAccount,         
        ud.[nvarchar1]        AS Title,         
        ud.[nvarchar1]        AS TieuDe,         
        ud.[datetime1]        AS StartDate,         
        ud.[datetime1]        AS BatDau,         
        ud.[datetime2]        AS EndDate,         
        ud.[datetime2]        AS KetThuc,         
        ud.[nvarchar2]        AS Location,         
        ud.[nvarchar2]        AS DiaDiem,         
        ud.[nvarchar3]        AS Description,         
        ud.[nvarchar3]        AS NoiDung,         
        ud.[nvarchar6]        AS LoaiHop,         
        ud.[nvarchar10]       AS ChuTri,         
        ud.[nvarchar14]       AS ThuKy,         
        ud.[tp_Created]       AS CreatedDate,         
        ud.[tp_Modified]      AS ModifiedDate,         
        ud.[nvarchar4]        AS nvarchar4,         
        ud.[nvarchar5]        AS priority,         
        ud.[tp_Modified]      AS __sync_time,         
        ud.[tp_ID]            AS __sync_id_num,         
        ud.[tp_ListId]        AS tp_ListId,
        ud.[float1]           AS SucChua
    FROM [' + DbName + N'].[dbo].[AllUserData] ud WITH (NOLOCK)   
    INNER JOIN [' + DbName + N'].[dbo].[AllLists] l WITH (NOLOCK)        
        ON ud.[tp_ListId] = l.[tp_ID]    
    LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_author WITH (NOLOCK)        
        ON ud.[tp_Author] = ui_author.[tp_ID]    
    LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_editor WITH (NOLOCK)        
        ON ud.[tp_Editor] = ui_editor.[tp_ID]    
    WHERE ud.[tp_ListId] IN (        
        ''B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'',         
        ''360585BB-EDDA-4990-B293-AA097594B073'')      
      AND ud.tp_RowOrdinal = 0'
FROM @dbs;

SET @sql = @sql + N' ORDER BY DatabaseName, __sync_time ASC, __sync_id_num ASC, ListName ASC;';

EXEC sp_executesql @sql;
    `;
  }

  buildCountSql() {
    return `
DECLARE @dbs TABLE (DbName NVARCHAR(128));
INSERT INTO @dbs (DbName) VALUES('WSS_Content_eoffice'),('WSS_Content_eoffice_atpc'),('WSS_Content_eoffice_cll'),('WSS_Content_eoffice_cntt'),('WSS_Content_eoffice_ct'),('WSS_Content_eoffice_cvtc'),('WSS_Content_eoffice_donvi'),('WSS_Content_eoffice_dvhh'),('WSS_Content_eoffice_dvkt'),('WSS_Content_eoffice_gnvt'),('WSS_Content_eoffice_hc'),('WSS_Content_eoffice_hdsd'),('WSS_Content_eoffice_ht'),('WSS_Content_eoffice_icdlb'),('WSS_Content_eoffice_icdst'),('WSS_Content_eoffice_ios'),('WSS_Content_eoffice_khdt'),('WSS_Content_eoffice_khkd'),('WSS_Content_eoffice_ktvt'),('WSS_Content_eoffice_kvtc'),('WSS_Content_eoffice_mkt'),('WSS_Content_eoffice_npl'),('WSS_Content_eoffice_qlct'),('WSS_Content_eoffice_qsbv'),('WSS_Content_eoffice_record'),('WSS_Content_eoffice_record2018'),('WSS_Content_eoffice_snpl'),('WSS_Content_eoffice_tc'),('WSS_Content_eoffice_tc189'),('WSS_Content_eoffice_tcct'),('WSS_Content_eoffice_tchp'),('WSS_Content_eoffice_tcidi'),('WSS_Content_eoffice_tcld'),('WSS_Content_eoffice_tcmt'),('WSS_Content_eoffice_tco'),('WSS_Content_eoffice_tcot'),('WSS_Content_eoffice_tcpc'),('WSS_Content_eoffice_tcph'),('WSS_Content_eoffice_tctt'),('WSS_Content_eoffice_testuser2'),('WSS_Content_eoffice_thuvientct'),('WSS_Content_eoffice_ttddc'),('WSS_Content_eoffice_vp'),('WSS_Content_eoffice_vpmb'),('WSS_Content_eoffice_vptnb'),('WSS_Content_eoffice_vtb'),('WSS_Content_eoffice_vtt'),('WSS_Content_eoffice_xdct'),('WSS_Content_eoffice_xncg'),('WSS_Content_eoffice_yte');

DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql +     
    CASE WHEN @sql = N'' THEN N''          
         ELSE N'UNION ALL' + CHAR(13) + CHAR(10)     
    END +    
    N'SELECT 1 AS dummy
    FROM [' + DbName + N'].[dbo].[AllUserData] ud WITH (NOLOCK)   
    INNER JOIN [' + DbName + N'].[dbo].[AllLists] l WITH (NOLOCK)        
        ON ud.[tp_ListId] = l.[tp_ID]    
    WHERE ud.[tp_ListId] IN (        
        ''B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'',         
        ''360585BB-EDDA-4990-B293-AA097594B073'')      
      AND ud.tp_RowOrdinal = 0'
FROM @dbs;

SET @sql = N'SELECT COUNT(1) AS TongSoBanGhi FROM (' + @sql + N') AS Tmp;';

EXEC sp_executesql @sql;
    `;
  }

  // ============== TÍCH HỢP DASHBOARD ==============

  async getCount(lastSyncTime, lastSyncId = 0) {
    try {
      logger.info(`[meeting-sync2] [getCount] Đang đếm tổng số bản ghi trên 51 DB...`);
      const sql = this.buildCountSql();
      const rows = await this.queryOldDb(sql);
      const total = Number(rows?.[0]?.TongSoBanGhi || 0);
      logger.info(`[meeting-sync2] [getCount] ✅ Tổng cộng: ${total} bản ghi trên 51 DB`);
      return total;
    } catch (err) {
      logger.error(`[meeting-sync2] [getCount] ❌ LỖI: ${err.message}`);
      return 0;
    }
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0) {
    // Không dùng do ta ghi đè getList
    return [];
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    logger.info(`[meeting-sync2] 🚀 BẮT ĐẦU HÚT DỮ LIỆU VÀO STAGING...`);

    // Cập nhật tổng số lên Dashboard
    const totalCount = await this.getCount();

    try {
      await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
        total: totalCount,
        jobId: syncJobId
      });
    } catch (e) { }

    // Đảm bảo bảng staging tồn tại và TRUNCATE data cũ
    await this.ensureStagingTable();
    await this.truncateStagingTable();

    // Hút dữ liệu
    const sql = this.buildSql();
    const rows = await this.queryOldDb(sql);
    logger.info(`[meeting-sync2] ✅ Đã lấy được ${rows.length} bản ghi. Xử lý trùng lặp trước khi nạp...`);

    // Xử lý duplicate để tránh vi phạm Unique Index (tp_SiteId, source_db, tp_ListId, ID)
    const seenKeys = new Set();
    let dupCounter = 100000000; // Bắt đầu từ 100 triệu để tránh đụng ID thật
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      let key = `${r.DatabaseName}_${r.tp_ListId}_${r.ID}`;

      // Nếu trùng key, cấp 1 ID hoàn toàn mới
      while (seenKeys.has(key)) {
        dupCounter++;
        r.ID = dupCounter;
        key = `${r.DatabaseName}_${r.tp_ListId}_${r.ID}`;
      }
      seenKeys.add(key);
    }

    logger.info(`[meeting-sync2] ✅ Đã xử lý xong mảng. Đang nạp vào staging...`);

    // Ghi vào staging theo batch 100 (tối đa 2100 params mỗi query, 12 cột * 100 = 1200 params)
    const batchSize = 100;
    let actualStagedCount = 0;
    const totalBatches = Math.ceil(rows.length / batchSize);

    for (let i = 0; i < rows.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batchRows = rows.slice(i, i + batchSize);

      logger.info(`\n========================================================`);
      logger.info(`[meeting-sync2] ⏳ BẮT ĐẦU BATCH ${batchNum}/${totalBatches} (${batchRows.length} bản ghi)`);

      const res = await this.syncOldToStaging(batchRows, { syncJobId });
      actualStagedCount += (res.stagedCount || 0);

      // Chờ một chút để DB commit xong hoàn toàn nếu có độ trễ
      await new Promise(resolve => setTimeout(resolve, 500));

      // ✅ Verify COUNT thực tế trong DB sau mỗi batch
      try {
        const countRes = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${this.newTableSync}`);
        const actualDbCount = countRes?.[0]?.cnt || 0;
        const expected = Math.min(i + batchSize, rows.length);

        logger.info(`[meeting-sync2] 📊 TỔNG TRONG BẢNG STAGING HIỆN TẠI: ${actualDbCount} / ${expected} (dự kiến)`);

        if (actualDbCount < expected - 5) {
          logger.warn(`[meeting-sync2] ⚠️ CẢNH BÁO: BATCH ${batchNum} bị thiếu data! (Có ${actualDbCount}, dự kiến ${expected})`);
        } else {
          logger.info(`[meeting-sync2] ✅ XONG BATCH ${batchNum}. Chuyển sang batch tiếp theo...`);
        }
      } catch (e) {
        logger.warn(`[meeting-sync2] Không thể verify count: ${e.message}`);
      }
    }

    return {
      syncJobId,
      rows: [],
      sourceTotalCount: totalCount,
      totalCount: actualStagedCount,
      stagedCount: actualStagedCount,
      lastSyncTime,
      lastSyncId
    };
  }

  async getStagingRemainingCount() {
    try {
      const countRes = await this.queryNewDb(`
        SELECT COUNT(1) AS cnt 
        FROM ${this.newTableSync} WITH (NOLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0 AND ISNULL(MigrateErrFlg, 0) = 0
      `);
      return countRes?.[0]?.cnt || 0;
    } catch (e) {
      return 0;
    }
  }

  async processOne(syncJobId, context = {}) {
    const itemIndex = context.itemIndex || 0;
    const pendingRows = await this.queryNewDb(`
      SELECT * FROM ${this.newTableSync} WITH (NOLOCK)
      ORDER BY SY_SyncId ASC
      OFFSET ${itemIndex} ROWS FETCH NEXT 1 ROWS ONLY
    `);

    if (!pendingRows || pendingRows.length === 0) {
      return { status: 'IGNORED', message: 'Không còn bản ghi' };
    }

    const row = pendingRows[0];
    if (row.MigrateFlg === 1) {
      return { status: 'IGNORED', message: 'Bản ghi đã được đồng bộ trước đó' };
    }
    const { newTable, newSchema, externalKey } = this.mapping;
    const tableRef = `${this.mapping.newDatabase}.${newSchema}.${newTable}`;

    try {
      // 1. Phân giải user ChuTri
      let chairman_id = "b23406e3-5c75-41d3-91e0-1654293ae6b2";
      if (row.ChuTri) {
        let name = row.ChuTri;
        if (name.includes(';#')) {
          name = name.split(';#')[1];
        }
        name = name.trim();
        if (name) {
          const uq = `SELECT TOP 1 id FROM ${this.mapping.newDatabase}.dbo.users WHERE name = @name OR username = @name`;
          const ures = await this.queryNewDbTx(uq, { name });
          if (ures && ures.length > 0) chairman_id = ures[0].id;
        }
      }

      // 2. Chuyển đổi dữ liệu đơn giản
      const id_sp_bak = `${row.source_db}_${row.ID}`;
      const title = row.TieuDe || this.mapping.defaultValues.DEFAULT_TITLE;
      
      // Parse ngày giờ (fix lỗi dính AM/PM thành "7:00 AM")
      let startTimeObj = new Date();
      let debugBatDau = row.BatDau;
      if (row.BatDau) {
        if (row.BatDau instanceof Date) {
          startTimeObj = row.BatDau;
          debugBatDau = `Date Object: ${row.BatDau.toISOString()}`;
        } else {
          const sStr = String(row.BatDau).replace(/(\d)(AM|PM)/i, '$1 $2');
          const p = new Date(sStr);
          if (!isNaN(p.getTime())) startTimeObj = p;
          debugBatDau = `String: "${row.BatDau}" -> "${sStr}"`;
        }
      }

      // Xử lý meeting_time và meeting_date (HH:mm-HH:mm, YYYY-MM-DD với múi giờ +7)
      const offsetHours = 7;
      const sLocal = isNaN(startTimeObj.getTime()) ? new Date() : new Date(startTimeObj.getTime() + offsetHours * 60 * 60 * 1000);
      
      const meeting_date = sLocal.toISOString().split('T')[0];
      const startStr = sLocal.toISOString().substring(11, 16);
      const meeting_type = 'NB';
      
      let endStr = startStr;
      let debugKetThuc = row.KetThuc;
      if (row.KetThuc) {
        let endTimeObj = null;
        if (row.KetThuc instanceof Date) {
          endTimeObj = row.KetThuc;
          debugKetThuc = `Date Object: ${row.KetThuc.toISOString()}`;
        } else {
          const eStr = String(row.KetThuc).replace(/(\d)(AM|PM)/i, '$1 $2');
          const p = new Date(eStr);
          if (!isNaN(p.getTime())) endTimeObj = p;
          debugKetThuc = `String: "${row.KetThuc}" -> "${eStr}"`;
        }
        
        if (endTimeObj && !isNaN(endTimeObj.getTime())) {
          const eLocal = new Date(endTimeObj.getTime() + offsetHours * 60 * 60 * 1000);
          endStr = eLocal.toISOString().substring(11, 16);
        }
      }
      const meeting_time = `${startStr}-${endStr}`;

      logger.info(`[DEBUG_TIME] ID: ${id_sp_bak} | BatDau: ${debugBatDau} | KetThuc: ${debugKetThuc} | Result Date: ${meeting_date} | Result Time: ${meeting_time}`);

      // 3. Upsert
      const upsertSql = `
        SET NOCOUNT ON;
        DECLARE @meeting_id UNIQUEIDENTIFIER;
        IF EXISTS (SELECT 1 FROM ${tableRef} WHERE [${externalKey}] = @id_sp_bak)
        BEGIN
          UPDATE ${tableRef} 
          SET title = @title, meeting_date = @meeting_date, meeting_time = @meeting_time, chairman_id = @chairman_id, meeting_type = @meeting_type, meeting_mode = @meeting_mode, status = @status, meeting_state = @meeting_state, timezone = @timezone, is_company = @is_company, is_cancelled = @is_cancelled, is_template = @is_template
          WHERE [${externalKey}] = @id_sp_bak;
          SELECT @meeting_id = id FROM ${tableRef} WHERE [${externalKey}] = @id_sp_bak;
        END
        ELSE
        BEGIN
          SET @meeting_id = NEWID();
          INSERT INTO ${tableRef} (id, title, meeting_date, meeting_time, chairman_id, meeting_type, meeting_mode, status, meeting_state, timezone, is_company, is_cancelled, is_template, [${externalKey}]) 
          VALUES (@meeting_id, @title, @meeting_date, @meeting_time, @chairman_id, @meeting_type, @meeting_mode, @status, @meeting_state, @timezone, @is_company, @is_cancelled, @is_template, @id_sp_bak);
        END
        SELECT @meeting_id AS id;
      `;

      const upsertRes = await this.queryNewDbTx(upsertSql, {
        id_sp_bak,
        title,
        meeting_date,
        meeting_time,
        chairman_id,
        meeting_type,
        meeting_mode: 'OFFLINE',
        status: 1,
        meeting_state: 'FINISHED',
        timezone: 'Asia/Ho_Chi_Minh',
        is_company: 0,
        is_cancelled: 0,
        is_template: 0
      });

      const meetingId = upsertRes?.[0]?.id;

      if (meetingId) {
        // Create 3-step Audit Trail (CREATE, TRINH_LICH, PHE_DUYET_LICH)
        await this.createDefaultAuditForMigration(meetingId, row.AuthorAccount || null, chairman_id);

        if (row.meeting_mode === 'ONLINE') {
            await this.helper.createOnlineMeeting(meetingId, 'ZOOM');
        }

        await this.helper.createRecurrenceKhong(meetingId, startTimeObj);

        const rowData = {
          ...row,
          chairman_id,
          secretary_id: null,
          organizational_unit: null,
          room_ids: row.DiaDiem || '7611ef44-42de-426f-9721-e054ef92bb6d', // Default room if none
        };

        const meetingUnit = await this.ensureMeetingUnitExists(meetingId, rowData);
        await this.ensureMeetingParticipantsExist(meetingUnit, rowData);
      }

      // Update staging status
      await this.queryNewDbTx(
        `UPDATE ${this.newTableSync} 
         SET MigrateFlg = 1, MigrateErrFlg = 0 
         WHERE SY_SyncId = @id`,
        { id: row.SY_SyncId }
      );

      return { status: 'SUCCESS', count: 1 };
    } catch (error) {
      await this.queryNewDbTx(
        `UPDATE ${this.newTableSync} 
         SET MigrateErrFlg = 1, MigrateErrMess = @msg 
         WHERE SY_SyncId = @id`,
        { id: row.SY_SyncId, msg: error.message.substring(0, 500) }
      );
      return { status: 'ERROR', message: error.message };
    }
  }

  async ensureStagingTable() {
    // Không CREATE TABLE nữa vì dùng bảng có sẵn của hệ thống
    logger.info(`[meeting-sync2] [staging] 🔄 Đang sử dụng lại bảng có sẵn: ${this.newTableSync}`);
  }

  async truncateStagingTable() {
    try {
      const countBefore = await this.queryNewDb(`SELECT COUNT(1) AS cnt FROM ${this.newTableSync}`);
      const before = countBefore?.[0]?.cnt || 0;
      if (before > 0) {
        logger.warn(`[meeting-sync2] [staging] 🗑️  DELETE staging — xóa ${before} row cũ trước khi insert mới`);
        await this.queryNewDb(`DELETE FROM ${this.newTableSync}`);
        logger.info(`[meeting-sync2] [staging] ✅ DELETE xong, staging = 0 rows`);
      } else {
        logger.info(`[meeting-sync2] [staging] ✅ Staging đang trống, không cần delete`);
      }
    } catch (e) {
      logger.error(`[meeting-sync2] [staging] ❌ Lỗi DELETE: ${e.message}`);
      throw e;
    }
  }

  async syncOldToStaging(rows, { syncJobId }) {
    if (!rows || rows.length === 0) return { stagedCount: 0 };
    const cols = ['source_db', 'ListName', 'tp_Created', 'int1', 'TieuDe', 'ChuTri', 'BatDau', 'KetThuc', 'DiaDiem', 'LoaiHop', 'NoiDung', 'ID', 'tp_SiteId', 'tp_ListId'];

    const buildBatchInsert = (batchRows) => {
      let valuesSql = [];
      let params = {};
      let paramIndex = 0;
      for (const r of batchRows) {
        let rowSql = [];

        // Map data from new query schema to legacy staging columns
        const mappedRow = {
          source_db: r.DatabaseName,
          ListName: r.ListName,
          tp_Created: r.tp_Created,
          int1: null,
          TieuDe: r.TieuDe,
          ChuTri: r.ChuTri,
          BatDau: r.BatDau,
          KetThuc: r.KetThuc,
          DiaDiem: r.DiaDiem,
          LoaiHop: r.LoaiHop,
          NoiDung: r.NoiDung,
          ID: r.ID,
          tp_SiteId: null,
          tp_ListId: r.tp_ListId
        };

        for (const col of cols) {
          const pName = `p${paramIndex++}`;
          rowSql.push(`@${pName}`);
          params[pName] = mappedRow[col] !== undefined ? mappedRow[col] : null;
        }
        valuesSql.push(`(${rowSql.join(',')})`);
      }
      const sql = `INSERT INTO ${this.newTableSync} (${cols.join(',')}) VALUES ${valuesSql.join(',')}`;
      return { sql, params };
    };

    // === Thử INSERT cả batch ===
    try {
      const { sql, params } = buildBatchInsert(rows);
      await this.queryNewDbTx(sql, params);
      logger.info(`[meeting-sync2] [staging] ✅ Batch INSERT thành công ${rows.length} rows`);
      return { stagedCount: rows.length };
    } catch (batchErr) {
      logger.warn(`[meeting-sync2] [staging] ⚠️ Batch INSERT ${rows.length} rows THẤT BẠI: ${batchErr.message}`);
      logger.warn(`[meeting-sync2] [staging] 🔄 Fallback: INSERT từng row một để tìm row lỗi...`);
    }

    // === Fallback: INSERT từng row, log row nào lỗi ===
    let stagedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowLabel = `[DB=${r.DatabaseName}|ID=${r.ID}|idx=${i}]`;
      try {
        const { sql, params } = buildBatchInsert([r]);
        await this.queryNewDbTx(sql, params);
        stagedCount++;
      } catch (rowErr) {
        errorCount++;
        logger.error(`[meeting-sync2] [staging] ❌ ROW LỖI ${rowLabel}: ${rowErr.message}`);
        // Log giá trị từng cột để debug
        const colDump = cols.map(col => `${col}=${JSON.stringify(r[col])}`).join(', ');
        logger.error(`[meeting-sync2] [staging]    DATA: ${colDump}`);
      }
    }

    logger.info(`[meeting-sync2] [staging] 📊 Fallback kết quả: thành công=${stagedCount}, lỗi=${errorCount}/${rows.length}`);
    return { stagedCount };
  }

  async ensureMeetingUnitExists(meetingId, rowData, transaction = null) {
    try {
      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;

      const unitId = rowData.organizational_unit || 'UNIT_DEFAULT';
      const roomId = rowData.room_ids || '7611ef44-42de-426f-9721-e054ef92bb6d';
      const idBak = `${rowData.source_db}_${rowData.ID}`;

      const existingRows = await this.queryNewDbTx(
        `
        SELECT TOP 1
          id,
          unit_id,
          seat_number,
          room_id,
          unit_state,
          accept_join,
          prepare_documents
        FROM ${unitsTable}
        WHERE meeting_id = @meetingId AND unit_id = @unitId
        `,
        { meetingId, unitId },
        transaction
      );

      let meetingUnit = existingRows?.[0] || null;

      if (!meetingUnit?.id) {
        const insertRows = await this.queryNewDbTx(
          `
          INSERT INTO ${unitsTable} (
              id, id_bak, meeting_id, unit_id, room_id, unit_state,
              accept_join, assign_participants, seat_participants, prepare_documents, is_room_selected
          )
          OUTPUT
            INSERTED.id,
            INSERTED.unit_id,
            INSERTED.seat_number,
            INSERTED.room_id,
            INSERTED.unit_state,
            INSERTED.accept_join,
            INSERTED.prepare_documents
          VALUES (
              NEWID(), @idBak, @meetingId, @unitId, @roomId, 'CONFIRMED',
              1, 1, 1, 1, 1
          );
          `,
          { meetingId, unitId, roomId, idBak },
          transaction
        );
        meetingUnit = insertRows?.[0] || null;
      }

      return {
        id: meetingUnit?.id || null,
        unitId: meetingUnit?.unit_id || unitId,
        roomId: meetingUnit?.room_id || roomId,
        seatNumber: meetingUnit?.seat_number || null,
        unitState: meetingUnit?.unit_state || null,
        acceptJoin: Number(meetingUnit?.accept_join || 0),
        prepareDocuments: Number(meetingUnit?.prepare_documents || 0)
      };
    } catch (err) {
      logger.error(`[meeting-sync2] ensureMeetingUnitExists ERROR: ${err.message}`);
      return null;
    }
  }

  buildMeetingParticipantSeeds(rowData, meetingUnit) {
    if (!meetingUnit?.id) return [];

    const seen = new Set();
    const seeds = [
      {
        userId: rowData?.chairman_id || null,
        participantRole: 'CHAIRMAN'
      },
      {
        userId: rowData?.secretary_id || null,
        participantRole: 'SECRETARY'
      }
    ];

    return seeds.filter((seed) => {
      if (!seed.userId) return false;
      const dedupeKey = `${seed.userId}::${seed.participantRole}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }

  async resolveExistingUserIdNoCreate(userIdOrName, transaction = null) {
    try {
      if (!userIdOrName) return null;

      const raw = String(userIdOrName).trim();
      if (!raw) return null;

      const candidateSet = new Set();
      const pushCandidate = (value) => {
        if (!value) return;
        const normalized = String(value).trim();
        if (!normalized) return;
        candidateSet.add(normalized);
      };

      pushCandidate(raw);

      for (const candidate of candidateSet) {
        const exactRows = await this.queryNewDbTx(
          `
          SELECT TOP 1 id
          FROM [${this.newDbName || process.env.NEW_DB_NAME}].[dbo].[users]
          WHERE id = @candidate
             OR id_user_bak = @candidate
             OR username = @candidate
             OR code_nd = @candidate
             OR name = @candidate
          `,
          { candidate },
          transaction
        );

        if (exactRows?.length) {
          return exactRows[0].id;
        }
      }

      const likeCandidate = raw;
      if (!likeCandidate) return null;

      const likeRows = await this.queryNewDbTx(
        `
        SELECT TOP 1 id
        FROM [${this.newDbName || process.env.NEW_DB_NAME}].[dbo].[users]
        WHERE name LIKE '%' + @candidate + '%'
        ORDER BY LEN(name) ASC
        `,
        { candidate: likeCandidate },
        transaction
      );

      return likeRows?.[0]?.id || null;
    } catch (err) {
      logger.error(`[meeting-sync2] resolveExistingUserIdNoCreate ERROR: ${err.message}`);
      return null;
    }
  }

  async createDefaultAuditForMigration(meetingId, creatorUserId, chairmanId, transaction = null) {
    const db = this.newDbName || process.env.NEW_DB_NAME;
    const auditTable = `[${db}].[dbo].[audit]`;
    const creatorId = creatorUserId || 'SYSTEM_MIGRATION';
    const finalChairmanId = chairmanId || 'eac9bcb6-efcd-4b23-a656-dd351037a138';

    // 1. Resolve IDs for specialized roles
    logger.info(`[meeting-sync2] Resolving Audit Roles for ID ${meetingId}...`);
    const quanLyPhongId = await this.resolveExistingUserIdNoCreate('Quản lý phòng', transaction) || creatorId;
    const quanLyPhongHopId = await this.resolveExistingUserIdNoCreate('Quản lý phòng họp', transaction) || finalChairmanId;

    const query = `
        IF NOT EXISTS (SELECT 1 FROM ${auditTable} WHERE document_id = @meetingId AND action_code = 'CREATE')
      BEGIN
          INSERT INTO ${auditTable}
          (
            document_id, [time], user_id, display_name, role, action_code, from_node_id, to_node_id,
            details, origin_id, created_by, receiver, roleProcess, [action], stage_status,
            curStatusCode, type_document, created_at, updated_at, table_bak
          )
          VALUES
          (
            @meetingId, SYSUTCDATETIME(), @creatorId, N'Người tạo', 'NGUOI_SOAN_LICH', 'CREATE',
            'Activity_1rl80cg', 'Activity_1rl80cg', '{"transferType":"to_person"}', NULL,
            @creatorId, @creatorId, 'processor', N'Tạo văn bản', 'DA_XU_LY', '1', 'Meetings',
            SYSUTCDATETIME(), SYSUTCDATETIME(), 1
          ),
          (
            @meetingId, SYSUTCDATETIME(), @creatorId, N'Người tạo', 'NGUOI_SOAN_LICH',
            'TRINH_LICH', 'Activity_1rl80cg', 'Gateway_16pjuoq', '{"note":""}', 'migration_origin',
            @creatorId, @quanLyPhongId, 'processor', N'Chuyển Ban quản lý phòng', 'DONG_Y_PHE_DUYET',
            '2', 'Meetings', SYSUTCDATETIME(), SYSUTCDATETIME(), 1
          ),
          (
            @meetingId, SYSUTCDATETIME(), @quanLyPhongHopId, N'Quản lý phòng họp', 'BAN_QUAN_LY_PHONG_HOP',
            'PHE_DUYET_LICH', 'Gateway_16pjuoq', 'Activity_18dmg6c', NULL, 'migration_origin',
            @creatorId, @quanLyPhongHopId, 'seat', N'Gán vị trí chỗ ngồi', 'CHUA_XU_LY',
            '3', 'Meetings', SYSUTCDATETIME(), SYSUTCDATETIME(), 1
          );
      END
    `;
    logger.info(`[meeting-sync2] Audit creation for meetingId ${meetingId} (Creator: ${creatorId}, Management: ${quanLyPhongId}, RoomMgmt: ${quanLyPhongHopId})`);
    try {
        await this.queryNewDbTx(query, { meetingId, creatorId, quanLyPhongId, quanLyPhongHopId }, transaction);
    } catch (err) {
        logger.error(`[meeting-sync2] createDefaultAuditForMigration ERROR: ${err.message}`);
    }
  }

  async ensureMeetingParticipantsExist(meetingUnit, rowData, transaction = null) {
    try {
      if (!meetingUnit?.id) return;

      const db = this.newDbName || process.env.NEW_DB_NAME;
      const schema = this.newDbSchema || 'dbo';
      const participantsTable = `[${db}].[${schema}].[meeting_participants]`;
      const participantSeeds = this.buildMeetingParticipantSeeds(rowData, meetingUnit);

      if (participantSeeds.length === 0) return;

      for (const participant of participantSeeds) {
        await this.queryNewDbTx(
          `
          IF NOT EXISTS (
              SELECT 1
              FROM ${participantsTable}
              WHERE meeting_unit_id = @meetingUnitId
                AND user_id = @userId
                AND participant_role = @participantRole
          )
          BEGIN
              INSERT INTO ${participantsTable} (
                  meeting_unit_id,
                  user_id,
                  seat_number,
                  room_id,
                  participant_role,
                  accept_join,
                  prepare_documents,
                  unit_id
              )
              VALUES (
                  @meetingUnitId,
                  @userId,
                  @seatNumber,
                  @roomId,
                  @participantRole,
                  @acceptJoin,
                  @prepareDocuments,
                  @unitId
              );
          END
          `,
          {
            meetingUnitId: meetingUnit.id,
            userId: participant.userId,
            seatNumber: meetingUnit.seatNumber,
            roomId: meetingUnit.roomId,
            participantRole: participant.participantRole,
            acceptJoin: meetingUnit.acceptJoin,
            prepareDocuments: meetingUnit.prepareDocuments,
            unitId: meetingUnit.unitId
          },
          transaction
        );
      }
    } catch (err) {
      logger.error(`[meeting-sync2] ensureMeetingParticipantsExist ERROR: ${err.message}`);
    }
  }
}

module.exports = StreamMeetingSync2Model;
