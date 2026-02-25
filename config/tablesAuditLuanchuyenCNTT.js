// config/tablesAuditLuanchuyenCNTT.js
const tableMappings = {
  auditLuanchuyenCNTT: {
    oldTable: 'LuanChuyenVanBan_CNTT',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'audit3',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      ID: 'origin_id',
      IDVanBan: 'IDVanBan',
      VBId: 'VBId',
      VBGocId: 'VBGocId',
      IDVanBanGoc: 'IDVanBanGoc',

      NgayTao: 'time',
      NguoiXuLy: 'processed_by',
      HanhDong: 'action',
      Category: 'Category'
    },

    defaultValues: {
      document_id: null,
      user_id: null,
      display_name: null,
      role: null,
      action_code: 'PROCESS_DOCUMENT',
      from_node_id: null,
      to_node_id: null,
      details: null,
      created_by: null,
      receiver: null,
      receiver_unit: null,
      group_: null,
      roleProcess: null,
      deadline: null,
      stage_status: null,
      curStatusCode: null,
      created_at: new Date(),
      updated_at: new Date(),
      type_document: null,
      table_backups: 'LuanChuyenVanBan_CNTT'
    },

    handleDuplicateId: true,
    backupIdField: 'origin_id'
  }
};

module.exports = { tableMappings };