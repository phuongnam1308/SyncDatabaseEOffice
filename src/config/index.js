const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, 'sync_config.json');
const syncConfigRaw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Helper to get keywords
const getKeywords = (roleKey) => syncConfigRaw.roles[roleKey]?.keywords || [];

// Constants & Mappings
const ROLE_MAPPINGS = {
  ADMIN: {
    KEYWORDS: getKeywords('ADMIN') || ["admin", "quản trị viên"],
    ROLES:    syncConfigRaw.process_mappings.ADMIN.ROLES
  },
  GIAM_DOC: {
    KEYWORDS: getKeywords('GIAM_DOC'),
    ROLES:    syncConfigRaw.process_mappings.GIAM_DOC.ROLES
  },
  PHO_GIAM_DOC: {
    KEYWORDS: getKeywords('PHO_GIAM_DOC'),
    ROLES:    syncConfigRaw.process_mappings.PHO_GIAM_DOC.ROLES
  },
  CHANH_VAN_PHONG: {
    KEYWORDS: getKeywords('CHANH_VAN_PHONG'),
    ROLES:    []
  },
  TRUONG_PHONG: {
    KEYWORDS: getKeywords('TRUONG_PHONG'),
    ROLES:    syncConfigRaw.process_mappings.TRUONG_PHONG.ROLES
  },
  PHO_TRUONG_PHONG: {
    KEYWORDS: getKeywords('PHO_TRUONG_PHONG'),
    ROLES:    syncConfigRaw.process_mappings.PHO_TRUONG_PHONG.ROLES
  },
  VAN_THU_CUC: {
    KEYWORDS: getKeywords('VAN_THU_CUC') || ["văn thư cục"],
    ROLES:    syncConfigRaw.process_mappings.VAN_THU_CUC.ROLES
  },
  VAN_THU: {
    KEYWORDS: getKeywords('VANTHU'),
    ROLES:    syncConfigRaw.process_mappings.VAN_THU.ROLES
  },
  NHAN_VIEN: {
    KEYWORDS: getKeywords('NHAN_VIEN'),
    ROLES:    syncConfigRaw.process_mappings.NHAN_VIEN.ROLES
  }
};

const OUTGOING_SYNC_CONFIG = syncConfigRaw.settings;

/**
 * Gets the workflow configuration for a specific document type.
 * Automatically injects the unified keywords into each process step.
 *
 * @param {string} docType - 'outgoing' | 'incoming'
 * @returns {object} { WORKFLOW_PROCESS_CONFIG, DEFAULT_WORKFLOW_PROCESS }
 */
const getWorkflowConfig = (docType = 'outgoing') => {
  const workflowGroup = syncConfigRaw.workflow_config[docType] || syncConfigRaw.workflow_config.outgoing;

  const workflow_process = (workflowGroup.workflow_process || []).map(p => {
    // Map normalized role names to their definitions
    const roleKeyMap = {
      "VANTHU": "VANTHU",
      "Giám đốc": "GIAM_DOC",
      "Chánh văn phòng": "CHANH_VAN_PHONG",
      "Phó giám đốc": "PHO_GIAM_DOC",
      "Trưởng phòng": "TRUONG_PHONG",
      "Phó trưởng phòng": "PHO_TRUONG_PHONG",
      "Cán bộ": "NHAN_VIEN"
    };
    const key = roleKeyMap[p.role];
    if (key) {
      p.keywords = getKeywords(key);
    }
    return p;
  });

  return {
    WORKFLOW_PROCESS_CONFIG: workflow_process,
    DEFAULT_WORKFLOW_PROCESS: workflowGroup.default
  };
};

module.exports = {
  // Legacy exports for compatibility
  ...Object.keys(ROLE_MAPPINGS).reduce((acc, key) => {
    acc[`${key}_KEYWORDS`] = ROLE_MAPPINGS[key].KEYWORDS;
    acc[`ROLES_${key}`] = ROLE_MAPPINGS[key].ROLES;
    return acc;
  }, {}),

  ROLES_DEFAULT: ROLE_MAPPINGS.NHAN_VIEN.ROLES,
  NHANVIEN_KEYWORDS: ROLE_MAPPINGS.NHAN_VIEN.KEYWORDS,

  USER_PAREN_DEFAULT: OUTGOING_SYNC_CONFIG.USER_PAREN_DEFAULT,
  BEGIN_LIMIT:        OUTGOING_SYNC_CONFIG.BEGIN_LIMIT,
  COMPLETED_LIMIT:    OUTGOING_SYNC_CONFIG.COMPLETED_LIMIT,

  ...OUTGOING_SYNC_CONFIG.STATUS_TABS,

  // Provide a function to load the correct workflow config based on document type
  getWorkflowConfig,

  ROLE_MAPPINGS,
  OUTGOING_SYNC_CONFIG
};
