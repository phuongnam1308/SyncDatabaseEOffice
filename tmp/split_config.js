const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'src/config/sync_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 1. Keywords
const keywords = config.roles;
fs.writeFileSync(path.join(process.cwd(), 'src/config/keywords.js'), `module.exports = ${JSON.stringify(keywords, null, 2)};`);

// 2. Permissions
const permissions = config.process_mappings;
fs.writeFileSync(path.join(process.cwd(), 'src/config/permissions.js'), `module.exports = ${JSON.stringify(permissions, null, 2)};`);

// 3. Settings
const settings = config.settings;
fs.writeFileSync(path.join(process.cwd(), 'src/config/settings.js'), `module.exports = ${JSON.stringify(settings, null, 2)};`);

// 4. Workflows (Split by docType)
const workflowIncoming = config.workflow_config.incoming;
const workflowOutgoing = config.workflow_config.outgoing;

// Function to split workflows by role
function splitWorkflow(workflow, targetDir) {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  
  const processNames = [];
  workflow.workflow_process.forEach(p => {
    // Generate valid filename from role
    const fileName = p.role.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.js';
    processNames.push(fileName);
    
    // Clean up keywords from roles if requested, since index.js injects them
    const { keywords, ...rest } = p;
    fs.writeFileSync(path.join(targetDir, fileName), `module.exports = ${JSON.stringify(rest, null, 2)};`);
  });

  // Create index.js for the workflow dir
  const indexContent = `
const workflow_process = [
${processNames.map(name => `  require('./${name}')`).join(',\n')}
];

module.exports = {
  workflow_process,
  default: ${JSON.stringify(workflow.default, null, 2)}
};
`;
  fs.writeFileSync(path.join(targetDir, 'index.js'), indexContent);
}

splitWorkflow(workflowIncoming, path.join(process.cwd(), 'src/config/workflows/incoming'));
splitWorkflow(workflowOutgoing, path.join(process.cwd(), 'src/config/workflows/outgoing'));

console.log('Split sync_config.json into modular JS files!');
