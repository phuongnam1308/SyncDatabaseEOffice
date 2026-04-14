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

  if (mapConfigs[actionKey]) {
    // Ưu tiên nạp role đặc biệt được cấu hình tường minh
    if (mapConfigs[actionKey][roleKey] !== undefined) {
      return mapConfigs[actionKey][roleKey];
    }
    // Fallback sang giá trị mặc định của hành động đó
    if (mapConfigs[actionKey]['default'] !== undefined) {
      return mapConfigs[actionKey]['default'];
    }
  }

  // Fallback an toàn phòng khi actionKey không hề tồn tại trong map
  return 1;
}

module.exports = {
  getStatusCodeByAction
};
