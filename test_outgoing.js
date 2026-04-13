const OutGoingDocumentModel = require('./src/sync-outgoing-document/models/StreamOutgoingIncrementalModel');
const logger = require('./utils/logger');

async function test() {
  try {
    console.log('Testing OutGoingDocumentModel...');
    const instance = new OutGoingDocumentModel();
    console.log('Instance created. Initializing...');
    await instance.initialize();
    console.log('Initialization SUCCESS');
  } catch (err) {
    console.error('Initialization FAILED:', err);
  }
}

test();
