// config/tablesBookBanHanhDelete.js
const tableMappings = {
  bookbanhanhdelete: {
    oldTable: 'VanBanBanHanhDelete',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'book_documents',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'SoVanBan': 'to_book_code',         // SoVanBan → to_book_code (unique key cho sổ)
      'NoiLuuTru': 'sender_unit',         // NoiLuuTru → sender_unit
      'DoKhan': 'private_level'           // DoKhan → private_level
    },

    requiredFields: ['to_book_code'],

    defaultValues: {
      'name': function(record) { return record.SoVanBan || 'Không tên'; }, // name = SoVanBan (tên sổ)
      'year': 2014,                       // Mặc định 2014
      'status': 3,
      'type_document': 'OutGoingDocument', // Văn bản ban hành
      'manager_book': null,
      'count': 0,                         // Sẽ update sau khi gộp
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'active': 1,
      'order': null,
      'created_by': null
    },

    handleDuplicate: true,                // Check trùng to_book_code (name)
    uniqueField: 'to_book_code'           // Check duplicate theo to_book_code
  }
};

module.exports = { tableMappings };