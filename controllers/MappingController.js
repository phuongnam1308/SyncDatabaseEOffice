// controllers/MappingController.js
const BaseController = require('./BaseController');
const sql = require('mssql');
const { newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class MappingController extends BaseController {
  constructor() {
    super();
  }

  // API: GET /mapping/all-ids
  // Trả về mapping toàn bộ ID cũ → ID mới cho users, groups và quan hệ
  getAllIdMappings = this.asyncHandler(async (req, res) => {
    try {
      const pool = new sql.ConnectionPool(newDbConfig);
      await pool.connect();

      // 1. Mapping Users (PersonalProfile & PersonalProfileDelete)
      const usersResult = await pool.request().query(`
        SELECT 
          Id AS new_id,                  -- Sửa nếu PK là 'id' thì đổi thành id
          id_user_bak,
          id_user_del_bak,
          username,
          name,
          status,
          table_backups,
          created_at,
          updated_at
        FROM camunda.dbo.users
        WHERE id_user_bak IS NOT NULL OR id_user_del_bak IS NOT NULL
        ORDER BY table_backups, username
      `);

      // 2. Mapping Groups (UserGroup)
      const groupsResult = await pool.request().query(`
        SELECT 
          id AS new_id,
          id_group_bk AS old_group_id,
          name,
          code,
          type,
          status,
          createdAt AS created_at,
          updatedAt AS updated_at
        FROM camunda.dbo.group_users
        WHERE id_group_bk IS NOT NULL
        ORDER BY code
      `);

      // 3. Mapping quan hệ User-Group (từ bảng backup)
      const relationsResult = await pool.request().query(`
        SELECT 
          ug.id_user_bak AS old_user_id,
          ug.id_group_bak AS old_group_id,
          ug.id_user_del_bak,
          ug.table_bak,
          u.Id AS mapped_user_id,               -- Sửa nếu PK users là 'id' thì đổi thành id
          u.username AS mapped_username,
          u.name AS mapped_user_name,
          u.table_backups AS user_source_table,
          gu.id AS mapped_group_id,
          gu.name AS mapped_group_name,
          gu.code AS mapped_group_code
        FROM camunda.dbo.user_group_users_bak ug
        LEFT JOIN camunda.dbo.users u 
          ON ug.id_user_bak = u.id_user_bak 
          OR ug.id_user_bak = u.id_user_del_bak
        LEFT JOIN camunda.dbo.group_users gu 
          ON ug.id_group_bak = gu.id_group_bk
        ORDER BY ug.table_bak, ug.id_user_bak
      `);

      await pool.close();

      const response = {
        total_users_mapped: usersResult.recordset.length,
        total_groups_mapped: groupsResult.recordset.length,
        total_relations_mapped: relationsResult.recordset.length,
        data: {
          users: usersResult.recordset,
          groups: groupsResult.recordset,
          user_group_relations: relationsResult.recordset
        }
      };

      return this.success(res, response, 'Mapping toàn bộ ID cũ → ID mới thành công');

    } catch (error) {
      logger.error('Lỗi khi lấy toàn bộ mapping ID:', error);
      return this.error(res, 'Lỗi khi mapping toàn bộ ID cũ sang mới', 500, error);
    }
  });

  // API: POST /mapping/update-relations
  // Đổ dữ liệu thật vào bảng user_group_users + update table_bak trong backup
  updateRelationsMapping = this.asyncHandler(async (req, res) => {
    try {
      const pool = new sql.ConnectionPool(newDbConfig);
      await pool.connect();

      // Bước 1: Đổ dữ liệu thật vào bảng user_group_users (nếu chưa tồn tại)
      const insertResult = await pool.request().query(`
        INSERT INTO camunda.dbo.user_group_users (user_id, group_user_id)
        SELECT DISTINCT
          u.Id AS user_id,                  -- PK của users (sửa nếu tên cột khác)
          gu.id AS group_user_id
        FROM camunda.dbo.user_group_users_bak ug
        INNER JOIN camunda.dbo.users u 
          ON ug.id_user_bak = u.id_user_bak OR ug.id_user_bak = u.id_user_del_bak
        INNER JOIN camunda.dbo.group_users gu 
          ON ug.id_group_bak = gu.id_group_bk
        WHERE NOT EXISTS (
          SELECT 1 
          FROM camunda.dbo.user_group_users tgt 
          WHERE tgt.user_id = u.Id AND tgt.group_user_id = gu.id
        );
      `);

      // Bước 2: Update table_bak trong bảng backup (copy từ users.table_backups)
      const updateTableBak = await pool.request().query(`
        UPDATE ug
        SET ug.table_bak = u.table_backups
        FROM camunda.dbo.user_group_users_bak ug
        INNER JOIN camunda.dbo.users u 
          ON ug.id_user_bak = u.id_user_bak OR ug.id_user_bak = u.id_user_del_bak
        WHERE ug.table_bak IS NULL OR ug.table_bak = '';
      `);

      await pool.close();

      return this.success(res, {
        message: 'Đã đổ dữ liệu thật vào user_group_users và update table_bak thành công',
        details: {
          rows_inserted_into_real_table: insertResult.rowsAffected[0],
          rows_updated_table_bak: updateTableBak.rowsAffected[0]
        }
      }, 'Update và đổ mapping quan hệ hoàn tất');

    } catch (error) {
      logger.error('Lỗi khi update và đổ mapping quan hệ:', error);
      return this.error(res, 'Lỗi khi đổ dữ liệu thật và mapping quan hệ', 500, error);
    }
  });
}

module.exports = new MappingController();