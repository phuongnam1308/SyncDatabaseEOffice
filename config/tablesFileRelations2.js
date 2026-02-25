// config/tablesFileRelations.js
const tableMappings = {
  fileRelations: {
    oldTable: 'files2',
    oldSchema: 'dbo',
    oldDatabase: 'camunda',

    newTable: 'file_relations2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      // Các trường lấy trực tiếp từ files2
      'nguoikyvanban': 'object_id_bak',
      'id_bak': 'file_id_bak',
      'table_bak': 'table_bak',
      'type_doc': 'type_doc'
    },

    requiredFields: [],  // Không bắt buộc, vì hầu hết có thể null

    defaultValues: {
      // Các trường mặc định hoặc tính toán
      'id': () => require('uuid').v4().toUpperCase(),  // Generate UUID mới cho id
      'object_type': () => null,  // Tạm thời NULL theo yêu cầu mới
      'object_id': (record) => record?.id_bak || '',  // Lấy từ id_bak, default '' nếu null
      'file_id': (record) => record?.id || '',  // Lấy từ id, default '' nếu null hoặc rỗng
      'created_at': (record) => record?.created_at ? new Date(record.created_at) : new Date(),  // Lấy từ created_at cũ nếu có, fallback hiện tại
      'status': 1,  // Mặc định 1
      'file_id_bak2': null,  // Không chỉ định, set null
    },

    handleDuplicateId: true,
    backupIdField: 'file_id'  // Check duplicate dựa trên file_id (vì file_id từ files2.id)
  }
};

module.exports = { tableMappings };