const BaseModel = require('./BaseModel');

class Audit2SyncTypeDocumentModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'audit2';
  }

  async updateIncoming() {
    const query = `
      UPDATE ${this.schema}.${this.table}
      SET type_document = 'IncomingDocument'
      WHERE type_document IS NULL
        AND Category IS NOT NULL
        AND (
          Category LIKE N'%Văn bản đến%'
          OR Category LIKE N'%VBDEN%'
        );

      SELECT @@ROWCOUNT AS affected;
    `;
    const rs = await this.queryNewDb(query);
    return rs?.[0]?.affected || 0;
  }

  async updateOutgoing() {
    const query = `
      UPDATE ${this.schema}.${this.table}
      SET type_document = 'OutgoingDocument'
      WHERE type_document IS NULL
        AND Category IS NOT NULL
        AND (
          Category LIKE N'%Phát hành%'
          OR Category LIKE N'%ban hành%'
          OR Category LIKE N'%VBPH%'
        );

      SELECT @@ROWCOUNT AS affected;
    `;
    const rs = await this.queryNewDb(query);
    return rs?.[0]?.affected || 0;
  }
}

module.exports = Audit2SyncTypeDocumentModel;
