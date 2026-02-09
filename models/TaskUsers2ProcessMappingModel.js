const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { taskUsers2ProcessMapping } =
  require('../config/taskUsers2ProcessMapping');

class TaskUsers2ProcessMappingModel extends BaseModel {
  constructor() {
    super();
    this.cfg = taskUsers2ProcessMapping;
  }

  async getNeedMapping() {
    const { sourceTable, condition, sourceUserBakField } = this.cfg;

    const query = `
      SELECT id, ${sourceUserBakField}
      FROM ${sourceTable.schema}.${sourceTable.table}
      WHERE ${condition}
    `;
    return await this.queryNewDb(query);
  }

  async findUserByBakId(userIdBak) {
    const { userTable, matchFields } = this.cfg;

    const whereClause = matchFields
      .map(f => `${f} = @userIdBak`)
      .join(' OR ');

    const query = `
      SELECT TOP 1 id, name
      FROM ${userTable.schema}.${userTable.table}
      WHERE ${whereClause}
    `;

    const result = await this.queryNewDb(query, { userIdBak });
    return result.length ? result[0] : null;
  }

  async updateProcess(id, user) {
    const { sourceTable, updateTimeField } = this.cfg;

    const query = `
      UPDATE ${sourceTable.schema}.${sourceTable.table}
      SET
        process_id = @processId,
        process_name = @processName,
        ${updateTimeField} = GETDATE()
      WHERE id = @id
    `;

    await this.queryNewDb(query, {
      id,
      processId: user.id,
      processName: user.name
    });
  }
}

module.exports = TaskUsers2ProcessMappingModel;
