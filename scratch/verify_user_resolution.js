const logger = require("../src/utils/logger");
const MigrationHelper = require("../src/helpers/MigrationHelper");
require('dotenv').config();

async function test() {
    const mockQuery = async (sql, params) => {
        // console.log("SQL:", sql);
        // console.log("Params:", params);
        return []; // Simulate not found
    };

    const helper = new MigrationHelper(mockQuery);
    
    console.log("--- Testing findUserIdByNameOnly ---");
    const id = await helper.findUserIdByNameOnly("User Not Found Test");
    console.log("Resulting ID (should be default):", id);
    if (id === process.env.DEFAULT_USER_ID) {
        console.log("✅ Success: Returned DEFAULT_USER_ID");
    } else {
        console.log("❌ Failure: Did not return DEFAULT_USER_ID (" + process.env.DEFAULT_USER_ID + ")");
    }
}

test().catch(console.error);
