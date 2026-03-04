/**
 * ============================================================
 * config.js - Department Sync Configuration
 * ============================================================
 * Maps PersonalProfile departments to organization_units.
 */

const tableMappings = {
  department: {
    // === Source (Old Database) ===
    oldTable: 'PersonalProfile',
    oldSchema: 'dbo',
    oldDatabase: process.env.OLD_DB_NAME,

    // === Target (New Database) ===
    newTable: 'organization_units',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'camunda',

    // === Field Mapping ===
    fieldMapping: {
      'DonVi': 'code',
      'Department': 'name'
    },

    // === Required Fields ===
    requiredFields: ['name', 'code'],

    // === Default Values ===
    defaultValues: {
      'type': null,
      'phone_number': null,
      'email': null,
      'leader': null,
      'position': null,
      'address': null,
      'description': null,
      'display_order': 0,
      'status': 1,
      'mpath': null,
      'parentId': null,
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      'table_backups': 'PersonalProfile'
    },

    // === Duplicate Handling ===
    handleDuplicateCode: true,
    backupIdField: 'Id_backups'
  }
};

module.exports = { tableMappings };
