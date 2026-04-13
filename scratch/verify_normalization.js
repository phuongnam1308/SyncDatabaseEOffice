const MigrationHelper = require('./src/helpers/MigrationHelper');
const logger = require('./src/utils/logger');

async function testNormalization() {
  const helper = new MigrationHelper(() => Promise.resolve([]), () => Promise.resolve([]));
  
  const testCases = [
    { input: "Phòng Kế Toán", expected: "phong_ke_toan" },
    { input: "phòng kế toán", expected: "phong_ke_toan" },
    { input: "PHÒNG KẾ-TOÁN", expected: "phong_ke_toan" },
    { input: "Phong Ke Toan", expected: "phong_ke_toan" },
    { input: "  P. Kế toán  ", expected: "p_ke_toan" },
    { input: "Phòng An Toàn - Pháp Chế", expected: "phong_an_toan_phap_che" }
  ];

  console.log('--- Testing normalizeUnitName ---');
  testCases.forEach(tc => {
    const result = helper.normalizeUnitName(tc.input);
    const pass = result === tc.expected;
    console.log(`Input: "${tc.input}" -> Result: "${result}" [${pass ? 'PASS' : 'FAIL, expected ' + tc.expected}]`);
  });
}

testNormalization();
