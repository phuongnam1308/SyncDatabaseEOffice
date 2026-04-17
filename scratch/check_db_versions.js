const dbConnection = require('./db/connection');
const logger = require('./utils/logger');

async function checkVersions() {
  try {
    await dbConnection.connectAll();
    const oldPool = dbConnection.getOldPool();
    const newPool = dbConnection.getNewPool();

    if (oldPool) {
      const oldRes = await oldPool.request().query('SELECT @@VERSION as version');
      console.log('OLD DB VERSION:', oldRes.recordset[0].version);
    } else {
      console.log('OLD DB NOT CONNECTED');
    }

    if (newPool) {
      const newRes = await newPool.request().query('SELECT @@VERSION as version');
      console.log('NEW DB VERSION:', newRes.recordset[0].version);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkVersions();
