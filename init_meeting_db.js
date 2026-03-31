require('dotenv').config({ path: '.env copy 2' });
const StreamMeetingMigrationModel = require('./src/sync-meeting copy/migrate/StreamMeetingMigrationModel');

async function main() {
  const model = new StreamMeetingMigrationModel();
  try {
    console.log('--- ĐANG KHỞI TẠO DATABASE CHO MEETING COPY ---');
    await model.initialize();
    console.log('--- KHỞI TẠO THÀNH CÔNG ---');
  } catch (error) {
    console.error('--- LỖI KHỞI TẠO: ---', error);
  } finally {
    process.exit();
  }
}

main();
