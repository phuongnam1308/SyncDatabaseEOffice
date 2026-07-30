require('dotenv').config();
const dbConnection = require('../db/connection');
const fs = require('fs');

async function analyzeUsers() {
  await dbConnection.connectAll();
  const newPool = dbConnection.getNewPool();
  if (!newPool) {
    console.error('Failed to connect to New DB');
    process.exit(1);
  }

  // 1. Get all status = 1 users
  const activeRes = await newPool.request().query(`
    SELECT id, name, username, email_user, code_nd, status
    FROM dbo.users
    WHERE status = 1
  `);
  const activeUsers = activeRes.recordset;

  // 2. Get all status = 99 users
  const junkRes = await newPool.request().query(`
    SELECT id, name, username, email_user, code_nd, status
    FROM dbo.users
    WHERE status = 99
  `);
  const junkUsers = junkRes.recordset;

  console.log(`Active users (status = 1): ${activeUsers.length}`);
  console.log(`Junk/Unused users (status = 99): ${junkUsers.length}`);

  // Test mapping logic:
  // Active user name format: "Nguyễn Minh Thế - PTB CNTT" or "Vũ Việt Hải - VP"
  // Junk user name format: "Nguyễn Minh Thế" or "Vũ Việt Hải"
  // Let's build a map from cleanName -> activeUser
  const cleanNameToActiveUserMap = new Map();
  for (const u of activeUsers) {
    if (!u.name) continue;
    // Extract base name before ' - ' or '-' or '('
    const baseName = u.name.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
    if (baseName) {
      if (!cleanNameToActiveUserMap.has(baseName)) {
        cleanNameToActiveUserMap.set(baseName, []);
      }
      cleanNameToActiveUserMap.get(baseName).push(u);
    }
  }

  let matched = 0;
  let unmatched = 0;
  const sampleMatches = [];
  const sampleUnmatched = [];

  for (const ju of junkUsers) {
    if (!ju.name) {
      unmatched++;
      continue;
    }
    const junkBaseName = ju.name.split(/\s*[-–—(]\s*/)[0].trim().toLowerCase();
    const candidates = cleanNameToActiveUserMap.get(junkBaseName);
    if (candidates && candidates.length > 0) {
      matched++;
      if (sampleMatches.length < 10) {
        sampleMatches.push({
          junkUser: { id: ju.id, name: ju.name, username: ju.username, code_nd: ju.code_nd },
          matchedActive: candidates.map(c => ({ id: c.id, name: c.name, username: c.username, email: c.email_user }))
        });
      }
    } else {
      unmatched++;
      if (sampleUnmatched.length < 10) {
        sampleUnmatched.push({ id: ju.id, name: ju.name, username: ju.username, code_nd: ju.code_nd });
      }
    }
  }

  console.log(`\nMapping result by base name:`);
  console.log(`Matched junk users: ${matched}`);
  console.log(`Unmatched junk users: ${unmatched}`);

  console.log(`\nSample Matches:`, JSON.stringify(sampleMatches, null, 2));
  console.log(`\nSample Unmatched:`, JSON.stringify(sampleUnmatched, null, 2));

  process.exit(0);
}

analyzeUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
