const BaseIncrementalSyncInterface = require('../sync-manager/BaseIncrementalSyncInterface');
const logger = require('../../utils/logger');
const MigrationHelper = require('../helpers/MigrationHelper');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SYNC_TIME = '1970-01-01T00:00:00.000Z';

class StreamCarMigrationModel extends BaseIncrementalSyncInterface {
  constructor() {
    super({ modelName: 'STREAM_CAR_MIGRATION' });
    this.oldDbName = 'WSS_Content_eoffice_khkd';
    this.oldDbSchema = 'dbo';
    this.oldListId = '090933CE-FF2D-4962-AC64-87B73626F973';
    this.newDbName = process.env.NEW_DB_NAME || 'app_tancang';
    this.newDbSchema = process.env.NEW_DB_SCHEMA || 'dbo';
    this.newTableSync = 'vehicle_registrations_sync';
    this.masterTable = 'vehicle_registrations';
    this.detailTable = 'vehicle_registration_assignments';
    this.carTable = 'list_cars';
    this.driverTable = 'list_drivers';
    this.heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  async initialize() {
    await super.initialize();
    logger.info(`[${this.modelName}] Schema validation and table/index checks are skipped due permissions.`);
  }

  getTargetTableRef(table) {
    const target = table || this.masterTable;
    return this.newDbName
      ? `[${this.newDbName}].[${this.newDbSchema}].[${target}]`
      : `${this.newDbSchema}.${target}`;
  }

  normalizeSyncTime(value) {
    if (!value) return DEFAULT_SYNC_TIME;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? DEFAULT_SYNC_TIME : d.toISOString();
  }

  extractRowSyncTime(row) {
    const raw = row?.__sync_time || row?.original_modified || row?.original_created || null;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  extractRowSyncId(row) {
    return Number(row?.__sync_id_num || row?.old_id || 0);
  }

  isCursorAhead(aTime, aId, bTime, bId) {
    const ta = new Date(aTime || DEFAULT_SYNC_TIME).getTime();
    const tb = new Date(bTime || DEFAULT_SYNC_TIME).getTime();
    if (ta > tb) return true;
    if (ta < tb) return false;
    return Number(aId || 0) > Number(bId || 0);
  }

  async getExistingColumns(tableName, schema = this.newDbSchema) {
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE
      FROM [${this.newDbName}].INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND TABLE_SCHEMA = @schema
    `;
    const result = await this.queryNewDb(query, { tableName, schema });
    const colMap = new Map();
    result.forEach(r => colMap.set(r.COLUMN_NAME.toLowerCase(), r.DATA_TYPE.toLowerCase()));
    return colMap;
  }

  async addColumnsIfMissing(tableRef, tableName, columns) {
    const existingCols = await this.getExistingColumns(tableName, this.newDbSchema);
    for (const col of columns) {
      if (!existingCols.has(col.name.toLowerCase())) {
        const alter = `ALTER TABLE ${tableRef} ADD [${col.name}] ${col.type} ${col.nullable || 'NULL'};`;
        await this.queryNewDb(alter);
        logger.info(`[StreamCarMigrationModel] Added missing column ${col.name} to ${tableName}`);
      }
    }
  }

  async ensureTargetTables() {
    const db = this.newDbName;
    const schema = this.newDbSchema;

    const masterRef = `[${db}].[${schema}].[${this.masterTable}]`;
    const detailRef = `[${db}].[${schema}].[${this.detailTable}]`;
    const carRef = `[${db}].[${schema}].[${this.carTable}]`;
    const driverRef = `[${db}].[${schema}].[${this.driverTable}]`;

    const createMaster = `
      IF OBJECT_ID('${masterRef}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${masterRef} (
          id uniqueidentifier NOT NULL PRIMARY KEY,
          name nvarchar(255) NULL,
          request_type nvarchar(255) NULL,
          priority nvarchar(50) NULL,
          is_important_guest nvarchar(10) NULL,
          passenger_count int NULL,
          departure_time datetime2 NULL,
          return_time datetime2 NULL,
          departure_point nvarchar(500) NULL,
          destination nvarchar(500) NULL,
          contact_person nvarchar(255) NULL,
          contact_phone nvarchar(20) NULL,
          total_people int NULL,
          purpose nvarchar(1000) NULL,
          notes nvarchar(1000) NULL,
          status int NULL,
          bpmn_version nvarchar(50) NULL,
          timezone nvarchar(100) NULL,
          vehicle_state nvarchar(50) NULL,
          status_code nvarchar(100) NULL,
          request_submitted_at datetime2 NULL,
          waiting_confirmed_at datetime2 NULL,
          created_at datetime2 NULL,
          updated_at datetime2 NULL,
          created_by nvarchar(255) NULL,
          department nvarchar(255) NULL,
          trip_duration_minutes int NULL,
          driver_ids nvarchar(MAX) NULL,
          car_ids nvarchar(MAX) NULL,
          coordination_information nvarchar(MAX) NULL,
          rejection_reason nvarchar(MAX) NULL,
          confirmed_driver_ids nvarchar(MAX) NULL,
          is_all_drivers_confirmed bit NULL,
          driver_notice_count int NULL,
          leader_notice_count int NULL,
          request_code nvarchar(30) NULL,
          table_bak int NULL,
          id_sp_bak nvarchar(255) NULL,
          driver_notice_times nvarchar(MAX) NULL,
          leader_notice_times nvarchar(MAX) NULL,
          leader_escalated_at datetime NULL,
          source_db nvarchar(255) NULL
        );
      END
    `;

    const createDetail = `
      IF OBJECT_ID('${detailRef}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${detailRef} (
          id uniqueidentifier NOT NULL PRIMARY KEY,
          registration_id uniqueidentifier NOT NULL,
          car_id nvarchar(100) NOT NULL,
          driver_id nvarchar(100) NULL,
          is_confirmed bit NULL,
          confirmed_at datetime NULL,
          created_at datetime2 NULL,
          table_bak int NULL,
          id_sp_bak nvarchar(255) NULL,
          source_db nvarchar(255) NULL
        );
      END
    `;

    const createCar = `
      IF OBJECT_ID('${carRef}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${carRef} (
          id varchar(40) NOT NULL PRIMARY KEY,
          license_plate nvarchar(50) NULL,
          car_type nvarchar(100) NULL,
          brand nvarchar(100) NULL,
          seat_count int NULL,
          manager nvarchar(255) NULL,
          status_car nvarchar(50) NULL,
          status int NULL,
          note nvarchar(1000) NULL,
          created_at datetime2 NULL,
          updated_at datetime2 NULL,
          maintenance nvarchar(100) NULL,
          total_trips int NULL,
          booking_available bit NULL
        );
      END
    `;

    const createDriver = `
      IF OBJECT_ID('${driverRef}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${driverRef} (
          id varchar(40) NOT NULL PRIMARY KEY,
          full_name nvarchar(255) NULL,
          phone_number varchar(20) NULL,
          id_card varchar(20) NULL,
          email nvarchar(255) NULL,
          address nvarchar(500) NULL,
          license_number varchar(50) NULL,
          license_class nvarchar(50) NULL,
          license_issued_date datetime2 NULL,
          note nvarchar(1000) NULL,
          status int NULL,
          created_at datetime2 NULL,
          updated_at datetime2 NULL,
          driverId varchar(40) NULL,
          total_trips int NULL,
          experience_years int NULL,
          booking_available bit NULL
        );
      END
    `;

    await this.queryNewDb(createMaster);
    await this.queryNewDb(createDetail);
    await this.queryNewDb(createCar);
    await this.queryNewDb(createDriver);

    const masterCols = [
      { name: 'id', type: 'uniqueidentifier', nullable: 'NOT NULL DEFAULT newid()' },
      { name: 'name', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'request_type', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'priority', type: 'nvarchar(50)', nullable: 'NULL' },
      { name: 'is_important_guest', type: 'nvarchar(10)', nullable: 'NULL' },
      { name: 'passenger_count', type: 'int', nullable: 'NULL' },
      { name: 'departure_time', type: 'datetime2', nullable: 'NULL' },
      { name: 'return_time', type: 'datetime2', nullable: 'NULL' },
      { name: 'departure_point', type: 'nvarchar(500)', nullable: 'NULL' },
      { name: 'destination', type: 'nvarchar(500)', nullable: 'NULL' },
      { name: 'contact_person', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'contact_phone', type: 'nvarchar(20)', nullable: 'NULL' },
      { name: 'total_people', type: 'int', nullable: 'NULL' },
      { name: 'purpose', type: 'nvarchar(1000)', nullable: 'NULL' },
      { name: 'notes', type: 'nvarchar(1000)', nullable: 'NULL' },
      { name: 'status', type: 'int', nullable: 'NULL' },
      { name: 'bpmn_version', type: 'nvarchar(50)', nullable: 'NULL' },
      { name: 'timezone', type: 'nvarchar(100)', nullable: 'NULL' },
      { name: 'vehicle_state', type: 'nvarchar(50)', nullable: 'NULL' },
      { name: 'status_code', type: 'nvarchar(100)', nullable: 'NULL' },
      { name: 'request_submitted_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'waiting_confirmed_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'created_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'updated_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'created_by', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'department', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'trip_duration_minutes', type: 'int', nullable: 'NULL' },
      { name: 'driver_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'car_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'coordination_information', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'rejection_reason', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'confirmed_driver_ids', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'is_all_drivers_confirmed', type: 'bit', nullable: 'NULL' },
      { name: 'driver_notice_count', type: 'int', nullable: 'NULL' },
      { name: 'leader_notice_count', type: 'int', nullable: 'NULL' },
      { name: 'request_code', type: 'nvarchar(30)', nullable: 'NULL' },
      { name: 'table_bak', type: 'int', nullable: 'NULL' },
      { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'driver_notice_times', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'leader_notice_times', type: 'nvarchar(MAX)', nullable: 'NULL' },
      { name: 'leader_escalated_at', type: 'datetime', nullable: 'NULL' },
      { name: 'source_db', type: 'nvarchar(255)', nullable: 'NULL' }
    ];

    const detailCols = [
      { name: 'id', type: 'uniqueidentifier', nullable: 'NOT NULL DEFAULT newid()' },
      { name: 'registration_id', type: 'uniqueidentifier', nullable: 'NOT NULL' },
      { name: 'car_id', type: 'nvarchar(100)', nullable: 'NOT NULL' },
      { name: 'driver_id', type: 'nvarchar(100)', nullable: 'NULL' },
      { name: 'is_confirmed', type: 'bit', nullable: 'NULL' },
      { name: 'confirmed_at', type: 'datetime', nullable: 'NULL' },
      { name: 'created_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'table_bak', type: 'int', nullable: 'NULL' },
      { name: 'id_sp_bak', type: 'nvarchar(255)', nullable: 'NULL' },
      { name: 'source_db', type: 'nvarchar(255)', nullable: 'NULL' }
    ];

    const carCols = [
      { name: 'id', type: 'varchar(40) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'license_plate', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'car_type', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'brand', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'seat_count', type: 'int', nullable: 'NULL' },
      { name: 'manager', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'status_car', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'status', type: 'int', nullable: 'NULL' },
      { name: 'note', type: 'nvarchar(1000) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'created_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'updated_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'maintenance', type: 'nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'total_trips', type: 'int', nullable: 'NULL' },
      { name: 'booking_available', type: 'bit', nullable: 'NULL' }
    ];

    const driverCols = [
      { name: 'id', type: 'varchar(40) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL' },
      { name: 'full_name', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'phone_number', type: 'varchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'id_card', type: 'varchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'email', type: 'nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'address', type: 'nvarchar(500) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'license_number', type: 'varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'license_class', type: 'nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'license_issued_date', type: 'datetime2', nullable: 'NULL' },
      { name: 'note', type: 'nvarchar(1000) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'status', type: 'int', nullable: 'NULL' },
      { name: 'created_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'updated_at', type: 'datetime2', nullable: 'NULL' },
      { name: 'driver_id', type: 'varchar(40) COLLATE SQL_Latin1_General_CP1_CI_AS NULL' },
      { name: 'total_trips', type: 'int', nullable: 'NULL' },
      { name: 'experience_years', type: 'int', nullable: 'NULL' },
      { name: 'booking_available', type: 'bit', nullable: 'NULL' }
    ];

    await this.addColumnsIfMissing(masterRef, this.masterTable, masterCols);
    await this.addColumnsIfMissing(detailRef, this.detailTable, detailCols);
    await this.addColumnsIfMissing(carRef, this.carTable, carCols);
    await this.addColumnsIfMissing(driverRef, this.driverTable, driverCols);

    await this.queryNewDb(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${this.masterTable}_id_sp_bak' AND object_id = OBJECT_ID('${masterRef}'))
        CREATE NONCLUSTERED INDEX IX_${this.masterTable}_id_sp_bak ON ${masterRef}(id_sp_bak, source_db);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${this.detailTable}_id_sp_bak' AND object_id = OBJECT_ID('${detailRef}'))
        CREATE NONCLUSTERED INDEX IX_${this.detailTable}_id_sp_bak ON ${detailRef}(id_sp_bak, source_db);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${this.detailTable}_registration' AND object_id = OBJECT_ID('${detailRef}'))
        CREATE NONCLUSTERED INDEX idx_${this.detailTable}_registration ON ${detailRef}(registration_id);
      IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_${this.detailTable}_registration' AND parent_object_id = OBJECT_ID('${detailRef}'))
      BEGIN
        ALTER TABLE ${detailRef} ADD CONSTRAINT FK_${this.detailTable}_registration FOREIGN KEY (registration_id) REFERENCES ${masterRef}(id);
      END
    `);
  }

  async ensureReferenceTables() {
    const db = this.newDbName;
    const schema = this.newDbSchema;
    const carRef = `[${db}].[${schema}].[${this.carTable}]`;
    const driverRef = `[${db}].[${schema}].[${this.driverTable}]`;

    await this.queryNewDb(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${this.carTable}_license_plate' AND object_id = OBJECT_ID('${carRef}'))
        CREATE NONCLUSTERED INDEX IX_${this.carTable}_license_plate ON ${carRef}(license_plate);
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_${this.driverTable}_full_name' AND object_id = OBJECT_ID('${driverRef}'))
        CREATE NONCLUSTERED INDEX IX_${this.driverTable}_full_name ON ${driverRef}(full_name);
    `);
  }

  async ensureStagingTableExists() {
    logger.info(`[${this.modelName}] Staging is disabled for car migration; skipping staging table initialization.`);
    return;
  }

  async countOldRows() {
    const query = `
      SELECT COUNT(1) AS total
      FROM [WSS_Content_eoffice_khkd].[dbo].AllUserData ud
      WHERE ud.tp_ListId = @listId
    `;
    const rows = await this.queryOldDb(query, { listId: this.oldListId });
    return Number(rows?.[0]?.total || 0);
  }

  async fetchListFromOldDb(
    lastSyncTime,
    lastSyncId = 0,
    offset = 0,
    limit = 2000,
  ) {
    const query = `
      SELECT * FROM (
        SELECT
          ud.tp_ID AS old_id,
          @sourceDb AS source_db,

          ud.tp_Created AS original_created,
          ud.tp_Modified AS original_modified,

          -- ==========================
          -- Vehicle registration data
          -- ==========================

          -- datetime1: thời gian xuất phát
          rawXml.value(
            '(/root/datetime1)[1]',
            'datetime2'
          ) AS departure_time,

          -- nvarchar1: tiêu đề
          rawXml.value(
            '(/root/nvarchar1)[1]',
            'nvarchar(255)'
          ) AS title,

          -- ntext9: ghi chú
          rawXml.value(
            '(/root/ntext9)[1]',
            'nvarchar(255)'
          ) AS notes,

          -- ntext7: mục đích
          rawXml.value(
            '(/root/ntext7)[1]',
            'nvarchar(max)'
          ) AS purpose,

          -- nvarchar12: tên xe
          rawXml.value(
            '(/root/nvarchar12)[1]',
            'nvarchar(100)'
          ) AS car_name,

          -- nvarchar12: loại xe
          rawXml.value(
            '(/root/nvarchar12)[1]',
            'nvarchar(100)'
          ) AS type_car,

          -- nvarchar13: điểm xuất phát
          rawXml.value(
            '(/root/nvarchar13)[1]',
            'nvarchar(500)'
          ) AS departure_location,

          -- nvarchar14: điểm đến
          rawXml.value(
            '(/root/nvarchar14)[1]',
            'nvarchar(500)'
          ) AS destination,

          -- nvarchar15: tài xế
          rawXml.value(
            '(/root/nvarchar15)[1]',
            'nvarchar(255)'
          ) AS driver_name,

          -- passenger info
          rawXml.value(
            '(/root/nvarchar17)[1]',
            'nvarchar(255)'
          ) AS passenger_1,

          rawXml.value(
            '(/root/nvarchar18)[1]',
            'nvarchar(255)'
          ) AS passenger_2,

          CASE
            WHEN NULLIF(
              LTRIM(RTRIM(
                rawXml.value(
                  '(/root/nvarchar17)[1]',
                  'nvarchar(255)'
                )
              )),
              ''
            ) IS NOT NULL
            AND NULLIF(
              LTRIM(RTRIM(
                rawXml.value(
                  '(/root/nvarchar18)[1]',
                  'nvarchar(255)'
                )
              )),
              ''
            ) IS NOT NULL
            THEN 2

            WHEN NULLIF(
              LTRIM(RTRIM(
                rawXml.value(
                  '(/root/nvarchar17)[1]',
                  'nvarchar(255)'
                )
              )),
              ''
            ) IS NOT NULL
            OR NULLIF(
              LTRIM(RTRIM(
                rawXml.value(
                  '(/root/nvarchar18)[1]',
                  'nvarchar(255)'
                )
              )),
              ''
            ) IS NOT NULL
            THEN 1

            ELSE 0
          END AS passenger_count,

          -- sync fields
          ud.tp_Modified AS __sync_time,
          ud.tp_ID AS __sync_id_num,

          ROW_NUMBER() OVER (
            ORDER BY ud.tp_Modified ASC, ud.tp_ID ASC
          ) AS __page_rn,

          ud.tp_ColumnSet AS raw_xml

        FROM [WSS_Content_eoffice_khkd].[dbo].AllUserData ud

        CROSS APPLY (
          SELECT TRY_CAST(
            '<root>' +
            CONVERT(nvarchar(max), ud.tp_ColumnSet) +
            '</root>' AS XML
          )
        ) AS xmlSrc(rawXml)

        WHERE ud.tp_ListId = @listId
      ) AS t

      WHERE __page_rn > @offset
        AND __page_rn <= (@offset + @limit)

      ORDER BY __page_rn;
    `;

    return this.queryOldDb(query, {
      listId: this.oldListId,
      sourceDb: this.oldDbName,
      offset: Number(offset || 0),
      limit: Number(limit || 2000),
    });
  }

  async syncOldToStaging(rows) {
    throw new Error('[StreamCarMigrationModel] Staging is disabled for this migration model.');
  }

  async getList(lastSyncTime, syncJobId, lastSyncId = 0) {
    if (!syncJobId) throw new Error('syncJobId is required');

    const normalizedLastSyncTime = this.normalizeSyncTime(lastSyncTime);
    const normalizedLastSyncId = Number(lastSyncId || 0);

    const totalCount = await this.countOldRows();
    await this.queryNewDb(`UPDATE sync_jobs SET total_to_sync = @total WHERE job_id = @jobId`, {
      total: totalCount,
      jobId: syncJobId,
    });

    const batchSize = Number(process.env.STAGING_FETCH_BATCH_SIZE || 2000);
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let nextSyncTime = normalizedLastSyncTime;
    let nextSyncId = normalizedLastSyncId;
    const iterations = Math.ceil(totalCount / batchSize) || 1;

    for (let i = 0; i < iterations; i++) {
      const offset = i * batchSize;
      const rows = await this.fetchListFromOldDb(normalizedLastSyncTime, normalizedLastSyncId, offset, batchSize);
      console.log("================= COUNT ROW ==================", rows.length);
      if (!rows || rows.length === 0) break;

      let batchProcessed = 0;
      let batchSuccess = 0;
      let batchErrors = 0;

      for (const row of rows) {
        try {
          await this.processRowData(row);
          totalSuccess += 1;
          batchSuccess += 1;
        } catch (error) {
          totalErrors += 1;
          batchErrors += 1;
          logger.error(`[${this.modelName}] Failed to sync old row ${row.old_id}: ${error.message}`);
        }
        totalProcessed += 1;
        batchProcessed += 1;

        const rowTime = this.extractRowSyncTime(row);
        const rowId = this.extractRowSyncId(row);
        if (rowTime && this.isCursorAhead(rowTime, rowId, nextSyncTime, nextSyncId)) {
          nextSyncTime = rowTime;
          nextSyncId = rowId;
        }
      }

      await this.queryNewDb(`
        UPDATE sync_jobs
        SET total_processed = ISNULL(total_processed, 0) + @processed,
            total_success = ISNULL(total_success, 0) + @success,
            total_errors = ISNULL(total_errors, 0) + @errors
        WHERE job_id = @jobId`, {
        processed: batchSuccess,
        success: totalSuccess,
        errors: batchErrors,
        jobId: syncJobId,
      });
    }

    return {
      syncJobId,
      rows: [],
      totalCount,
      stagedCount: totalProcessed,
      lastSyncTime: nextSyncTime,
      lastSyncId: nextSyncId,
    };
  }

  async getSyncJobState(syncJobId) {
    const rows = await this.queryNewDb(`SELECT TOP 1 * FROM sync_jobs WHERE job_id = @syncJobId`, { syncJobId });
    return rows?.[0] || null;
  }

  async fetchOneFromStaging() {
    return null;
  }

  async updateHeartbeat(_rowData, _transaction = null) {
    return 0;
  }

  async processOne(syncJobId) {
    if (!syncJobId) throw new Error('syncJobId is required');
    logger.info(`[${this.modelName}] processOne is disabled because staging is skipped.`);
    return { syncJobId, processed: false, done: true, message: 'Staging disabled; use getList for direct sync.' };
  }

  sanitizeString(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str === '' ? null : str;
  }

  parseDate(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(String(value).trim());
    if (isNaN(parsed.getTime())) return null;
    return new Date(parsed.getTime() + 7 * 60 * 60 * 1000);
  }

  async getCarByName(name) {
    if (!name) return null;
    const ref = this.getTargetTableRef(this.carTable);
    const rows = await this.queryNewDb(
      `SELECT TOP 1 id FROM ${ref} WHERE license_plate = @name OR note = @name`,
      {
        name,
      },
    );
    return rows?.[0] || null;
  }

  getSeatCountFromCarName(name) {
    if (!name) return 4;
    const normalized = String(name).toLowerCase();
    const match = normalized.match(/(\d+)\s*(cho|chỗ|seat|ch)/i);
    if (match && Number(match[1]) > 0) {
      return Number(match[1]);
    }
    const digitMatch = normalized.match(/(\d+)/);
    return digitMatch ? Number(digitMatch[1]) : 4;
  }

  async processRowData(rowData) {
    const oldId = String(rowData.old_id || '').trim();
    if (!oldId) {
      throw new Error('Missing old_id in staging row');
    }

    const carName = this.sanitizeString(rowData.car_name);
    const fakeDriverId = '33084655-3a53-4dfd-b841-b8de26a3f8b7';
    const passengerCount = Number(rowData.passenger_count);
    const driverName = this.sanitizeString(rowData.driver_name);

    let carId = uuidv4().toUpperCase();
    if (carName) {
      const existingCar = await this.getCarByName(carName);
      if (existingCar) {
        carId = existingCar.id;
        logger.info(`[${this.modelName}] Using existing car "${carName}" for request ${oldId} (${carId}).`);
      }
    }

    await this.ensureCarExists(carId, carName || 'Xe 4 chỗ', rowData.type_car);

    const departureTime =
      this.parseDate(rowData.departure_time) ||
      this.parseDate(rowData.original_created) ||
      new Date();

    const returnTime = new Date();

    const tripDurationMinutes = Math.max(
      0,
      Math.floor((returnTime.getTime() - departureTime.getTime()) / (1000 * 60)),
    );

    const createdById = await this.helper.mapUserName(driverName) || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';

    const masterRow = {
      name: 'Yêu cầu đặt xe',
      request_type: 'Tp',
      priority: 'bt',
      is_important_guest: 'khong',
      passenger_count: Number.isFinite(passengerCount) ? passengerCount : 1,
      departure_time: departureTime,
      return_time: returnTime,
      departure_point: this.sanitizeString(rowData.departure_location) || 'Tân Cảng',
      destination: this.sanitizeString(rowData.destination) || 'Tân Cảng',
      contact_person: driverName || 'Thường trực',
      contact_phone: '0359999999',
      total_people: null,
      purpose: this.sanitizeString(rowData.purpose) || 'Đặt xe từ dữ liệu cũ',
      notes: this.sanitizeString(rowData.notes) || null,
      rejection_reason: null,
      status: 1,
      bpmn_version: 'QUY_TRINH_DANG_KY_XE',
      timezone: 'Asia/Ho_Chi_Minh',
      vehicle_state: 'HOAN_THANH',
      status_code: '2',
      request_submitted_at: this.parseDate(rowData.original_created) || new Date(),
      waiting_confirmed_at: this.parseDate(rowData.original_modified) || new Date(),
      created_at: this.parseDate(rowData.original_created) || new Date(),
      updated_at: this.parseDate(rowData.original_modified) || new Date(),
      created_by: createdById,
      department: null,
      trip_duration_minutes: tripDurationMinutes,
      driver_ids: JSON.stringify([fakeDriverId]),
      car_ids: JSON.stringify([carId]),
      coordination_information: JSON.stringify([{ carId, driverId: fakeDriverId }]),
      confirmed_driver_ids: JSON.stringify([fakeDriverId]),
      is_all_drivers_confirmed: 1,
      driver_notice_count: 0,
      leader_notice_count: 0,
      request_code: `REQ-${oldId}`,
      driver_notice_times: null,
      leader_notice_times: null,
      leader_escalated_at: null,
      id_sp_bak: oldId,
      source_db: this.oldDbName,
      table_bak: 1,
    };

    const masterResult = await this.upsertMaster(masterRow);
    const masterId = masterResult.id;
    if (!masterId) {
      throw new Error('Failed to insert or update master record');
    }

    await this.ensureDriverExists(fakeDriverId, 'Tài xế công ty');
    await this.upsertAssignment(masterId, carId, fakeDriverId, oldId);

    const durationMs = new Date(masterRow.return_time).getTime() - new Date(masterRow.departure_time).getTime();
    if (durationMs > 0) {
      await this.queryNewDb(`UPDATE ${this.getTargetTableRef(this.masterTable)} SET trip_duration_minutes = @duration WHERE id = @id`, {
        duration: Math.floor(durationMs / 60000),
        id: masterId,
      });
    }

    // Only create audit records on insert. Skip audit creation for existing bookings to avoid duplicates.
    if (masterResult.action === 'inserted') {
      await this._createAuditRecords(masterId, driverName, rowData);
    } else {
      logger.info(`[${this.modelName}] Skipping audit creation for existing registration ${masterId} (action=${masterResult.action}).`);
    }

    return { masterId, action: masterResult.action };
  }

  async upsertMaster(data) {
    const ref = this.getTargetTableRef(this.masterTable);
    const newId = uuidv4().toUpperCase();

    const query = `
      DECLARE @output TABLE (
        id uniqueidentifier,
        action nvarchar(20)
      );

      IF EXISTS (
        SELECT 1
        FROM ${ref}
        WHERE id_sp_bak = @id_sp_bak
          AND source_db = @source_db
      )
      BEGIN
        UPDATE ${ref}
        SET
          name = @name,
          request_type = @request_type,
          priority = @priority,
          is_important_guest = @is_important_guest,
          passenger_count = @passenger_count,
          departure_time = @departure_time,
          return_time = @return_time,
          departure_point = @departure_point,
          destination = @destination,
          contact_person = @contact_person,
          contact_phone = @contact_phone,
          total_people = @total_people,
          purpose = @purpose,
          notes = @notes,
          status = @status,
          bpmn_version = @bpmn_version,
          timezone = @timezone,
          vehicle_state = @vehicle_state,
          status_code = @status_code,
          request_submitted_at = @request_submitted_at,
          waiting_confirmed_at = @waiting_confirmed_at,
          updated_at = @updated_at,
          created_by = @created_by,
          department = @department,
          trip_duration_minutes = @trip_duration_minutes,
          driver_ids = @driver_ids,
          car_ids = @car_ids,
          coordination_information = @coordination_information,
          rejection_reason = @rejection_reason,
          confirmed_driver_ids = @confirmed_driver_ids,
          is_all_drivers_confirmed = @is_all_drivers_confirmed,
          driver_notice_count = @driver_notice_count,
          leader_notice_count = @leader_notice_count,
          request_code = @request_code,
          driver_notice_times = @driver_notice_times,
          leader_notice_times = @leader_notice_times,
          leader_escalated_at = @leader_escalated_at,
          table_bak = @table_bak
        OUTPUT
          INSERTED.id,
          'updated'
        INTO @output(id, action)
        WHERE id_sp_bak = @id_sp_bak
          AND source_db = @source_db;
      END
      ELSE
      BEGIN
        INSERT INTO ${ref} (
          id,
          name,
          request_type,
          priority,
          is_important_guest,
          passenger_count,
          departure_time,
          return_time,
          departure_point,
          destination,
          contact_person,
          contact_phone,
          total_people,
          purpose,
          notes,
          status,
          bpmn_version,
          timezone,
          vehicle_state,
          status_code,
          request_submitted_at,
          waiting_confirmed_at,
          created_at,
          updated_at,
          created_by,
          department,
          trip_duration_minutes,
          driver_ids,
          car_ids,
          coordination_information,
          rejection_reason,
          confirmed_driver_ids,
          is_all_drivers_confirmed,
          driver_notice_count,
          leader_notice_count,
          request_code,
          driver_notice_times,
          leader_notice_times,
          leader_escalated_at,
          id_sp_bak,
          source_db,
          table_bak
        )
        OUTPUT
          INSERTED.id,
          'inserted'
        INTO @output(id, action)
        VALUES (
          @id,
          @name,
          @request_type,
          @priority,
          @is_important_guest,
          @passenger_count,
          @departure_time,
          @return_time,
          @departure_point,
          @destination,
          @contact_person,
          @contact_phone,
          @total_people,
          @purpose,
          @notes,
          @status,
          @bpmn_version,
          @timezone,
          @vehicle_state,
          @status_code,
          @request_submitted_at,
          @waiting_confirmed_at,
          @created_at,
          @updated_at,
          @created_by,
          @department,
          @trip_duration_minutes,
          @driver_ids,
          @car_ids,
          @coordination_information,
          @rejection_reason,
          @confirmed_driver_ids,
          @is_all_drivers_confirmed,
          @driver_notice_count,
          @leader_notice_count,
          @request_code,
          @driver_notice_times,
          @leader_notice_times,
          @leader_escalated_at,
          @id_sp_bak,
          @source_db,
          @table_bak
        );
      END

      SELECT TOP 1 id, action
      FROM @output;
    `;

    const params = {
      rejection_reason: null,
      ...data,
      id: newId,
    };

    const result = await this.queryNewDb(query, params);
    console.log('Upsert master result:', result);
    return result?.[0] || {
      id: null,
      action: 'skipped',
    };
  }

  async ensureCarExists(id, label, carType) {
    const ref = this.getTargetTableRef(this.carTable);

    const exists = await this.queryNewDb(
      `SELECT TOP 1 id FROM ${ref} WHERE id = @id OR note = @label`,
      { id, label },
    );

    if (exists?.length) {
      return exists[0].id;
    }
    console.log(`Creating new car record for "${label}" with ID ${id}...`);

    const seatCount = this.getSeatCountFromCarName(label);

    const fakeLicensePlate = `51${String.fromCharCode(
      65 + Math.floor(Math.random() * 26),
    )}-${Math.floor(100 + Math.random() * 900)}.${Math.floor(
      10 + Math.random() * 90,
    )}`;

    const carTypeValue = this.sanitizeString(carType) || label;

    await this.queryNewDb(
      `
        INSERT INTO ${ref} (
          id,
          license_plate,
          car_type,
          brand,
          seat_count,
          manager,
          status_car,
          status,
          note,
          created_at,
          updated_at,
          maintenance,
          total_trips,
          booking_available
        ) VALUES (
          @id,
          @license_plate,
          @car_type,
          @brand,
          @seat_count,
          @manager,
          N'SAN_SANG',
          1,
          @note,
          GETDATE(),
          GETDATE(),
          'khong',
          0,
          1
        );
      `,
      {
        id,
        license_plate: fakeLicensePlate,
        car_type: carTypeValue,
        brand: 'Xe công ty',
        seat_count: seatCount,
        manager: '33084655-3a53-4dfd-b841-b8de26a3f8b7',
        note: label || null,
      },
    );

    return id;
  }

  async ensureDriverExists(id, label) {
    const ref = this.getTargetTableRef(this.driverTable);
    const exists = await this.queryNewDb(`SELECT TOP 1 id FROM ${ref} WHERE id = @id OR full_name = @label`, { id, label });
    const driverId = exists?.[0]?.id || id;
    await this.ensureDriverUserExists(driverId, label || 'Tài xế công ty');
    if (exists?.length) return exists[0].id;

    await this.queryNewDb(`
      INSERT INTO ${ref} (
        id, full_name, phone_number, id_card, email, address,
        license_number, license_class, license_issued_date,
        note, status, created_at, updated_at,
        driverId, total_trips, experience_years, booking_available
      ) VALUES (
        @id, @label, '0359999999', '090967555257', 'taixecongty@gmail.com', 'Địa chỉ công ty',
        '7789444667', N'B2', GETDATE(),
        NULL, 1, GETDATE(), GETDATE(),
        @id, 0, 0, 1
      );
    `, {
      id,
      label,
    });
    return id;
  }

  async ensureDriverUserExists(id, displayName) {
    if (!id) return null;

    const userRef = this.getTargetTableRef('users');
    const existingUser = await this.queryNewDb(`SELECT TOP 1 id FROM ${userRef} WHERE id = @id`, { id });
    if (existingUser?.length) {
      return existingUser[0].id;
    }

    const username = 'taixecongty';
    const codeNd = 'taixecongty';
    const name = this.sanitizeString(displayName) || 'Tài xế công ty';
    const password = process.env.DEFAULT_USER_PASSWORD || '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa';
    const roles = (process.env.ROLES_DEFAULT && process.env.ROLES_DEFAULT.trim()) ? process.env.ROLES_DEFAULT : '[]';

    await this.helper.ensureUsersTbBakColumnExists();
    await this.queryNewDb(`
      INSERT INTO ${userRef} (
        id, username, code_nd, name, password, avatar, roles_by_process,
        status, created_at, updated_at, tb_bak
      ) VALUES (
        @id, @username, @code_nd, @name, @password, '[]', @roles,
        1, GETDATE(), GETDATE(), 1
      );
    `, {
      id,
      username,
      code_nd: codeNd,
      name,
      password,
      roles,
    });

    logger.info(`[${this.modelName}] Created fallback user record for driver ${id} (${name}).`);
    return id;
  }

  async upsertAssignment(registrationId, carId, driverId, oldId) {
    const ref = this.getTargetTableRef(this.detailTable);
    const query = `
      IF EXISTS (SELECT 1 FROM ${ref} WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id AND source_db = @source_db)
      BEGIN
        UPDATE ${ref}
        SET is_confirmed = @is_confirmed,
            confirmed_at = @confirmed_at,
            table_bak = @table_bak
        WHERE registration_id = @registration_id AND car_id = @car_id AND driver_id = @driver_id AND source_db = @source_db;
      END
      ELSE
      BEGIN
        INSERT INTO ${ref} (
          id, registration_id, car_id, driver_id, is_confirmed, confirmed_at,
          created_at, id_sp_bak, source_db, table_bak
        ) VALUES (
          @id, @registration_id, @car_id, @driver_id, @is_confirmed, @confirmed_at,
          GETDATE(), @id_sp_bak, @source_db, @table_bak
        );
      END
    `;

    return this.queryNewDb(query, {
      id: uuidv4().toUpperCase(),
      registration_id: registrationId,
      car_id: carId,
      driver_id: driverId,
      is_confirmed: 1,
      confirmed_at: new Date(),
      id_sp_bak: oldId,
      source_db: this.oldDbName,
      table_bak: 1,
    });
  }

  async _createAuditRecord(registrationId, driverName, rowData) {
    return this._createAuditRecords(registrationId, driverName, rowData);
  }

  async _createAuditRecords(registrationId, driverName, rowData, auditEntries = null) {
    try {
      const mappedUserId = await this.helper.mapUserName(driverName) || 'b23406e3-5c75-41d3-91e0-1654293ae6b2';
      const now = new Date();
      const entries = auditEntries || this._getDefaultAuditEntries(registrationId, mappedUserId, rowData, now);

      const auditQuery = `
        INSERT INTO [DiOffice].[dbo].[audit] (
          [document_id],
          [time],
          [user_id],
          [display_name],
          [role],
          [action_code],
          [from_node_id],
          [to_node_id],
          [details],
          [origin_id],
          [created_by],
          [receiver],
          [receiver_unit],
          [group_],
          [roleProcess],
          [action],
          [deadline],
          [stage_status],
          [curStatusCode],
          [created_at],
          [updated_at],
          [type_document],
          [processed_by],
          [acting_as]
        )
        VALUES (
          @document_id,
          @time,
          @user_id,
          @display_name,
          @role,
          @action_code,
          @from_node_id,
          @to_node_id,
          @details,
          @origin_id,
          @created_by,
          @receiver,
          @receiver_unit,
          @group_,
          @roleProcess,
          @action,
          @deadline,
          @stage_status,
          @curStatusCode,
          @created_at,
          @updated_at,
          @type_document,
          @processed_by,
          @acting_as
        );
      `;

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const params = {
          document_id: registrationId,
          time: now,
          receiver_unit: null,
          group_: null,
          roleProcess: 'processor',
          deadline: null,
          stage_status: 'DA_XU_LY',
          created_at: now,
          updated_at: now,
          type_document: 'VEHICLE_REGISTRATION',
          processed_by: null,
          acting_as: null,
          ...entry,
        };

        await this.queryNewDb(auditQuery, params);
        logger.info(`[${this.modelName}] Created audit record ${index + 1}/${entries.length} for registration ${registrationId}`);
      }
    } catch (error) {
      logger.warn(`[${this.modelName}] Failed to create audit records for registration ${registrationId}: ${error.message}`);
      // Don't throw - audit creation is non-critical, don't block main sync
    }
  }

  _getDefaultAuditEntries(registrationId, mappedUserId, rowData, now) {
    return [
      {
        user_id: mappedUserId,
        display_name: 'Phòng hậu cần, đội xe',
        role: 'NGUOI_DANG_KY_XE',
        action_code: 'TAO_VA_GUI_YEU_CAU_DANG_KY_XE',
        from_node_id: 'Activity_00hcfcm',
        to_node_id: 'Gateway_1ilkpo8',
        details: '"Tạo mới yêu cầu đăng ký xe"',
        origin_id: 'preview',
        created_by: mappedUserId,
        receiver: 'PHONG_DOI_HAU_CAN_NGUOI_DIEU_PHOI',
        action: 'Tạo mới yêu cầu đăng ký xe',
        curStatusCode: '2',
      },
      {
        user_id: mappedUserId,
        display_name: 'Điều phối xe và tài xế ',
        role: 'PHONG_HAU_CAN_DOI_XE',
        action_code: 'DIEU_PHOI_XE_PHONG_HAU_CAN',
        from_node_id: 'Gateway_1ilkpo8',
        to_node_id: 'Gateway_1ilkpo8',
        details: '"Đã điều phối"',
        origin_id: 'wi_1773646760098_vd1cl9',
        created_by: mappedUserId,
        receiver: 'TAI_XE_TIEP_NHAN',
        action: 'Điều phối xe và tài xế',
        curStatusCode: '2',
      },
      {
        user_id: '33084655-3a53-4dfd-b841-b8de26a3f8b7', // fake driver ID
        display_name: 'Tài xế tiếp nhận phân công',
        role: 'TAI_XE_XE',
        action_code: 'TAI_XE_XAC_NHAN_YEU_CAU',
        from_node_id: 'Activity_0k060ta',
        to_node_id: 'Event_1ffnh4z',
        details: '"Tài xế tiếp nhận phân công"',
        origin_id: 'wi_1773652031631_ja5qh1',
        created_by: 'Hệ thống',
        receiver: 'Hệ thống',
        action: 'Tài xế tiếp nhận phân công',
        curStatusCode: null,
      },
      {
        user_id: 'Hệ thống',
        display_name: 'Khởi hành chuyến đi',
        role: null,
        action_code: 'Khởi hành chuyến đi',
        from_node_id: null,
        to_node_id: null,
        details: '"Khởi hành chuyến đi"',
        origin_id: null,
        created_by: 'Hệ thống',
        receiver: 'Hệ thống',
        action: 'Khởi hành chuyến đi',
        curStatusCode: null,
      },
      {
        user_id: mappedUserId,
        display_name: 'Hoàn thành yêu cầu đăng ký xe',
        role: 'NGUOI_DANG_KY_XE',
        action_code: 'Flow_073md5u',
        from_node_id: 'Event_1r02jyy',
        to_node_id: 'Event_1r02jyy',
        details: '"Hoàn thành yêu cầu đăng ký xe"',
        origin_id: 'wi_1774799220659_gbs11m',
        created_by: mappedUserId,
        receiver: mappedUserId,
        action: 'Hoàn thành chuyến đi',
        curStatusCode: null,
      },
    ];
  }
}

module.exports = StreamCarMigrationModel;
