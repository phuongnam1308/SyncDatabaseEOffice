const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');

async function testSingleFile() {
    const migrator = new HtmlFileMigrationModel();
    
    console.log('Allowed IMG Paths:', migrator.allowedImgPaths);

    const filePath = path.resolve(__dirname, '../../../tintucraw/tintuc/Pages/cac-kien-thuc-can-biet-ve-benh-tang-huyet-ap.aspx');
    
    if (!fs.existsSync(filePath)) { console.error('File not found:', filePath); return; }

    try {
        console.log('\n--- TESTING (WITH WHITELIST FILTER) ---');
        const data = await migrator.parseHtmlFile(filePath);
        console.log('isActive:', data.isActive);
        console.log('itemId:', data.itemId);
        console.log('newsType:', data.newsType);
        console.log('Images:', JSON.stringify(data.images, null, 2));
        
        const jsonFilePath = path.join(migrator.jsonOutputPath, `${data.slug}.json`);
        fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log('\n✅ JSON saved to:', jsonFilePath);
    } catch (err) {
        console.error('Test failed:', err);
    }
}

testSingleFile();
