const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { taskUsers2ProcessOrgMapping } =
  require('../config/taskUsers2ProcessOrgMapping');

class TaskUsers2ProcessOrgMappingModel extends BaseModel {
  constructor() {
    super();
    this.cfg = taskUsers2ProcessOrgMapping;
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

  async findOrgByBackupId(bakId) {
    const { orgTable, orgBackupField } = this.cfg;

    const query = `
      SELECT TOP 1 id, name
      FROM ${orgTable.schema}.${orgTable.table}
      WHERE ${orgBackupField} = @bakId
    `;

    const result = await this.queryNewDb(query, { bakId });
    return result.length ? result[0] : null;
  }

  async updateProcess(id, org) {
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
      processId: org.id,
      processName: org.name
    });
  }
}

module.exports = TaskUsers2ProcessOrgMappingModel;
