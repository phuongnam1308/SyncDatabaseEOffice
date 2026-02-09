class FileRelationTypeResolverService {
  constructor(model, logger) {
    this.model = model;
    this.logger = logger;
  }

  async resolve() {
    const rows = await this.model.getCandidates();

    let resolved = 0;
    let skipped = 0;
    const detail = [];

    for (const row of rows) {
      const inferred = this.model.resolveObjectType(row.type_doc);

      this.logger.info(
        `[RESOLVE] id=${row.id} | type_doc="${row.type_doc}" | inferred=${inferred}`
      );

      if (inferred && row.object_type !== inferred) {
        await this.model.updateObjectType(row.id, inferred);
        resolved++;
        detail.push({
          id: row.id,
          type_doc: row.type_doc,
          object_type: inferred
        });
      } else {
        skipped++;
      }
    }

    return {
      resolved,
      skipped,
      total: rows.length,
      data: detail
    };
  }
}

module.exports = FileRelationTypeResolverService;
