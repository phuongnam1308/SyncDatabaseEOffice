// config/tablesBookDocumentsDelete.js
const tableMappings = {
  bookdocumentdelete: {
    oldTable: 'VanBanDenDelete',
    oldSchema: 'dbo',
    oldDatabase: process.env.OLD_DB_NAME,

    newTable: 'book_documents',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME,

    fieldMapping: {
      'Title': 'name',                    // Title cũ → name (sổ)
      'CoQuanGuiText': 'sender_unit',     // Cơ quan gửi
      'DoKhan': 'private_level'           // Độ khẩn
    },

    requiredFields: ['name'],

    defaultValues: {
      'year': 2014,                       // Mặc định 2014
      'status': 3,
      'type_document': 'IncommingDocument',
      'manager_book': null,
      'count': 0,                         // Sẽ update sau khi gộp
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'active': 1,
      'order': null,
      'created_by': null
    },

    handleDuplicate: true,                // Check trùng name (to_book_code)
    uniqueField: 'name'                   // Check duplicate theo name
  }
};

module.exports = { tableMappings };