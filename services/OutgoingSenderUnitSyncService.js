class OutgoingSenderUnitSyncService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Tách chuỗi "25;#Phòng ABC;#26;#Văn phòng"
   * => ["Phòng ABC", "Văn phòng"]
   */
  extractUnitNames(raw) {
    if (!raw || typeof raw !== 'string') return [];

    return raw
      .split(';#')
      .map(x => x.trim())
      .filter(x => x && isNaN(Number(x)));
  }

  /**
   * Từ mảng tên đơn vị -> lấy mảng ID organization_units
   * DÙNG LIKE, KHÔNG SP
   */
  async findOrganizationIdsByNames(names = []) {
    if (!names.length) return [];

    const request = this.db.request();
    const conditions = [];

    names.forEach((name, i) => {
      const key = `name${i}`;
      request.input(key, name);
      conditions.push(`
        ou.name LIKE '%' + @${key} + '%'
        OR @${key} LIKE '%' + ou.name + '%'
      `);
    });

    const sql = `
      SELECT DISTINCT TOP 100 PERCENT ou.id
      FROM organization_units ou
      WHERE ${conditions.join(' OR ')}
      ORDER BY LEN(ou.name) DESC
    `;

    const result = await request.query(sql);
    return result.recordset.map(r => r.id);
  }

  /**
   * Hàm public để mapping
   */
  async mappingOU(rawDonVi) {
    try {
      const unitNames = this.extractUnitNames(rawDonVi);

      if (!unitNames.length) {
        return { success: true, data: [] };
      }

      const orgIds = await this.findOrganizationIdsByNames(unitNames);

      return {
        success: true,
        data: orgIds
      };
    } catch (err) {
      console.error('[mappingOU] ERROR', err);
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = OutgoingSenderUnitSyncService;
