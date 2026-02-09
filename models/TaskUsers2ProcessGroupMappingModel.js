const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { taskUsers2ProcessGroupMapping } =
  require('../config/taskUsers2ProcessGroupMapping');

class TaskUsers2ProcessGroupMappingModel extends BaseModel {
  constructor() {
    super();
    this.cfg = taskUsers2ProcessGroupMapping;
  }

  async getNeedMapping() {
    const { sourceTable, condition, sourceBakField } = this.cfg;

    const query = `
      SELECT id, ${sourceBakField}
      FROM ${sourceTable.schema}.${sourceTable.table}
      WHERE ${condition}
        AND (process_id IS NULL OR process_name IS NULL)
    `;
    return await this.queryNewDb(query);
  }

  async findGroupByBackupId(bakId) {
    const { groupTable, groupBackupField } = this.cfg;

    const query = `
      SELECT TOP 1 id, name
      FROM ${groupTable.schema}.${groupTable.table}
      WHERE ${groupBackupField} = @bakId
    `;

    const result = await this.queryNewDb(query, { bakId });
    return result.length ? result[0] : null;
  }

  async updateProcess(id, group) {
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
      processId: group.id,
      processName: group.name
    });
  }
}

module.exports = TaskUsers2ProcessGroupMappingModel;
