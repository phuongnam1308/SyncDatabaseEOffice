// // config/tablesUser.js
// const tableMappings = {
//   user: {
//     oldTable: 'PersonalProfile',
//     oldSchema: 'dbo',
//     oldDatabase: 'DataEOfficeSNP',

//     newTable: 'users',
//     newSchema: 'dbo',
//     newDatabase: 'camunda',

//     fieldMapping: {
//       'AccountID': 'AccountID',
//       'AccountName': 'username',
//       'FullName': 'FullName',
//       'Department': 'Department',
//       'DepartmentManager': 'DepartmentManager',
//       'Manager': 'leader',
//       'Gender': 'gender',
//       'BirthDay': 'birthday',
//       'Address': 'address_user',
//       'Image': 'avatar',
//       'Mobile': 'phone_number_user',
//       'Email': 'email_user',
//       'Position': 'position',
//       'PhongBan': 'Department', // giữ 1 cột nếu trùng lặp
//       'Orders': 'orders',
//       'DepartmentId': 'DepartmentId',
//       'PhongBanID': 'PhongBanID',
//       'NgayTao': 'created_at',
//       'Modified': 'updated_at',
//       'IsTCT': 'IsTCT',
//       'ImagePath': 'ImagePath',
//       'SignImage': 'SignImage',
//       'SignImageSmall': 'SignImageSmall',
//       'CMND': 'identification_card',
//       'SimKySo1': 'SimKySo1',
//       'SimKySo2': 'SimKySo2'
//     },

//     requiredFields: ['username', 'name'],

//     defaultValues: {
//       'id': () => require('uuid').v4().toUpperCase(),
//       'password': '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa',
//       'name': (record) => (record.FullName || record.AccountName || 'Unknown').trim(),
//       'avatar': (record) => record.Image || '[]',
//       'code_nd': null,
//       'description': null,
//       'role': null,
//       'roles_by_process': '[]',
//       'organization_name': null,
//       'organization_code': null,
//       'organization_type': null,
//       'contact_time': null,
//       'parent': null,
//       'wso2_user_id': null,
//       'keycloak_user_id': null,
//       'status': (record) => {
//         const ws = record.WorkStatus;
//         return ws === -1 ? 3 : (ws === 1 ? 1 : 1);
//       },
//       'author': '',
//       'role_group_source_authorized': '',
//       'name_authorized': null,
//       'id_user_bak': (record) => record.ID,
//       'gender': (record) => {
//         const g = record.Gender;
//         return g === 1 ? 'nam' : (g === 0 ? 'nu' : null);
//       },
//       'created_at': () => new Date(),
//       'updated_at': () => new Date(),
//       'table_backups': 'PersonalProfile'
//     },

//     handleDuplicateUsername: true,
//     backupIdField: 'id_user_bak'
//   }
// };

// module.exports = { tableMappings };

// config/tablesUser.js
const tableMappings = {
  user: {
    oldTable: 'PersonalProfile',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'users',
    newSchema: 'dbo',
    newDatabase: 'camunda',

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
      'PhongBan': 'Department', // Chú ý: trùng với Department ở trên
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

    requiredFields: ['username', 'name'],

    defaultValues: {
      'id': () => require('uuid').v4().toUpperCase(),
      'password': '$10$mH.NYj.Bapxk4auiGaPKhOfCqUnA8jr1JO5fvP3miKbhIfwU3CVRa',
      'name': (record) => {
        // Xử lý cẩn thận để tránh lỗi
        if (!record) return 'Unknown';
        return (record.FullName || record.AccountName || 'Unknown').trim();
      },
      'avatar': (record) => record?.Image || '[]',
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
      'status': (record) => {
        if (!record || record.WorkStatus === undefined) return 1;
        const ws = String(record.WorkStatus);
        return ws === '-1' ? 3 : 1;
      },
      'author': '',
      'role_group_source_authorized': '',
      'name_authorized': null,
      'id_user_bak': (record) => record?.ID || '',
      'gender': (record) => {
        if (!record || record.Gender === undefined) return null;
        const g = String(record.Gender);
        return g === '1' ? 'nam' : (g === '0' ? 'nu' : null);
      },
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      'table_backups': 'PersonalProfile'
    },

    handleDuplicateUsername: true,
    backupIdField: 'id_user_bak'
  }
};

module.exports = { tableMappings };