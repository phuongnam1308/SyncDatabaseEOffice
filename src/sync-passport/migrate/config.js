require('dotenv').config();
const mapping = require('./mapping.json');
const statusMapping = require('./status_mapping.json');

/* ===================== UTIL ===================== */

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const normalizeStr = (str) => {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
};

const mapStatus = (oldStatus) => {
  if (!oldStatus) return statusMapping.DEFAULT || 'PENDING';
  const s = String(oldStatus).trim();
  const ns = normalizeStr(s);

  // 1. Exact match
  if (statusMapping.MAPPING?.[s]) return statusMapping.MAPPING[s];

  // 2. Normalized exact match or partial match
  for (const [key, val] of Object.entries(statusMapping.MAPPING || {})) {
    const nk = normalizeStr(key);
    if (ns === nk || ns.includes(nk) || nk.includes(ns)) return val;
  }

  return statusMapping.DEFAULT || 'PENDING';
};

/* ===================== TABLE MAPPING ===================== */
// Đọc DB từ env - đồng nhất với các module khác trong project:
//   - OLD DB: SHAREPOINT_DB_NAME (WSS_Content_eoffice_khkd)
//   - NEW DB: NEW_DB_NAME (app_tancang)
const tableMappings = {
  passport: {
    // ============ SOURCE (SharePoint AllUserData) ============
    oldTable:       mapping.oldTable       || 'AllUserData',
    oldSchema:      mapping.oldSchema      || 'dbo',
    oldDatabase:    process.env.SHAREPOINT_DB_NAME || mapping.oldDatabase,  // env: WSS_Content_eoffice_khkd
    oldUserDatabase: mapping.oldUserDatabase || process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd',

    listIds: mapping.listIds || [],

    // Multi-DB Support: Read from databases.json if exists
    databaseList: (() => {
      try {
        return require('./databases.json');
      } catch (e) {
        return null;
      }
    })(),

    // ============ TARGET (camunda / app_tancang) ============
    newTable:  mapping.newTable  || 'passport_borrow_requests',
    newSchema: mapping.newSchema || 'dbo',
    newDatabase: process.env.NEW_DB_NAME || 'app_tancang',                  // env: app_tancang

    // ============ EXTERNAL KEY ============
    externalKey:   mapping.externalKey || 'sharepoint_item_id',
    backupIdField: 'sharepoint_item_id',

    // ============ DEFAULTS ============
    defaults: mapping.defaults || {},
  },
};

module.exports = { tableMappings, mapStatus, parseDate };
