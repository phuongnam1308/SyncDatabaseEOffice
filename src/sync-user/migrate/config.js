
// Biến `tableMappings` chứa cấu hình chi tiết cho việc di chuyển dữ liệu
// từ một bảng cũ sang một bảng mới. Trong trường hợp này, nó định nghĩa cách di chuyển
// dữ liệu người dùng.
const tableMappings = {
  // 'user' là key định danh cho khối cấu hình này, dùng để chỉ việc di chuyển dữ liệu người dùng.
  user: {
    // === Cấu hình cho bảng nguồn (dữ liệu cũ) ===
    oldTable: 'PersonalProfile', // Tên bảng nguồn chứa thông tin người dùng.
    oldSchema: 'dbo',             // Schema của bảng nguồn.
    oldDatabase: process.env.OLD_DB_NAME ,  // Tên cơ sở dữ liệu nguồn.

    // === Cấu hình cho bảng đích (dữ liệu mới) ===
    newTable: 'users',            // Tên bảng đích sẽ lưu thông tin người dùng.
    newSchema: 'dbo',             // Schema của bảng đích.
    newDatabase: process.env.NEW_DB_NAME ,         // Tên cơ sở dữ liệu đích.

    // === Ánh xạ trường (Field Mapping) ===
    // Định nghĩa cách ánh xạ các cột từ bảng cũ sang bảng mới.
    // 'Tên cột bảng cũ': 'Tên cột bảng mới'
    fieldMapping: {
      'AccountID': 'AccountID',
      'AccountName': 'username',
      'FullName': 'FullName',
      'Department': 'Department',
      'DepartmentManager': 'DepartmentManager',
      'Manager': 'leader',
      'Gender': 'gender',
      'BirthDay': 'birthday',
      'Address': 'address_user',
      'Image': 'avatar',
      'Mobile': 'phone_number_user',
      'Email': 'email_user',
      'Position': 'position',
      'PhongBan': 'Department',      // Chú ý: Cột này có thể trùng lặp hoặc là một tên gọi khác cho 'Department'.
      'Orders': 'orders',
      'DepartmentId': 'DepartmentId',
      'PhongBanID': 'PhongBanID',
      'NgayTao': 'created_at',
      'Modified': 'updated_at',
      'IsTCT': 'IsTCT',
      'ImagePath': 'ImagePath',
      'SignImage': 'SignImage',
      'SignImageSmall': 'SignImageSmall',
      'CMND': 'identification_card',
      'SimKySo1': 'SimKySo1',
      'SimKySo2': 'SimKySo2'
    },

    // Mảng các trường bắt buộc phải có trong bản ghi mới.
    // Quá trình di chuyển có thể sẽ kiểm tra các trường này.
    requiredFields: ['username', 'name'],

    // === Giá trị mặc định cho các trường ở bảng mới ===
    // Dùng để tạo giá trị cho các cột trong bảng mới không có trong ánh xạ
    // hoặc cần xử lý logic đặc biệt.
    defaultValues: {
      // Hàm tạo giá trị 'id' duy nhất (UUID) cho mỗi người dùng mới.
      'id': () => require('uuid').v4().toUpperCase(),
      // Mật khẩu mặc định cho tất cả người dùng mới.
      'password': process.env.DEFAULT_USER_PASSWORD || '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa', // Đây là mật khẩu đã được hash.
      // Hàm tạo giá trị cho trường 'name'.
      // Ưu tiên lấy 'FullName', nếu không có thì lấy 'AccountName'.
      'name': (record) => {
        if (!record) return 'Unknown'; // Tránh lỗi nếu không có bản ghi nguồn.
        return (record.FullName || record.AccountName || 'Unknown').trim();
      },
      // Lấy đường dẫn ảnh đại diện, nếu không có thì trả về chuỗi rỗng '[]'.
      'avatar': (record) => record?.Image || '[]',
      // Các trường sau được gán giá trị mặc định là `null` hoặc chuỗi rỗng.
      'code_nd': null,
      'description': null,
      'role': null,
      'roles_by_process': '[]',
      'organization_name': null,
      'organization_code': null,
      'organization_type': null,
      'contact_time': null,
      'parent': null,
      'wso2_user_id': null,
      'keycloak_user_id': null,
      // Hàm xử lý trạng thái người dùng.
      // `WorkStatus` ở bảng cũ: -1 -> 3 (ngừng hoạt động), ngược lại là 1 (hoạt động).
      'status': (record) => {
        if (!record || record.WorkStatus === undefined) return 1; // Mặc định là hoạt động
        const ws = String(record.WorkStatus);
        return ws === '-1' ? 3 : 1;
      },
      'author': '',
      'role_group_source_authorized': '',
      'name_authorized': null,
      // Lưu lại ID gốc từ bảng 'PersonalProfile' để đối chiếu.
      'id_user_bak': (record) => record?.ID || '',
      // Hàm chuyển đổi giới tính: 1 -> 'nam', 0 -> 'nu'.
      'gender': (record) => {
        if (!record || record.Gender === undefined) return null;
        const g = String(record.Gender);
        return g === '1' ? 'nam' : (g === '0' ? 'nu' : null);
      },
      // Gán ngày giờ tạo và cập nhật là thời điểm hiện tại.
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      // Ghi lại tên bảng nguồn để tiện cho việc truy vết.
      'table_backups': 'PersonalProfile'
    },

    // === Cấu hình xử lý đặc biệt ===
    // Nếu `true`, hệ thống sẽ kiểm tra và xử lý trường hợp `username` bị trùng lặp.
    handleDuplicateUsername: true,
    // Tên trường trong bảng mới dùng để lưu ID gốc từ bảng cũ.
    backupIdField: 'id_user_bak'
  }
};

// Xuất khẩu cấu hình để các module khác có thể sử dụng.
module.exports = { tableMappings };
