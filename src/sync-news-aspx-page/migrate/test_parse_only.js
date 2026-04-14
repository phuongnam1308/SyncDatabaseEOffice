const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const HtmlFileMigrationModel = require('./HtmlFileMigrationModel');
const fs = require('fs');

async function testSingleFile() {
    // Disable DB calls in helpers
    process.env.OLD_DB_SERVER = ''; 

    const migrator = new HtmlFileMigrationModel();
    // mock helper queries to bypass DB errors
    migrator.helper.findUserCodeByName = async () => 'mock_code';
    migrator.helper.findUserIdByName = async () => 'mock_id';

    const filePath = path.resolve(__dirname, '../../../tintucraw/tintuc/Pages/v-v-cu-the-hoa-phan-can-cu-cua-quyet-dinh-hanh-chinh.aspx');
    console.log('\n--- TESTING EXTRACTION ---');
    
    // override queryOldDb since it could be called magically
    migrator.queryOldDb = async () => [];
    migrator.queryNewDb = async () => [];

    const data = await migrator.parseHtmlFile(filePath);
    console.log('Title:', data.title);
    console.log('Summary:', data.summary);
    console.log('Topic:', data.topic);
    console.log('Thumbnail:', data.nameThumbnail);
    console.log('CONTENT (first 200 chars):', data.content.substring(0, 200).replace(/\n/g,' '));
    console.log('CONTENT LENGTH:', data.content.length);
    
    const jsonFilePath = path.join(migrator.jsonOutputPath, `test_output.json`);
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log('\n✅ JSON result saved to:', jsonFilePath);
    process.exit(0);
}
testSingleFile().catch(console.error);
