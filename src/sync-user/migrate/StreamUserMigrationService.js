
const logger = require('../../../utils/logger');
const StreamUserMigrationModel = require('./StreamUserMigrationModel');
const { v4: uuidv4 } = require('uuid');

/**
 * Class StreamUserMigrationService
 * 
 * Service này chứa toàn bộ logic nghiệp vụ để di chuyển dữ liệu người dùng.
 * Nó hoạt động theo cơ chế stream, xử lý dữ liệu theo từng đợt (batch) để
 * tránh tải toàn bộ dữ liệu vào bộ nhớ, tối ưu cho các tập dữ liệu lớn.
 * 
 * Quy trình chính:
 * 1. Lấy một đợt dữ liệu từ DB cũ.
 * 2. Xử lý, làm sạch, và ánh xạ (map) từng bản ghi.
 * 3. Kiểm tra các điều kiện (ví dụ: đã tồn tại chưa)
 * 4. Chèn (insert) bản ghi đã xử lý vào DB mới.
 * 5. Lặp lại cho đến khi hết dữ liệu hoặc đạt giới hạn.
 */
class StreamUserMigrationService {
  
  /**
   * Khởi tạo service.
   */
  constructor() {
    this.model = null; // Model sẽ được khởi tạo trong hàm initialize
    this.defaultBatchSize = parseInt(process.env.BATCH_SIZE) || 100; // Kích thước đợt mặc định
  }

  /**
   * Khởi tạo các thành phần cần thiết cho service, chủ yếu là model để tương tác DB.
   * Phải được gọi trước khi sử dụng các hàm khác.
   */
  async initialize() {
    try {
      this.model = new StreamUserMigrationModel();
      await this.model.initialize(); // Khởi tạo kết nối DB trong model
      logger.info('[StreamUserMigrationService] Initialized successfully');
    } catch (error) {
      logger.error('[StreamUserMigrationService] Initialize error:', error);
      throw new Error(`Không thể khởi tạo service: ${error.message}`);
    }
  }

  /**
   * Lấy trạng thái hiện tại của quá trình di chuyển.
   * @returns {Promise<Object>} Một object chứa thông tin thống kê.
   */
  async getStatus() {
    try {
      if (!this.model) {
        throw new Error('Service chưa được khởi tạo');
      }
      return await this.model.getStatus();
    } catch (error) {
      logger.error('[StreamUserMigrationService.getStatus] Error:', error);
      throw error;
    }
  }

  /**
   * Tạo một GUID (Global Unique Identifier) mới.
   * @returns {string} Một chuỗi GUID viết hoa.
   */
  generateGuid() {
    return uuidv4().toUpperCase();
  }

  // --- Các hàm tiện ích để làm sạch dữ liệu (Data Cleaning Helpers) ---

  /**
   * Chuyển đổi giá trị thành chuỗi một cách an toàn.
   * @param {*} value - Giá trị đầu vào.
   * @returns {string|null} Chuỗi đã được trim hoặc null nếu không hợp lệ.
   */
  safeString(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return null;
    }
    return String(value).trim();
  }

  /**
   * Chuyển đổi giá trị thành số một cách an toàn.
   * @param {*} value - Giá trị đầu vào.
   * @param {number} defaultValue - Giá trị mặc định nếu chuyển đổi thất bại.
   * @returns {number}
   */
  safeNumber(value, defaultValue = 0) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return defaultValue;
    }
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Chuyển đổi giá trị thành đối tượng Date một cách an toàn.
   * @param {*} value - Giá trị đầu vào.
   * @returns {Date|null}
   */
  safeDate(value) {
    if (value === 'NULL' || value === 'null' || value === null || value === undefined) {
      return null;
    }
    try {
      const dateStr = String(value).trim();
      if (!dateStr || dateStr === '') return null;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch (error) {
      return null;
    }
  }

  /**
   * Phân tích và chuẩn hóa giới tính.
   * @param {*} value 
   * @returns {'nam'|'nu'|null}
   */
  parseGender(value) {
    const genderStr = String(value || '');
    if (genderStr === '1') return 'nam';
    if (genderStr === '0') return 'nu';
    return null;
  }

  /**
   * Phân tích và chuẩn hóa trạng thái làm việc.
   * @param {*} value 
   * @returns {number} 3 nếu nghỉ việc, 1 nếu đang làm.
   */
  parseStatus(value) {
    const statusStr = String(value || '');
    if (statusStr === '-1') return 3; // Nghỉ việc
    return 1; // Mặc định là active
  }

  /**
   * Phân tích và chuẩn hóa giá trị bit (boolean).
   * @param {*} value 
   * @returns {number} 1 hoặc 0.
   */
  parseBit(value) {
    if (value === '1' || value === 1 || value === true) return 1;
    if (value === '0' || value === 0 || value === false) return 0;
    return 0; // Mặc định là 0
  }

  /**
   * Ánh xạ (map) và làm sạch dữ liệu từ bản ghi cũ sang cấu trúc của bản ghi mới.
   * @param {Object} oldRecord - Bản ghi từ DB cũ.
   * @returns {Object} Bản ghi mới sẵn sàng để insert.
   */
  safeMapRecord(oldRecord) {
    // --- Logic chuyển đổi dữ liệu theo yêu cầu ---

    const username = oldRecord.AccountName || '';

    // 1. Tạo `code_nd` từ username (lấy phần sau dấu '\')
    let code_nd = username;
    const backslashIndex = username.lastIndexOf('\\');
    if (backslashIndex > -1) {
      code_nd = username.substring(backslashIndex + 1);
    }

    // 2. Tạo `name` (bỏ phần sau dấu '-')
    let name = (oldRecord.FullName || username || 'Unknown').trim();
    const hyphenIndex = name.indexOf('-');
    if (hyphenIndex > -1) {
      name = name.substring(0, hyphenIndex).trim();
    }

    // 3. Tạo `email_user` nếu rỗng
    let email_user = this.safeString(oldRecord.Email);
    if (!email_user && code_nd) {
      email_user = `${code_nd}@saigonnewport.com.vn`;
    }

    // --- Trả về đối tượng bản ghi mới ---
    return {
      id: this.generateGuid(),
      password: '$2b$10$Ohcqw9J1YStppJHeYdoD5.yWjnCm5Mt7MQxWoIMNc0LBwbFRW1DU2', // Mật khẩu mới
      name: name, // Tên đã xử lý
      avatar: oldRecord.Image || '[]',
      code_nd: code_nd, // Code ND đã xử lý
      username: oldRecord.AccountName,
      email_user: email_user, // Email đã xử lý
      phone_number_user: this.safeString(oldRecord.Mobile),
      position: this.safeString(oldRecord.Position),
      leader: this.safeString(oldRecord.Manager),
      address_user: this.safeString(oldRecord.Address),
      description: null,
      role: null,
      roles_by_process: '[{"processKey":"PHUC_DAP_DV","name":"PHUC_DAP_DV","roles":[{"roleCode":"LANH_DAO_TCT","name":"LANH_DAO_TCT"}]},{"processKey":"KY_SO_HS_VBD","name":"KY_SO_HS_VBD","roles":[{"roleCode":"NGUOI_KY_PHE_DUYET","name":"NGUOI_KY_PHE_DUYET"}]},{"processKey":"SOANTHAO_PHATHANH_VBD","name":"SOANTHAO_PHATHANH_VBD","roles":[{"roleCode":"NGUOI_KY_NOI_DUNG","name":"NGUOI_KY_NOI_DUNG"}]}]', // Roles mới
      organization_name: null,
      organization_code: null,
      organization_type: null,
      orders: this.safeNumber(oldRecord.Orders, 1000),
      birthday: this.safeDate(oldRecord.BirthDay),
      gender: this.parseGender(oldRecord.Gender),
      identification_card: this.safeString(oldRecord.CMND),
      contact_time: null,
      parent: null,
      wso2_user_id: null,
      keycloak_user_id: null,
      status: this.parseStatus(oldRecord.WorkStatus),
      author: '',
      role_group_source_authorized: '',
      created_at: new Date(),
      updated_at: new Date(),
      name_authorized: null,
      id_user_bak: oldRecord.ID, // ID gốc để đối chiếu
      AccountID: this.safeString(oldRecord.AccountID),
      FullName: this.safeString(oldRecord.FullName),
      Department: this.safeString(oldRecord.Department),
      DepartmentId: this.safeString(oldRecord.DepartmentId),
      PhongBanID: this.safeString(oldRecord.PhongBanID),
      SimKySo1: this.safeString(oldRecord.SimKySo1),
      SimKySo2: this.safeString(oldRecord.SimKySo2),
      DepartmentManager: this.safeString(oldRecord.DepartmentManager),
      IsTCT: this.parseBit(oldRecord.IsTCT),
      ImagePath: this.safeString(oldRecord.ImagePath),
      SignImage: this.safeString(oldRecord.SignImage),
      SignImageSmall: this.safeString(oldRecord.SignImageSmall),
      table_backups: 'PersonalProfile' // Ghi chú nguồn gốc dữ liệu
    };
  }

  /**
   * Hàm chính thực hiện di chuyển dữ liệu.
   * @param {Object} options - Tùy chọn di chuyển.
   * @param {number} options.limit - Giới hạn tổng số bản ghi.
   * @param {number} options.batch - Số lượng bản ghi mỗi đợt.
   * @param {number} options.lastProcessedId - ID cuối cùng đã xử lý.
   * @returns {Promise<Object>} Kết quả tổng kết.
   */
  async migrate({ limit = 0, batch = this.defaultBatchSize, lastProcessedId = '0' } = {}) {
    const startTime = Date.now();

    // --- Validation ---
    if (!this.model) {
      throw new Error('Service chưa được khởi tạo. Gọi initialize() trước.');
    }
    if (batch <= 0) throw new Error('Batch size phải lớn hơn 0');
    if (limit < 0) throw new Error('Limit không được âm');

    logger.info(`[StreamUserMigrationService] BẮT ĐẦU MIGRATION USER - Limit: ${limit || 'ALL'}, Batch: ${batch}`);

    // --- Biến đếm ---
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let hasMore = true; // Cờ để kiểm tra xem còn dữ liệu để xử lý không

    try {
      // Vòng lặp xử lý các đợt cho đến khi hết dữ liệu
      while (hasMore) {
        batchCount++;
        const batchStartTime = Date.now();
        logger.info(`BATCH ${batchCount}`);
        
        // 1. Lấy dữ liệu từ DB cũ
        const oldRecords = await this.model.fetchBatchFromOldDb({ batch, lastId: lastProcessedId });

        // Nếu không còn bản ghi nào, dừng lại
        if (!oldRecords || oldRecords.length === 0) {
          logger.info(`No more records to process`);
          hasMore = false;
          break;
        }

        logger.info(`Fetched ${oldRecords.length} records`);

        // 2. Xử lý từng bản ghi trong đợt
        for (const oldRecord of oldRecords) {
          try {
            // Bỏ qua nếu bản ghi không hợp lệ
            if (!oldRecord || !oldRecord.ID) {
              totalErrors++;
              continue;
            }

            // 3. Kiểm tra xem đã di chuyển chưa (dựa vào ID gốc)
            const existingByBackup = await this.model.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              continue;
            }

            // 4. Kiểm tra xem username đã tồn tại chưa
            const usernameExists = await this.model.checkUsernameExists(oldRecord.AccountName);
            if (usernameExists) {
              totalSkipped++;
              continue;
            }

            // 5. Ánh xạ và chèn vào DB mới
            const newRecord = this.safeMapRecord(oldRecord);
            await this.model.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record ID ${oldRecord?.ID || 'unknown'}: ${error.message}`);
          }
        }

        // Cập nhật tổng số đã xử lý và ID cuối cùng
        totalProcessed += oldRecords.length;
        if (oldRecords.length > 0) {
          lastProcessedId = oldRecords[oldRecords.length - 1].ID;
        }

        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
        logger.info(`Batch duration: ${batchDuration}s | Inserted: ${totalInserted}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`);

        // 6. Kiểm tra điều kiện dừng
        if (limit > 0 && totalProcessed >= limit) {
          logger.info(`Reached limit (${limit}). Stopping...`);
          hasMore = false;
        }

        if (oldRecords.length < batch) {
          logger.info(`Last batch. Stopping...`);
          hasMore = false;
        }
      }

      // --- Hậu xử lý (Post-processing) ---
      // Tạo phòng ban từ Department và update lại parent cho user
      await this.model.syncDepartmentsFromUsers();

      // --- Tổng kết ---
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`MIGRATION HOÀN TẤT - Total Processed: ${totalProcessed}, Inserted: ${totalInserted}, Skipped: ${totalSkipped}, Errors: ${totalErrors}, Duration: ${totalDuration}s`);

      return {
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        totalProcessed,
        batches: batchCount,
        duration: totalDuration
      };

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`MIGRATION FAILED after ${duration}s: ${error.message}`);
      throw error;
    }
  }

  /**
   * Chạy riêng logic đồng bộ phòng ban (Post-processing).
   * Dùng khi muốn chạy lại bước này mà không cần migrate lại user.
   */
  async syncDepartments() {
    if (!this.model) {
      await this.initialize();
    }
    await this.model.syncDepartmentsFromUsers();
  }
}

module.exports = StreamUserMigrationService;
