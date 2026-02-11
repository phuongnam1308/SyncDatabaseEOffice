const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const {
  documentCommentsMigration
} = require('../config/documentCommentsMigration.config');

class DocumentCommentsMigrationModel extends BaseModel {
  constructor() {
    super();
    this.cfg = documentCommentsMigration;
  }

  async getAllSource() {
    const { source, mapping } = this.cfg;

    const sourceFields = Object.values(mapping).join(', ');

    const query = `
      SELECT ${sourceFields}
      FROM ${source.database}.${source.schema}.${source.table}
      ORDER BY ID
    `;
    return await this.queryOldDb(query);
  }

  async existsByBackupId(idBak) {
    const { target } = this.cfg;

    const query = `
      SELECT id, document_id, id_comments_bak
      FROM ${target.database}.${target.schema}.${target.table}
      WHERE id_comments_bak = @idBak
    `;
    const res = await this.queryNewDb(query, { idBak });
    return res.length > 0 ? res[0] : null;
  }

  async updateDocumentId(idBak, documentId) {
    const { target } = this.cfg;

    const query = `
      UPDATE ${target.database}.${target.schema}.${target.table}
      SET document_id = @documentId,
          updated_at = GETDATE()
      WHERE id_comments_bak = @idBak
    `;
    
    await this.queryNewDb(query, { idBak, documentId });
  }

  async insert(record) {
    const { target } = this.cfg;

    const fields = Object.keys(record);
    const params = fields.map((_, i) => `@p${i}`).join(', ');

    const query = `
      INSERT INTO ${target.database}.${target.schema}.${target.table}
      (${fields.join(', ')})
      VALUES (${params})
    `;

    const request = this.newPool.request();
    fields.forEach((f, i) => request.input(`p${i}`, record[f]));
    await request.query(query);
  }
}

module.exports = DocumentCommentsMigrationModel;
