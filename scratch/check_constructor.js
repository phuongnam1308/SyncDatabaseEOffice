const SyncIncomingDocumentModel = require('./src/sync-incoming-document/models/SyncIncomingDocumentModel');
const StreamIncomingIncrementalModel = require('./src/sync-incoming-document/models/StreamIncomingIncrementalModel');

console.log('SyncIncomingDocumentModel type:', typeof SyncIncomingDocumentModel);
console.log('StreamIncomingIncrementalModel type:', typeof StreamIncomingIncrementalModel);

try {
    const inst = new SyncIncomingDocumentModel();
    console.log('SyncIncomingDocumentModel instantiable: YES');
} catch (e) {
    console.log('SyncIncomingDocumentModel instantiable: NO, error:', e.message);
}
