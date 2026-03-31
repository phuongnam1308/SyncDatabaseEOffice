const fs = require('fs');
const path = require('path');

const baseDirs = [
    'src/config/workflows/incoming',
    'src/config/workflows/outgoing'
];

const TARGET_VERSION = 'SOANTHAO_PHATHANH_VBD';

baseDirs.forEach(baseDir => {
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.js'));
    
    files.forEach(file => {
        const filePath = path.join(baseDir, file);
        if (file === 'index.js') {
            // Update index.js default config
            let content = fs.readFileSync(filePath, 'utf8');
            content = content.replace(/"bpmn_version":\s*("[^"]*"|null)/g, `"bpmn_version": "${TARGET_VERSION}"`);
            content = content.replace(/"type_of_process":\s*("[^"]*"|null)/g, `"type_of_process": "${TARGET_VERSION}"`);
            // Keep curStatusCode as it is or ensure it exists
            fs.writeFileSync(filePath, content);
            console.log(`Updated index: ${filePath}`);
            return;
        }

        // Update role files
        let config = require(path.resolve(filePath));
        if (config.screens && Array.isArray(config.screens)) {
            config.screens = config.screens.map(screen => ({
                ...screen,
                bpmn_version: TARGET_VERSION,
                type_of_process: TARGET_VERSION
            }));
            
            const newContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
            fs.writeFileSync(filePath, newContent);
            console.log(`Updated role file: ${filePath}`);
        }
    });
});
