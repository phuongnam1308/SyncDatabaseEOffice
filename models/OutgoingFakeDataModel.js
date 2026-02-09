const BaseModel = require('./BaseModel');

class OutgoingFakeDataModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Fake toàn bộ outgoing_documents bằng 1 câu UPDATE
   */
  async fakeAllOnce({ senderUnit, drafter }) {
    const query = `
      DECLARE @start DATETIME = GETDATE();

      UPDATE DiOffice.dbo.outgoing_documents
      SET
        sender_unit = @senderUnit,
        drafter = @drafter,
        status_code = CASE
          WHEN status_code = 100 THEN 1
          ELSE status_code
        END
      WHERE table_backup = 'outgoing_documents2';

      SELECT
        @@ROWCOUNT AS affected,
        DATEDIFF(SECOND, @start, GETDATE()) AS duration_seconds;
    `;

    const result = await this.queryNewDb(query, {
      senderUnit,
      drafter
    });

    return result[0];
  }
}

module.exports = OutgoingFakeDataModel;
