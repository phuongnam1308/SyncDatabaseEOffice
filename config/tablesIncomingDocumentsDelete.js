// config/tablesIncomingDocumentsDelete.js
const tableMappings = {
  incomingdocumentdelete: {
    oldTable: 'VanBanDenDelete',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'incomming_documents2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'ID': 'id_incoming_bak',
      'SoDen': 'to_book_code',            // Dùng để tra book_document_id
      'CoQuanGui2': 'CoQuanGui2',
      'CoQuanGuiText': 'CoQuanGuiText',
      'DonVi': 'DonVi',
      'IsLibrary': 'IsLibrary',
      'DoKhan': 'urgency_level',
      'DoMat': 'private_level',
      'ThoiHanGQ': 'deadline_reply',
      'ItemVBDTCT': 'ItemVBDTCT',
      'ItemVBPH': 'ItemVBPH',
      'BanLanhDao': 'BanLanhDao',
      'LanhDaoTCT': 'LanhDaoTCT',
      'LanhDaoTCTDaXuLy': 'LanhDaoTCT',
      'LanhDaoTCTDeBiet': 'LanhDaoTCT',
      'LanhDaoVPDN': 'LanhDaoTCT',
      'LinhVuc': 'LinhVuc',
      'LoaiVanBan': 'document_type',
      'NgayDen': 'receive_date',
      'NgayTrenVB': 'to_book_date',
      'SoBan': 'SoBan',
      'SoTrang': 'SoTrang',
      'SoVanBan': 'to_book',
      'TrangThai': 'TrangThai',
      'TrichYeu': 'abstract_note',
      'VanBanTraLoi': 'VanBanTraLoi',
      'ChenSo': 'ChenSo',
      'YKienLanhDao': 'YKienLanhDao',
      'YKienLanhDaoTCT': 'YKienLanhDaoTCT',
      'YKienLanhDaoVPDN': 'YKienLanhDaoVPDN',
      'YKienCuaLDVPChoVanThu': 'YKienCuaLDVPChoVanThu',
      'ForwardType': 'ForwardType',
      'Modified': 'updated_at',
      'Created': 'created_at',
      'ModifiedBy': 'ModifiedBy',
      'CreatedBy': 'CreatedBy',
      'ModuleId': 'ModuleId',
      'SiteName': 'SiteName',
      'ListName': 'ListName',
      'ItemId': 'ItemId',
      'MigrateFlg': 'MigrateFlg',
      'YearMonth': 'YearMonth',
      'MigrateErrFlg': 'MigrateErrFlg',
      'MigrateErrMess': 'MigrateErrMess',
      'DGPId': 'DGPId'
    },

    requiredFields: ['abstract_note'],

    defaultValues: {
      'document_id': function() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }); },
      'status': 3,                        // Fix cứng status = 3 (đã xóa)
      'status_code': '100',               // Mặc định 100
      'book_document_id': null,           // Sẽ tra cứu từ SoDen
      'created_at': function() { return new Date(); },
      'updated_at': function() { return new Date(); }
    },

    handleDuplicateId: true,
    backupIdField: 'id_incoming_bak'
  }
};

module.exports = { tableMappings };