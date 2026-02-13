const BaseModel = require('./BaseModel');

class IncomingStatusCodeUpdateModel extends BaseModel {
  constructor() {
    super();
  }

  /**
   * Thực hiện update status_code theo TrangThai
   * CHỈ update khi status_code = 100
   */
  async updateStatusCodeByTrangThai() {
    const query = `
      UPDATE DiOffice.dbo.incomming_documents2
      SET status_code = CASE
        WHEN TrangThai LIKE N'%Trình Chỉ huy%' THEN 10
        WHEN TrangThai LIKE N'%Chuyển văn thư%' THEN 6
        WHEN TrangThai LIKE N'%Trình Lãnh đạo TCT%' THEN 7
        WHEN TrangThai LIKE N'%Trình Chỉ huy VP%' THEN 2
        ELSE status_code
      END
      WHERE status_code = 100
    `;

    const result = await this.newPool.request().query(query);
    return result.rowsAffected[0];
  }

  /**
   * Thống kê số lượng theo status_code
   */
  async statisticStatusCode() {
    const query = `
      SELECT status_code, COUNT(*) AS total
      FROM DiOffice.dbo.incomming_documents2
      GROUP BY status_code
      ORDER BY status_code
    `;

    const result = await this.newPool.request().query(query);
    return result.recordset;
  }
}

module.exports = IncomingStatusCodeUpdateModel;
