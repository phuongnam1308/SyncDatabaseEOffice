const outgoingMap = require('./outgoing');
const incomingMap = require('./incoming');

/**
 * Trả về status_code tương ứng dựa trên loại văn bản, hành động và vai trò
 * Nếu không cấu hình, mặc định trả về 1 (fallback)
 * 
 * @param {string} typeDocument 
 * @param {string} actionCode 
 * @param {string} role 
 * @returns {number|null}
 */
function getStatusCodeByAction(typeDocument, actionCode, role) {
  if (!actionCode || !role) return 1;

  const isIncoming = ['IncomingDocument', 'IncommingDocument'].includes(typeDocument);
  const mapConfigs = isIncoming ? incomingMap : outgoingMap;

  // actionCode nếu không chuẩn thì uppercase
  const actionKey = actionCode.toUpperCase();
  let roleKey = role.toUpperCase();
  if (roleKey === 'VANTHU') roleKey = 'VAN_THU';
  if (roleKey === 'NHAN_VIEN') roleKey = 'CAN_BO';

  if (mapConfigs[actionKey] && mapConfigs[actionKey][roleKey] !== undefined) {
    return mapConfigs[actionKey][roleKey];
  }

  // Fallback mặc định
  return 1;
}

module.exports = {
  getStatusCodeByAction
};
