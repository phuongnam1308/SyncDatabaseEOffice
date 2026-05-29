const { v4: uuidv4 } = require('uuid');
const MigrationHelper = require('../../helpers/MigrationHelper');
const BaseIncrementalSyncInterface = require('../../sync-manager/BaseIncrementalSyncInterface');
const { tableMappings } = require('./config');
const mapping = require('./mapping.json');
const requiredRoles = require('./required_process_roles.json');


const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamMeetingMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_MEETING_COPY_MIGRATION' });

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

    // Multi-site support
    this.listIdCache = {};
    this.canonicalListTitle = null;
    this.databases = [
      'WSS_Content_eoffice', 'WSS_Content_eoffice_atpc', 'WSS_Content_eoffice_cll', 'WSS_Content_eoffice_cntt',
      'WSS_Content_eoffice_ct', 'WSS_Content_eoffice_cvtc', 'WSS_Content_eoffice_donvi', 'WSS_Content_eoffice_dvhh',
      'WSS_Content_eoffice_dvkt', 'WSS_Content_eoffice_gnvt', 'WSS_Content_eoffice_hc', 'WSS_Content_eoffice_hdsd',
      'WSS_Content_eoffice_ht', 'WSS_Content_eoffice_icdlb', 'WSS_Content_eoffice_icdst', 'WSS_Content_eoffice_ios',
      'WSS_Content_eoffice_khdt', 'WSS_Content_eoffice_khkd', 'WSS_Content_eoffice_ktvt', 'WSS_Content_eoffice_kvtc',
      'WSS_Content_eoffice_mkt', 'WSS_Content_eoffice_npl', 'WSS_Content_eoffice_qlct', 'WSS_Content_eoffice_qsbv',
      'WSS_Content_eoffice_record', 'WSS_Content_eoffice_record2018', 'WSS_Content_eoffice_snpl', 'WSS_Content_eoffice_tc',
      'WSS_Content_eoffice_tc189', 'WSS_Content_eoffice_tcct', 'WSS_Content_eoffice_tchp', 'WSS_Content_eoffice_tcidi',
      'WSS_Content_eoffice_tcld', 'WSS_Content_eoffice_tcmt', 'WSS_Content_eoffice_tco', 'WSS_Content_eoffice_tcot',
      'WSS_Content_eoffice_tcpc', 'WSS_Content_eoffice_tcph', 'WSS_Content_eoffice_tctt', 'WSS_Content_eoffice_testuser2',
      'WSS_Content_eoffice_thuvientct', 'WSS_Content_eoffice_ttddc', 'WSS_Content_eoffice_vp', 'WSS_Content_eoffice_vpmb',
      'WSS_Content_eoffice_vptnb', 'WSS_Content_eoffice_vtb', 'WSS_Content_eoffice_vtt', 'WSS_Content_eoffice_xdct',
      'WSS_Content_eoffice_xncg', 'WSS_Content_eoffice_yte'
    ];
  }

  /**
   * Override initialize: kết nối DB xong tự động tạo bảng staging nếu chưa có.
   */
  async initialize() {
    try {
      console.log(`[StreamMeetingMigrationModel] Initializing...`);
      await super.initialize();
      // await this.ensureStagingTableExists();
      // await this.ensureMeetingsColumnsExist();
      // await this.ensureMeetingParticipantsTableExists();
      // await this.ensureDefaultRoomExists();
      // await this.ensureAuditTableExists();
      console.log(`[StreamMeetingMigrationModel] Initialization complete.`);
    } catch (error) {
      console.error(`[StreamMeetingMigrationModel] ❌ Initialization failed: ${error.message}`);
      // Do not re-throw to allow model registration on dashboard
    }
  }


  async ensureMeetingsColumnsExist() {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const meetingsTable = `[${db}].[${schema}].[meetings]`;
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;
      const roomsTable = `[${db}].[${schema}].[meeting_rooms]`;

      console.log(`[StreamMeetingMigrationModel] Ensuring tables and columns exist...`);

      // Check if table exists first
      const tableCheck = await this.queryNewDb(`SELECT 1 FROM ${db}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = 'meetings'`);
      if (!tableCheck || tableCheck.length === 0) {
        console.warn(`[StreamMeetingMigrationModel] Target table meetings not found. Skipping column ensure.`);
        return;
      }

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

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'duration_seconds')
          ALTER TABLE ${meetingsTable} ADD [duration_seconds] INT NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'assigned_seat_by')
          ALTER TABLE ${meetingsTable} ADD [assigned_seat_by] NVARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'recurrence_id')
          ALTER TABLE ${meetingsTable} ADD [recurrence_id] UNIQUEIDENTIFIER NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'chairman_type')
          ALTER TABLE ${meetingsTable} ADD [chairman_type] VARCHAR(10) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'secretary_type')
          ALTER TABLE ${meetingsTable} ADD [secretary_type] VARCHAR(10) NULL;

      IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meetings' AND COLUMN_NAME = 'google_calendar_processed_by_cron')
          ALTER TABLE ${meetingsTable} ADD [google_calendar_processed_by_cron] BIT NULL;

      IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'IX_meetings_id_sp_bak')
          CREATE INDEX IX_meetings_id_sp_bak ON ${meetingsTable}(id_sp_bak);

      IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'IX_meetings_meeting_date')
          CREATE INDEX IX_meetings_meeting_date ON ${meetingsTable}(meeting_date);
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

          IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'IX_meeting_units_id_bak')
              CREATE INDEX IX_meeting_units_id_bak ON ${unitsTable}(id_bak);
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
              id_sp_bak nvarchar(255) NULL,
              layout_col_wing int NULL,
              layout_row_bottom int NULL,
              tb_bak int NULL
          );
      END
      ELSE
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_rooms' AND COLUMN_NAME = 'layout_col_wing')
              ALTER TABLE ${roomsTable} ADD layout_col_wing int NULL;
          IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_rooms' AND COLUMN_NAME = 'layout_row_bottom')
              ALTER TABLE ${roomsTable} ADD layout_row_bottom int NULL;
          IF NOT EXISTS (SELECT 1 FROM ${db}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_rooms' AND COLUMN_NAME = 'tb_bak')
              ALTER TABLE ${roomsTable} ADD tb_bak int NULL;
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

  async ensureMeetingParticipantsTableExists() {
    try {
      const db = this.newDbName || 'app_tancang';
      const schema = this.newDbSchema || 'dbo';
      const participantsTable = `[${db}].[${schema}].[meeting_participants]`;
      const unitsTable = `[${db}].[${schema}].[meeting_units]`;

      console.log(`[StreamMeetingMigrationModel] Checking/Creating meeting_participants table...`);

      const createQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = 'meeting_participants')
      BEGIN
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
      END
      ELSE
      BEGIN
          -- Bổ sung các cột thiếu nếu bảng đã tồn tại
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_email')
              ALTER TABLE ${participantsTable} ADD google_email nvarchar(255) NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_event_id')
              ALTER TABLE ${participantsTable} ADD google_calendar_event_id nvarchar(255) NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_sync_status')
              ALTER TABLE ${participantsTable} ADD google_calendar_sync_status nvarchar(50) NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_sync_error')
              ALTER TABLE ${participantsTable} ADD google_calendar_sync_error nvarchar(MAX) NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_sync_at')
              ALTER TABLE ${participantsTable} ADD google_calendar_sync_at datetime2 NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_synced')
              ALTER TABLE ${participantsTable} ADD google_calendar_synced bit NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_calendar_hidden')
              ALTER TABLE ${participantsTable} ADD google_calendar_hidden bit NULL;
          IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'meeting_participants' AND COLUMN_NAME = 'google_event_id')
              ALTER TABLE ${participantsTable} ADD google_event_id nvarchar(255) NULL;
      END
      `;
      await this.queryNewDb(createQuery);

      const addForeignKeyQuery = `
      IF NOT EXISTS (
          SELECT 1
          FROM [${db}].sys.foreign_keys
          WHERE name = 'fk_participant_unit'
            AND parent_object_id = OBJECT_ID('[${db}].[${schema}].[meeting_participants]')
      )
      BEGIN
          ALTER TABLE ${participantsTable}
          WITH CHECK ADD CONSTRAINT fk_participant_unit
          FOREIGN KEY (meeting_unit_id) REFERENCES ${unitsTable}(id) ON DELETE CASCADE;
      END
      `;
      await this.queryNewDb(addForeignKeyQuery);

      const unitIndexQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'idx_participant_unit' AND object_id = OBJECT_ID('[${db}].[${schema}].[meeting_participants]'))
      BEGIN
          CREATE NONCLUSTERED INDEX idx_participant_unit ON ${participantsTable}(meeting_unit_id);
      END
      `;
      await this.queryNewDb(unitIndexQuery);

      const unitIdIndexQuery = `
      IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'idx_participant_unit_id' AND object_id = OBJECT_ID('[${db}].[${schema}].[meeting_participants]'))
      BEGIN
          CREATE NONCLUSTERED INDEX idx_participant_unit_id ON ${participantsTable}(unit_id);
      END

      IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes WHERE name = 'IX_meeting_participants_user_id')
      BEGIN
          CREATE NONCLUSTERED INDEX IX_meeting_participants_user_id ON ${participantsTable}(user_id);
      END
      `;
      await this.queryNewDb(unitIdIndexQuery);

      console.log(`[StreamMeetingMigrationModel] [ensureMeetingParticipantsTableExists] OK`);
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] [ensureMeetingParticipantsTableExists] ERROR: ${err.message}`);
      throw err;
    }
  }

  getStagingColumnDefinitions() {
    return [
      { name: 'ID', type: 'BIGINT' },
      { name: 'stg_job_id', type: 'NVARCHAR(255)' },
      { name: 'ListName', type: 'NVARCHAR(500)' },
      { name: 'tp_Created', type: 'DATETIME2' },
      { name: 'tp_Modified', type: 'DATETIME2' },
      { name: 'AuthorName', type: 'NVARCHAR(500)' },
      { name: 'AuthorFullName', type: 'NVARCHAR(500)' },
      { name: 'AuthorAccount', type: 'NVARCHAR(500)' },
      { name: 'AuthorEmail', type: 'NVARCHAR(500)' },
      { name: 'EditorName', type: 'NVARCHAR(500)' },
      { name: 'EditorAccount', type: 'NVARCHAR(500)' },
      { name: 'Title', type: 'NVARCHAR(MAX)' },
      { name: 'TieuDe', type: 'NVARCHAR(MAX)' },
      { name: 'StartDate', type: 'DATETIME2' },
      { name: 'BatDau', type: 'DATETIME2' },
      { name: 'EndDate', type: 'DATETIME2' },
      { name: 'KetThuc', type: 'DATETIME2' },
      { name: 'Location', type: 'NVARCHAR(MAX)' },
      { name: 'DiaDiem', type: 'NVARCHAR(MAX)' },
      { name: 'Description', type: 'NVARCHAR(MAX)' },
      { name: 'NoiDung', type: 'NVARCHAR(MAX)' },
      { name: 'LoaiHop', type: 'NVARCHAR(MAX)' },
      { name: 'ChuTri', type: 'NVARCHAR(MAX)' },
      { name: 'ThuKy', type: 'NVARCHAR(MAX)' },
      { name: 'CreatedDate', type: 'DATETIME2' },
      { name: 'ModifiedDate', type: 'DATETIME2' },
      { name: 'nvarchar4', type: 'NVARCHAR(MAX)' },
      { name: 'priority', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar6', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar7', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar8', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar9', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar10', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar11', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar12', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar13', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar14', type: 'NVARCHAR(MAX)' },
      { name: 'nvarchar15', type: 'NVARCHAR(MAX)' },
      { name: 'datetime1', type: 'DATETIME2' },
      { name: 'datetime2', type: 'DATETIME2' },
      { name: 'datetime3', type: 'DATETIME2' },
      { name: 'datetime4', type: 'DATETIME2' },
      { name: 'datetime5', type: 'DATETIME2' },
      { name: 'int1', type: 'INT' },
      { name: 'int2', type: 'INT' },
      { name: 'int3', type: 'INT' },
      { name: 'int4', type: 'INT' },
      { name: 'bit1', type: 'BIT' },
      { name: 'bit2', type: 'BIT' },
      { name: 'tp_Author', type: 'INT' },
      { name: 'tp_Editor', type: 'INT' },
      { name: 'tp_Version', type: 'INT' },
      { name: 'tp_IsCurrent', type: 'BIT' },
      { name: 'tp_ListId', type: 'NVARCHAR(255)' },
      { name: 'float1', type: 'FLOAT' },
      { name: 'float2', type: 'FLOAT' },
      { name: 'DocumentTitle', type: 'NVARCHAR(MAX)' },
      { name: 'ThoiLuongGiay', type: 'INT' },
      { name: 'DocumentID', type: 'NVARCHAR(255)' },
      { name: 'DocumentStatus', type: 'NVARCHAR(100)' },
      { name: 'DocumentStatusText', type: 'NVARCHAR(MAX)' },
      { name: 'LinkedItemID', type: 'NVARCHAR(255)' },
      { name: 'DocumentCreatedDate', type: 'DATETIME2' },
      { name: 'Organizer', type: 'NVARCHAR(500)' }
    ];
  }

  getStagingDataColumns() {
    return this.getStagingColumnDefinitions()
      .map((column) => column.name)
      .filter((column) => column !== 'stg_job_id');
  }


  /**
   * Tự động tạo bảng staging `meeting_sync_staging` trong DB mới nếu chưa tồn tại.
   */
    async ensureStagingTableExists() {
      try {
        const stagingTableRef = this.getStagingTableRef();
        console.log(`[StreamMeetingMigrationModel] Checking/Creating staging table: ${stagingTableRef}`);
        const db = this.newDbName || 'app_tancang';
        const schema = this.newDbSchema || 'dbo';
        const table = this.newTableSync;

        const createQuery = `
        IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}')
        BEGIN
            CREATE TABLE ${stagingTableRef} (
                [SY_SyncId] INT IDENTITY(1,1) PRIMARY KEY,
                [__sync_time] DATETIME2 NULL,
                [__sync_id_num] BIGINT NULL
            );
        END
        `;
        await this.queryNewDb(createQuery);

        const columnsToAdd = this.getStagingColumnDefinitions();
        // Thêm cột source_db cho đa site
        if (!columnsToAdd.some(c => c.name === 'source_db')) {
          columnsToAdd.push({ name: 'source_db', type: 'NVARCHAR(255)' });
        }

        for (const col of columnsToAdd) {
            const alterQuery = `
            IF NOT EXISTS (
                SELECT 1
                FROM [${db}].INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${col.name}'
            )
            BEGIN
                ALTER TABLE ${stagingTableRef} ADD [${col.name}] ${col.type} NULL;
            END
            `;
            await this.queryNewDb(alterQuery);
        }

        // Flags chuẩn cho sync-manager
        const flags = [
          { name: 'MigrateFlg', type: 'INT' },
          { name: 'MigrateErrFlg', type: 'INT' },
          { name: 'MigrateErrMess', type: 'NVARCHAR(MAX)' }
        ];
        for (const flag of flags) {
          await this.queryNewDb(`IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}' AND COLUMN_NAME = '${flag.name}') ALTER TABLE ${stagingTableRef} ADD [${flag.name}] ${flag.type} NULL;`);
        }

        const dropLegacyIndexQuery = `
        IF EXISTS (SELECT 1 FROM [${db}].sys.indexes i JOIN [${db}].sys.tables t ON i.object_id = t.object_id JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id WHERE i.name = 'IX_${table}_ID' AND t.name = '${table}' AND s.name = '${schema}')
            DROP INDEX IX_${table}_ID ON ${stagingTableRef};
        IF EXISTS (SELECT 1 FROM [${db}].sys.indexes i JOIN [${db}].sys.tables t ON i.object_id = t.object_id JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id WHERE i.name = 'IX_${table}_job_ID' AND t.name = '${table}' AND s.name = '${schema}')
            DROP INDEX IX_${table}_job_ID ON ${stagingTableRef};
        IF EXISTS (SELECT 1 FROM [${db}].sys.indexes i JOIN [${db}].sys.tables t ON i.object_id = t.object_id JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id WHERE i.name = 'IX_${table}_job_list_ID' AND t.name = '${table}' AND s.name = '${schema}')
            DROP INDEX IX_${table}_job_list_ID ON ${stagingTableRef};
        `;
        await this.queryNewDb(dropLegacyIndexQuery);

        const indexQuery = `
        IF NOT EXISTS (SELECT 1 FROM [${db}].sys.indexes i JOIN [${db}].sys.tables t ON i.object_id = t.object_id JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id WHERE i.name = 'IX_${table}_job_list_ID_source' AND t.name = '${table}' AND s.name = '${schema}')
        BEGIN
            CREATE UNIQUE INDEX IX_${table}_job_list_ID_source ON ${stagingTableRef}(stg_job_id, source_db, tp_ListId, ID);
        END
        `;
        await this.queryNewDb(indexQuery);

        const dropOldCursorIndexQuery = `
        IF EXISTS (
            SELECT 1 FROM [${db}].sys.indexes i
            JOIN [${db}].sys.tables t ON i.object_id = t.object_id
            JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.name = 'IX_${table}_job_cursor'
              AND t.name = '${table}'
              AND s.name = '${schema}'
        )
        BEGIN
            -- Sử dụng cú pháp an toàn hơn cho DROP INDEX
            DECLARE @dropSql NVARCHAR(MAX) = 'DROP INDEX [IX_${table}_job_cursor] ON ' + '${stagingTableRef}';
            EXEC sp_executesql @dropSql;
        END
        `;
        await this.queryNewDb(dropOldCursorIndexQuery);

        const syncCursorIndexQuery = `
        IF NOT EXISTS (
            SELECT 1 FROM [${db}].sys.indexes i
            JOIN [${db}].sys.tables t ON i.object_id = t.object_id
            JOIN [${db}].sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.name = 'IX_${table}_job_cursor'
              AND t.name = '${table}'
              AND s.name = '${schema}'
        )
        BEGIN
            CREATE INDEX IX_${table}_job_cursor ON ${stagingTableRef}(stg_job_id, __sync_time, __sync_id_num, tp_ListId, SY_SyncId);
        END
        `;
        await this.queryNewDb(syncCursorIndexQuery);

        console.log(`[StreamMeetingMigrationModel] [ensureStagingTableExists] OK: ${stagingTableRef} is ready`);

      } catch (err) {
        console.error(`[StreamMeetingMigrationModel] [ensureStagingTableExists] ERROR: ${err.message}`);
        throw err;
      }
    }

  async ensureAuditTableExists() {
    const db = this.newDbName || 'app_tancang';
    const schema = 'dbo';
    const table = 'audit';
    const tableRef = `[${db}].[${schema}].[${table}]`;

    console.log(`[StreamMeetingMigrationModel] Checking/Creating Audit table: ${table}`);
    const createAuditTable = `
    IF NOT EXISTS (SELECT 1 FROM [${db}].INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${schema}')
    BEGIN
        CREATE TABLE ${tableRef} (id bigint IDENTITY(1,1) PRIMARY KEY);
    END
    `;
    await this.queryNewDb(createAuditTable);

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
      await this.queryNewDb(query);
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

  buildSourceRecordKey(row = {}) {
    const itemId = row?.ID != null ? String(row.ID) : '';
    const listId = row?.tp_ListId ? String(row.tp_ListId).trim().toUpperCase() : '';
    return listId ? `${listId}:${itemId}` : itemId;
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

  /**
   * Tự động tìm kiếm List IDs của Đăng ký họp trong một Content DB nhất định.
   */
  async resolveListIdsForDb(dbName) {
    if (this.listIdCache[dbName]) return this.listIdCache[dbName];

    const referenceIds = this.oldConfig.listIds || [];

    // 1. Tìm Title mẫu từ DB tham chiếu
    if (!this.canonicalListTitle) {
      const refDb = this.oldDbName;
      const refId = referenceIds[0];
      const titleQuery = `SELECT TOP 1 tp_Title FROM [${refDb}].[dbo].[AllLists] WHERE tp_ID = @refId`;
      try {
        const rows = await this.queryOldDb(titleQuery, { refId });
        if (rows?.length) {
          this.canonicalListTitle = rows[0].tp_Title;
          console.log(`[StreamMeetingMigrationModel] Canonical List Title discovered: "${this.canonicalListTitle}"`);
        }
      } catch (err) {
        console.error(`[StreamMeetingMigrationModel] Failed to discover canonical title: ${err.message}`);
      }
    }

    // 2. Exact Match theo Title
    let discoveredIds = [];
    if (this.canonicalListTitle) {
      const query = `SELECT tp_ID FROM [${dbName}].[dbo].[AllLists] WHERE tp_Title = @title AND tp_DeleteTransactionId = 0x0`;
      try {
        const rows = await this.queryOldDb(query, { title: this.canonicalListTitle });
        discoveredIds = rows.map(r => String(r.tp_ID).toUpperCase());
      } catch (e) {}
    }

    // 3. Keyword Match (H hardened)
    if (discoveredIds.length === 0) {
      const keywords = ['Lịch họp', 'Đăng ký họp', 'Lịchhọp', 'Lịch công tác'];
      const patterns = keywords.map(k => `tp_Title LIKE N'%${k}%'`).join(' OR ');
      const query = `
          SELECT tp_ID, tp_Title
          FROM [${dbName}].[dbo].[AllLists]
          WHERE (${patterns})
          AND tp_DeleteTransactionId = 0x0
          AND tp_Title NOT LIKE N'%Đính kèm%'
          AND tp_Title NOT LIKE N'%Văn bản%'
          AND tp_Title NOT LIKE N'%Tài liệu%'
      `;
      try {
        const rows = await this.queryOldDb(query);
        if (rows?.length) {
          discoveredIds = rows.map(r => String(r.tp_ID).toUpperCase());
          console.log(`[StreamMeetingMigrationModel] [${dbName}] Found potential lists: ${rows.map(r => r.tp_Title).join(', ')}`);
        }
      } catch (e) {}
    }

    if (dbName === this.oldDbName && referenceIds.length > 0) {
      discoveredIds = [...discoveredIds, ...referenceIds];
    }

    // ĐẢM BẢO BAO GỒM CÁC DANH SÁCH BỊ LỌT DO KHÔNG KHỚP TÊN (VD: Lịch đặc thù)
    if (dbName === 'WSS_Content_eoffice_khkd' || dbName === this.oldDbName) {
      discoveredIds.push('B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C');
      discoveredIds.push('360585BB-EDDA-4990-B293-AA097594B073');
    }

    if (discoveredIds.length > 0) {
      discoveredIds = [...new Set(discoveredIds.map(id => String(id).toUpperCase()))];
      this.listIdCache[dbName] = discoveredIds;
      return discoveredIds;
    }

    console.error(`[StreamMeetingMigrationModel] !!! KHÔNG TÌM THẤY DANH SÁCH HỌP TẠI DB: ${dbName} !!!`);
    return [];
  }

  async getCount(lastSyncTime, lastSyncId = 0) {
    console.log(`[StreamMeetingMigrationModel] [getCount] Đếm tổng bản ghi trên 51 databases bằng UNION ALL...`);
    const sql = `
      DECLARE @dbs TABLE (DbName NVARCHAR(128));
      INSERT INTO @dbs (DbName) VALUES
      ('WSS_Content_eoffice'),('WSS_Content_eoffice_atpc'),('WSS_Content_eoffice_cll'),
      ('WSS_Content_eoffice_cntt'),('WSS_Content_eoffice_ct'),('WSS_Content_eoffice_cvtc'),
      ('WSS_Content_eoffice_donvi'),('WSS_Content_eoffice_dvhh'),('WSS_Content_eoffice_dvkt'),
      ('WSS_Content_eoffice_gnvt'),('WSS_Content_eoffice_hc'),('WSS_Content_eoffice_hdsd'),
      ('WSS_Content_eoffice_ht'),('WSS_Content_eoffice_icdlb'),('WSS_Content_eoffice_icdst'),
      ('WSS_Content_eoffice_ios'),('WSS_Content_eoffice_khdt'),('WSS_Content_eoffice_khkd'),
      ('WSS_Content_eoffice_ktvt'),('WSS_Content_eoffice_kvtc'),('WSS_Content_eoffice_mkt'),
      ('WSS_Content_eoffice_npl'),('WSS_Content_eoffice_qlct'),('WSS_Content_eoffice_qsbv'),
      ('WSS_Content_eoffice_record'),('WSS_Content_eoffice_record2018'),('WSS_Content_eoffice_snpl'),
      ('WSS_Content_eoffice_tc'),('WSS_Content_eoffice_tc189'),('WSS_Content_eoffice_tcct'),
      ('WSS_Content_eoffice_tchp'),('WSS_Content_eoffice_tcidi'),('WSS_Content_eoffice_tcld'),
      ('WSS_Content_eoffice_tcmt'),('WSS_Content_eoffice_tco'),('WSS_Content_eoffice_tcot'),
      ('WSS_Content_eoffice_tcpc'),('WSS_Content_eoffice_tcph'),('WSS_Content_eoffice_tctt'),
      ('WSS_Content_eoffice_testuser2'),('WSS_Content_eoffice_thuvientct'),
      ('WSS_Content_eoffice_ttddc'),('WSS_Content_eoffice_vp'),('WSS_Content_eoffice_vpmb'),
      ('WSS_Content_eoffice_vptnb'),('WSS_Content_eoffice_vtb'),('WSS_Content_eoffice_vtt'),
      ('WSS_Content_eoffice_xdct'),('WSS_Content_eoffice_xncg'),('WSS_Content_eoffice_yte');

      DECLARE @sql NVARCHAR(MAX) = N'';

      SELECT @sql = @sql + N'
      SELECT
         ud.[tp_ID] AS __sync_id_num
      FROM [' + DbName + N'].[dbo].[AllUserData] ud
      INNER JOIN [' + DbName + N'].[dbo].[AllLists] l
         ON ud.[tp_ListId] = l.[tp_ID]
      LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_author
         ON ud.[tp_Author] = ui_author.[tp_ID]
      LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_editor
         ON ud.[tp_Editor] = ui_editor.[tp_ID]
      WHERE ud.[tp_ListId] IN (
         ''B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'',
         ''360585BB-EDDA-4990-B293-AA097594B073''
      )
      AND ud.tp_RowOrdinal = 0
      UNION ALL
      '
      FROM @dbs;

      -- Cắt bỏ UNION ALL cuối cùng
      IF LEN(@sql) > 0
         SET @sql = LEFT(@sql, LEN(@sql) - LEN('UNION ALL' + CHAR(13) + CHAR(10)));

      -- Chỉ lấy tổng cộng
      SET @sql = N'
      SELECT COUNT(*) AS TongSoBanGhi
      FROM (
      ' + @sql + N'
      ) AS T;
      ';

      EXEC sp_executesql @sql;
    `;

    try {
      const rows = await this.queryOldDb(sql);
      const total = Number(rows?.[0]?.TongSoBanGhi || 0);
      console.log(`[StreamMeetingMigrationModel] [getCount] ✅ Tổng cộng: ${total} bản ghi trên 51 DB`);
      return total;
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] [getCount] ❌ LỖI: ${err.message}`);
      return 0;
    }
  }

  async syncOldToStaging(rows, { transaction, syncJobId, dbName } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return { stagedCount: 0 };
    if (!syncJobId) throw new Error('syncJobId is required for staging');
    console.log(`[StreamMeetingMigrationModel] Staging ${rows.length} rows to ${this.newTableSync}...`);
    const columns = this.getStagingDataColumns();
    const stagingTableRef = this.getStagingTableRef();

    let actualStagedCount = 0;

    for (const row of rows) {
      const targetDb = row.DatabaseName || dbName || this.oldDbName;
      const params = {};
      for (const column of columns) {
        params[column] = row[column] !== undefined ? row[column] : null;
      }
      params.stg_job_id = syncJobId;
      params.source_db = targetDb;
      params.__sync_time = row.__sync_time;
      params.__sync_id_num = row.__sync_id_num;
      params.MigrateFlg = 0;
      params.MigrateErrFlg = 0;

      // KIỂM TRA TRÙNG LẶP TRONG BẢNG TRUNG GIAN
      const checkQuery = `
          SELECT TOP 1 __sync_time 
          FROM ${stagingTableRef} 
          WHERE [source_db] = @source_db AND [tp_ListId] = @tp_ListId AND [ID] = @ID
      `;
      const existing = await this.queryNewDbTx(checkQuery, params, transaction);

      if (existing?.length > 0) {
          if (existing[0].__sync_time && params.__sync_time) {
              const oldTime = new Date(existing[0].__sync_time).getTime();
              const newTime = new Date(params.__sync_time).getTime();
              if (newTime <= oldTime) {
                  // BẢN GHI ĐÃ TỒN TẠI VÀ KHÔNG CÓ UPDATE -> CẬP NHẬT LẠI stg_job_id ĐỂ JOB NÀY VẪN XỬ LÝ (RESYNC)
                  const updateJobIdQuery = `
                      UPDATE ${stagingTableRef} 
                      SET [stg_job_id] = @stg_job_id 
                      WHERE [source_db] = @source_db AND [tp_ListId] = @tp_ListId AND [ID] = @ID
                  `;
                  await this.queryNewDbTx(updateJobIdQuery, params, transaction);
                  continue;
              }
          }

          // BẢN GHI CÓ UPDATE MỚI -> CẬP NHẬT VÀ GẮN JOB ID HIỆN TẠI ĐỂ XỬ LÝ
          const updateSet = columns.filter(c => c !== 'ID' && c !== 'tp_ListId' && c !== 'source_db').map(c => `[${c}] = @${c}`).join(', ');
          const updateQuery = `
              UPDATE ${stagingTableRef}
              SET ${updateSet}, [stg_job_id] = @stg_job_id, __sync_time = @__sync_time, __sync_id_num = @__sync_id_num, MigrateFlg = @MigrateFlg, MigrateErrFlg = @MigrateErrFlg, MigrateErrMess = NULL
              WHERE [source_db] = @source_db AND [tp_ListId] = @tp_ListId AND [ID] = @ID
          `;
          await this.queryNewDbTx(updateQuery, params, transaction);
      } else {
          // BẢN GHI CHƯA CÓ TRONG STAGING -> THÊM MỚI
          const insertQuery = `
              INSERT INTO ${stagingTableRef} ([stg_job_id], [source_db], ${columns.map(c => `[${c}]`).join(',')}, __sync_time, __sync_id_num, MigrateFlg, MigrateErrFlg)
              VALUES (@stg_job_id, @source_db, ${columns.map(c => `@${c}`).join(',')}, @__sync_time, @__sync_id_num, @MigrateFlg, @MigrateErrFlg)
          `;
          await this.queryNewDbTx(insertQuery, params, transaction);
      }

      actualStagedCount++;
    }
    return { stagedCount: actualStagedCount };
  }

  async fetchListFromOldDb(lastSyncTime, lastSyncId = 0, offset = 0, limit = 2000) {
    // Required by SyncHandlerModel to satisfy interface check (BaseIncrementalSyncInterface).
    // Actual data extraction logic is fully handled inside getList() and getCount() 
    // for this specialized cross-database model.
    return [];
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');
    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const totalCount = await this.getCount(normalizedLastSyncTime, normalizedLastSyncId);
    console.log(`[StreamMeetingMigrationModel] Total records to sync: ${totalCount}`);

    await this.queryNewDb(
      `
      UPDATE sync_jobs
      SET total_to_sync = @total,
          total_processed = 0,
          total_success = 0,
          total_errors = 0,
          last_sync_time = @lastSyncTime,
          last_sync_id = @lastSyncId
      WHERE job_id = @jobId
      `,
      {
        total: totalCount,
        lastSyncTime: normalizedLastSyncTime,
        lastSyncId: normalizedLastSyncId,
        jobId: syncJobId
      }
    );

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[StreamMeetingMigrationModel] 🚀 BẮT ĐẦU HÚT DỮ LIỆU OLD → STAGING`);
    console.log(`[StreamMeetingMigrationModel]    Job: ${syncJobId}`);
    console.log(`[StreamMeetingMigrationModel]    Đang thực thi truy vấn UNION ALL trên 51 DB...`);
    console.log(`${'='.repeat(60)}\n`);

    const jobStartTime = Date.now();
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;
    let totalStagedCount = 0;

    const sql = `
      DECLARE @dbs TABLE (DbName NVARCHAR(128));
      INSERT INTO @dbs (DbName) VALUES
      ('WSS_Content_eoffice'),('WSS_Content_eoffice_atpc'),('WSS_Content_eoffice_cll'),('WSS_Content_eoffice_cntt'),('WSS_Content_eoffice_ct'),('WSS_Content_eoffice_cvtc'),('WSS_Content_eoffice_donvi'),('WSS_Content_eoffice_dvhh'),('WSS_Content_eoffice_dvkt'),('WSS_Content_eoffice_gnvt'),('WSS_Content_eoffice_hc'),('WSS_Content_eoffice_hdsd'),('WSS_Content_eoffice_ht'),('WSS_Content_eoffice_icdlb'),('WSS_Content_eoffice_icdst'),('WSS_Content_eoffice_ios'),('WSS_Content_eoffice_khdt'),('WSS_Content_eoffice_khkd'),('WSS_Content_eoffice_ktvt'),('WSS_Content_eoffice_kvtc'),('WSS_Content_eoffice_mkt'),('WSS_Content_eoffice_npl'),('WSS_Content_eoffice_qlct'),('WSS_Content_eoffice_qsbv'),('WSS_Content_eoffice_record'),('WSS_Content_eoffice_record2018'),('WSS_Content_eoffice_snpl'),('WSS_Content_eoffice_tc'),('WSS_Content_eoffice_tc189'),('WSS_Content_eoffice_tcct'),('WSS_Content_eoffice_tchp'),('WSS_Content_eoffice_tcidi'),('WSS_Content_eoffice_tcld'),('WSS_Content_eoffice_tcmt'),('WSS_Content_eoffice_tco'),('WSS_Content_eoffice_tcot'),('WSS_Content_eoffice_tcpc'),('WSS_Content_eoffice_tcph'),('WSS_Content_eoffice_tctt'),('WSS_Content_eoffice_testuser2'),('WSS_Content_eoffice_thuvientct'),('WSS_Content_eoffice_ttddc'),('WSS_Content_eoffice_vp'),('WSS_Content_eoffice_vpmb'),('WSS_Content_eoffice_vptnb'),('WSS_Content_eoffice_vtb'),('WSS_Content_eoffice_vtt'),('WSS_Content_eoffice_xdct'),('WSS_Content_eoffice_xncg'),('WSS_Content_eoffice_yte');

      DECLARE @sql NVARCHAR(MAX) = N'';

      SELECT @sql = @sql + 
          CASE WHEN @sql = N'' THEN N'' ELSE N' UNION ALL ' + CHAR(13) + CHAR(10) END +
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
          ud.[tp_ListId]        AS tp_ListId
      FROM [' + DbName + N'].[dbo].[AllUserData] ud
      INNER JOIN [' + DbName + N'].[dbo].[AllLists] l
          ON ud.[tp_ListId] = l.[tp_ID]
      LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_author
          ON ud.[tp_Author] = ui_author.[tp_ID]
      LEFT JOIN [WSS_Content_eoffice].[dbo].[UserInfo] ui_editor
          ON ud.[tp_Editor] = ui_editor.[tp_ID]
      WHERE ud.[tp_ListId] IN (
          ''B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'',
          ''360585BB-EDDA-4990-B293-AA097594B073'')
      AND ud.tp_RowOrdinal = 0'
      FROM @dbs;

      SET @sql = @sql + CHAR(13) + CHAR(10) + N'ORDER BY DatabaseName, __sync_time ASC, __sync_id_num ASC, ListName ASC;';

      EXEC sp_executesql @sql;
    `;

    try {
      const rows = await this.queryOldDb(sql);
      const queryDuration = ((Date.now() - jobStartTime) / 1000).toFixed(1);
      console.log(`[StreamMeetingMigrationModel] ✅ Đã lấy được ${rows?.length || 0} bản ghi từ 51 DB trong ${queryDuration}s`);

      if (rows && rows.length > 0) {
        // Chia nhỏ batch để insert vào staging tránh nghẽn connection / transaction dài
        const batchSize = 1000;
        const totalBatches = Math.ceil(rows.length / batchSize);
        
        for (let i = 0; i < totalBatches; i++) {
          const batchStart = i * batchSize;
          const batchRows = rows.slice(batchStart, batchStart + batchSize);
          console.log(`[StreamMeetingMigrationModel] │   📦 Đang xử lý staging batch ${i + 1}/${totalBatches} (${batchRows.length} bản ghi)...`);
          const stageResult = await this.syncOldToStaging(batchRows, { syncJobId });
          totalStagedCount += Number(stageResult?.stagedCount || 0);

          for (const row of batchRows) {
            const rowTime = this.extractRowSyncTime(row);
            const rowId = this.extractRowSyncId(row);
            if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
                nextSyncTime = rowTime;
                nextSyncId = rowId;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] ❌ LỖI trong quá trình fetch dữ liệu: ${err.message}`);
    }

    const totalDuration = ((Date.now() - jobStartTime) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[StreamMeetingMigrationModel] 🏁 KẾT THÚC HÚT DỮ LIỆU OLD → STAGING`);
    console.log(`[StreamMeetingMigrationModel]    Tổng thời gian: ${totalDuration}s`);
    console.log(`[StreamMeetingMigrationModel]    Tổng staged (tạm tính): ${totalStagedCount}`);

    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM ${this.getStagingTableRef()} 
      WHERE stg_job_id = @syncJobId
    `;
    const actualStagedCountRes = await this.queryNewDb(countQuery, { syncJobId });
    const actualStagedCount = Number(actualStagedCountRes?.[0]?.total || 0);

    await this.queryNewDb(
      `UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`,
      {
        total: actualStagedCount,
        jobId: syncJobId
      }
    );

    return {
        syncJobId,
        rows: [],
        sourceTotalCount: totalCount,
        totalCount: actualStagedCount,
        stagedCount: actualStagedCount,
        lastSyncTime: nextSyncTime,
        lastSyncId: nextSyncId
    };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async fetchOneFromStaging(syncJobId, { processedCount = 0, transaction } = {}) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const stagingTableRef = this.getStagingTableRef();
    const query = `
      ;WITH staged AS (
        SELECT
          *,
          COALESCE(TRY_CONVERT(datetime2, __sync_time), TRY_CONVERT(datetime2, tp_Modified), TRY_CONVERT(datetime2, tp_Created)) AS __cursor_time,
          TRY_CONVERT(BIGINT, COALESCE(__sync_id_num, ID)) AS __cursor_id
        FROM ${stagingTableRef}
        WHERE stg_job_id = @syncJobId
      )
      SELECT *
      FROM staged
      ORDER BY
        __cursor_time ASC,
        ISNULL(__cursor_id, -9223372036854775808) ASC,
        ISNULL(tp_ListId, '') ASC,
        ID ASC,
        SY_SyncId ASC
      OFFSET @processedCount ROWS FETCH NEXT 1 ROWS ONLY
    `;

    const rows = await this.queryNewDbTx(
      query,
      {
        syncJobId,
        processedCount: Number(processedCount || 0)
      },
      transaction
    );

    if (!rows?.length) return null;

    const row = { ...rows[0] };
    delete row.__cursor_time;
    delete row.__cursor_id;
    return row;
  }

  async processOne(syncJobId, options = {}) {
    const itemIndex = Number(options.itemIndex || 0);
    const stagingTableRef = this.getStagingTableRef();

    const rowData = await this.fetchOneFromStaging(syncJobId, {
      processedCount: itemIndex
    });

    if (!rowData) {
        console.log(`[StreamMeetingMigrationModel] processOne: No more data for job ${syncJobId}`);
        return { syncJobId, processed: false, done: true };
    }

    await this.processRowData(rowData);

    console.log(`[StreamMeetingMigrationModel] processOne: Successfully processed row ID ${rowData.ID}`);
    return { 
        syncJobId, 
        processed: true, 
        done: false,
        lastSyncTime: this.extractRowSyncTime(rowData),
        lastSyncId: this.extractRowSyncId(rowData)
    };
  }

  /**
   * Hợp nhất các quyền bắt buộc vào danh sách quyền hiện tại của User.
   * Chỉ áp dụng trong module Meeting Sync này.
   */
  async forceUpdateUserRoles(userId, transaction = null) {
    if (!userId || userId === process.env.VANTHU_USER_ID) return;

    try {
      // 1. Lấy roles hiện tại của User
      const userRows = await this.queryNewDbTx(
        `SELECT roles_by_process FROM ${this.newDbName}.dbo.users WHERE id = @uid`,
        { uid: userId },
        transaction
      );

      let existingRoles = [];
      if (userRows?.[0]?.roles_by_process) {
        try {
          existingRoles = JSON.parse(userRows[0].roles_by_process);
        } catch (e) {
          existingRoles = [];
        }
      }

      if (!Array.isArray(existingRoles)) existingRoles = [];

      // 2. Hợp nhất với requiredRoles
      const finalRoles = JSON.parse(JSON.stringify(existingRoles));
      for (const req of requiredRoles) {
        const existingIdx = finalRoles.findIndex(r => r.processKey === req.processKey);
        if (existingIdx !== -1) {
          const existingProcess = finalRoles[existingIdx];
          if (!Array.isArray(existingProcess.roles)) existingProcess.roles = [];
          for (const reqRole of req.roles) {
            if (!existingProcess.roles.some(r => r.roleCode === reqRole.roleCode)) {
              existingProcess.roles.push(reqRole);
            }
          }
        } else {
          finalRoles.push(req);
        }
      }

      // 3. Cập nhật lại vào DB
      await this.queryNewDbTx(
        `UPDATE ${this.newDbName}.dbo.users SET roles_by_process = @roles WHERE id = @uid`,
        { uid: userId, roles: JSON.stringify(finalRoles) },
        transaction
      );
      // console.log(`[StreamMeetingMigrationModel] Forced roles updated for user ${userId}`);
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] Lỗi cập nhật roles cho user ${userId}:`, err.message);
    }
  }

  async processRowData(rowData, { transaction } = {}) {
    if (!rowData?.ID) throw new Error('ID is required');

    const recordId = this.buildSourceRecordKey(rowData);
    console.log(`[StreamMeetingMigrationModel] processRowData: recordId=${recordId}`);

    // BỔ SUNG SKIP NHANH: Kiểm tra xem bản ghi đã được đồng bộ mới nhất chưa
    try {
        const db = this.newDbName || 'app_tancang';
        const schema = this.newDbSchema || 'dbo';
        const existingMeeting = await this.queryNewDbTx(
            `SELECT updated_at, sharepoint_version FROM [${db}].[${schema}].[meetings] WHERE id_sp_bak = @recordId`,
            { recordId },
            transaction
        );
        if (existingMeeting?.length > 0) {
            const targetUpdated = existingMeeting[0].updated_at;
            const sourceUpdated = rowData.__sync_time || rowData.tp_Modified;
            if (targetUpdated && sourceUpdated) {
                const targetTime = new Date(targetUpdated).getTime();
                const sourceTime = new Date(sourceUpdated).getTime();
                if (targetTime >= sourceTime) {
                    console.log(`[StreamMeetingMigrationModel] SKIP NHANH: recordId=${recordId} đã đồng bộ (Target: ${new Date(targetUpdated).toISOString()} >= Source: ${new Date(sourceUpdated).toISOString()}). Nhưng vẫn cho phép update để fix meeting_time.`);
                    // TẠM THỜI COMMENT ĐỂ FORCE UPDATE meeting_time
                    // return {
                    //     backupId: recordId,
                    //     affected: 0,
                    //     logs: [{ table: this.oldConfig?.newTable || 'meetings', action: 'SKIPPED_UP_TO_DATE' }]
                    // };
                }
            }
        }
    } catch (e) {
        console.warn(`[StreamMeetingMigrationModel] Lỗi check skip nhanh: ${e.message}`);
    }

    const { externalKey } = this.oldConfig;
    const originalLocation = typeof rowData.Location === 'string' ? rowData.Location.trim() : rowData.Location;
    const descriptionRoomName = typeof rowData.Description === 'string' ? rowData.Description.trim() : '';

    // 1. Resolve Creator (Người tạo) - Ưu tiên AuthorAccount, AuthorName
    let creatorId = await this.helper.robustUserResolver(rowData, transaction);

    // 2. Resolve Chairman (Chủ trì) - Theo trường nvarchar10 (ChuTri từ db cũ) hoặc nvarchar4 (Organizer)
    // Fallback cố định khi không tìm thấy chủ trì theo tên
    const CHAIRMAN_FALLBACK_ID = 'b23406e3-5c75-41d3-91e0-1654293ae6b2';
    const chairmanSrc = rowData.nvarchar10 || rowData.ChuTri || rowData.nvarchar4 || rowData.Organizer;
    let chairmanId = CHAIRMAN_FALLBACK_ID; // Mặc định: UUID fix cứng khi không resolve được
    if (chairmanSrc) {
        // Chủ trì thường nhập tiếng Việt, dùng LikeSearch để dò ra ID chuẩn nhất theo họ tên
        const mapped = await this.helper.mapUserWithLikeSearch(chairmanSrc, transaction);
        if (mapped) {
            chairmanId = mapped;
            console.log(`[StreamMeetingMigrationModel] Chairman RESOLVED: "${chairmanSrc}" -> ${mapped}`);
        } else {
            console.warn(`[StreamMeetingMigrationModel] Chairman NOT FOUND: "${chairmanSrc}" -> Dùng fallback UUID ${CHAIRMAN_FALLBACK_ID}`);
        }
    } else {
        console.warn(`[StreamMeetingMigrationModel] Chairman SRC EMPTY (nvarchar10/ChuTri/nvarchar4 null) -> Dùng fallback UUID ${CHAIRMAN_FALLBACK_ID}`);
    }

    console.log(`[StreamMeetingMigrationModel] FINAL DECISION: Creator=${creatorId}, Chairman=${chairmanId}`);

    // Gán dữ liệu vào object chuẩn bị Upsert
    rowData.AuthorAccount = creatorId;
    rowData.chairman_id = chairmanId;
    rowData.created_by = creatorId;



    // Mapping Secretary (Thư ký) from nvarchar14
    if (rowData.nvarchar14) {
        rowData.secretary_id = await this.resolveExistingUserIdNoCreate(rowData.nvarchar14, transaction);
    }

    // Mapping Direct Command and Conclusion
    rowData.direct_command = rowData.DocumentTitle || null;
    rowData.conclusion = rowData.nvarchar7 || null;

    // Xử lý tách Ngày và Giờ từ BatDau và KetThuc
    if (rowData.BatDau || rowData.StartDate) {
        const sourceStart = rowData.BatDau || rowData.StartDate;
        const sourceEnd = rowData.KetThuc || rowData.EndDate;
        const d = new Date(sourceStart);
        if (!isNaN(d.getTime())) {
            // Định dạng: yyyy-MM-dd
            rowData.meeting_date = d.toISOString().split('T')[0];
            
            // Định dạng: HH:mm-HH:mm (cộng thêm 7 tiếng)
            const timeFormat = this.helper.formatMeetingTimeWithOffset(sourceStart, sourceEnd, 7);
            if (timeFormat) {
                rowData.meeting_time = timeFormat;
            } else {
                rowData.meeting_time = d.toTimeString().split(' ')[0].substring(0, 5);
            }
            
            // Gán các trường started_at/ended_at nếu cần cho app
            rowData.started_at = sourceStart;
            if (sourceEnd) rowData.ended_at = sourceEnd;

            // Map priority (Col 4 of sample) if possible
            // In SharePoint, priority is usually stored in nvarchar or specialized field
            // We assume it might be in nvarchar5 or similar if not provided, but let's stick to what we have

            console.log(`[StreamMeetingMigrationModel] Processed date: date=${rowData.meeting_date}, time=${rowData.meeting_time}`);
        }
    }

    // Ưu tiên nvarchar3/Description làm tên phòng để auto create/find room trong meeting_rooms.
    if (descriptionRoomName) {
        rowData.room_ids = await this.helper.mapMeetingRoom(descriptionRoomName, transaction);
    } else if (originalLocation && String(originalLocation).includes('-')) {
        // Fallback cho dữ liệu cũ đã lưu trực tiếp room ID.
        rowData.room_ids = originalLocation;
    } else if (originalLocation) {
        const normalizedLocation = String(originalLocation).toLowerCase();
        const looksLikePhysicalRoom =
            !normalizedLocation.includes('zoom') &&
            !normalizedLocation.includes('online') &&
            !normalizedLocation.includes('hybrid');

        if (looksLikePhysicalRoom) {
            rowData.room_ids = await this.helper.mapMeetingRoom(String(originalLocation), transaction);
        }
    }

    if (!rowData.room_ids) {
        rowData.room_ids = mapping.room_default.id;
        console.log(
            `[StreamMeetingMigrationModel] No room resolved for recordId=${recordId}. Fallback to default room ${mapping.room_default.id}`
        );
    }

    if (rowData.room_ids) {
        rowData.Location = rowData.room_ids;
    }

    // Meeting mode logic
    if (originalLocation) {
        const loc = String(originalLocation).toLowerCase();
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

    // FIX CỨNG: Cộng +7 giờ từ BatDau/KetThuc → meeting_time dạng "HH:mm-HH:mm"
    try {
        const db = this.newDbName || 'app_tancang';
        const schema = this.newDbSchema || 'dbo';
        const meetingTable = `[${db}].[${schema}].[meetings]`;

        const sourceStart = rowData.BatDau || rowData.StartDate;
        const sourceEnd = rowData.KetThuc || rowData.EndDate;

        // LOG CHI TIẾT để debug
        console.log(`[StreamMeetingMigrationModel] FIX meeting_time DEBUG:`);
        console.log(`  rowData.BatDau   = ${rowData.BatDau} (type=${typeof rowData.BatDau})`);
        console.log(`  rowData.StartDate= ${rowData.StartDate} (type=${typeof rowData.StartDate})`);
        console.log(`  rowData.KetThuc  = ${rowData.KetThuc} (type=${typeof rowData.KetThuc})`);
        console.log(`  rowData.EndDate  = ${rowData.EndDate} (type=${typeof rowData.EndDate})`);
        console.log(`  rowData.datetime1= ${rowData.datetime1} (type=${typeof rowData.datetime1})`);
        console.log(`  rowData.datetime2= ${rowData.datetime2} (type=${typeof rowData.datetime2})`);
        console.log(`  sourceStart=${sourceStart}, sourceEnd=${sourceEnd}`);

        const meetingTimeVal = this.helper.formatMeetingTimeWithOffset(sourceStart, sourceEnd, 7);

        console.log(`[StreamMeetingMigrationModel] FIX meeting_time → "${meetingTimeVal}"`);

        if (meetingTimeVal) {
            await this.queryNewDbTx(
                `UPDATE ${meetingTable} SET [meeting_time] = @meetingTime WHERE [id_sp_bak] = @recordId`,
                { meetingTime: meetingTimeVal, recordId },
                transaction
            );
            console.log(`[StreamMeetingMigrationModel] ✅ Updated meeting_time="${meetingTimeVal}" for recordId=${recordId}`);
        } else {
            // FALLBACK: thử dùng datetime1/datetime2 trực tiếp từ staging
            const fallbackStart = rowData.datetime1;
            const fallbackEnd = rowData.datetime2;
            const fallbackTime = this.helper.formatMeetingTimeWithOffset(fallbackStart, fallbackEnd, 7);
            console.log(`[StreamMeetingMigrationModel] FALLBACK datetime1=${fallbackStart} datetime2=${fallbackEnd} → "${fallbackTime}"`);
            if (fallbackTime) {
                await this.queryNewDbTx(
                    `UPDATE ${meetingTable} SET [meeting_time] = @meetingTime WHERE [id_sp_bak] = @recordId`,
                    { meetingTime: fallbackTime, recordId },
                    transaction
                );
                console.log(`[StreamMeetingMigrationModel] ✅ FALLBACK Updated meeting_time="${fallbackTime}" for recordId=${recordId}`);
            }
        }
    } catch (e) {
        console.warn(`[StreamMeetingMigrationModel] Lỗi force update meeting_time: ${e.message}`);
    }

    // Bổ sung: Cập nhật quyền "cứng" cho các user liên quan (chỉ chạy trong module này)
    if (creatorId) await this.forceUpdateUserRoles(creatorId, transaction);
    if (chairmanId && chairmanId !== creatorId) await this.forceUpdateUserRoles(chairmanId, transaction);
    if (rowData.secretary_id) await this.forceUpdateUserRoles(rowData.secretary_id, transaction);

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

        // NEW: Create meeting_units entry for the room/unit, then attach participants to that unit.
        const meetingUnit = await this.ensureMeetingUnitExists(meetingId, rowData, transaction);
        await this.ensureMeetingParticipantsExist(meetingUnit, rowData, transaction);
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
      const idBak = this.buildSourceRecordKey(rowData);

      console.log(`[StreamMeetingMigrationModel] Ensuring meeting_units entry for meetingId=${meetingId}, roomId=${roomId}`);

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
        {
          meetingId,
          unitId
        },
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
          {
            meetingId,
            unitId,
            roomId,
            idBak
          },
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
      console.error(`[StreamMeetingMigrationModel] ensureMeetingUnitExists ERROR: ${err.message}`);
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
      pushCandidate(this.helper.extractAccountOnly(raw));
      pushCandidate(this.helper.extractDisplayName(raw));
      pushCandidate(this.helper.extractCoreName(raw));

      for (const candidate of candidateSet) {
        const exactRows = await this.queryNewDbTx(
          `
          SELECT TOP 1 id
          FROM [${this.newDbName}].[${this.newDbSchema}].[users]
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

      const likeCandidate = this.helper.extractCoreName(raw) || this.helper.extractDisplayName(raw) || raw;
      if (!likeCandidate) return null;

      const likeRows = await this.queryNewDbTx(
        `
        SELECT TOP 1 id
        FROM [${this.newDbName}].[${this.newDbSchema}].[users]
        WHERE name LIKE '%' + @candidate + '%'
        ORDER BY LEN(name) ASC
        `,
        { candidate: likeCandidate },
        transaction
      );

      return likeRows?.[0]?.id || null;
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] resolveExistingUserIdNoCreate ERROR: ${err.message}`);
      return null;
    }
  }

  async ensureMeetingParticipantsExist(meetingUnit, rowData, transaction = null) {
    try {
      if (!meetingUnit?.id) return;

      const db = this.newDbName || 'app_tancang';
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

      console.log(
        `[StreamMeetingMigrationModel] Ensured ${participantSeeds.length} meeting_participants for meetingUnitId=${meetingUnit.id}`
      );
    } catch (err) {
      console.error(`[StreamMeetingMigrationModel] ensureMeetingParticipantsExist ERROR: ${err.message}`);
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
    console.log(`[StreamMeetingMigrationModel] Audit creation for meetingId ${meetingId} (Creator: ${creatorId}, Management: ${quanLyPhongId}, RoomMgmt: ${quanLyPhongHopId})`);
    try {
        await this.queryNewDbTx(query, { meetingId, creatorId, quanLyPhongId, quanLyPhongHopId }, transaction);
    } catch (err) {
        console.error(`[StreamMeetingMigrationModel] createDefaultAuditForMigration ERROR: ${err.message}`);
    }
  }


  async getExistingColumns(tableName, schema = 'dbo') {
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    // Trả về Map [tên_cột_lowercase] -> { type, maxLength }
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), {
      type: r.DATA_TYPE.toLowerCase(),
      maxLength: r.CHARACTER_MAXIMUM_LENGTH
    }));
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
    const insertColSet = new Set();
    const updateColSet = new Set();

    const addInsertColumn = (colName) => {
      const key = colName.toLowerCase();
      if (insertColSet.has(key)) return;
      insertColSet.add(key);
      insertCols.push(`[${colName}]`);
      insertVals.push(`@${colName}`);
    };

    const addUpdateColumn = (colName) => {
      const key = colName.toLowerCase();
      if (key === 'id' || key === 'created_at') return;
      if (updateColSet.has(key)) return;
      updateColSet.add(key);
      updateSet.push(`[${colName}] = @${colName}`);
    };

    // Helper function for safe trimming
    const applySafeCast = (colName, val) => {
      const colMeta = existingCols.get(colName.toLowerCase());
      if (!colMeta) return val;
      const { type, maxLength } = colMeta;
      if (typeof val === 'string' && maxLength && maxLength > 0) {
        if (val.length > maxLength) {
          console.warn(`[StreamMeetingMigrationModel] Truncating column [${colName}]: length ${val.length} > ${maxLength}. Value: "${val.substring(0, 20)}..."`);
          return val.substring(0, maxLength);
        }
      }
      return val;
    };

    // Tự động sinh ID nếu bảng có cột 'id' (case-insensitive) nhưng mapping không có
    if (existingCols.has('id') && !params.hasOwnProperty('id')) {
        const hasIdInMapping = Object.values(fieldMapping).some(v => v.toLowerCase() === 'id') ||
                              Object.keys(defaultValues || {}).some(v => v.toLowerCase() === 'id');
        if (!hasIdInMapping) {
            const newId = uuidv4().toUpperCase();
            params['id'] = applySafeCast('id', newId);
            addInsertColumn('id');
            // Thường không update ID
        }
    }

    for (const [oldField, newField] of Object.entries(fieldMapping)) {
      if (!existingCols.has(newField.toLowerCase())) continue;
      const value = rawData[oldField];
      if (value === undefined || value === null) continue;

      const safeValue = applySafeCast(newField, value);
      params[newField] = safeValue;
      addInsertColumn(newField);

      // 🔥 NEVER update ID or created_at
      addUpdateColumn(newField);
    }

    for (const [newField, valueFn] of Object.entries(defaultValues || {})) {
      if (!existingCols.has(newField.toLowerCase())) continue;
      if (!params.hasOwnProperty(newField)) {
        const rawVal = typeof valueFn === 'function' ? valueFn(rawData) : valueFn;
        const safeValue = applySafeCast(newField, rawVal);
        if (newField === 'meeting_time') {
          console.log(`[upsertDataToNewDB] meeting_time từ defaultValues: rawData.BatDau=${rawData?.BatDau}, rawData.StartDate=${rawData?.StartDate}, rawData.KetThuc=${rawData?.KetThuc}, rawData.EndDate=${rawData?.EndDate} → VALUE="${rawVal}"`);
        }
        params[newField] = safeValue;
        addInsertColumn(newField);

        // 🔥 NEVER update ID or created_at
        addUpdateColumn(newField);
      } else if (newField === 'meeting_time') {
        console.log(`[upsertDataToNewDB] meeting_time đã có sẵn trong params (từ fieldMapping): "${params[newField]}", KHÔNG gọi defaultValues`);
      }
    }

    for (const [colName, colMeta] of existingCols.entries()) {
      if (!params.hasOwnProperty(colName)) {
        // Tự động fake dữ liệu dựa trên kiểu dữ liệu của cột
        let fallback = null;
        const { type } = colMeta;
        if (colName.toLowerCase() === 'charman_type' || colName.toLowerCase() === 'chairman_type' || colName.toLowerCase() === 'secretary_type') {
          fallback = 'USER';
        } else if (type.includes('char') || type.includes('text')) {
          fallback = 'Chưa xác định (Auto-fake)';
        } else if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('numeric')) {
          fallback = 0;
        } else if (type.includes('date') || type.includes('time')) {
          fallback = new Date();
        } else if (type.includes('bit')) {
          fallback = 0;
        }

        if (fallback !== null) {
          const safeValue = applySafeCast(colName, fallback);
          params[colName] = safeValue;
          addInsertColumn(colName);
          addUpdateColumn(colName);
        }
      }
    }

    if (existingCols.has(externalKeyField.toLowerCase())) {
      params[externalKeyField] = applySafeCast(externalKeyField, externalKeyValue);
      addInsertColumn(externalKeyField);
      addUpdateColumn(externalKeyField);
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
