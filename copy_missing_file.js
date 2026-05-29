const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'src/sync-meeting copy/migrate/required_process_roles.json');
const dest = path.join(__dirname, 'src/meeting-sync2/required_process_roles.json');

try {
  fs.copyFileSync(src, dest);
  console.log('✅ Đã copy thành công required_process_roles.json sang meeting-sync2!');
} catch (e) {
  console.error('❌ Lỗi khi copy:', e.message);
}
