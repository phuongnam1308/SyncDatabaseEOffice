// const fs = require('fs');
// const path = require('path');
// const archiver = require('archiver');

// const outputFile = 'sync-tool-build.zip';
// const output = fs.createWriteStream(outputFile);
// const archive = archiver('zip', { zlib: { level: 9 } });

// archive.pipe(output);

// // 1. dist (app.js + swagger.json)
// archive.directory('dist', 'app/dist');

// // 2. node_modules BẮT BUỘC cho swagger
// const runtimeModules = [
//   'swagger-ui-express',
//   'swagger-ui-dist',
//   'express',
//   'cors'
// ];

// runtimeModules.forEach(mod => {
//   const modPath = path.join('node_modules', mod);
//   if (fs.existsSync(modPath)) {
//     archive.directory(modPath, `app/node_modules/${mod}`);
//     console.log(`✔ packed ${mod}`);
//   } else {
//     console.warn(`⚠ missing ${mod}`);
//   }
// });

// // 3. config cần thiết
// ['package.json', '.env.example', 'start.bat', 'start.sh'].forEach(f => {
//   if (fs.existsSync(f)) {
//     archive.file(f, { name: `app/${f}` });
//   }
// });

// archive.finalize();
// const fs = require('fs-extra');
// const path = require('path');

// const buildDir = path.join(__dirname, 'build');

// (async () => {
//   await fs.remove(buildDir);
//   await fs.ensureDir(buildDir);

//   // copy app
//   await fs.copy('./index.js', `${buildDir}/index.js`);
//   await fs.copy('./swagger.json', `${buildDir}/swagger.json`);
//   await fs.copy('./swagger-ui', `${buildDir}/swagger-ui`);

//   await fs.copy('./package.json', `${buildDir}/package.json`);
//   await fs.copy('./node_modules', `${buildDir}/node_modules`);

//   console.log('✅ Build done');
// })();
const fs = require('fs-extra');
const path = require('path');

const buildDir = path.join(__dirname, 'build/app');

(async () => {
  await fs.remove(buildDir);
  await fs.ensureDir(buildDir);

  const keep = [
    'index.js',
    'routes',
    'services',
    'utils',
    'models',
    'swagger',
    'swagger.json',
    'node_modules',
    '.env',
    'package.json'
  ];

  for (const item of keep) {
    await fs.copy(item, path.join(buildDir, item));
  }

  console.log('✅ Build xong – Swagger vẫn dùng được');
})();
