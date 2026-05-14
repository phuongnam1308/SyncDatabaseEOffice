const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function debugLogin() {
    console.log('Starting manual login debug...');
    const cmd = process.platform === 'win32' ? 'node' : 'node';
    const args = [path.join(process.cwd(), 'auth', 'login_playwright.js')];
    
    const logFile = path.join(process.cwd(), 'scratch', 'login_debug.log');
    const logStream = fs.createWriteStream(logFile);

    console.log(`Executing: ${cmd} ${args.join(' ')}`);
    
    const child = spawn(cmd, args, {
        cwd: process.cwd(),
        env: { ...process.env, HEADED: 'false' },
        shell: true,
    });

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on('close', (code) => {
        console.log(`Login process exited with code ${code}`);
        logStream.end();
    });
}

debugLogin();
