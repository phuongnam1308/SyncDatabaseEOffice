require('dotenv').config();
console.log(`CHROME_PATH: [${process.env.CHROME_PATH}]`);
const fs = require('fs');
if (process.env.CHROME_PATH) {
    const cleanPath = process.env.CHROME_PATH.replace(/"/g, '');
    console.log(`Clean Path: [${cleanPath}]`);
    console.log(`Exists: ${fs.existsSync(cleanPath)}`);
}
