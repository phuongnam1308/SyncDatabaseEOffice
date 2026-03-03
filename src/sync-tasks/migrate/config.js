
// Biến `tableMappings` chứa cấu hình chi tiết cho việc di chuyển dữ liệu
// từ một bảng cũ sang một bảng mới. Trong trường hợp này, nó định nghĩa cách di chuyển
// dữ liệu công việc.
const tableMappings = {
  // 'taskVBDen' là key định danh cho khối cấu hình này, dùng để chỉ việc di chuyển dữ liệu công việc.
  taskVBDen: {
    // === Cấu hình cho bảng nguồn (dữ liệu cũ) ===
    oldTable: 'TaskVBDen', // Tên bảng nguồn chứa thông tin công việc.
    oldSchema: 'dbo',             // Schema của bảng nguồn.
    oldDatabase: process.env.OLD_DB_NAME ,  // Tên cơ sở dữ liệu nguồn.

    // === Cấu hình cho bảng đích (dữ liệu mới) ===
    newTable: 'Tasks',            // Tên bảng đích sẽ lưu thông tin công việc.
    newSchema: 'dbo',             // Schema của bảng đích.
    newDatabase: process.env.NEW_DB_NAME ,         // Tên cơ sở dữ liệu đích.

    // === Ánh xạ trường (Field Mapping) ===
    // Định nghĩa cách ánh xạ các cột từ bảng cũ sang bảng mới.
    // 'Tên cột bảng cũ': 'Tên cột bảng mới'
    fieldMapping: {
      'ID': 'id',
      'VBId': 'doc_id',
      'Title': 'name',
      'StartDate': 'start_date',
      'DueDate': 'end_date',
      'Percent': 'progress',
      'TrangThai': 'process_status',
      'Priority': 'priority',
      'YKienChiDao': 'note',
      'Modified': 'update_at',
      'Created': 'created_at',
      'ModifiedBy': 'updated_by',
      'CreatedBy': 'created_by',
      'ParentTaskID': 'parent'
    },

    // Mảng các trường bắt buộc phải có trong bản ghi mới.
    // Quá trình di chuyển có thể sẽ kiểm tra các trường này.
    requiredFields: ['id', 'name'],

    // === Giá trị mặc định cho các trường ở bảng mới ===
    // Dùng để tạo giá trị cho các cột trong bảng mới không có trong ánh xạ
    // hoặc cần xử lý logic đặc biệt.
    defaultValues: {
      // Hàm tạo giá trị 'id' duy nhất (UUID) cho mỗi người dùng mới.
      // 'id': () => require('uuid').v4().toUpperCase(),
      // Hàm tạo giá trị cho trường 'name'.
      // Ưu tiên lấy 'FullName', nếu không có thì lấy 'AccountName'.
      'name': (record) => {
        if (!record) return 'Unknown'; // Tránh lỗi nếu không có bản ghi nguồn.
        return (record.FullName || record.AccountName || 'Unknown').trim();
      },
      // Hàm xử lý trạng thái người dùng.
      // `TrangThai` ở bảng cũ: -1 -> 3 (ngừng hoạt động), ngược lại là 1 (hoạt động).
      // 'status': (record) => {
      //   if (!record || record.TrangThai === undefined) return 1; // Mặc định là hoạt động
      //   const ws = String(record.TrangThai);
      //   return ws === '-1' ? 3 : 1;
      // },
      // Lưu lại ID gốc từ bảng 'TaskVBDen' để đối chiếu.
      'id_task_vbden_bak': (record) => record?.ID || '',
      // Gán ngày giờ tạo và cập nhật là thời điểm hiện tại.
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      // Ghi lại tên bảng nguồn để tiện cho việc truy vết.
      'table_backups': 'TaskVBDen'
    },

    // === Cấu hình xử lý đặc biệt ===
    // Nếu `true`, hệ thống sẽ kiểm tra và xử lý trường hợp `id` bị trùng lặp.
    handleDuplicateID: true,
    // Tên trường trong bảng mới dùng để lưu ID gốc từ bảng cũ.
    backupIdField: 'id_task_vbden_bak'
  },
  // 'TaskVBDenDelete' là key định danh cho khối cấu hình này, dùng để chỉ việc di chuyển dữ liệu công việc.
  TaskVBDenDelete: {
    // === Cấu hình cho bảng nguồn (dữ liệu cũ) ===
    oldTable: 'TaskVBDenDelete', // Tên bảng nguồn chứa thông tin công việcg.
    oldSchema: 'dbo',             // Schema của bảng nguồn.
    oldDatabase: process.env.OLD_DB_NAME ,  // Tên cơ sở dữ liệu nguồn.

    // === Cấu hình cho bảng đích (dữ liệu mới) ===
    newTable: 'Tasks',            // Tên bảng đích sẽ lưu thông tin người dùng.
    newSchema: 'dbo',             // Schema của bảng đích.
    newDatabase: process.env.NEW_DB_NAME ,         // Tên cơ sở dữ liệu đích.

    // === Ánh xạ trường (Field Mapping) ===
    // Định nghĩa cách ánh xạ các cột từ bảng cũ sang bảng mới.
    // 'Tên cột bảng cũ': 'Tên cột bảng mới'
    fieldMapping: {
      'ID': 'id',
      'VBId': 'doc_id',
      'Title': 'name',
      'StartDate': 'start_date',
      'DueDate': 'end_date',
      'Percent': 'progress',
      'TrangThai': 'process_status',
      'Priority': 'priority',
      'YKienChiDao': 'note',
      'Modified': 'update_at',
      'Created': 'created_at',
      'ModifiedBy': 'updated_by',
      'CreatedBy': 'created_by',
      'ParentTaskID': 'parent'
    },

    // Mảng các trường bắt buộc phải có trong bản ghi mới.
    // Quá trình di chuyển có thể sẽ kiểm tra các trường này.
    requiredFields: ['id', 'name'],

    // === Giá trị mặc định cho các trường ở bảng mới ===
    // Dùng để tạo giá trị cho các cột trong bảng mới không có trong ánh xạ
    // hoặc cần xử lý logic đặc biệt.
    defaultValues: {
      // Hàm tạo giá trị 'id' duy nhất (UUID) cho mỗi người dùng mới.
      // 'id': () => require('uuid').v4().toUpperCase(),
      // Hàm tạo giá trị cho trường 'name'.
      // Ưu tiên lấy 'FullName', nếu không có thì lấy 'AccountName'.
      'name': (record) => {
        if (!record) return 'Unknown'; // Tránh lỗi nếu không có bản ghi nguồn.
        return (record.FullName || record.AccountName || 'Unknown').trim();
      },
      // Hàm xử lý trạng thái người dùng.
      // `TrangThai` ở bảng cũ: -1 -> 3 (ngừng hoạt động), ngược lại là 1 (hoạt động).
      // 'status': (record) => {
      //   if (!record || record.TrangThai === undefined) return 1; // Mặc định là hoạt động
      //   const ws = String(record.TrangThai);
      //   return ws === '-1' ? 3 : 1;
      // },
      // Lưu lại ID gốc từ bảng 'TaskVBDenDelete' để đối chiếu.
      'id_task_vbden_del_bak': (record) => record?.ID || '',
      // Gán ngày giờ tạo và cập nhật là thời điểm hiện tại.
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      // Ghi lại tên bảng nguồn để tiện cho việc truy vết.
      'table_backups': 'TaskVBDenDelete'
    },

    // === Cấu hình xử lý đặc biệt ===
    // Nếu `true`, hệ thống sẽ kiểm tra và xử lý trường hợp `id` bị trùng lặp.
    handleDuplicateID: true,
    // Tên trường trong bảng mới dùng để lưu ID gốc từ bảng cũ.
    backupIdField: 'id_task_vbden_del_bak'
  },
  // 'TaskVBDi' là key định danh cho khối cấu hình này, dùng để chỉ việc di chuyển dữ liệu công việc.
  TaskVBDi: {
    // === Cấu hình cho bảng nguồn (dữ liệu cũ) ===
    oldTable: 'TaskVBDi', // Tên bảng nguồn chứa thông tin công việcg.
    oldSchema: 'dbo',             // Schema của bảng nguồn.
    oldDatabase: process.env.OLD_DB_NAME ,  // Tên cơ sở dữ liệu nguồn.

    // === Cấu hình cho bảng đích (dữ liệu mới) ===
    newTable: 'Tasks',            // Tên bảng đích sẽ lưu thông tin người dùng.
    newSchema: 'dbo',             // Schema của bảng đích.
    newDatabase: process.env.NEW_DB_NAME ,         // Tên cơ sở dữ liệu đích.

    // === Ánh xạ trường (Field Mapping) ===
    // Định nghĩa cách ánh xạ các cột từ bảng cũ sang bảng mới.
    // 'Tên cột bảng cũ': 'Tên cột bảng mới'
    fieldMapping: {
      'ID': 'id',
      'VBId': 'doc_id',
      'Title': 'name',
      'StartDate': 'start_date',
      'DueDate': 'end_date',
      'Percent': 'progress',
      'TrangThai': 'process_status',
      'Priority': 'priority',
      'YKienChiDao': 'note',
      'Modified': 'update_at',
      'Created': 'created_at',
      'ModifiedBy': 'updated_by',
      'CreatedBy': 'created_by',
      'ParentTaskID': 'parent'
    },

    // Mảng các trường bắt buộc phải có trong bản ghi mới.
    // Quá trình di chuyển có thể sẽ kiểm tra các trường này.
    requiredFields: ['id', 'name'],

    // === Giá trị mặc định cho các trường ở bảng mới ===
    // Dùng để tạo giá trị cho các cột trong bảng mới không có trong ánh xạ
    // hoặc cần xử lý logic đặc biệt.
    defaultValues: {
      // Hàm tạo giá trị 'id' duy nhất (UUID) cho mỗi người dùng mới.
      // 'id': () => require('uuid').v4().toUpperCase(),
      // Hàm tạo giá trị cho trường 'name'.
      // Ưu tiên lấy 'FullName', nếu không có thì lấy 'AccountName'.
      'name': (record) => {
        if (!record) return 'Unknown'; // Tránh lỗi nếu không có bản ghi nguồn.
        return (record.FullName || record.AccountName || 'Unknown').trim();
      },
      // Hàm xử lý trạng thái người dùng.
      // `TrangThai` ở bảng cũ: -1 -> 3 (ngừng hoạt động), ngược lại là 1 (hoạt động).
      // 'status': (record) => {
      //   if (!record || record.TrangThai === undefined) return 1; // Mặc định là hoạt động
      //   const ws = String(record.TrangThai);
      //   return ws === '-1' ? 3 : 1;
      // },
      // Lưu lại ID gốc từ bảng 'TaskVBDi' để đối chiếu.
      'id_task_vbdi_bak': (record) => record?.ID || '',
      // Gán ngày giờ tạo và cập nhật là thời điểm hiện tại.
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      // Ghi lại tên bảng nguồn để tiện cho việc truy vết.
      'table_backups': 'TaskVBDi'
    },

    // === Cấu hình xử lý đặc biệt ===
    // Nếu `true`, hệ thống sẽ kiểm tra và xử lý trường hợp `id` bị trùng lặp.
    handleDuplicateID: true,
    // Tên trường trong bảng mới dùng để lưu ID gốc từ bảng cũ.
    backupIdField: 'id_task_vbdi_bak'
  }
};

// Xuất khẩu cấu hình để các module khác có thể sử dụng.
module.exports = { tableMappings };
