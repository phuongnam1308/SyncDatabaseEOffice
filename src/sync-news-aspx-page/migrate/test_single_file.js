const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');

async function testSingleFile() {
    const migrator = new HtmlFileMigrationModel();
    
    console.log('Allowed IMG Paths:', migrator.allowedImgPaths);

    const filePath = path.resolve(__dirname, '../../../tintucraw/tintuc/Pages/ke-hoach-don-doan-cbam-ngay-18-04.aspx');
    
    if (!fs.existsSync(filePath)) { console.error('File not found:', filePath); return; }

    try {
        console.log('\n--- TESTING EXTRACTION ---');
        const data = await migrator.parseHtmlFile(filePath);
        console.log('Title (Vietnamese):', data.title);
        console.log('Summary:', data.summary);
        console.log('Category (newsType):', data.newsType);
        console.log('Thumbnail:', data.thumbnail);
        console.log('Tags:', data.tags);
        console.log('Published At:', data.publishedAt);
        console.log('isActive:', data.isActive);
        console.log('itemId:', data.itemId);
        
        const jsonFilePath = path.join(migrator.jsonOutputPath, `${data.slug}.json`);
        fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log('\n✅ JSON result saved to:', jsonFilePath);
    } catch (err) {
        console.error('Test failed:', err);
    }
}

testSingleFile();
