// config/mappingOU.js

function extractUnitNames(raw) {
  if (!raw || typeof raw !== 'string') return [];

  return raw
    .split('#')
    .map(x => x.replace(/^\d+;?/, '').trim())
    .filter(x => x.length > 0);
}

async function mapDonViToGuidArray(donVi, mssqlPool, logger = console) {
  if (!donVi || typeof donVi !== 'string') return null;

  const unitNames = extractUnitNames(donVi);
  if (!unitNames.length) return null;

  try {
    const request = mssqlPool.request();
    const conditions = [];

    unitNames.forEach((name, i) => {
      const key = `name${i}`;
      request.input(key, `%${name}%`);
      conditions.push(`ou.name LIKE @${key}`);
    });

    const sql = `
      SELECT DISTINCT CAST(ou.id AS NVARCHAR(36)) AS id
      FROM organization_units ou
      WHERE ${conditions.join(' OR ')}
    `;

    const { recordset } = await request.query(sql);

    if (!recordset || recordset.length === 0) {
      logger.warn(`[mappingOU] Không tìm thấy mapping cho: ${donVi}`);
      return null;
    }

    const ids = recordset.map(r => r.id);
    return JSON.stringify(ids);

  } catch (err) {
    logger.error(`[mappingOU] Lỗi mapping DonVi "${donVi}"`, err);
    return null;
  }
}

module.exports = { mapDonViToGuidArray };
