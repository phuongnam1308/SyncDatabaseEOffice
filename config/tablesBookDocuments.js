// // config/tablesBookDocuments.js
// const tableMappings = {
//   bookdocument: {
//     oldTable: 'VanBanDen',
//     oldSchema: 'dbo',
//     oldDatabase: 'DataEOfficeSNP',

//     newTable: 'book_documents',
//     newSchema: 'dbo',
//     newDatabase: 'DiOffice',

//     fieldMapping: {
//       'Title': 'name',                    // Title cũ → name
//       'CoQuanGuiText': 'sender_unit',     // Cơ quan gửi
//       'DoKhan': 'private_level'           // Độ khẩn
//     },

//     requiredFields: ['name'],

//     defaultValues: {
//       'year': 2014,                       // Mặc định 2014 như yêu cầu
//       'status': 1,
//       'type_document': 'IncommingDocument',
//       'manager_book': null,
//       'count': 0,                         // Sẽ update sau khi gộp
//       'created_at': function() { return new Date(); },
//       'updated_at': function() { return new Date(); },
//       'active': 1,
//       'order': null,
//       'created_by': null
//     },

//     handleDuplicate: false,
//     backupIdField: null
//   }
// };

// module.exports = { tableMappings };

// config/tablesBookDocuments.js
const tableMappings = {
  bookdocument: {
    oldTable: 'VanBanDen',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'book_documents',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',

    fieldMapping: {
      'Title': 'name',                    // Title cũ → name
      'CoQuanGuiText': 'sender_unit',     // Cơ quan gửi
      'DoKhan': 'private_level'           // Độ khẩn
    },

    requiredFields: ['name'],

    defaultValues: {
      'year': 2014,                       // Mặc định 2014 như yêu cầu
      'status': 1,
      'type_document': 'IncommingDocument',
      'manager_book': null,
      'count': 0,                         // Sẽ update sau khi gộp
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); },
      'active': 1,
      'sort_order': null,                 // ← Đổi từ 'order' thành 'sort_order' (khuyến nghị)
      'created_by': null
    },

    handleDuplicate: false,
    backupIdField: null
  }
};

module.exports = { tableMappings };