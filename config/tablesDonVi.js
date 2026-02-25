/**
 * ============================================================
 * FILE 1: config/tablesDonVi.js
 * ============================================================
 * Mục đích: Cấu hình mapping từ bảng DonVi (DB cũ) 
 *           sang organization_units (DB mới)
 * ============================================================
 */

const tableMappings = {
  donvi: {
    // ========== DATABASE CŨ ==========
    oldTable: 'DonVi',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',
    
    // ========== DATABASE MỚI ==========
    newTable: 'organization_units',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',
    
    // ========== MAPPING CÁC TRƯỜNG ==========
    // Ánh xạ: Tên cột cũ → Tên cột mới
    fieldMapping: {
      'DonViID': 'Id_backups',      // numeric -> nvarchar(255) [PHẢI CONVERT SANG STRING]
      'MaDonVi': 'code',             // nvarchar -> nvarchar(255)
      'TenDonVi': 'name',            // nvarchar -> nvarchar(255)
      'URLDonVi': 'description',     // varchar -> nvarchar(MAX)
      'Manager': 'leader'            // nvarchar -> nvarchar(MAX)
    },
    
    // ========== TRƯỜNG BẮT BUỘC ==========
    requiredFields: ['name', 'code'],
    
    // ========== GIÁ TRỊ MẶC ĐỊNH ==========
    defaultValues: {
      'type': null,
      'phone_number': null,
      'email': null,
      'position': null,
      'address': null,
      'display_order': 0,
      'status': 1,
      'mpath': null,
      'parentId': null,
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'table_backups': 'DonVi'       // ĐÁnh dấu nguồn gốc
    },
    
    // ========== XỬ LÝ TRÙNG LẶP ==========
    handleDuplicateId: true,
    backupIdField: 'Id_backups'
  }
};

module.exports = {
  tableMappings
};