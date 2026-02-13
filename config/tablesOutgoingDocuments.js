// // config/tablesOutgoingDocuments.js
// const tableMappings = {
//   outgoingdocument: {
//     oldTable: 'VanBanBanHanh',
//     oldSchema: 'dbo',
//     oldDatabase: 'DataEOfficeSNP',

//     newTable: 'outgoing_documents2',
//     newSchema: 'dbo',
//     newDatabase: 'DiOffice',

//     fieldMapping: {
//       'ID': 'id_outgoing_bak',
//       'SoVanBan': 'to_book',              // Dùng để tra book_document_id
//       'Title': 'Title',
//       'BanLanhDao': 'BanLanhDao',
//       'ChenSo': 'ChenSo',
//       'TrangThai': 'TrangThai',
//       'IsLibrary': 'IsLibrary',
//       'DoKhan': 'urgency_level',
//       'DoMat': 'private_level',
//       'DonVi': 'DonVi',
//       'Files': 'files',
//       'ChucVu': 'ChucVu',
//       'DocNum': 'DocNum',
//       'NguoiSoanThaoText': 'NguoiSoanThaoText',
//       'FolderLocation': 'FolderLocation',
//       'HoSoXuLyLink': 'HoSoXuLyLink',
//       'InfoVBDi': 'InfoVBDi',
//       'ItemVBPH': 'ItemVBPH',
//       'LoaiBanHanh': 'LoaiBanHanh',
//       'LoaiVanBan': 'document_type',
//       'NoiLuuTru': 'NoiLuuTru',
//       'NoiNhan': 'NoiNhan',
//       'NgayBanHanh': 'NgayBanHanh',
//       'NgayHieuLuc': 'NgayHieuLuc',
//       'NgayHoanTat': 'NgayHoanTat',
//       'NguoiKyVanBan': 'NguoiKyVanBan',
//       'NguoiKyVanBanText': 'NguoiKyVanBanText',
//       'PhanCong': 'PhanCong',
//       'TraLoiVBDen': 'reply_incomming_doc', // Gán dưới dạng mảng 'id' nếu cần
//       'SoBan': 'SoBan',
//       'SoTrang': 'SoTrang',
//       'SoVanBanText': 'SoVanBanText',
//       'TrichYeu': 'abstract_note',
//       'BanLanhDaoTCT': 'BanLanhDaoTCT',
//       'YKien': 'YKien',
//       'YKienChiHuy': 'YKienChiHuy',
//       'ModuleId': 'ModuleId',
//       'SiteName': 'SiteName',
//       'ListName': 'ListName',
//       'ItemId': 'ItemId',
//       'YearMonth': 'YearMonth',
//       'Modified': 'updated_at',
//       'Created': 'created_at',
//       'ModifiedBy': 'ModifiedBy',
//       'CreatedBy': 'CreatedBy',
//       'MigrateFlg': 'MigrateFlg',
//       'MigrateErrFlg': 'MigrateErrFlg',
//       'MigrateErrMess': 'MigrateErrMess',
//       'LoaiMoc': 'LoaiMoc',
//       'KySoFiles': 'KySoFiles',
//       'DGPId': 'DGPId',
//       'Workflow': 'Workflow',
//       'IsKyQuyChe': 'IsKyQuyChe',
//       'DocSignType': 'DocSignType',
//       'IsConverting': 'IsConverting',
//       'CodeItemId': 'CodeItemId'
//     },

//     requiredFields: ['Title', 'to_book'],

//     defaultValues: {
//       'document_id': function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
//         const r = Math.random() * 16 | 0;
//         const v = c === 'x' ? r : (r & 0x3 | 0x8);
//         return v.toString(16);
//       }); },
//       'status': 1,
//       'status_code': '1',                 // Mặc định '1' theo schema
//       'book_document_id': null,           // Sẽ tra cứu từ SoVanBan
//       'created_at': function() { return new Date(); },
//       'updated_at': function() { return new Date(); }
//     },

//     handleDuplicateId: true,
//     backupIdField: 'id_outgoing_bak'
//   }
// };

// module.exports = { tableMappings };
// config/tablesOutgoingDocuments2.js (sửa phần này)
const tableMappings = {
  outgoingdocument2: {
    // ... giữ nguyên phần khác ...
    fieldMapping: {
      'ID': 'id_outgoing_bak',
      'SoVanBan': 'sovanban',             // ← Sửa: Gán SoVanBan vào cột mới sovanban
      'Title': 'Title',
      'BanLanhDao': 'BanLanhDao',
      'ChenSo': 'ChenSo',
      'TrangThai': 'TrangThai',
      'IsLibrary': 'IsLibrary',
      'DoKhan': 'urgency_level',
      'DoMat': 'private_level',
      'DonVi': 'DonVi',
      'Files': 'files',
      'ChucVu': 'ChucVu',
      'DocNum': 'DocNum',
      'NguoiSoanThaoText': 'NguoiSoanThaoText',
      'FolderLocation': 'FolderLocation',
      'HoSoXuLyLink': 'HoSoXuLyLink',
      'InfoVBDi': 'InfoVBDi',
      'ItemVBPH': 'ItemVBPH',
      'LoaiBanHanh': 'LoaiBanHanh',
      'LoaiVanBan': 'document_type',
      'NoiLuuTru': 'NoiLuuTru',
      'NoiNhan': 'NoiNhan',
      'NgayBanHanh': 'NgayBanHanh',
      'NgayHieuLuc': 'NgayHieuLuc',
      'NgayHoanTat': 'NgayHoanTat',
      'NguoiKyVanBan': 'NguoiKyVanBan',
      'NguoiKyVanBanText': 'NguoiKyVanBanText',
      'PhanCong': 'PhanCong',
      'TraLoiVBDen': 'reply_incomming_doc',
      'SoBan': 'SoBan',
      'SoTrang': 'SoTrang',
      'SoVanBanText': 'SoVanBanText',
      'TrichYeu': 'abstract_note',
      'BanLanhDaoTCT': 'BanLanhDaoTCT',
      'YKien': 'YKien',
      'YKienChiHuy': 'YKienChiHuy',
      'ModuleId': 'ModuleId',
      'SiteName': 'SiteName',
      'ListName': 'ListName',
      'ItemId': 'ItemId',
      'YearMonth': 'YearMonth',
      'Modified': 'updated_at',
      'Created': 'created_at',
      'ModifiedBy': 'ModifiedBy',
      'CreatedBy': 'CreatedBy',
      'MigrateFlg': 'MigrateFlg',
      'MigrateErrFlg': 'MigrateErrFlg',
      'MigrateErrMess': 'MigrateErrMess',
      'LoaiMoc': 'LoaiMoc',
      'KySoFiles': 'KySoFiles',
      'DGPId': 'DGPId',
      'Workflow': 'Workflow',
      'IsKyQuyChe': 'IsKyQuyChe',
      'DocSignType': 'DocSignType',
      'IsConverting': 'IsConverting',
      'CodeItemId': 'CodeItemId'
    },

    requiredFields: ['Title'],  // ← Bỏ 'to_book' nếu không cần nữa

    defaultValues: {
      'document_id': function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }); },
      'status': 1,
      'status_code': '1',
      'book_document_id': null,
      'to_book': null,                    // ← Để null như yêu cầu
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); }
    },

    handleDuplicateId: true,
    backupIdField: 'id_outgoing_bak'
  }
};

module.exports = { tableMappings };