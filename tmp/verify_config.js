const oldConfig = require('../src/config/index.js.bak');
const newConfig = require('../src/config/index.js');

function compareObjects(obj1, obj2, path = '') {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    console.error(`Mismatch in number of keys at ${path}: ${keys1.length} vs ${keys2.length}`);
    const missingIn1 = keys2.filter(k => !keys1.includes(k));
    const missingIn2 = keys1.filter(k => !keys2.includes(k));
    if (missingIn1.length) console.error(`Missing in old: ${missingIn1}`);
    if (missingIn2.length) console.error(`Missing in new: ${missingIn2}`);
    return false;
  }

  for (const key of keys1) {
    const val1 = obj1[key];
    const val2 = obj2[key];
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof val1 !== typeof val2) {
      console.error(`Type mismatch at ${currentPath}: ${typeof val1} vs ${typeof val2}`);
      return false;
    }

    if (typeof val1 === 'function' && typeof val2 === 'function') {
      // Skip function body comparison as it will naturally differ due to refactoring
      continue;
    }

    if (typeof val1 === 'object' && val1 !== null) {
      if (!compareObjects(val1, val2, currentPath)) return false;
    } else {
      if (val1 !== val2) {
        console.error(`Value mismatch at ${currentPath}: ${val1} vs ${val2}`);
        return false;
      }
    }
  }
  return true;
}

console.log('Comparing basic constants and mappings...');
const baseCompare = compareObjects(oldConfig, newConfig);

console.log('\nComparing getWorkflowConfig outputs...');
const oldWorkflowOut = oldConfig.getWorkflowConfig('outgoing');
const newWorkflowOut = newConfig.getWorkflowConfig('outgoing');
const workflowOutCompare = compareObjects(oldWorkflowOut, newWorkflowOut, 'workflow_outgoing');

const oldWorkflowIn = oldConfig.getWorkflowConfig('incoming');
const newWorkflowIn = newConfig.getWorkflowConfig('incoming');
const workflowInCompare = compareObjects(oldWorkflowIn, newWorkflowIn, 'workflow_incoming');

if (baseCompare && workflowOutCompare && workflowInCompare) {
  console.log('\nSUCCESS: Configuration is identical!');
} else {
  console.error('\nFAILURE: Configuration mismatch found!');
  process.exit(1);
}
