const BaseModel = require('./src/models/BaseModel');

async function checkSchema() {
  const model = new BaseModel();
  try {
    await model.initialize();
    const query = `
      SELECT 
        TABLE_NAME, 
        COLUMN_NAME, 
        DATA_TYPE, 
        NUMERIC_PRECISION, 
        NUMERIC_SCALE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME IN ('sync_models', 'sync_jobs')
    `;
    const rows = await model.queryNewDb(query);
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Error checking schema:', err);
  } finally {
    if (model.newPool) await model.newPool.close();
    process.exit(0);
  }
}

checkSchema();
