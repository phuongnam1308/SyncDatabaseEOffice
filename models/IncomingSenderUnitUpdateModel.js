const BaseModel = require('./BaseModel');

class IncomingSenderUnitUpdateModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Update sender_unit theo CoQuanGui2
   */
  async updateSenderUnit() {
    const query = `
      UPDATE i
      SET i.sender_unit = ou.id
      FROM camunda.dbo.incomming_documents2 i
      CROSS APPLY (
          SELECT TOP 1 ou.id
          FROM camunda.dbo.organization_units ou
          WHERE ou.status = 1
            AND (
                 ou.Id_backups = LEFT(i.CoQuanGui2, CHARINDEX(';#', i.CoQuanGui2) - 1)
              OR (
                   ou.name LIKE '%' +
                   LTRIM(RTRIM(SUBSTRING(
                     i.CoQuanGui2,
                     CHARINDEX(';#', i.CoQuanGui2) + 2,
                     LEN(i.CoQuanGui2)
                   ))) + '%'
              )
            )
          ORDER BY
            CASE
              WHEN ou.Id_backups = LEFT(i.CoQuanGui2, CHARINDEX(';#', i.CoQuanGui2) - 1)
              THEN 1 ELSE 2
            END,
            LEN(ou.name) DESC
      ) ou
      WHERE i.sender_unit IS NULL
        AND i.CoQuanGui2 LIKE '%;#%';
    `;

    const result = await this.newPool.request().query(query);
    return result.rowsAffected[0];
  }

  /**
   * Thống kê nhanh
   */
  async statistic() {
    const query = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sender_unit IS NULL THEN 1 ELSE 0 END) AS notUpdated
      FROM camunda.dbo.incomming_documents2
      WHERE CoQuanGui2 LIKE '%;#%';
    `;

    const result = await this.newPool.request().query(query);
    return result.recordset[0];
  }
}

module.exports = IncomingSenderUnitUpdateModel;
