const keywordsTable = require('./keywords');
const permissionsTable = require('./permissions');
const settings = require('./settings');
const workflowIncoming = require('./workflows/incoming');
const workflowOutgoing = require('./workflows/outgoing');

// Helper to get keywords
const getKeywords = (roleKey) => keywordsTable[roleKey]?.keywords || [];

// Constants & Mappings
const ROLE_MAPPINGS = {
  ADMIN: {
    KEYWORDS: getKeywords('ADMIN'),
    ROLES:    permissionsTable.ADMIN?.ROLES || []
  },
  GIAM_DOC: {
    KEYWORDS: getKeywords('GIAM_DOC'),
    ROLES:    permissionsTable.GIAM_DOC?.ROLES || []
  },
  PHO_GIAM_DOC: {
    KEYWORDS: getKeywords('PHO_GIAM_DOC'),
    ROLES:    permissionsTable.PHO_GIAM_DOC?.ROLES || []
  },
  CHANH_VAN_PHONG: {
    KEYWORDS: getKeywords('CHANH_VAN_PHONG'),
    ROLES:    []
  },
  TRUONG_PHONG: {
    KEYWORDS: getKeywords('TRUONG_PHONG'),
    ROLES:    permissionsTable.TRUONG_PHONG?.ROLES || []
  },
  PHO_TRUONG_PHONG: {
    KEYWORDS: getKeywords('PHO_TRUONG_PHONG'),
    ROLES:    permissionsTable.PHO_TRUONG_PHONG?.ROLES || []
  },
  PHO_CHANH_VAN_PHONG: {
    KEYWORDS: getKeywords('PHO_CHANH_VAN_PHONG'),
    ROLES:    []
  },
  VAN_THU_CUC: {
    KEYWORDS: getKeywords('VAN_THU_CUC') || ["văn thư cục"],
    ROLES:    permissionsTable.VAN_THU_CUC?.ROLES || []
  },
  VAN_THU: {
    KEYWORDS: getKeywords('VANTHU'),
    ROLES:    permissionsTable.VAN_THU?.ROLES || []
  },
  CAN_BO: {
    KEYWORDS: getKeywords('CAN_BO'),
    ROLES:    permissionsTable.CAN_BO?.ROLES || []
  }
};
const KEYWORDS = Object.keys(ROLE_MAPPINGS).reduce((acc, key) => {
  acc[key] = ROLE_MAPPINGS[key].KEYWORDS;
  return acc;
}, {});

const OUTGOING_SYNC_CONFIG = settings;

/**
 * Gets the workflow configuration for a specific document type.
 * Automatically injects the unified keywords into each process step.
 *
 * @param {string} docType - 'outgoing' | 'incoming'
 * @returns {object} { WORKFLOW_PROCESS_CONFIG, DEFAULT_WORKFLOW_PROCESS }
 */
const getWorkflowConfig = (docType = 'outgoing') => {
  const workflowGroup = docType === 'incoming' ? workflowIncoming : workflowOutgoing;

  const workflow_process = (workflowGroup.workflow_process || []).map(p => {
    // Map normalized role names to their definitions
    const roleKeyMap = {
      "VANTHU": "VANTHU",
      "GIAM_DOC": "GIAM_DOC",
      "PHO_GIAM_DOC": "PHO_GIAM_DOC",
      "CHANH_VAN_PHONG": "CHANH_VAN_PHONG",
      "PHO_CHANH_VAN_PHONG": "PHO_CHANH_VAN_PHONG",
      "TRUONG_PHONG": "TRUONG_PHONG",
      "PHO_TRUONG_PHONG": "PHO_TRUONG_PHONG",
      "CAN_BO": "CAN_BO",
      "NHAN_VIEN": "CAN_BO",
      // Legacy support for human-readable strings if needed
      "Giám đốc": "GIAM_DOC",
      "Chánh văn phòng": "CHANH_VAN_PHONG",
      "Phó chánh văn phòng": "PHO_CHANH_VAN_PHONG",
      "Phó giám đốc": "PHO_GIAM_DOC",
      "Trưởng phòng": "TRUONG_PHONG",
      "Phó trưởng phòng": "PHO_TRUONG_PHONG",
      "Cán bộ": "CAN_BO"
    };

    // Use a copy to avoid mutating the original exported objects
    const processCopy = { ...p };
    const key = roleKeyMap[p.role] || p.role; // Use role key directly if not in map
    if (key) {
      processCopy.keywords = getKeywords(key);
    }
    return processCopy;
  });

  return {
    WORKFLOW_PROCESS_CONFIG: workflow_process,
    DEFAULT_WORKFLOW_PROCESS: workflowGroup.default
  };
};

module.exports = {
  // Legacy exports for compatibility
  ...Object.keys(ROLE_MAPPINGS).reduce((acc, key) => {
    acc[`${key}_KEYWORDS`] = KEYWORDS[key];
    acc[`ROLES_${key}`] = ROLE_MAPPINGS[key].ROLES;
    return acc;
  }, {}),

  ROLES_DEFAULT: ROLE_MAPPINGS.CAN_BO.ROLES,
  NHANVIEN_KEYWORDS: ROLE_MAPPINGS.CAN_BO.KEYWORDS,

  USER_PAREN_DEFAULT: OUTGOING_SYNC_CONFIG.USER_PAREN_DEFAULT,
  BEGIN_LIMIT:        OUTGOING_SYNC_CONFIG.BEGIN_LIMIT,
  COMPLETED_LIMIT:    OUTGOING_SYNC_CONFIG.COMPLETED_LIMIT,

  ...OUTGOING_SYNC_CONFIG.STATUS_TABS,


  // Provide a function to load the correct workflow config based on document type
  getWorkflowConfig,

  ROLE_MAPPINGS,
  KEYWORDS,
  OUTGOING_SYNC_CONFIG
};
