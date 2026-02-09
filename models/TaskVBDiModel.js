// models/TaskVBDiModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const mssql = require('mssql');

class TaskVBDiModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'TaskVBDi';
    this.oldSchema = 'dbo';
    this.newTable = 'task3';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          [ID],
          [VBId],
          [DepartmentId],
          [ParentId],
          [Title],
          [DanhGia],
          [DeBaoCao],
          [DeBiet],
          [DeThucHien],
          [DuocHuy],
          [DiemChatLuong],
          [DiemThoiGian],
          [DiemDanhGia],
          [StartDate],
          [DueDate],
          [CompletedDate],
          [HoanTatTuDong],
          [HoSoDuThaoId],
          [HoSoDuThaoUrl],
          [HoSoXuLyUrl],
          [Percent],
          [TrangThai],
          [Priority],
          [YKienCuaNguoiGiaiQuyet],
          [YKienChiDao],
          [ModuleId],
          [SiteName],
          [ListName],
          [ItemId],
          [Modified],
          [Created],
          [ModifiedBy],
          [CreatedBy],
          [MigrateFlg],
          [MigrateErrFlg],
          [MigrateErrMess],
          [ParentTaskID]
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách TaskVBDi từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_taskBackups = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm task vbdi theo id_taskBackups trong task3:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      logger.info('Dữ liệu sắp insert vào task3:', JSON.stringify(data, (k, v) => v instanceof Date ? v.toISOString() : v, 2));

      const fields = Object.keys(data);
      const escapedFields = fields.map(field => 
        field.toLowerCase() === 'order' ? '[order]' : 
        field.toLowerCase() === 'role' ? '[role]' : 
        field.toLowerCase() === 'action' ? '[action]' : 
        field.toLowerCase() === 'month' ? '[month]' : 
        field.toLowerCase() === 'path' ? '[path]' : field
      ).join(', ');

      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${escapedFields}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();

      fields.forEach((field, i) => {
        let value = data[field];

        if (value === undefined) value = null;

        if (value === null) {
          request.input(`param${i}`, mssql.NVarChar, null);
        } else if (['start_date', 'end_date', 'repetitive_start', 'repetitive_end', 'update_at', 'created_at'].includes(field)) {
          const dateValue = new Date(value);
          request.input(`param${i}`, mssql.DateTime2, isNaN(dateValue.getTime()) ? null : dateValue);
        } else if (['DanhGia', 'DeBaoCao', 'DeBiet', 'DeThucHien', 'DuocHuy'].includes(field)) {
          request.input(`param${i}`, mssql.Bit, value);
        } else if (['status', 'approval_status', 'recurring_from_id', 'meeting_conclusion_id'].includes(field)) {
          request.input(`param${i}`, mssql.Int, value);
        } else {
          request.input(`param${i}`, value);
        }
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert vào task3:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = TaskVBDiModel;  // <-- Export default class