const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');

class SyncFileModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "file_documents_sync";
    this.mainSchema = "dbo";
    this.mainTable = "file_documents";
  }

  async getStatus() {
    try {
      const countSyncQuery = `
        SELECT COUNT(*) AS total
        FROM DiOffice.${this.syncSchema}.${this.syncTable}
      `;
      const syncResult = await this.queryNewDbTx(countSyncQuery);
      const totalInSync = syncResult[0]?.total || 0;

      const countMainQuery = `
        SELECT COUNT(*) AS total
        FROM DiOffice.${this.mainSchema}.${this.mainTable}
      `;
      const mainResult = await this.queryNewDbTx(countMainQuery);
      const totalInMain = mainResult[0]?.total || 0;

      return {
        totalInSync,
        totalInMain,
        remaining: totalInSync - totalInMain,
      };
    } catch (error) {
      logger.error("[SyncFileModel.getStatus] Error:", error);
      throw error;
    }
  }
}

module.exports = SyncFileModel;
