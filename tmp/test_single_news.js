const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const HtmlFileMigrationModel = require('../src/sync-news-aspx-page/migrate/HtmlFileMigrationModel');
const fs = require('fs');

async function testSingle() {
    const migrator = new HtmlFileMigrationModel();
    const filePath = path.resolve(__dirname, '../tintucraw/tintuc/Pages/cac-kien-thuc-can-biet-ve-benh-tang-huyet-ap.aspx');
    
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return;
    }

    console.log('--- TEST PARSING SINGLE FILE ---');
    try {
        const data = await migrator.parseHtmlFile(filePath);
        
        // Print essential fields
        console.log('\nResult JSON (Summary):');
        const summary = { ...data };
        delete summary.content; 
        console.log(JSON.stringify(summary, null, 2));
        
        console.log('\n--- Content HTML Snippet (First 1000 chars) ---');
        console.log(data.content.substring(0, 1000));
        console.log('...');
        
        console.log('\n--- View Count check ---');
        console.log('viewCount:', data.viewCount);
        
        console.log('\n--- Content Length ---');
        console.log('Content length:', data.content.length);

    } catch (err) {
        console.error('Error:', err);
    }
}

testSingle();
