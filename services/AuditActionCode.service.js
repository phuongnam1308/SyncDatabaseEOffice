const AuditActionCodeModel = require('../models/AuditActionCode.model');

class AuditActionCodeService {
  constructor() {
    this.model = new AuditActionCodeModel();
    this.mappings = [];
  }

  async initialize() {
    await this.model.initialize();
    this.mappings = await this.model.getActionCodeMapping();
  }

  resolveActionCode(hanhDong) {
    if (!hanhDong) return null;
    const text = hanhDong.toLowerCase();

    for (const m of this.mappings) {
      const keywords = [
        m.keyword_pattern,
        m.keyword_pattern_2,
        m.keyword_pattern_3,
        m.keyword_pattern_4
      ]
        .filter(Boolean)
        .map(k => k.replace(/%/g, '').toLowerCase());

      if (keywords.length === 0) continue;

      // match_type = 0 → OR
      if (m.match_type === 0) {
        if (keywords.some(k => text.includes(k))) {
          return m.action_code;
        }
      }

      // match_type = 1 → AND
      if (m.match_type === 1) {
        if (keywords.every(k => text.includes(k))) {
          return m.action_code;
        }
      }
    }

    return null;
  }

  async execute() {
    const audits = await this.model.getAudit2NeedUpdate();
    let updated = 0;

    for (const a of audits) {
      const actionCode = this.resolveActionCode(a.HanhDong);
      if (actionCode) {
        await this.model.updateActionCode(a.id, actionCode);
        updated++;
      }
    }

    return {
      total: audits.length,
      updated
    };
  }
}

module.exports = AuditActionCodeService;
