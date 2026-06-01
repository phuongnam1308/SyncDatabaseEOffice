const fs = require('fs');
const path = require('path');

const srcModel = path.join(__dirname, 'src/sync-meeting copy/migrate/StreamMeetingMigrationModel.js');
const destModel = path.join(__dirname, 'src/meeting-sync2/models/StreamMeetingSync2Model.js');

try {
  let content = fs.readFileSync(srcModel, 'utf8');
  
  // Clone logic and change class name
  content = content.replace(/StreamMeetingMigrationModel/g, 'StreamMeetingSync2Model');
  content = content.replace(/STREAM_MEETING_COPY_MIGRATION/g, 'STREAM_MEETING_SYNC2');
  
  // Update imports so it points to the files we copied into meeting-sync2
  content = content.replace(/require\('\.\/config'\)/g, "require('../config')");
  content = content.replace(/require\('\.\/mapping\.json'\)/g, "require('../mapping.json')");
  content = content.replace(/require\('\.\/required_process_roles\.json'\)/g, "require('../required_process_roles.json')");
  
  fs.writeFileSync(destModel, content);
  
  console.log('✅ Đã clone thành công logic của StreamMeetingMigrationModel sang StreamMeetingSync2Model!');
} catch (e) {
  console.error('❌ Lỗi khi clone:', e.message);
}
