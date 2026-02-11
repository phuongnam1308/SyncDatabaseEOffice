const db = require('../utils/dbAdapter');
const logger = require('../utils/logger');

class FileRelations2ToMainModel {
  async migrateAll() {
    const sql = `
      INSERT INTO camunda.dbo.file_relations (
        object_type,
        object_id,
        file_id,
        created_at,
        status,
        object_id_bak,
        file_id_bak,
        file_id_bak2,
        table_bak,
        type_doc
      )
      SELECT
        LEFT(object_type, 50),
        LEFT(object_id, 50),
        TRY_CAST(file_id AS bigint),
        TRY_CAST(created_at AS datetime),
        TRY_CAST(status AS int),
        LEFT(object_id_bak, 50),
        LEFT(file_id_bak, 50),
        LEFT(file_id_bak2, 50),
        LEFT(table_bak, 50),
        LEFT(type_doc, 50)
      FROM camunda.dbo.file_relations2
    `;

    logger.info('[FileRelations2ToMainModel] migrateAll');
    const rs = await db.query(sql);
    return rs?.rowsAffected?.[0] || 0;
  }

  async countSource() {
    const rs = await db.query(
      'SELECT COUNT(*) AS total FROM camunda.dbo.file_relations2'
    );
    return rs.recordset[0].total;
  }

  async countTarget() {
    const rs = await db.query(
      'SELECT COUNT(*) AS total FROM camunda.dbo.file_relations'
    );
    return rs.recordset[0].total;
  }
}

module.exports = FileRelations2ToMainModel;
