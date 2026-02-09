// config/tablesTask3ToTask.js
const tableMappings = {
  task3toTask: {
    oldTable: 'task3',
    oldSchema: 'dbo',

    newTable: 'task',
    newSchema: 'dbo',

    fieldMapping: {
      // ID gốc để trace
      ID: 'id_taskBackups',

      code: 'code',
      name: 'name',
      start_date: 'start_date',
      end_date: 'end_date',
      bpmn_id: 'bpmn_id',
      priority: 'priority',
      reminder_time: 'reminder_time',
      topic: 'topic',
      note: 'note',
      repetitive_task: 'repetitive_task',
      month: 'month',
      repetitive_start: 'repetitive_start',
      repetitive_end: 'repetitive_end',
      parent: 'parent',
      path: 'path',
      progress: 'progress',
      process_status: 'process_status',
      status: 'status',
      approval_status: 'approval_status',
      created_by: 'created_by',
      updated_by: 'updated_by',
      update_at: 'update_at',
      created_at: 'created_at',
      recurring_from_id: 'recurring_from_id',
      type_task: 'type_task',
      doc_id: 'doc_id',
      meeting_id: 'meeting_id',
      meeting_conclusion_id: 'meeting_conclusion_id',
      week_days: 'week_days',
      VBId: 'VBId',

      CompletedDate: 'CompletedDate',
      HoanTatTuDong: 'HoanTatTuDong',
      HoSoDuThaoId: 'HoSoDuThaoId',
      HoSoDuThaoUrl: 'HoSoDuThaoUrl',
      HoSoXuLyUrl: 'HoSoXuLyUrl',
      YKienCuaNguoiGiaiQuyet: 'YKienCuaNguoiGiaiQuyet',
      YKienChiDao: 'YKienChiDao',
      ModuleId: 'ModuleId',
      SiteName: 'SiteName',
      ListName: 'ListName',
      ItemId: 'ItemId',
      DepartmentId: 'DepartmentId',
      ParentId: 'ParentId'

      // ❌ TUYỆT ĐỐI KHÔNG MAP:
      // ParentTaskID
      // ParentTaskID_bak
    },

    defaultValues: {
      // 🔥 FIX NGUỒN – STRING CỐ ĐỊNH
        tb_bak: 'task3',

      project_id: null
    },

    handleDuplicateId: true,
    backupIdField: 'id_taskBackups'
  }
};

module.exports = { tableMappings };
