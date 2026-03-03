const { v4: uuidv4 } = require('uuid');

const tableMappings = {
  meeting: {
    /* ================= OLD DB (SharePoint) ================= */
    oldTable: 'AllUserData',
    oldSchema: 'dbo',
    oldDatabase: process.env.OLD_DB_WSS_CONTENT,

    whereClause: `
      tp_ListId = 'B0F4D2C4-D65B-42AB-A37A-9D45118A2A2C'
      AND tp_RowOrdinal = 0
      AND tp_IsCurrentVersion = 1
    `,

    /* ================= NEW DB ================= */
    newTable: 'meetings',
    newSchema: 'dbo',
    newDatabase: process.env.NEW_DB_NAME,

    /* ================= FIELD MAP (XML → MEMORY) ================= */
    fieldMapping: {
      tp_ID: 'sharepoint_item_id',

      nvarchar1: 'title',
      nvarchar3: 'room_ids',
      nvarchar6: 'meeting_type',
      nvarchar11: 'recurrence_type',
      nvarchar14: 'chairman_id',

      ntext7: 'content',

      datetime1: 'started_at',
      datetime2: 'ended_at',

      int2: 'duration_seconds',

      bit5: 'is_online',
      bit8: 'is_important',

      tp_Version: 'sharepoint_version',
      tp_Created: 'created_at',
      tp_Modified: 'updated_at'
    },

    requiredFields: ['nvarchar1', 'datetime1'],

    /* ================= DEFAULT VALUES (MATCH TABLE) ================= */
    defaultValues: {
      id: () => uuidv4(),

      /* ===== CORE ===== */
      title: (r) => r?.nvarchar1 || 'Không tiêu đề',
      meeting_type: (r) => r?.nvarchar6 || 'HOP_THUONG',
      priority: (r) => (r?.bit8 ? 'HIGH' : null),

      meeting_date: (r) => {
        if (!r?.datetime1) return null;
        return new Date(r.datetime1);
      },

      meeting_time: (r) => {
        if (!r?.datetime1) return '00:00';
        return new Date(r.datetime1).toTimeString().substring(0, 5);
      },

      meeting_mode: (r) => (r?.bit5 ? 'ONLINE' : 'OFFLINE'),

      room_ids: (r) => r?.nvarchar3 || null,
      status: 'ACTIVE',

      bpmn_version: process.env.DEFAULT_BPMN_VERSION || null,
      content: (r) => r?.ntext7 || null,

      chairman_id: (r) => r?.nvarchar14 || null,
      secretary_id: null,

      online_meeting_id: null,

      created_at: (r) => r?.tp_Created || new Date(),
      updated_at: (r) => r?.tp_Modified || new Date(),

      status_code: 'MIGRATED',
      direct_command: null,
      conclusion: null,
      created_by: 'SYSTEM_MIGRATION',

      attendance_locked: 0,
      meeting_state: 'DU_KIEN',

      started_at: (r) => r?.datetime1 || null,
      ended_at: (r) => r?.datetime2 || null,

      timezone: 'Asia/Ho_Chi_Minh',
      is_company: 0,
      organizational_unit: null,
      is_assigning_seat: 'NOT_ASSIGN',

      cancelled_by: null,
      cancelled_at: null,
      cancelled_reason: null,

      is_template: 0,
      parent_id: null,
      recurrence_group_id: null,
      is_cancelled: 0,
      is_override_instance: 0,

      sharepoint_version: (r) => r?.tp_Version || null
    },

    /* ================= DUPLICATE CHECK ================= */
    duplicateCheck: {
      fields: ['sharepoint_item_id'],
      strategy: 'skip'
    },

    backupIdField: 'sharepoint_item_id',

    /* =======================================================
       ================= CHILD TABLES ========================
    ======================================================== */

    childTables: {

      /* ===== ONLINE MEETINGS ===== */
      online_meetings: {
        table: 'online_meetings',
        map: (r, meetingId) => {
          if (!r?.bit5) return null;

          return {
            id: uuidv4(),
            platform: 'OTHER',
            meeting_link: r?.nvarchar20 || 'N/A',
            meeting_id: meetingId,
            passcode: null
          };
        }
      },

      /* ===== MEETING UNITS ===== */
      meeting_units: {
        table: 'meeting_units',
        map: (r, meetingId) => {
          if (!r?.nvarchar40) return [];

          return r.nvarchar40.split(';').map(unit => ({
            id: uuidv4(),
            meeting_id: meetingId,
            unit_id: unit.trim(),
            seat_number: null,
            room_id: null,
            unit_state: 'PENDING',
            accept_join: 0,
            assign_participants: 0,
            prepare_documents: 0,
            processby: null
          }));
        }
      },

      /* ===== PARTICIPANTS ===== */
      meeting_participants: {
        table: 'meeting_participants',
        map: () => []
      },

      /* ===== GUESTS ===== */
      meeting_guests: {
        table: 'meeting_guests',
        map: (r, meetingId) => {
          if (!r?.nvarchar60) return [];

          return r.nvarchar60.split(';').map(name => ({
            id: uuidv4(),
            meeting_id: meetingId,
            guest_name: name.trim(),
            guest_title: null,
            created_at: new Date(),
            updated_at: new Date(),
            seat_number: null,
            room_id: null
          }));
        }
      },

      /* ===== RECURRENCE ===== */
      meeting_recurrences: {
        table: 'meeting_recurrences',
        map: (r, meetingId) => {
          if (!r?.nvarchar11) return null;

          return {
            id: uuidv4(),
            meeting_id: meetingId,
            type: r.nvarchar11,
            start_date: r?.datetime1
              ? new Date(r.datetime1)
              : new Date(),
            end_date: null,
            days_of_week: null,
            day_of_month: null,
            day_of_year: null,
            interval_value: null
          };
        }
      }
    }
  }
};

module.exports = { tableMappings };