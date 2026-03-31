const StreamTgdScheduleMigrationModel = require('./src/sync-tgd-schedule/migrate/StreamTgdScheduleMigrationModel');
const dbConnection = require('./db/connection');

async function test() {
    console.log('Testing StreamTgdScheduleMigrationModel initialization...');
    try {
        console.log('Connecting to databases...');
        await dbConnection.connectAll();
        console.log('Databases connected.');

        const model = new StreamTgdScheduleMigrationModel();
        console.log('Constructor OK');
        
        await model.initialize();
        console.log('Initialization complete successfully!');
    } catch (err) {
        console.error('Initialization failed:', err);
    } finally {
        await dbConnection.closeAll();
        process.exit();
    }
}

test();
