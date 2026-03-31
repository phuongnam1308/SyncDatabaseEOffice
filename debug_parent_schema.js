// Temporary script to investigate parent table schema
const TgdModel = require('./src/sync-tgd-schedule/migrate/StreamTgdScheduleMigrationModel');

async function checkSchema() {
    const model = new TgdModel();
    await model.initialize();
    
    try {
        const columns = await model.queryNewDb(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM DiOffice.INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'leadership_duty_schedules'
        `);
        console.log('Columns for leadership_duty_schedules:', JSON.stringify(columns, null, 2));
    } catch (err) {
        console.error('Error checking schema:', err.message);
    }
}

checkSchema();
