const dbConnection = require('./db/connection');
const logger = require('./utils/logger');

async function findReferences() {
  const oldId = '78e863d4-71f1-40b3-8283-a5ee14e12e65';
  
  try {
    await dbConnection.connectAll();
    const newPool = dbConnection.getNewPool();
    if (!newPool) {
      console.error('Cannot connect to new database pool.');
      process.exit(1);
    }

    console.log(`Searching for references to: ${oldId} in all tables...`);

    // Get all tables and columns of type uniqueidentifier, varchar, nvarchar
    const query = `
      SELECT t.name AS TableName, c.name AS ColumnName, y.name AS DataType
      FROM sys.tables t
      INNER JOIN sys.columns c ON t.object_id = c.object_id
      INNER JOIN sys.types y ON c.user_type_id = y.user_type_id
      WHERE t.is_ms_shipped = 0
        AND y.name IN ('uniqueidentifier', 'varchar', 'nvarchar', 'char', 'nchar')
      ORDER BY TableName, ColumnName
    `;

    const result = await newPool.request().query(query);
    const columns = result.recordset;

    console.log(`Found ${columns.length} columns to search.`);

    const foundReferences = [];

    for (const col of columns) {
      const { TableName, ColumnName } = col;
      
      try {
        const countQuery = `
          SELECT COUNT(1) as cnt 
          FROM [dbo].[${TableName}] 
          WHERE CAST([${ColumnName}] AS NVARCHAR(250)) = @oldId
        `;
        
        const countRes = await newPool.request()
          .input('oldId', oldId)
          .query(countQuery);
        
        const count = countRes.recordset[0].cnt;
        if (count > 0) {
          console.log(`Match found: Table [${TableName}], Column [${ColumnName}] has ${count} matching records.`);
          foundReferences.push({ TableName, ColumnName, count });
        }
      } catch (err) {
        // Some columns or queries might fail if they are computed columns or special types, ignore them
      }
    }

    console.log('\n--- SEARCH RESULTS ---');
    if (foundReferences.length === 0) {
      console.log('No references found.');
    } else {
      console.log(JSON.stringify(foundReferences, null, 2));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error finding references:', err);
    process.exit(1);
  }
}

findReferences();
