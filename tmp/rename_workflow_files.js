const fs = require('fs');
const path = require('path');

const map = {
  'gi_m___c.js': 'giam_doc.js',
  'ch_nh_v_n_ph_ng.js': 'chanh_van_phong.js',
  'ph__gi_m___c.js': 'pho_giam_doc.js',
  'ph__ch_nh_v_n_ph_ng.js': 'pho_chanh_van_phong.js',
  'tr__ng_ph_ng.js': 'truong_phong.js',
  'ph__tr__ng_ph_ng.js': 'pho_truong_phong.js',
  'c_n_b_.js': 'can_bo.js'
};

const dirs = [
  'src/config/workflows/incoming',
  'src/config/workflows/outgoing'
];

dirs.forEach(dir => {
  const fullDir = path.join(process.cwd(), dir);
  if (!fs.existsSync(fullDir)) return;

  const indexFile = path.join(fullDir, 'index.js');
  let indexContent = fs.readFileSync(indexFile, 'utf8');

  Object.keys(map).forEach(oldName => {
    const oldPath = path.join(fullDir, oldName);
    const newPath = path.join(fullDir, map[oldName]);

    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      console.log(`Renamed ${oldName} to ${map[oldName]} in ${dir}`);
      
      // Update index.js
      indexContent = indexContent.replace(`'./${oldName}'`, `'./${map[oldName]}'`);
      indexContent = indexContent.replace(`"./${oldName}"`, `"./${map[oldName]}"`);
    }
  });

  fs.writeFileSync(indexFile, indexContent);
});

console.log('Renaming complete!');
