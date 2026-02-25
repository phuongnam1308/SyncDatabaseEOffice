const tableMappings = {
  taskdelete: {
    oldTable: 'TaskVBDenDelete',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'task2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'ID': 'id_taskBackups',
      'VBId': 'VBId',
      'DepartmentId': 'DepartmentId',
      'ParentId': 'ParentId',
      'Title': 'name',
      'DanhGia': 'DanhGia',
      'DeBaoCao': 'DeBaoCao',
      'DeBiet': 'DeBiet',
      'DeThucHien': 'DeThucHien',
      'DuocHuy': 'DuocHuy',
      'DiemChatLuong': 'DiemChatLuong',
      'DiemThoiGian': 'DiemThoiGian',
      'DiemDanhGia': 'DiemDanhGia',
      'StartDate': 'start_date',
      'DueDate': 'end_date',
      'CompletedDate': 'CompletedDate',
      'HoanTatTuDong': 'HoanTatTuDong',
      'HoSoDuThaoId': 'HoSoDuThaoId',
      'HoSoDuThaoUrl': 'HoSoDuThaoUrl',
      'HoSoXuLyUrl': 'HoSoXuLyUrl',
      'Percent': 'progress',
      'TrangThai': 'status',
      'Priority': 'priority',
      'YKienCuaNguoiGiaiQuyet': 'YKienCuaNguoiGiaiQuyet',
      'YKienChiDao': 'YKienChiDao',
      'ModuleId': 'ModuleId',
      'SiteName': 'SiteName',
      'ListName': 'ListName',
      'ItemId': 'ItemId',
      'Modified': 'Modified',
      'Created': 'created_at',
      'ModifiedBy': 'updated_by',
      'CreatedBy': 'created_by',
      'MigrateFlg': 'MigrateFlg',
      'MigrateErrFlg': 'MigrateErrFlg',
      'MigrateErrMess': 'MigrateErrMess',
      'ParentTaskID': 'ParentTaskID',
      'Deleted': 'Deleted',  // Map thêm nếu bảng task2 hỗ trợ, nếu không thì bỏ
      'DeletedBy': 'DeletedBy'  // Map thêm nếu bảng task2 hỗ trợ, nếu không thì bỏ
    },

    requiredFields: [],

    defaultValues: {
      code: null,
      bpmn_id: null,
      reminder_time: '2 days',
      topic: null,
      note: null,
      repetitive_task: null,
      month: null,
      repetitive_start: null,
      repetitive_end: null,
      parent: null,
      path: null,
      process_status: null,
      status: 3,  // Default là 3 cho delete
      approval_status: null,
      update_at: new Date(),
      recurring_from_id: null,
      type_task: null,
      doc_id: null,
      meeting_id: null,
      meeting_conclusion_id: null,
      week_days: null,
      ParentTaskID_bak: null,
      CreatedBy: null,
      ModifiedBy: null
    },

    handleDuplicateId: true,
    backupIdField: 'id_taskBackups'
  }
};

module.exports = { tableMappings };