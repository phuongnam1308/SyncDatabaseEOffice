// // config/tablesUserDelete.js
// const tableMappings = {
//   userdelete: {
//     oldTable: 'PersonalProfileDelete',
//     oldSchema: 'dbo',
//     oldDatabase: 'DataEOfficeSNP',

//     newTable: 'users',
//     newSchema: 'dbo',
//     newDatabase: 'DiOffice',

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
//       'PhongBan': 'Department',
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
//       'password': '12345678',
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
//       'status': 3,  // Mặc định status = 3
//       'author': '',
//       'role_group_source_authorized': '',
//       'name_authorized': null,
//       'id_user_del_bak': (record) => record.ID,  // Lưu ID cũ vào id_user_del_bak
//       'gender': (record) => {
//         const g = record.Gender;
//         return g === 1 ? 'nam' : (g === 0 ? 'nu' : null);
//       },
//       'created_at': () => new Date(),
//       'updated_at': () => new Date(),
//       'table_backups': 'PersonalProfileDelete'  // table_backups = 'PersonalProfileDelete'
//     },

//     handleDuplicateUsername: true,
//     backupIdField: 'id_user_del_bak'
//   }
// };

// module.exports = { tableMappings };

// config/tablesUserDelete.js
const tableMappings = {
  userdelete: {
    oldTable: 'PersonalProfileDelete',
    oldSchema: 'dbo',
    oldDatabase: 'DataEOfficeSNP',

    newTable: 'users',
    newSchema: 'dbo',
    newDatabase: 'DiOffice',

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
      'PhongBan': 'Department',
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
      'status': 3,  // Luôn là 3 cho delete
      'author': '',
      'role_group_source_authorized': '',
      'name_authorized': null,
      'id_user_del_bak': (record) => record?.ID || '',  // Sử dụng id_user_del_bak
      'gender': (record) => {
        if (!record || record.Gender === undefined) return null;
        const g = String(record.Gender);
        return g === '1' ? 'nam' : (g === '0' ? 'nu' : null);
      },
      'created_at': () => new Date(),
      'updated_at': () => new Date(),
      'table_backups': 'PersonalProfileDelete'  // Đánh dấu delete
    },

    handleDuplicateUsername: true,
    backupIdField: 'id_user_del_bak'
  }
};

module.exports = { tableMappings };