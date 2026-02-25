// config/tablesFileRelations.js
const tableMappings = {
  file_relations2: {
    oldTable: 'files2',
    oldSchema: 'dbo',
    oldDatabase: 'camunda',  // Sửa nếu cần: nếu files2 ở DB cũ như 'DataEOfficeSNP', đổi thành 'DataEOfficeSNP'

    newTable: 'file_relations2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'id_bak': 'object_id_bak',
      'table_bak': 'table_bak',
      'type_doc': 'type_doc',
      'nguoikyvanban': 'nguoikyvanban',
      'created_at': 'created_at',
      // Thêm mapping khác nếu cần từ files2 (ví dụ: 'file_path': 'some_field')
    },

    requiredFields: [],  // Không bắt buộc, tất cả NULL được

    defaultValues: {
      object_type: null,
      object_id: null,
      file_id: null,
      status: '1',
      file_id_bak: null,
      file_id_bak2: null,
      // Các default khác nếu cần
    },

    handleDuplicateId: true,
    backupIdField: 'object_id_bak'  // Để check duplicate
  }
};

module.exports = { tableMappings };