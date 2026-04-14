
const workflow_process = [
  require('./vanthu.js'),
  require('./giam_doc.js'),
  require('./chanh_van_phong.js'),
  require('./pho_giam_doc.js'),
  require('./pho_chanh_van_phong.js'),
  require('./truong_phong.js'),
  require('./pho_truong_phong.js'),
  require('./can_bo.js')
];

module.exports = {
  workflow_process,
  default: {
  "status_code": 2,
  "bpmn_version": "VAN_BAN_DI",
  "type_of_process": "VAN_BAN_DI",
  "curStatusCode": 1,
  "stage_status": "CHUA_XU_LY",
  "role": "NGUOI_SOAN_THAO",
  "action_code": "CREATE"
}
};
