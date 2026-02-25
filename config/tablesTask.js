// config/tablesTask.js
const tableMappings = {
  task: {
    oldTable: 'TaskVBDen',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'task2',
    newSchema: 'dbo',
    newDatabase: 'camunda',

    fieldMapping: {
      'ID': 'id_taskBackups',
      'VBId': 'VBId',
      'DepartmentId': 'DepartmentId',
      'Title': 'name',  // Sẽ xử lý đặc biệt trong service
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
      'TrangThai': 'status',  // Sẽ map giá trị trong service
      'Priority': 'priority',  // Sẽ map giá trị trong service
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
      'ParentTaskID': 'ParentTaskID'
    },

    requiredFields: [],  // Không bắt buộc, tất cả NULL được

    defaultValues: {
      code: null,
      bpmn_id: null,
      reminder_time: '2 days',  // Default theo yêu cầu
      topic: null,
      note: null,
      repetitive_task: null,
      month: null,
      repetitive_start: null,
      repetitive_end: null,
      parent: null,
      path: null,
      process_status: null,
      status: 1,  // Default nếu không map được từ TrangThai
      approval_status: null,
      update_at: new Date(),  // Giá trị hiện tại
      recurring_from_id: null,
      type_task: null,
      doc_id: null,
      meeting_id: null,
      meeting_conclusion_id: null,
      week_days: null,
      ParentId: null,
      ParentTaskID_bak: null,
      CreatedBy: null,  // Có thể override nếu cần
      ModifiedBy: null
    },

    handleDuplicateId: true,
    backupIdField: 'id_taskBackups'  // Để check duplicate
  }
};

module.exports = { tableMappings };