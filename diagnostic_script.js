const path = require('path');
const fs = require('fs');

async function runTest() {
  try {
    const SyncModelRegistry = require('./src/sync-manager/SyncModelRegistry');
    const dbConnection = require('./db/connection');
    await dbConnection.connectAll();
    
    const reg = new SyncModelRegistry();
    const entry = {
      key: 'STREAM_INCOMING_INCREMENTAL',
      label: 'Đồng bộ văn bản đến v2',
      ModelClass: require('./src/sync-incoming-v2/models/SyncIncomingModel')
    };
    
    const mockSyncManager = {
      ensureModel: async () => {},
      updateModelStatus: async () => {}
    };
    
    await reg._initializeSingle(entry, {}, mockSyncManager);
    
    fs.writeFileSync('diagnostic_output.txt', 'Initialization succeeded. Registry handler: ' + (reg._registry.get('Đồng bộ văn bản đến v2')?.handler ? 'Exists' : 'Null'));
  } catch (err) {
    fs.writeFileSync('diagnostic_output.txt', 'Initialization failed: ' + err.message + '\nStack: ' + err.stack);
  }
}

runTest().catch(console.error);
