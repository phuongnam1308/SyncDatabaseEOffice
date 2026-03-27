// Import các module cần thiết
const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");
const ReceiverParserService = require("./ReceiverParserService");
const sql = require("mssql");

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đi
const CATEGORY_RELEASE_DV = "Phát hành văn bản ĐV";
const CATEGORY_RELEASE_TCT = "Phát hành văn bản TCT";
const CATEGORY_OUTGOING = "Văn bản đi";

// Định nghĩa các hằng số cho danh mục (Category) của văn bản đến
const CATEGORY_INCOMING_SUBMIT = "Văn bản trình ký";
const CATEGORY_INCOMING_TCT = "Văn bản đến TCT";
const CATEGORY_INCOMING= "Văn bản đến";
const CATEGORY_INCOMING_INTERNAL= "Văn bản nội bộ";

// Tạo các tập hợp (Set) để kiểm tra category hiệu quả
const INCOMING_CATEGORIES = new Set([
  CATEGORY_INCOMING_SUBMIT,
  CATEGORY_INCOMING_TCT,
  CATEGORY_INCOMING,
  CATEGORY_INCOMING_INTERNAL,
]);
const OUTGOING_CATEGORIES = new Set([
  CATEGORY_RELEASE_DV,
  CATEGORY_RELEASE_TCT,
  CATEGORY_OUTGOING,
]);


// --- CẤU HÌNH QUY TRÌNH (WORKFLOW PROCESS) ---
const WORKFLOW_PROCESS_CONFIG = [
  {
    "role": "VANTHU",
    "keywords": ["văn thư", "vt", "văn thư cục", "văn thư bảo mật", "bảo mật lưu trữ", "văn thư lưu trữ"],
    "screens": [
      {
        "screen_name": "Màn phát hành - chờ phát hành",
        "trangthais": ["chờ phát hành"],
        "status_code": 16,
        "bpmn_version": "SOANTHAO_PHATHANH_CQD",
        "type_of_process": "SOANTHAO_PHATHANH_CQD",
        "curStatusCode": 3,
        "stage_status": "DA_XU_LY",
        "role": "VAN_THU",
        "action_code": "TRINH_KY"
      },
      {
        "screen_name": "Màn phát hành - Đã phát hành",
        "trangthais": ["đã phát hành", "phát hành"],
        "status_code": 9,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 9,
        "stage_status": "BAN_HANH_DU_THAO",
        "role": "VAN_THU",
        "action_code": "DONG_DAU"
      },
      {
        "screen_name": "Màn xử lý - Chờ xử lý",
        "trangthais": ["chờ xử lý"],
        "status_code": 2,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 2,
        "stage_status": "CHUA_XU_LY",
        "role": "NGUOI_SOAN_THAO",
        "action_code": "TRINH_KIEM_TRA_TT"
      },
      {
        "screen_name": "Màn xử lý - Đã xử lý",
        "trangthais": ["đã xử lý"],
        "status_code": 6,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 3,
        "stage_status": "DA_XU_LY",
        "role": "VAN_THU",
        "action_code": "TRINH_KY"
      },
      {
        "screen_name": "Màn xử lý - Đã phát hành",
        "trangthais": ["đã ban hành"],
        "status_code": 9,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 9,
        "stage_status": "DA_BAN_HANH",
        "role": "VAN_THU",
        "action_code": "BAN_HANH"
      },
      {
        "screen_name": "Màn đóng dấu - chờ đóng dấu",
        "trangthais": ["chờ đóng dấu"],
        "status_code": 100,
        "bpmn_version": "KY_SO_HS_VBD",
        "type_of_process": "KY_SO_HS_VBD",
        "curStatusCode": 100,
        "stage_status": "CHO_DONG_DAU",
        "role": "NGUOI_KY_PHE_DUYET",
        "action_code": "KY_SO"
      },
      {
        "screen_name": "Màn đóng dấu - đã đóng dấu",
        "trangthais": ["đã đóng dấu"],
        "status_code": 6,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 3,
        "stage_status": "DA_XU_LY",
        "role": "VAN_THU",
        "action_code": "TRINH_KY"
      }
    ]
  },
  {
    "role": "Giám đốc",
    "keywords": [
      "giám đốc", "tổng giám đốc", "giám đốc cn", "giám đốc trung tâm", "giám đốc nhân sự", 
      "chủ tịch kiêm giám đốc", "chủ tịch hđqt", "chủ tịch hội đồng quản trị", "chủ tịch", 
      "chính ủy", "tham mưu trưởng", "tmt", "phó tổng giám đốc", "cn chính trị", "đại phó", 
      "hải đoàn trưởng", "phó chủ tịch hội đồng thành viên", "phó chủ tịch hđtv", 
      "thành viên hđtv", "thành viên hội đồng thành viên", "thư ký thường trực hội đồng thành viên", 
      "thư ký tổng giám đốc"
    ],
    "screens": [
      {
        "screen_name": "Màn xử lý - chờ xử lý",
        "trangthais": ["trình ký", "chờ ký", "chờ xử lý"],
        "status_code": 6,
        "bpmn_version": "QUY_TRINH_KY_UQ",
        "type_of_process": "QUY_TRINH_KY_UQ",
        "curStatusCode": 6,
        "stage_status": "CHO_KY_BAN_HANH",
        "role": "NGUOI_KY_THE_THUC",
        "action_code": "KY_NHAY_THE_THUC"
      },
      {
        "screen_name": "Màn xử lý - đã xử lý",
        "trangthais": ["đã ký", "đã duyệt", "đã xử lý"],
        "status_code": 16,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 7,
        "stage_status": "CHUA_XU_LY",
        "role": "NGUOI_KY_BAN_HANH",
        "action_code": "KY_SO"
      },
      {
        "screen_name": "Màn xử lý - đã phát hành",
        "trangthais": ["đã ban hành", "đã phát hành", "phát hành"],
        "status_code": 9,
        "bpmn_version": "SOANTHAO_PHATHANH_CQD",
        "type_of_process": "SOANTHAO_PHATHANH_CQD",
        "curStatusCode": 15,
        "stage_status": "BAN_HANH_DU_THAO",
        "role": "NGUOI_KY_BAN_HANH",
        "action_code": "KY_SO"
      }
    ]
  },
  {
    "role": "Chánh văn phòng",
    "keywords": ["chánh văn phòng", "cvp"],
    "screens": [
      {
        "screen_name": "Màn xử lý - chờ xử lý",
        "trangthais": ["chờ xử lý"],
        "status_code": 5,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 5,
        "stage_status": "CHO_KY_THE_THUC",
        "role": "NGUOI_KY_NOI_DUNG",
        "action_code": "KY_NHAY_NOI_DUNG"
      },
      {
        "screen_name": "Màn xử lý - đã xử lý",
        "trangthais": ["đã xử lý"],
        "status_code": 16,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 16,
        "stage_status": "VAN_THU",
        "role": "VAN_THU",
        "action_code": "DONG_DAU"
      },
      {
        "screen_name": "Màn xử lý - đã phát hành",
        "trangthais": ["đã ban hành"],
        "status_code": 9,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 9,
        "stage_status": "DA_BAN_HANH",
        "role": "VAN_THU",
        "action_code": "BAN_HANH"
      }
    ]
  },
  {
    "role": "Phó giám đốc",
    "keywords": ["phó giám đốc", "phó gđ", "phó gd", "phó chính ủy", "phó tham mưu trưởng"],
    "screens": []
  },
  {
    "role": "Phó chánh văn phòng",
    "keywords": ["phó chánh văn phòng"],
    "screens": []
  },
  {
    "role": "Trưởng phòng",
    "keywords": [
      "trưởng phòng", "tp", "trưởng ban", "trưởng trung tâm", "trưởng chi nhánh", "trưởng ter", 
      "quản đốc", "kế toán trưởng", "chủ nhiệm", "phụ trách phòng", "tp tài chính", "tp.điều độ", 
      "tp.tchc", "quyền tpth", "trưởng dp", "dpa", "trưởng khu", "trưởng ban thương vụ", 
      "trưởng ban giao nhận", "trạm trưởng", "trưởng trạm", "thuyền trưởng", "máy trưởng", 
      "máy trưởng tàu khách", "xe trưởng", "trưởng depot", "trưởng văn phòng đại diện", 
      "trưởng ttpp", "trưởng đhsx", "trưởng tmn", "xưởng trưởng", "trung đội trưởng", 
      "trưởng trực ban", "trưởng khu kho hàng"
    ],
    "screens": [
      {
        "screen_name": "Dự thảo - dự thảo",
        "trangthais": ["trả lại", "dự thảo"],
        "status_code": 1,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 1,
        "stage_status": "CHUA_XU_LY",
        "role": "NGUOI_KY_NOI_DUNG",
        "action_code": "TRA_LAI"
      },
      {
        "screen_name": "Xử lý - chờ xử lý",
        "trangthais": ["chờ xử lý"],
        "status_code": 3,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 3,
        "stage_status": "CHO_KY_NOI_DUNG",
        "role": "VAN_THU",
        "action_code": "TRINH_KY"
      },
      {
        "screen_name": "xử lý - đã xử lý",
        "trangthais": ["đã xử lý"],
        "status_code": 16,
        "bpmn_version": "SOANTHAO_PHATHANH_CQD",
        "type_of_process": "SOANTHAO_PHATHANH_CQD",
        "curStatusCode": 4,
        "stage_status": "DA_XU_LY",
        "role": "NGUOI_KY_NOI_DUNG",
        "action_code": "KY_NHAY_NOI_DUNG"
      },
      {
        "screen_name": "xử lý - đã phát hành",
        "trangthais": ["đã ban hành"],
        "status_code": 5,
        "bpmn_version": "QTVBNB",
        "type_of_process": "QTVBNB",
        "curStatusCode": 15,
        "stage_status": "BAN_HANH_DU_THAO",
        "role": "CHI_HUY_PHONG",
        "action_code": "KY_SO"
      },
      {
        "screen_name": "ý kiến - chờ cho ý kiến",
        "trangthais": ["chờ cho ý kiến"],
        "status_code": 1,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 1,
        "stage_status": "CHUA_XU_LY",
        "role": "NGUOI_SOAN_THAO",
        "action_code": "CREATE"
      },
      {
        "screen_name": "nhận để biết - nhận để biết",
        "trangthais": ["nhận để biết"],
        "status_code": 16,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 5,
        "stage_status": "DA_XU_LY",
        "role": "NGUOI_KY_NOI_DUNG",
        "action_code": "KY_NHAY_NOI_DUNG"
      }
    ]
  },
  {
    "role": "Phó trưởng phòng",
    "keywords": [
      "phó trưởng phòng", "ptp", "phó phòng", "phó ban", "phó trung tâm", "phó trưởng trung tâm", 
      "phó trưởng chi nhánh", "phó ter", "phó terminal", "phó chủ nhiệm", "hải đội phó", "phó quản đốc", 
      "p.hđt", "pp kế toán", "tổ trưởng", "đội trưởng", "trưởng kho", "trưởng ca", "bếp trưởng", 
      "tiểu đội trưởng", "quản lý bếp", "tbsx", "trưởng tbsx", "trưởng khu kh", "xưởng phó", 
      "phó chi nhánh", "phó depot", "phó trưởng khu kho hàng", "trung đội phó", "thuyền phó", 
      "máy phó", "sĩ quan máy", "sĩ quan boong", "giám sát ca", "giám sát công trình", 
      "giám sát chất lượng", "phó trưởng trực ban"
    ],
    "screens": [
      {
        "screen_name": "xử lý - chờ xử lý",
        "trangthais": ["chờ xử lý"],
        "status_code": 2,
        "bpmn_version": "KY_SO_HS_VBD",
        "type_of_process": "KY_SO_HS_VBD",
        "curStatusCode": 2,
        "stage_status": "CHO_KY_NOI_DUNG",
        "role": "NGUOI_SOAN_THAO",
        "action_code": null
      },
      {
        "screen_name": "xử lý - đã xử lý",
        "trangthais": ["đã xử lý"],
        "status_code": 14,
        "bpmn_version": "SOANTHAO_PHATHANH_VBD",
        "type_of_process": "SOANTHAO_PHATHANH_VBD",
        "curStatusCode": 14,
        "stage_status": "CHUA_XU_LY",
        "role": "NGUOI_SOAN_THAO",
        "action_code": "NGUOI_SOAN_THAO"
      }
    ]
  },
  {
    "role": "Cán bộ",
    "keywords": [
      "nhân viên", "chuyên viên", "kế toán", "trợ lý", "i tá", "y sĩ", "bác sĩ", "bác sỹ", 
      "dược tá", "quân y", "y tế", "điều dưỡng", "kỹ thuật viên nha khoa", "kỹ thuật viên y học cổ truyền", 
      "ktv x quang", "cấp phát thuốc", "lái xe", "lái canô", "lái cẩu", "lái máy", "lễ tân", "nhân sự", 
      "kinh doanh", "logistics", "logistic", "kỹ thuật", "kỹ sư", "tổ phó", "đội phó", "phó kho", 
      "tiểu đội phó", "phó khu", "thư ký", "thu ngân", "thủ quỹ", "thủ quĩ", "thủ kho", "thống kê", 
      "điều độ", "điều hành", "kiểm soát", "kiểm soát viên", "thương vụ", "chứng từ", "giao nhận", 
      "trực ban", "tiền lương", "định mức", "nhân viên kt", "nhân viên kd", "nhân viên tc", 
      "nhân viên an toàn", "nhân viên kỹ thuật", "nhân viên truyền thông", "nhân viên cảng vụ", 
      "nhân viên kho vật tư", "nhân viên tiếp liệu", "cán bộ an toàn", "depot", "sales", "marketing", 
      "kh - kd", "hc - vt", "tclđ", "cnkt", "cnhc", "cnct", "phct", "tl tp", "nv kh - kt", "thư viện", 
      "tổ chức hành chính", "quản trị mạng", "quản trị hệ thống", "nấu ăn", "bộ phận", "văn phòng", 
      "hành chính", "pháp chế", "khai thác", "an toàn lao động", "bảo hộ lao động", "công nghệ thông tin", 
      "lập trình", "điện tử", "điện - điện tử", "an ninh mạng", "bảo vệ", "tạp vụ", "vệ sinh", "phục vụ", 
      "dọn buồng", "giữ xe", "thuyền viên", "thủy thủ", "hoa tiêu", "chiến sĩ", "học việc", "thử việc", 
      "tập sự", "công đoàn", "quan hệ", "dịch vụ khách hàng", "chăm sóc khách hàng", "báo giá", "phụ xe", 
      "thợ", "sửa chữa", "bảo trì", "bảo dưỡng", "thị trường", "kho hàng", "quản lý vật tư", 
      "quản lý thiết bị", "quản lý tàu thuyền", "quản lý xe máy", "quản lý bếp ăn", "quản lý kỹ thuật", 
      "quản lý dv", "lao động - chính sách", "lao động - tiền lương", "đầu tư xây dựng", "đầu tư thiết bị", 
      "tuyên huấn", "nhà hàng", "sản lượng", "sản xuất", "hiện trường", "công vụ", "công tác cầu cảng", 
      "huấn luyện", "đào tạo", "doanh trại", "điện công nghiệp", "điện - nước", "phòng chống cháy nổ", 
      "cứu hộ", "tư vấn", "khai báo hq", "phô tô", "thiết bị đầu cuối", "thành viên", "vi tính", "vận hành", 
      "thanh lý", "kiểm hóa", "nghiệp vụ", "điều tàu", "làm hàng", "đối ngoại", "giám định", "chính sách", 
      "xử lý đơn hàng", "chấm bay", "vá vỏ xe", "lập sơ đồ", "phân tích", "tổng hợp", "kế hoạch sx", 
      "cẩu hàng rời", "khối hỗ trợ", "máy ii", "cảng vụ", "phát hành", "tiếp nhận", "vi tính cổng", 
      "vi tính tổng hợp", "cán bộ"
    ],
    "screens": [
      {
        "screen_name": "dự thảo - dự thảo",
        "trangthais": ["dự thảo"]
      },
      {
        "screen_name": "dự thảo - đã trình ký",
        "trangthais": ["đã trình ký"]
      },
      {
        "screen_name": "dự thảo - chờ phát hành",
        "trangthais": ["chờ phát hành"]
      },
      {
        "screen_name": "dự thảo - đã phát hành",
        "trangthais": ["đã ban hành"]
      },
      {
        "screen_name": "xử lý - chờ xử lý",
        "trangthais": ["chờ xử lý"]
      },
      {
        "screen_name": "xử lý - đã xử lý",
        "trangthais": ["đã xử lý"]
      },
      {
        "screen_name": "xử lý - đã phát hành",
        "trangthais": ["đã phát hành"]
      }
    ]
  }
];

const DEFAULT_WORKFLOW_PROCESS = {
  "status_code": 2,
  "bpmn_version": "SOANTHAO_PHATHANH_VBD",
  "type_of_process": "SOANTHAO_PHATHANH_VBD",
  "curStatusCode": 1,
  "stage_status": "CHUA_XU_LY",
  "role": "NGUOI_SOAN_THAO",
  "action_code": "CREATE"
};
class SyncAuditModel extends BaseModel {
  /**
   * Khởi tạo đối tượng SyncAuditModel.
   * @param {string} oldDbTable - Tên bảng trong CSDL cũ chứa dữ liệu audit cần đồng bộ.
   */
  constructor(oldDbTable) {
    super();
    // Cấu hình cho CSDL cũ
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;

    // Cấu hình cho CSDL mới
    this.newDbSchema = "dbo";
    this.newDbTable = "audit"; // Bảng đích trong CSDL mới

    // Khởi tạo helper để hỗ trợ các tác vụ chuyển đổi dữ liệu
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));

    // Khởi tạo ReceiverParser để bóc tách receiver theo quy tắc nghiệp vụ
    // Truyền thêm helper để dùng mapUserName tra cứu ID chính xác
    this.receiverParser = new ReceiverParserService(
      this.queryNewDbTx.bind(this),
      this.queryOldDb.bind(this),
      this.helper
    );
  }

  /**
   * Khởi tạo kết nối và các cấu trúc dữ liệu nếu cần
   */
  async initialize() {
    if (typeof super.initialize === 'function') {
      await super.initialize();
    }

    try {
      await this.queryNewDb(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'table_backups')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD table_backups NVARCHAR(255) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'type_document')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD type_document VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'processed_by')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD processed_by VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'acting_as')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD acting_as VARCHAR(100) NULL;
        
        -- Thêm các cột mới cho workflow process
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'status_code')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD status_code VARCHAR(50) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'bpmn_version')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD bpmn_version VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'type_of_process')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD type_of_process VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'curStatusCode')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD curStatusCode INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${this.newDbTable}' AND COLUMN_NAME = 'role')
            ALTER TABLE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} ADD [role] VARCHAR(100) NULL;
      `);
    } catch(e) {
      logger.warn(`[SyncAuditModel] Lỗi khởi tạo cấu trúc cột (table_backups, type_document): ${e.message}`);
    }
  }

  /**
   * Lấy tất cả các bản ghi audit từ CSDL cũ dựa trên ID của văn bản.
   * @param {string|number} oldDocumentId - ID của văn bản trong CSDL cũ.
   */
  async fetchByDocumentId(oldDocumentId) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId
    );
  }

  /**
   * Lấy các bản ghi audit cho văn bản đi dựa trên ID văn bản,
   * lọc theo các danh mục (category) dành riêng cho văn bản đi.
   * @param {string|number} oldDocumentId - ID của văn bản đi trong CSDL cũ.
   */
  async fetchByOutgoingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_RELEASE_DV,
        CATEGORY_RELEASE_TCT,
        CATEGORY_OUTGOING,
      ]
    );
  }

  /**
   * Lấy các bản ghi audit dựa trên ID văn bản và một danh sách các danh mục cụ thể.
   * @param {string|number} oldDocumentId - ID của văn bản trong CSDL cũ.
   * @param {string[]} categories - Mảng các danh mục cần lọc.
   */
  async fetchByDocumentIdWithCategories(
    oldDocumentId,
    categories = []
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      categories
    );
  }

  /**
   * Phương thức nội bộ để thực hiện việc truy vấn CSDL cũ.
   * Xây dựng câu lệnh SQL động để lấy dữ liệu audit dựa trên ID văn bản
   * và có thể lọc theo danh mục.
   * @param {string|number} oldDocumentId - ID của văn bản.
   * @param {string[]|null} categories - Mảng các danh mục để lọc (nếu có).
   * @private
   */
  async _fetchByDocumentIdInternal(
    oldDocumentId,
    categories = null
  ) {
    if (!oldDocumentId) return [];

    // Chuẩn hóa ID văn bản (xóa khoảng trắng thừa)
    const normalizedDocumentId =
      String(oldDocumentId).trim();

    const params = {
      oldDocumentId: normalizedDocumentId,
    };

    let categoryFilter = "";
    // Chuẩn hóa danh sách các category
    const normalizedCategories =
      this._normalizeCategories(categories);

    // Nếu có category, thêm điều kiện lọc vào câu truy vấn
    if (normalizedCategories.length) {
      const placeholders = normalizedCategories
        .map((_, idx) => `@category${idx}`)
        .join(", ");

      categoryFilter = `
        AND LTRIM(RTRIM(ISNULL(Category, ''))) IN (${placeholders})
      `;

      // Thêm giá trị của các category vào parameters cho câu truy vấn
      normalizedCategories.forEach(
        (category, idx) => {
          params[`category${idx}`] = category;
        }
      );
    }

// Các cột có thể chứa ID văn bản trong bảng audit cũ
// LTRIM(RTRIM(ISNULL(IDVanBan, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(VBId, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(IDVanBanGoc, ''))) = @oldDocumentId
//           OR LTRIM(RTRIM(ISNULL(VBGocId, ''))) = @oldDocumentId

    const query = `
      SELECT *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (
          LTRIM(RTRIM(ISNULL(VBId, ''))) = @oldDocumentId -- Tìm kiếm theo cột VBId
      )
      ${categoryFilter} -- Áp dụng bộ lọc category nếu có
      ORDER BY
        -- Sắp xếp ưu tiên theo ngày tạo (NgayTao), thử nhiều định dạng ngày tháng khác nhau
        COALESCE(
          TRY_CONVERT(datetime, NgayTao, 120),
          TRY_CONVERT(datetime, NgayTao, 121),
          TRY_CONVERT(datetime, NgayTao, 103),
          TRY_CONVERT(datetime, NgayTao, 105),
          TRY_CONVERT(datetime, NgayTao),
          GETDATE()
        ) ASC,
        ID ASC -- Nếu ngày giống nhau thì sắp xếp theo ID
    `;

    // Thực thi câu truy vấn trên CSDL cũ
    return this.queryOldDb(query, params);
  }

  /**
   * Lấy các bản ghi audit cho văn bản đến dựa trên ID văn bản,
   * lọc theo các danh mục (category) dành riêng cho văn bản đến.
   * @param {string|number} oldDocumentId - ID của văn bản đến trong CSDL cũ.
   */
  async fetchByIncomingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_INCOMING_TCT,
        CATEGORY_INCOMING,
        CATEGORY_INCOMING_INTERNAL,
        CATEGORY_INCOMING_SUBMIT
      ]
    );
  }

  /**
   * Xử lý một bản ghi audit thô từ CSDL cũ, chuyển đổi và lưu vào CSDL mới.
   * @param {object} rawRecord - Bản ghi thô từ CSDL cũ.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {object} transaction - Đối tượng transaction của CSDL.
   */
  async processSingleRecord(rawRecord, documentId, transaction = null) {
    if (!rawRecord || !documentId) return null;

    let inserted = 0;
    let updated = 0;

    try {
      // 1. Chuyển đổi (map) dữ liệu từ bản ghi cũ sang cấu trúc mới
      const mapped = await this._mapSingleRecord(
        rawRecord,
        documentId,
        transaction
      );

      if (!mapped) {
        return null;
      }

      // 2. Một số bản ghi cũ có thể được mở rộng thành nhiều bản ghi audit mới
      const audits = this.helper._expandMappedRecords(mapped);

      if (!Array.isArray(audits) || audits.length === 0) {
        return null;
      }

      // 3. Lặp qua từng bản ghi audit đã được chuyển đổi
      for (const audit of audits) {
        if (!audit) continue;

        try {
          // 4. Kiểm tra xem bản ghi audit này đã tồn tại trong CSDL mới chưa
          const existed = await this._getExistingAudit(audit, transaction);

          if (existed) {
            // 5a. Nếu đã tồn tại, cập nhật lại thông tin
            await this._update(audit, existed.id, transaction);
            updated++;
          } else {
            // 5b. Nếu chưa tồn tại, thêm mới
            await this._insert(audit, transaction);
            inserted++;
          }
        } catch (auditErr) {
          logger.warn(
            `[AuditSyncModel.processSingleRecord] single audit failed table=${this.oldDbTable} ID=${rawRecord?.ID}: ${auditErr.message}`
          );
          // Không throw lỗi ở đây để các bản ghi audit khác trong cùng văn bản vẫn được xử lý
        }
      }

      return { inserted, updated };

    } catch (error) {
      logger.error(
        `[AuditSyncModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}`,
        error
      );
      throw error;
    }
  }

  /**
   * Kiểm tra xem một bản ghi audit đã tồn tại trong CSDL mới hay chưa.
   * @param {object} audit - Dữ liệu audit đã được map.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {object|null} - Trả về bản ghi đã tồn tại hoặc null.
   * @private
   */
  async _getExistingAudit(audit, transaction) {
    if (!audit) return null;

    // Ưu tiên tìm kiếm theo ID gốc (origin_id) và tên bảng backup
    if (audit.origin_id) {
      const byOriginQuery = `
        SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
        WHERE origin_id = @origin_id
          AND table_backups = @table_backups
      `;

      const byOrigin = await this.queryNewDbTx(
        byOriginQuery,
        {
          origin_id: audit.origin_id,
          table_backups:
            audit.table_backups ||
            this.oldDbTable,
        },
        transaction
      );

      if (byOrigin?.[0]) {
        return byOrigin[0];
      }
    }

    // Nếu không tìm thấy bằng origin_id, thử tìm kiếm bằng tổ hợp document_id, time và user_id
    if (!audit.document_id || !audit.time) return null;

    const query = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      WHERE document_id = @document_id
        AND [time] = @time
        AND (
          (@user_id IS NULL AND user_id IS NULL)
          OR user_id = @user_id
        )
    `;

    const result = await this.queryNewDbTx(
      query,
      {
        document_id: audit.document_id,
        time: audit.time,
        user_id: audit.user_id ?? null,
      },
      transaction
    );

    return result?.[0] || null;
  }

  /**
   * Chèn một bản ghi audit mới vào CSDL mới.
   * @param {object} data - Dữ liệu audit đã được map.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _insert(data, transaction) {
    // Chuẩn hóa dữ liệu mảng (người nhận, đơn vị nhận) thành chuỗi
    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} (
        document_id,
        [time],
        user_id,
        display_name,
        action_code,
        details,
        origin_id,
        created_by,
        receiver,
        receiver_unit,
        group_,
        roleProcess,
        [action],
        stage_status,
        created_at,
        updated_at,
        type_document,
        table_backups,
        status_code,
        bpmn_version,
        type_of_process,
        curStatusCode,
        [role]
      )
      VALUES (
        @document_id,
        @time,
        @user_id,
        @display_name,
        @action_code,
        @details,
        @origin_id,
        @created_by,
        @receiver,
        @receiver_unit,
        @group_,
        @roleProcess,
        @action,
        @stage_status,
        @created_at,
        GETDATE(), -- Tự động lấy ngày giờ hiện tại
        @type_document,
        @table_backups,
        @status_code,
        @bpmn_version,
        @type_of_process,
        @curStatusCode,
        @role
      )
    `;

    // Thực thi câu lệnh INSERT
    await this.queryNewDbTx(
      query,
      {
        document_id: data.document_id,
        time: data.time,
        user_id: data.user_id ?? null,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        details: data.details ?? null,
        origin_id: data.origin_id ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        created_at: data.time ?? new Date(),
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
        table_backups:
          data.table_backups ||
          this.oldDbTable,
        status_code: data.status_code ?? null,
        bpmn_version: data.bpmn_version ?? null,
        type_of_process: data.type_of_process ?? null,
        curStatusCode: data.curStatusCode ?? null,
        role: data.role ?? null,
      },
      transaction
    );
  }

  /**
   * Cập nhật một bản ghi audit đã tồn tại trong CSDL mới.
   * @param {object} data - Dữ liệu audit mới.
   * @param {number} existingId - ID của bản ghi audit cần cập nhật.
   * @param {object} transaction - Đối tượng transaction.
   * @private
   */
  async _update(data, existingId, transaction) {
    if (!existingId) return;

    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      SET
        document_id = @document_id,
        display_name = @display_name,
        action_code = @action_code,
        details = @details,
        created_by = @created_by,
        receiver = @receiver,
        receiver_unit = @receiver_unit,
        group_ = @group_,
        roleProcess = @roleProcess,
        [action] = @action,
        stage_status = @stage_status,
        status_code = @status_code,
        bpmn_version = @bpmn_version,
        type_of_process = @type_of_process,
        curStatusCode = @curStatusCode,
        [role] = @role,
        type_document = @type_document,
        updated_at = GETDATE() -- Cập nhật thời gian update
      WHERE id = @id
    `;

    // Thực thi câu lệnh UPDATE
    await this.queryNewDbTx(
      query,
      {
        id: existingId,
        document_id: data.document_id,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        details: data.details ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        status_code: data.status_code ?? null,
        bpmn_version: data.bpmn_version ?? null,
        type_of_process: data.type_of_process ?? null,
        curStatusCode: data.curStatusCode ?? null,
        role: data.role ?? null,
        type_document: data.type_document, // Logic đã được xử lý ở _mapSingleRecord
      },
      transaction
    );
  }

  /**
   * Chuyển đổi (map) một bản ghi thô từ CSDL cũ sang cấu trúc dữ liệu của CSDL mới.
   * Đây là nơi diễn ra logic chuyển đổi chính.
   * @param {object} record - Bản ghi thô từ CSDL cũ.
   * @param {number} documentId - ID của văn bản trong CSDL mới.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {object|null} - Đối tượng dữ liệu đã được map hoặc null.
   * @private
   */
  async _mapSingleRecord(record, documentId, transaction) {
    if (!record?.ID || !documentId)
      return null;

    // Chuyển đổi chuỗi ngày tháng từ CSDL cũ sang đối tượng Date
    const parsedTime =
      this.helper.parseDate(record.NgayTao);
    const time =
      parsedTime || new Date();

    // Map tên người dùng từ CSDL cũ sang user_id trong CSDL mới
    const user_id =
      (await this.helper.mapUserName(
        record.NguoiXuLy,
        transaction
      )) || process.env.VANTHU_USER_ID;

    // Trích xuất tên hiển thị từ chuỗi người xử lý
    const displayName =
      this.helper.extractDisplayName(
        record.NguoiXuLy
      );

    // Phân tích chuỗi hành động (HanhDong) để lấy thông tin chi tiết (mã hành động, người nhận, ...)
    const actionParsed =
      this.helper.parseActionString(
        user_id,
        record.HanhDong
      ) || {};
    
    // ── SỬ DỤNG ReceiverParserService ĐỂ BÓC TÁCH RECEIVER THEO QUY TẮC NGHIỆP VỤ ──
    const parsed = await this.receiverParser.determineReceivers(record, transaction);
    let receiver = parsed.receiverIds || [];
    const receiverUnit = parsed.receiverUnitIds || [];
    const parsedRoleProcess = parsed.roleProcess || actionParsed.roleProcess || 'VANTHU';

    // ── FALLBACK: Nếu receiver rỗng → tự động lấy ID người xử lý (user_id) đắp vào ──
    if ((!receiver || receiver.length === 0) && user_id) {
      receiver = [user_id];
    }

    // Chuẩn hóa chuỗi hành động thô và tạo đối tượng JSON cho cột 'details'
    const rawAction = this._normalizeTextField(record.HanhDong);
    const actionStr = JSON.stringify({
      note: rawAction,
      isTransferOption: true
    });

    // --- LOGIC MỚI ĐỂ XÁC ĐỊNH type_document DỰA TRÊN Category ---
    let type_document;
    const category = this._normalizeTextField(record.Category);

    if (INCOMING_CATEGORIES.has(category)) {
      type_document = 'IncomingDocument';
    } else if (OUTGOING_CATEGORIES.has(category)) {
      type_document = 'OutgoingDocument';
    } else {
      // Logic dự phòng nếu category không khớp: sử dụng kết quả phân tích hành động hoặc mặc định
      type_document = actionParsed.type_document ?? "OutgoingDocument";
    }
    // --- KẾT THÚC LOGIC MỚI ---

    // ── XỬ LÝ MAPPING ROLE VÀ SCREEN DỰA TRÊN CẤU HÌNH DYNAMIC ──
    const userProfile = await this.helper.findUserByBakId(user_id, transaction);
    const userPosition = userProfile?.position || '';
    const currentTrangThai = this._normalizeTextField(record.TrangThai);
    
    const workflowMapping = this._determineUserRoleAndScreen(userPosition, currentTrangThai, rawAction);

    // Trả về đối tượng đã được map theo cấu trúc của bảng 'audit' mới
    return {
      document_id: documentId,
      time,
      action_code: workflowMapping.action_code || actionParsed.action_code || null,
      details: actionStr ?? null,
      origin_id: this._normalizeTextField(
        record.ID,
        100
      ),
      created_by: user_id || process.env.VANTHU_USER_ID,
      receiver,
      receiver_unit: receiverUnit,
      group_: this._normalizeTextField(
        record.Category,
        100
      ),
      display_name: displayName ?? null,
      user_id: user_id ?? null,
      roleProcess:
        workflowMapping.role || parsedRoleProcess || actionParsed.roleProcess || null,
      action: actionParsed.action || this._normalizeTextField(
        rawAction,
        255
      ),
      stage_status:
        workflowMapping.stage_status || actionParsed.stage_status || null,
      status_code: workflowMapping.status_code || null,
      bpmn_version: workflowMapping.bpmn_version || null,
      type_of_process: workflowMapping.type_of_process || null,
      curStatusCode: workflowMapping.curStatusCode || null,
      role: workflowMapping.role || null,
      type_document: type_document, // Sử dụng biến đã được quyết định ở trên
      table_backups: this.oldDbTable,
    };
  }

  /**
   * Xác định vai trò và màn hình dựa trên chức danh và trạng thái/hành động.
   * @param {string} userPosition - Chức danh/vị trí của người dùng.
   * @param {string} currentTrangThai - Trạng thái hiện tại từ bản ghi cũ.
   * @param {string} actionText - Nội dung hành động (HanhDong).
   * @returns {object} - Cấu hình mapping tìm được hoặc mặc định.
   * @private
   */
  _determineUserRoleAndScreen(userPosition, currentTrangThai, actionText) {
    const pos = (userPosition || '').toLowerCase();
    const status = (currentTrangThai || '').toLowerCase();
    const action = (actionText || '').toLowerCase();

    // 1. Tìm vai trò (role) dựa trên keywords
    let matchedRole = null;
    for (const roleConf of WORKFLOW_PROCESS_CONFIG) {
      if (roleConf.keywords.some(kw => pos.includes(kw.toLowerCase()))) {
        matchedRole = roleConf;
        break;
      }
    }

    if (!matchedRole) {
      return DEFAULT_WORKFLOW_PROCESS;
    }

    // 2. Tìm màn hình (screen) dựa trên trangthais
    let matchedScreen = null;
    if (matchedRole.screens && matchedRole.screens.length > 0) {
      for (const screen of matchedRole.screens) {
        if (screen.trangthais && screen.trangthais.some(st => 
          status.includes(st.toLowerCase()) || action.includes(st.toLowerCase())
        )) {
          matchedScreen = screen;
          break;
        }
      }
    }

    if (matchedScreen) {
      return {
        ...matchedScreen,
        role: matchedScreen.role || matchedRole.role // Fallback to role name if screen doesn't have it
      };
    }

    // Nếu không khớp màn hình nào, trả về mặc định của role đó hoặc hệ thống
    return DEFAULT_WORKFLOW_PROCESS;
  }

  /**
   * Map một mảng tên người dùng (receiver) sang một mảng các ID người dùng trong CSDL mới.
   * @param {string[]} receiverValues - Mảng tên người dùng.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {string[]} - Mảng các user ID.
   * @private
   */
  async _mapReceiverUsers(receiverValues, transaction) {
    if (!Array.isArray(receiverValues))
      return [];

    // Lọc ra các giá trị rỗng và trùng lặp
    const normalized = [
      ...new Set(
        receiverValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    // Lặp qua từng tên người dùng để map sang ID
    for (const userName of normalized) {
      const userId =
        await this.helper.mapUserName(
          userName,
          transaction
        );

      if (userId) {
        mapped.push(String(userId));
      }
    }

    return mapped;
  }

  /**
   * Map một mảng tên đơn vị (receiver unit) sang một mảng các ID đơn vị trong CSDL mới.
   * @param {string[]} receiverUnitValues - Mảng tên đơn vị.
   * @param {object} transaction - Đối tượng transaction.
   * @returns {string[]} - Mảng các unit ID.
   * @private
   */
  async _mapReceiverUnits(receiverUnitValues, transaction) {
    if (!Array.isArray(receiverUnitValues))
      return [];

    // Lọc ra các giá trị rỗng và trùng lặp
    const normalized = [
      ...new Set(
        receiverUnitValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    // Lặp qua từng tên đơn vị để map sang ID
    for (const unitName of normalized) {
      const unitId =
        await this.helper.mapSenderUnitId(
          unitName,
          transaction
        );

      if (unitId) {
        mapped.push(String(unitId));
      }
    }

    return mapped;
  }

  /**
   * Chuẩn hóa giá trị của một trường dạng mảng.
   * Chuyển mảng thành chuỗi phân cách bằng dấu phẩy và giới hạn độ dài.
   * @param {string[]|string} value - Giá trị cần chuẩn hóa.
   * @param {number|null} maxLength - Độ dài tối đa.
   * @returns {string|null} - Chuỗi đã được chuẩn hóa.
   * @private
   */
  _normalizeArrayField(value, maxLength = null) {
    if (!value) return null;

    let normalized = null;

    if (Array.isArray(value)) {
      normalized = value.length
        ? value.join(",")
        : null;
    } else {
      normalized =
        String(value).trim() || null;
    }

    if (
      normalized &&
      maxLength &&
      normalized.length > maxLength
    ) {
      return normalized.substring(0, maxLength);
    }

    return normalized;
  }

  /**
   * Chuẩn hóa giá trị của một trường dạng text.
   * Xóa khoảng trắng, xử lý giá trị 'NULL', và giới hạn độ dài.
   * @param {*} value - Giá trị cần chuẩn hóa.
   * @param {number|null} maxLength - Độ dài tối đa.
   * @returns {string|null} - Chuỗi đã được chuẩn hóa.
   * @private
   */
  _normalizeTextField(value, maxLength = null) {
    if (value === null || value === undefined)
      return null;

    let normalized = String(value).trim();
    if (!normalized) return null;

    // Coi chuỗi "NULL" là giá trị null thực sự
    if (normalized.toUpperCase() === "NULL") {
      return null;
    }

    // Cắt chuỗi nếu vượt quá độ dài tối đa
    if (
      maxLength &&
      normalized.length > maxLength
    ) {
      normalized = normalized.substring(
        0,
        maxLength
      );
    }

    return normalized;
  }

  /**
   * Chuẩn hóa một mảng các category.
   * Xóa các giá trị rỗng và trùng lặp.
   * @param {string[]} categories - Mảng các category.
   * @returns {string[]} - Mảng đã được chuẩn hóa.
   * @private
   */
  _normalizeCategories(categories) {
    if (!Array.isArray(categories)) {
      return [];
    }

    return [
      ...new Set(
        categories
          .map((category) =>
            this._normalizeTextField(category)
          )
          .filter(Boolean)
      ),
    ];
  }
}

module.exports = SyncAuditModel;
