const fs = require('fs');
const path = require('path');

const configs = [
    {
        dir: 'src/config/workflows/incoming',
        version: 'PHOIHOP_NHANDEBIET'
    },
    {
        dir: 'src/config/workflows/outgoing',
        version: 'VAN_BAN_DI'
    }
];

configs.forEach(conf => {
    const baseDir = conf.dir;
    const targetVersion = conf.version;
    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.js'));
    
    files.forEach(file => {
        const filePath = path.join(baseDir, file);
        if (file === 'index.js') {
            // Update index.js default config
            let content = fs.readFileSync(filePath, 'utf8');
            content = content.replace(/"bpmn_version":\s*("[^"]*"|null)/g, `"bpmn_version": "${targetVersion}"`);
            content = content.replace(/"type_of_process":\s*("[^"]*"|null)/g, `"type_of_process": "${targetVersion}"`);
            fs.writeFileSync(filePath, content);
            console.log(`Updated index: ${filePath} to ${targetVersion}`);
            return;
        }

        // Update role files
        // Using a regex replace instead of require to avoid any state issues if we run multiple times
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace(/"bpmn_version":\s*("[^"]*"|null)/g, `"bpmn_version": "${targetVersion}"`);
        content = content.replace(/"type_of_process":\s*("[^"]*"|null)/g, `"type_of_process": "${targetVersion}"`);
        
        fs.writeFileSync(filePath, content);
        console.log(`Updated role file: ${filePath} to ${targetVersion}`);
    });
});
