
const BaseModel = require('../../../models/BaseModel');
const logger = require('../../../utils/logger');
const sql = require('mssql');

/**
 * Class StreamUserMigrationModel
 *
 * Lớp Model này chịu trách nhiệm cho tất cả các tương tác trực tiếp với cơ sở dữ liệu,
 * cả cơ sở dữ liệu nguồn (cũ) và đích (mới), trong quá trình di chuyển dữ liệu người dùng.
 * Nó chứa các phương thức để đọc dữ liệu theo batch, chèn dữ liệu, kiểm tra sự tồn tại,
 * và lấy thông tin trạng thái từ DB.
 *
 * @extends BaseModel - Kế thừa từ lớp BaseModel để tái sử dụng các kết nối cơ sở dữ liệu
 *                      (this.oldPool, this.newPool) và các hàm tiện ích chung.
 */
class StreamUserMigrationModel extends BaseModel {
  /**
   * Hàm khởi tạo của Model.
   * Định nghĩa tên bảng và schema mặc định mà model này sẽ làm việc.
   * Giữ lại một tham chiếu đến thư viện `mssql` để có thể định kiểu dữ liệu
   * một cách tường minh khi thực hiện các câu lệnh SQL, giúp tránh các lỗi
   * chuyển đổi kiểu dữ liệu và tấn công SQL injection.
   */
  constructor() {
    super(); // Gọi constructor của lớp cha `BaseModel`
    this.oldTable = 'PersonalProfile'; // Tên bảng nguồn
    this.oldSchema = 'dbo';           // Schema của bảng nguồn
    this.newTable = 'users';          // Tên bảng đích
    this.newSchema = 'dbo';           // Schema của bảng đích
    this.sql = sql;                   // Tham chiếu đến thư viện mssql
  }

  /**
   * Lấy một "đợt" (batch) các bản ghi người dùng từ cơ sở dữ liệu cũ.
   * Dữ liệu được lấy tuần tự dựa trên `ID` để đảm bảo không bỏ sót và không xử lý lại.
   *
   * @param {object} options - Các tùy chọn để lấy dữ liệu.
   * @param {number} options.batch - Số lượng bản ghi tối đa cần lấy trong một lần.
   * @param {number} options.lastId - ID của bản ghi cuối cùng đã được xử lý. Hàm sẽ lấy
   *                                  các bản ghi có ID lớn hơn giá trị này.
   * @returns {Promise<Array<object>>} Một mảng chứa các đối tượng người dùng từ DB cũ.
   */
  async fetchBatchFromOldDb({ batch, lastId }) {
    try {
      const query = `
        SELECT TOP ${batch}
          ID, AccountID, AccountName, FullName, Department, DepartmentManager,
          Manager, Gender, BirthDay, Address, Image, Mobile, Email, Position,
          PhongBan, Orders, DepartmentId, PhongBanID, WorkStatus, NgayTao,
          Modified, IsTCT, ImagePath, SignImage, SignImageSmall, CMND,
          SimKySo1, SimKySo2
        FROM ${this.oldSchema}.${this.oldTable}
        WHERE ID > @lastId  -- Lấy các bản ghi mới hơn
        ORDER BY ID ASC     -- Sắp xếp theo ID để xử lý tuần tự
      `;
      // `queryOldDb` có thể tự suy luận kiểu dữ liệu, nhưng trong trường hợp này,
      // `lastId` ban đầu là 0 (number) trong khi cột `ID` có thể là chuỗi (GUID).
      // Điều này gây ra lỗi chuyển đổi kiểu dữ liệu ở phía SQL Server.
      // Do đó, chúng ta cần tạo một request và định nghĩa kiểu dữ liệu của tham số một cách tường minh.
      const request = this.oldPool.request();
      // Định nghĩa `lastId` là kiểu NVarChar để khớp với kiểu dữ liệu của cột ID trong DB.
      request.input('lastId', this.sql.NVarChar, String(lastId));
      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error('Lỗi khi lấy batch dữ liệu từ PersonalProfile (DB cũ):', error);
      throw error; // Ném lỗi để lớp service có thể bắt và xử lý
    }
  }

  /**
   * Lấy thông tin thống kê tổng quan về quá trình di chuyển.
   * Đếm tổng số dòng trong bảng nguồn và bảng đích để so sánh.
   * @returns {Promise<object>} Một đối tượng chứa tổng số bản ghi ở hai DB.
   */
  async getStatus() {
    // Đếm tổng số bản ghi trong bảng nguồn
    const totalInOldDb = await this.count(this.oldTable, this.oldSchema, true);
    // Đếm tổng số bản ghi trong bảng đích
    const totalInNewDb = await this.count(this.newTable, this.newSchema, false);
    return {
      totalInOldDb,
      totalInNewDb,
      remaining: totalInOldDb - totalInNewDb,
      lastMigratedId: null, // Ghi chú: Để lấy ID cuối cùng một cách chính xác, cần một logic phức tạp hơn,
                              // ví dụ như truy vấn bản ghi có `id_user_bak` lớn nhất trong bảng đích.
    };
  }

  /**
   * Tìm một người dùng trong cơ sở dữ liệu mới dựa trên ID từ cơ sở dữ liệu cũ.
   * ID gốc được lưu trong cột `id_user_bak` để tiện cho việc kiểm tra và đối chiếu.
   *
   * @param {string|number} backupId - ID của người dùng trong bảng `PersonalProfile` (DB cũ).
   * @returns {Promise<object|null>} Trả về đối tượng người dùng nếu tìm thấy, ngược lại trả về `null`.
   */
  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, username, name, id_user_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_user_bak = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      // Nếu có kết quả, trả về dòng đầu tiên, nếu không trả về null.
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi khi tìm bản ghi theo id_user_bak:', error);
      throw error;
    }
  }

  /**
   * Kiểm tra xem một `username` đã tồn tại trong cơ sở dữ liệu mới hay chưa.
   * Việc này rất quan trọng để tránh tạo ra các `username` trùng lặp,
   * vốn thường là một ràng buộc duy nhất (UNIQUE constraint) trong bảng người dùng.
   *
   * @param {string} username - Tên đăng nhập cần kiểm tra.
   * @returns {Promise<boolean>} `true` nếu username đã tồn tại, `false` nếu chưa.
   */
  async checkUsernameExists(username) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM ${this.newSchema}.${this.newTable}
        WHERE username = @username
      `;
      const result = await this.queryNewDb(query, { username });
      return result[0].count > 0;
    } catch (error) {
      logger.error('Lỗi khi kiểm tra sự tồn tại của username:', error);
      throw error;
    }
  }

  /**
   * Chèn một bản ghi người dùng mới vào cơ sở dữ liệu đích.
   * Hàm này nhận một đối tượng dữ liệu đã được ánh xạ và chuẩn hóa.
   *
   * @param {object} data - Đối tượng chứa dữ liệu của người dùng cần chèn.
   * @returns {Promise<boolean>} `true` nếu chèn thành công.
   */
  async insertToNewDb(data) {
    try {
      if (!data || Object.keys(data).length === 0) {
        throw new Error('Dữ liệu để chèn vào DB không được rỗng.');
      }

      // Chuẩn bị dữ liệu lần cuối để đảm bảo tính toàn vẹn (ví dụ: các giá trị không được NULL)
      const processedData = this.prepareDataForInsert(data);
      const fields = Object.keys(processedData);
      const values = fields.map((_, i) => `@param${i}`).join(', '); // Tạo chuỗi placeholder: @param0, @param1, ...

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable}
        (${fields.join(', ')})
        VALUES (${values})
      `;

      // Tạo một request mới từ connection pool của DB mới
      const request = this.newPool.request();

      // Thêm các tham số vào request một cách an toàn, có định kiểu rõ ràng
      fields.forEach((field, i) => {
        const value = processedData[field];
        const paramName = `param${i}`;

        // `prepareDataForInsert` đã chuẩn hóa kiểu dữ liệu.
        // Logic dưới đây sẽ map kiểu dữ liệu Javascript sang kiểu của MSSQL một cách chung chung.
        if (value instanceof Date) {
            request.input(paramName, this.sql.DateTime2, value); // DateTime2 chính xác hơn DateTime
        } else if (typeof value === 'boolean') {
            request.input(paramName, this.sql.Bit, value);
        } else if (typeof value === 'number') {
            // Phân biệt giữa số nguyên và số thực
            request.input(paramName, Number.isInteger(value) ? this.sql.Int : this.sql.Float, value);
        } else {
            // Mặc định cho chuỗi, null, và các kiểu khác. Driver `mssql` sẽ tự xử lý.
            request.input(paramName, value);
        }
      });

      await request.query(query); // Thực thi câu lệnh
      return true;

    } catch (error) {
      logger.error('Lỗi khi chèn dữ liệu người dùng vào DB mới:', error.message);
      logger.error('Chi tiết dữ liệu gây lỗi:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  /**
   * Chuẩn bị và làm sạch dữ liệu ngay trước khi chèn vào cơ sở dữ liệu.
   * Hàm này đảm bảo các ràng buộc NOT NULL được thỏa mãn và các kiểu dữ liệu
   * được định dạng đúng cách.
   *
   * @param {object} data - Dữ liệu đầu vào, đã qua ánh xạ.
   * @returns {object} Dữ liệu đã được xử lý, sẵn sàng để chèn.
   */
  prepareDataForInsert(data) {
    const processed = { ...data };

    // Đảm bảo các trường bắt buộc phải có giá trị
    if (!processed.id) throw new Error('ID là trường bắt buộc và không được rỗng.');
    if (!processed.name) processed.name = 'Unknown';
    if (!processed.username) processed.username = `user_${Date.now()}`;
    if (!processed.avatar) processed.avatar = '[]';

    // Gán giá trị mặc định cho các trường số nếu chúng không tồn tại
    if (typeof processed.status !== 'number') processed.status = 1;
    if (typeof processed.orders !== 'number') processed.orders = 1000;

    // Chuẩn hóa giá trị Bit (true/false)
    const isTCTValue = processed.IsTCT; // Chuyển đổi giá trị sang kiểu boolean tường minh
    processed.IsTCT = isTCTValue === true || isTCTValue === 1 || isTCTValue === '1';
    
    // Chuẩn hóa giá trị ngày tháng
    if (!processed.created_at || !(processed.created_at instanceof Date)) {
      processed.created_at = new Date();
    }
    if (!processed.updated_at || !(processed.updated_at instanceof Date)) {
      processed.updated_at = new Date();
    }
    
    // Xử lý trường `birthday`
    if (processed.birthday && !(processed.birthday instanceof Date)) {
      try {
        const date = new Date(processed.birthday);
        // Nếu ngày hợp lệ, gán lại, nếu không, đặt là null
        processed.birthday = isNaN(date.getTime()) ? null : date;
      } catch {
        processed.birthday = null; // Bắt lỗi nếu new Date() thất bại
      }
    } else if (typeof processed.birthday === 'undefined') {
      processed.birthday = null;
    }

    return processed;
  }

  /**
   * Thực hiện logic hậu xử lý:
   * 1. Tạo organization_units từ Department của users (nếu chưa có).
   * 2. Cập nhật trường parent của users dựa trên organization_units vừa tạo.
   */
  async syncDepartmentsFromUsers() {
    try {
      logger.info('Đang đồng bộ Phòng ban từ Users (render2302)...');

      // 1. INSERT organization_units từ Department của users
      // Lưu ý: Thêm điều kiện NOT EXISTS để tránh lỗi trùng lặp nếu chạy nhiều lần
      const insertQuery = `
        INSERT INTO ${this.newSchema}.organization_units 
        ( id, name, code, [type], phone_number, email, leader, [position], address, description, display_order, status, mpath, parentId, created_at, updated_at, Id_backups, table_backups ) 
        SELECT NEWID() AS id, u.Department AS name, UPPER(REPLACE(u.Department, ' ', '')) AS code, 1 AS [type], NULL, NULL, NULL, NULL, NULL, NULL, 0, 1, NULL, NULL, GETDATE(), GETDATE(), NULL, 'render2302' 
        FROM ${this.newSchema}.${this.newTable} u 
        WHERE u.Department IS NOT NULL 
        AND NOT EXISTS (SELECT 1 FROM ${this.newSchema}.organization_units o WHERE o.name = u.Department)
        GROUP BY u.Department;
      `;
      await this.queryNewDb(insertQuery);

      // 2. UPDATE parent cho users
      const updateQuery = `
        UPDATE u 
        SET u.parent = o.id 
        FROM ${this.newSchema}.${this.newTable} u 
        INNER JOIN ${this.newSchema}.organization_units o ON u.Department = o.name 
        WHERE o.table_backups = 'render2302';
      `;
      await this.queryNewDb(updateQuery);

      logger.info('Đồng bộ Phòng ban và cập nhật Parent cho User hoàn tất.');
    } catch (error) {
      logger.error('Lỗi khi đồng bộ Phòng ban từ Users:', error);
      // Không throw error ở đây để tránh làm fail cả quá trình migration chính, chỉ ghi log lỗi.
    }
  }
}

module.exports = StreamUserMigrationModel;
