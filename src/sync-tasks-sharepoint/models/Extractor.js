const axios = require('axios');
const logger = require('../../../utils/logger');
const { downloadFile } = require('../../sync-file-copy/SharePointAuthService');

class Extractor {
  constructor() {
    this.modelName = 'SHAREPOINT_TASK_EXTRACTOR';
    this.listId = process.env.SHAREPOINT_TASK_LIST_ID || 'FEC511D8-E617-41C0-9C63-EAD5CB201F8A';
    this.siteUrl = process.env.SHAREPOINT_SITE_URL || 'https://eoffice.saigonnewport.com.vn/congviec';
    this.newPool = null;
  }

  async initialize(newPool) {
    this.newPool = newPool;
    await this.ensureStagingTableExists();
  }

  async ensureStagingTableExists() {
    const table = `task_sharepoint_sync`;
    const query = `
      IF OBJECT_ID('${table}', 'U') IS NULL
      BEGIN
        CREATE TABLE ${table} (
          ID                     NVARCHAR(255)   NOT NULL,
          Title                  NVARCHAR(MAX)   NULL,
          Body                   NVARCHAR(MAX)   NULL,
          Priority               NVARCHAR(100)   NULL,
          PercentComplete        FLOAT           NULL,
          StartDate              DATETIME2       NULL,
          DueDate                DATETIME2       NULL,
          DateCompleted          DATETIME2       NULL,
          nStatus                NVARCHAR(255)   NULL,
          AuthorId               INT             NULL,
          AuthorName             NVARCHAR(255)   NULL,
          EditorId               INT             NULL,
          EditorName             NVARCHAR(255)   NULL,
          Created                DATETIME2       NULL,
          Modified               DATETIME2       NULL,
          AssignedToId           NVARCHAR(MAX)   NULL, -- JSON array of IDs
          AssignedToNames        NVARCHAR(MAX)   NULL, -- JSON array of Names
          TheoDoiCongViecId      NVARCHAR(MAX)   NULL, -- JSON array of IDs
          TheoDoiCongViecNames   NVARCHAR(MAX)   NULL, -- JSON array of Names
          GUID                   UNIQUEIDENTIFIER NULL,
          
          MigrateFlg             INT             DEFAULT 0,
          MigrateErrFlg          INT             DEFAULT 0,
          MigrateErrMess         NVARCHAR(MAX)   NULL,
          processing_owner       NVARCHAR(255)   NULL,
          processing_started_at  DATETIME2       NULL,
          processing_heartbeat_at DATETIME2      NULL,
          
          CONSTRAINT PK_task_sharepoint_sync PRIMARY KEY (ID)
        );
      END
    `;
    await this.newPool.request().query(query);
    logger.info(`[${this.modelName}] Staging table task_sharepoint_sync ensured`);
  }

  async runExtract() {
    let totalExtracted = 0;
    // Thêm $expand và $select để lấy tên người dùng (Title) thay vì chỉ lấy ID
    const expandFields = 'Author,Editor,AssignedTo,TheoDoiCongViec';
    const selectFields = '*,Author/Title,Editor/Title,AssignedTo/Title,TheoDoiCongViec/Title';
    let nextUrl = `${this.siteUrl}/_api/web/lists(guid'${this.listId}')/items?$format=json&$top=500&$expand=${expandFields}&$select=${selectFields}`;

    logger.info(`[${this.modelName}] Starting extraction from SharePoint API (with User Expansion)...`);

    while (nextUrl) {
      try {
        const responseBuffer = await downloadFile(nextUrl, this.newPool);
        const data = JSON.parse(responseBuffer.toString());
        
        const items = data.d?.results || data.value || [];
        if (items.length === 0) break;

        await this.syncBatchToStaging(items);
        totalExtracted += items.length;

        nextUrl = data.d?.__next || data['odata.nextLink'] || null;
        logger.info(`[${this.modelName}] Extracted ${items.length} items. Total: ${totalExtracted}`);
        
        // // LIMIT FOR TESTING: Stop after 500 items
        // if (totalExtracted >= 500) {
        //   logger.info(`[${this.modelName}] Reached testing limit of 500. Stopping extraction.`);
        //   break;
        // }
      } catch (err) {
        logger.error(`[${this.modelName}] Extraction failed at URL ${nextUrl}: ${err.message}`);
        throw err;
      }
    }

    return { extractedCount: totalExtracted };
  }

  async syncBatchToStaging(items) {
    const table = `task_sharepoint_sync`;
    
    for (const item of items) {
      const id = String(item.ID || item.Id);
      
      const params = {
        ID: id,
        Title: item.Title || null,
        Body: item.Body || null,
        Priority: item.Priority || null,
        PercentComplete: item.PercentComplete || 0,
        StartDate: item.StartDate ? new Date(item.StartDate) : null,
        DueDate: item.DueDate ? new Date(item.DueDate) : null,
        DateCompleted: item.DateCompleted ? new Date(item.DateCompleted) : null,
        nStatus: item.nStatus || null,
        AuthorId: item.AuthorId || null,
        AuthorName: item.Author?.Title || null,
        EditorId: item.EditorId || null,
        EditorName: item.Editor?.Title || null,
        Created: item.Created ? new Date(item.Created) : null,
        Modified: item.Modified ? new Date(item.Modified) : null,
        AssignedToId: item.AssignedToId ? (item.AssignedToId.results ? JSON.stringify(item.AssignedToId.results) : JSON.stringify([item.AssignedToId])) : null,
        AssignedToNames: (item.AssignedTo && item.AssignedTo.results) ? JSON.stringify(item.AssignedTo.results.map(u => u.Title)) : (item.AssignedTo && item.AssignedTo.Title ? JSON.stringify([item.AssignedTo.Title]) : null),
        TheoDoiCongViecId: item.TheoDoiCongViecId ? (item.TheoDoiCongViecId.results ? JSON.stringify(item.TheoDoiCongViecId.results) : JSON.stringify([item.TheoDoiCongViecId])) : null,
        TheoDoiCongViecNames: (item.TheoDoiCongViec && item.TheoDoiCongViec.results) ? JSON.stringify(item.TheoDoiCongViec.results.map(u => u.Title)) : (item.TheoDoiCongViec && item.TheoDoiCongViec.Title ? JSON.stringify([item.TheoDoiCongViec.Title]) : null),
        GUID: item.GUID || null
      };

      const query = `
        IF EXISTS (SELECT 1 FROM ${table} WHERE ID = @ID)
        BEGIN
          UPDATE ${table} SET
            Title = @Title,
            Body = @Body,
            Priority = @Priority,
            PercentComplete = @PercentComplete,
            StartDate = @StartDate,
            DueDate = @DueDate,
            DateCompleted = @DateCompleted,
            nStatus = @nStatus,
            AuthorId = @AuthorId,
            AuthorName = @AuthorName,
            EditorId = @EditorId,
            EditorName = @EditorName,
            Created = @Created,
            Modified = @Modified,
            AssignedToId = @AssignedToId,
            AssignedToNames = @AssignedToNames,
            TheoDoiCongViecId = @TheoDoiCongViecId,
            TheoDoiCongViecNames = @TheoDoiCongViecNames,
            GUID = @GUID,
            MigrateFlg = CASE WHEN Modified > @Modified THEN MigrateFlg ELSE 0 END -- Reset if changed
          WHERE ID = @ID;
        END
        ELSE
        BEGIN
          INSERT INTO ${table} (
            ID, Title, Body, Priority, PercentComplete, StartDate, DueDate, 
            DateCompleted, nStatus, AuthorId, AuthorName, EditorId, EditorName, 
            Created, Modified, AssignedToId, AssignedToNames, 
            TheoDoiCongViecId, TheoDoiCongViecNames, GUID
          ) VALUES (
            @ID, @Title, @Body, @Priority, @PercentComplete, @StartDate, @DueDate,
            @DateCompleted, @nStatus, @AuthorId, @AuthorName, @EditorId, @EditorName,
            @Created, @Modified, @AssignedToId, @AssignedToNames,
            @TheoDoiCongViecId, @TheoDoiCongViecNames, @GUID
          );
        END
      `;

      const request = this.newPool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      await request.query(query);
    }
  }
}

module.exports = Extractor;
