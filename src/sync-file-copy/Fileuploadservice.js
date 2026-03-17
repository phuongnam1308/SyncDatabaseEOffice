const { Client: MinioClient } = require('minio');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');
const FileModel = require('./FileModel');
const FileRelationsModel = require('./FileRelationsModel');
const fs = require('fs/promises');
const fsSync = require('fs');

// ══════════════════════════════════════════════
//  KHỞI TẠO MINIO CLIENT TỪ ENV
//  Các biến môi trường cần có:
//    MINIO_ENDPOINT   - host MinIO (vd: "minio.internal" hoặc "localhost")
//    MINIO_PORT       - port (vd: 9000)
//    MINIO_USE_SSL    - "true" / "false"
//    MINIO_ACCESS_KEY - access key
//    MINIO_SECRET_KEY - secret key
//    MINIO_BUCKET     - tên bucket mặc định
// ══════════════════════════════════════════════
const minioClient = new MinioClient({
  endPoint:  process.env.MINIO_ENDPOINT  || 'localhost',
  port:      parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL:    process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const DEFAULT_BUCKET = process.env.MINIO_BUCKET || 'files';
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '..', '..', 'uploads');


class FileUploadService {
  /**
   * @param {import('mssql').ConnectionPool|null} pool - DB pool đã được khởi tạo (this.newPool từ BaseModel)
   */
  constructor(pool = null) {
    this.fileModel          = new FileModel();
    this.fileRelationsModel = new FileRelationsModel();
    // Gán pool trực tiếp vào 2 model — tránh phải gọi initialize() riêng
    if (pool) {
      this.fileModel.newPool          = pool;
      this.fileRelationsModel.newPool = pool;
    }
  }

  // ──────────────────────────────────────────────
  //  PUBLIC API
  // ──────────────────────────────────────────────

  /**
   * Upload file lên MinIO → insert vào bảng `files` → insert vào bảng `file_relations`.
   * Nếu bất kỳ bước DB nào fail thì tự động rollback MinIO (xóa file đã upload).
   *
   * @param {object}  options
   *
   * ── PHẦN UPLOAD ──────────────────────────────────────────────────────────────────
   * @param {Buffer}  options.fileBuffer                  - Nội dung file dạng Buffer (bắt buộc)
   * @param {string}  options.originalName                - Tên file gốc, vd: "baocao.docx" (bắt buộc)
   * @param {string}  [options.mimeType]                  - MIME type, vd: "application/pdf"
   * @param {string}  [options.bucket]                    - Tên bucket MinIO (mặc định: MINIO_BUCKET env)
   * @param {string}  [options.folder]                    - Thư mục con trong bucket, vd: "incoming-docs/2024"
   * @param {object}  [options.transaction]               - SQL Transaction dùng chung cho cả 2 insert DB
   *
   * ── BẢNG files (FileModel) ────────────────────────────────────────────────────────
   * @param {object}  options.fileRecord                           - Dữ liệu insert vào bảng files (bắt buộc)
   * @param {string}  [options.fileRecord.file_name]               - Tên file (mặc định = originalName nếu không truyền)
   * @param {string}  [options.fileRecord.file_path]               - Đường dẫn file logic
   * @param {string}  [options.fileRecord.mime_type]               - MIME type (mặc định = options.mimeType)
   * @param {number}  [options.fileRecord.file_size]               - Kích thước bytes (mặc định = buffer.length)
   * @param {string}  [options.fileRecord.description]             - Mô tả file
   * @param {number}  [options.fileRecord.is_directory=0]          - Có phải thư mục không (0/1)
   * @param {number}  [options.fileRecord.parent_id]               - ID thư mục cha
   * @param {string}  [options.fileRecord.created_by]              - Người tạo
   * @param {Date}    [options.fileRecord.created_at]              - Thời gian tạo (mặc định: GETDATE())
   * @param {Date}    [options.fileRecord.updated_at]              - Thời gian cập nhật (mặc định: GETDATE())
   * @param {number}  [options.fileRecord.status=1]                - Trạng thái (1: hoạt động, 0: ẩn)
   * @param {number}  [options.fileRecord.version]                 - Phiên bản file
   * @param {number}  [options.fileRecord.is_signed_file=0]        - Có phải file đã ký (0/1)
   * @param {number}  [options.fileRecord.number_of_signed_file]   - Số lượng file đã ký
   * @param {string}  [options.fileRecord.storage_path]            - ⚠ TỰ ĐỘNG ĐIỀN từ MinIO, không cần truyền
   * @param {string}  [options.fileRecord.storage_type]            - ⚠ TỰ ĐỘNG ĐIỀN = 'minio', không cần truyền
   * @param {number}  [options.fileRecord.isNumbered=0]            - Có đánh số không (0/1)
   * @param {string}  [options.fileRecord.typeSize]                - Loại kích thước
   * @param {string}  [options.fileRecord.id_bak]                  - ID backup từ hệ thống cũ
   * @param {string}  [options.fileRecord.table_bak]               - Tên bảng backup
   * @param {string}  [options.fileRecord.type_doc]                - Loại tài liệu
   * @param {number}  [options.fileRecord.isBak=0]                 - Có phải bản backup không (0/1)
   * @param {string}  [options.fileRecord.nguoikyvanban]           - Người ký văn bản
   * @param {number}  [options.fileRecord.is_important=0]          - Tài liệu quan trọng (0/1)
   *
   * ── BẢNG file_relations (FileRelationsModel) ─────────────────────────────────────
   * @param {object|null} [options.relationRecord]                    - Dữ liệu insert vào bảng file_relations.
   *                                                                    Truyền null để bỏ qua bước này.
   * @param {string}  [options.relationRecord.object_type]            - Loại đối tượng liên kết, vd: 'IncomingDocument'
   * @param {string}  [options.relationRecord.object_id]              - ID đối tượng liên kết
   * @param {number}  [options.relationRecord.file_id]                - ⚠ TỰ ĐỘNG ĐIỀN sau insert files, không cần truyền
   * @param {number}  [options.relationRecord.status=1]               - Trạng thái (1: hoạt động, 0: ẩn)
   * @param {number}  [options.relationRecord.is_certified_copy=0]    - Có phải bản sao công chứng (0/1)
   * @param {string}  [options.relationRecord.object_id_bak]          - ID đối tượng backup từ hệ thống cũ
   * @param {string}  [options.relationRecord.file_id_bak]            - ID file backup từ hệ thống cũ
   * @param {string}  [options.relationRecord.table_bak]              - Tên bảng backup
   * @param {string}  [options.relationRecord.type_doc]               - Loại tài liệu
   * @param {Date}    [options.relationRecord.created_at]             - Thời gian tạo (mặc định: GETDATE())
   *
   * @returns {Promise<{
   *   fileId:      number,       - ID bản ghi vừa insert vào bảng files
   *   relationId:  number|null,  - ID bản ghi vừa insert vào bảng file_relations (null nếu bỏ qua)
   *   storagePath: string,       - Đường dẫn object MinIO dạng "bucket/folder/uuid-name.ext"
   *   bucket:      string,       - Tên bucket đã dùng
   * }>}
   */
  async uploadAndInsert({
    fileBuffer,
    originalName,
    mimeType,
    fileRecord,
    relationRecord,
    bucket,
    folder,
    transaction,
  } = {}) {
    // ── Validate đầu vào ──
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('[FileUploadService] fileBuffer phải là Buffer hợp lệ.');
    }
    if (!originalName) {
      throw new Error('[FileUploadService] originalName là bắt buộc.');
    }
    if (!fileRecord || typeof fileRecord !== 'object') {
      throw new Error('[FileUploadService] fileRecord là bắt buộc.');
    }

    const targetBucket = bucket || DEFAULT_BUCKET;
    const objectName   = this._buildObjectName(originalName, folder);

    // // ── BƯỚC 1: Đảm bảo bucket tồn tại ──
    // await this._ensureBucket(targetBucket);

    // // ── BƯỚC 2: Upload lên MinIO ──
    // //    Từ đây nếu DB fail → phải xóa file này khỏi MinIO
    // const storagePath = await this._upload(targetBucket, objectName, fileBuffer, mimeType);
    // logger.info(`[FileUploadService] Upload MinIO OK: bucket=${targetBucket}, object=${objectName}`);

    const storagePath = 'https://file-examples.com/wp-content/storage/2017/02/file-sample_100kB.docx';



    // ── BƯỚC 3 & 4: Insert files + file_relations, bọc chung try-catch ──
    //    Bất kỳ lỗi nào trong 2 bước này → rollback MinIO ngay
    let fileId     = null;
    let relationId = null;

    try {
      // BƯỚC 3: Insert vào bảng files
      const enrichedFileRecord = {
        ...fileRecord,
        file_name:    fileRecord.file_name || originalName,
        mime_type:    fileRecord.mime_type || mimeType || null,
        file_size:    fileRecord.file_size ?? fileBuffer.length,
        storage_path: storagePath,   // ghi đè bằng path thực tế trên MinIO
        storage_type: 'minio',
      };

      const fileResult = await this.fileModel.insert(enrichedFileRecord, transaction);
      fileId = fileResult.newId;
      logger.info(`[FileUploadService] Insert files OK: fileId=${fileId}`);

      // BƯỚC 4: Insert vào bảng file_relations (nếu có truyền relationRecord)
      if (relationRecord && typeof relationRecord === 'object') {
        const enrichedRelationRecord = {
          ...relationRecord,
          file_id: fileId,   // gắn file_id vừa có từ bước 3
        };

        const relationResult = await this.fileRelationsModel.insert(enrichedRelationRecord, transaction);
        relationId = relationResult.newId;
        logger.info(`[FileUploadService] Insert file_relations OK: relationId=${relationId}`);
      }

    } catch (dbError) {
      // Một trong 2 bước DB fail → rollback MinIO ngay lập tức
      logger.error(
        `[FileUploadService] Insert DB thất bại, đang rollback MinIO` +
        ` (bucket=${targetBucket}, object=${objectName})... Lỗi: ${dbError.message}`
      );

      try {
        await minioClient.removeObject(targetBucket, objectName);
        logger.info(`[FileUploadService] Rollback MinIO OK: đã xóa object=${objectName}`);
      } catch (rollbackErr) {
        // Rollback MinIO cũng fail → log cảnh báo để admin vào xóa tay
        logger.error(
          `[FileUploadService] ⚠ ROLLBACK MINIO THẤT BẠI — file rác tồn tại trên MinIO!` +
          ` bucket=${targetBucket}, object=${objectName}. Lỗi rollback: ${rollbackErr.message}`
        );
      }

      // Ném lại lỗi gốc để caller xử lý (rollback transaction nếu có)
      throw dbError;
    }

    return {
      fileId,
      relationId,
      storagePath,
      bucket: targetBucket,
    };
  }

  /**
   * Lưu file vào thư mục cục bộ → insert vào bảng `files` → insert vào bảng `file_relations`.
   * Nếu bất kỳ bước DB nào fail thì tự động rollback (xóa file đã lưu).
   *
   * @param {object} options - Tương tự `uploadAndInsert` nhưng không có `bucket`.
   * @returns {Promise<{
   *   fileId:      number,
   *   relationId:  number|null,
   *   storagePath: string,
   * }>}
   */
  async saveToLocalAndInsert({
    fileBuffer,
    originalName,
    mimeType,
    fileRecord,
    relationRecord,
    folder,
    transaction,
  } = {}) {
    // ── Validate đầu vào ──
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('[FileUploadService] fileBuffer phải là Buffer hợp lệ.');
    }
    if (!originalName) {
      throw new Error('[FileUploadService] originalName là bắt buộc.');
    }
    if (!fileRecord || typeof fileRecord !== 'object') {
      throw new Error('[FileUploadService] fileRecord là bắt buộc.');
    }

    // ── BƯỚC 1: Chuẩn bị đường dẫn và thư mục ──
    const uniqueFileName = this._buildObjectName(originalName, null);
    const targetFolder = folder ? path.join(LOCAL_STORAGE_PATH, folder) : LOCAL_STORAGE_PATH;
    const fullPath = path.join(targetFolder, uniqueFileName);
    const relativePath = path.relative(LOCAL_STORAGE_PATH, fullPath);

    // Tạo thư mục nếu chưa có
    if (!fsSync.existsSync(targetFolder)) {
      await fs.mkdir(targetFolder, { recursive: true });
      logger.info(`[FileUploadService] Đã tạo thư mục cục bộ: ${targetFolder}`);
    }

    // ── BƯỚC 2: Lưu file vào thư mục ──
    await fs.writeFile(fullPath, fileBuffer);
    logger.info(`[FileUploadService] Lưu file cục bộ OK: ${fullPath}`);
    
    // ── BƯỚC 3 & 4: Insert files + file_relations, bọc chung try-catch ──
    let fileId = null;
    let relationId = null;

    try {
      // BƯỚC 3: Insert vào bảng files
      const enrichedFileRecord = {
        ...fileRecord,
        file_name: fileRecord.file_name || originalName,
        mime_type: fileRecord.mime_type || mimeType || null,
        file_size: fileRecord.file_size ?? fileBuffer.length,
        storage_path: relativePath,
        storage_type: 'filesystem',
      };

      const fileResult = await this.fileModel.insert(enrichedFileRecord, transaction);
      fileId = fileResult.newId;
      logger.info(`[FileUploadService] Insert files OK: fileId=${fileId}`);

      // BƯỚC 4: Insert vào bảng file_relations (nếu có)
      if (relationRecord && typeof relationRecord === 'object') {
        const enrichedRelationRecord = {
          ...relationRecord,
          file_id: fileId,
        };

        const relationResult = await this.fileRelationsModel.insert(enrichedRelationRecord, transaction);
        relationId = relationResult.newId;
        logger.info(`[FileUploadService] Insert file_relations OK: relationId=${relationId}`);
      }

    } catch (dbError) {
      logger.error(
        `[FileUploadService] Insert DB thất bại, đang rollback file cục bộ (${fullPath})... Lỗi: ${dbError.message}`
      );
      try {
        await fs.unlink(fullPath);
        logger.info(`[FileUploadService] Rollback file cục bộ OK: đã xóa ${fullPath}`);
      } catch (rollbackErr) {
        logger.error(
          `[FileUploadService] ⚠ ROLLBACK FILE CỤC BỘ THẤT BẠI — file rác tồn tại! Path: ${fullPath}. Lỗi rollback: ${rollbackErr.message}`
        );
      }
      throw dbError;
    }

    return {
      fileId,
      relationId,
      storagePath: relativePath,
    };
  }


  /**
   * Tạo presigned URL để client tải file trực tiếp từ MinIO.
   *
   * @param {string} storagePath  - Giá trị cột storage_path trong bảng files (dạng "bucket/object")
   * @param {number} [expirySeconds=3600] - Thời gian hết hạn URL tính bằng giây
   * @returns {Promise<string>}
   */
  async getDownloadUrl(storagePath, expirySeconds = 3600) {
    const { bucket, objectName } = this._parseStoragePath(storagePath);
    return minioClient.presignedGetObject(bucket, objectName, expirySeconds);
  }

  /**
   * Xóa file khỏi MinIO (thường gọi khi xóa bản ghi trong DB).
   *
   * @param {string} storagePath - Giá trị cột storage_path trong bảng files
   * @returns {Promise<void>}
   */
  async deleteFromStorage(storagePath) {
    try {
      const { bucket, objectName } = this._parseStoragePath(storagePath);
      await minioClient.removeObject(bucket, objectName);
      logger.info(`[FileUploadService] Đã xóa MinIO object: ${storagePath}`);
    } catch (err) {
      logger.warn(`[FileUploadService] Không xóa được MinIO object (${storagePath}): ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  //  PRIVATE HELPERS
  // ──────────────────────────────────────────────

  /** Tạo tên object duy nhất: [folder/]<uuid>-<sanitized-name><ext> */
  _buildObjectName(originalName, folder) {
    const ext        = path.extname(originalName);
    const baseName   = path.basename(originalName, ext)
                         .replace(/[^a-zA-Z0-9._-]/g, '_')
                         .substring(0, 80);
    const uniqueName = `${uuidv4()}-${baseName}${ext}`;
    return folder ? `${folder.replace(/\/$/, '')}/${uniqueName}` : uniqueName;
  }

  /** Tự tạo bucket nếu chưa tồn tại */
  async _ensureBucket(bucket) {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket);
      logger.info(`[FileUploadService] Đã tạo bucket mới: ${bucket}`);
    }
  }

  /** Upload Buffer lên MinIO, trả về storage_path dạng "bucket/objectName" */
  async _upload(bucket, objectName, buffer, mimeType) {
    const meta = mimeType ? { 'Content-Type': mimeType } : {};
    await minioClient.putObject(bucket, objectName, buffer, buffer.length, meta);
    return `${bucket}/${objectName}`;
  }

  /** Parse "bucket/objectName" → { bucket, objectName } */
  _parseStoragePath(storagePath) {
    if (!storagePath || typeof storagePath !== 'string') {
      throw new Error(`[FileUploadService] storage_path không hợp lệ: ${storagePath}`);
    }
    const idx = storagePath.indexOf('/');
    if (idx === -1) {
      throw new Error(`[FileUploadService] storage_path thiếu bucket: ${storagePath}`);
    }
    return {
      bucket:     storagePath.substring(0, idx),
      objectName: storagePath.substring(idx + 1),
    };
  }
}

module.exports = FileUploadService;

// ══════════════════════════════════════════════
//  CÁCH DÙNG ĐẦY ĐỦ
// ══════════════════════════════════════════════
//
//  const FileUploadService = require('./FileUploadService');
//  const svc = new FileUploadService();
//
//  const result = await svc.uploadAndInsert({
//    // ── UPLOAD ──────────────────────────────────────
//    fileBuffer:   fs.readFileSync('/tmp/baocao.pdf'),  // bắt buộc
//    originalName: 'baocao.pdf',                        // bắt buộc
//    mimeType:     'application/pdf',
//    bucket:       'files',                             // mặc định: MINIO_BUCKET env
//    folder:       'incoming-docs/2024',                // tùy chọn
//    transaction:  null,                                // SQL Transaction nếu cần atomic
//
//    // ── BẢNG files ──────────────────────────────────
//    fileRecord: {
//      file_name:             'baocao.pdf',             // mặc định = originalName
//      file_path:             '/docs/2024/',            // đường dẫn logic
//      mime_type:             'application/pdf',        // mặc định = mimeType
//      file_size:             204800,                   // mặc định = buffer.length
//      description:           'Báo cáo tháng 3 năm 2024',
//      is_directory:          0,                        // mặc định: 0
//      parent_id:             42,
//      created_by:            'user123',
//      created_at:            new Date('2024-03-01'),   // mặc định: GETDATE()
//      updated_at:            new Date('2024-03-01'),   // mặc định: GETDATE()
//      status:                1,                        // mặc định: 1
//      version:               1,
//      is_signed_file:        0,                        // mặc định: 0
//      number_of_signed_file: null,
//      // storage_path ← TỰ ĐỘNG ĐIỀN từ MinIO, KHÔNG truyền
//      // storage_type ← TỰ ĐỘNG ĐIỀN = 'minio', KHÔNG truyền
//      isNumbered:            0,                        // mặc định: 0
//      typeSize:              'MB',
//      id_bak:                'OLD-FILE-001',
//      table_bak:             'OldFiles',
//      type_doc:              'BaoCao',
//      isBak:                 0,                        // mặc định: 0
//      nguoikyvanban:         'Nguyễn Văn A',
//      is_important:          1,
//    },
//
//    // ── BẢNG file_relations ─────────────────────────
//    relationRecord: {
//      object_type:       'IncomingDocument',           // bắt buộc
//      object_id:         'DOC-999',                    // bắt buộc
//      // file_id ← TỰ ĐỘNG ĐIỀN sau khi insert files xong, KHÔNG truyền
//      status:            1,                            // mặc định: 1
//      is_certified_copy: 0,                            // mặc định: 0
//      object_id_bak:     'OLD-DOC-001',
//      file_id_bak:       'OLD-FILE-001',
//      table_bak:         'FileRelations',
//      type_doc:          'BaoCao',
//      created_at:        new Date('2024-03-01'),       // mặc định: GETDATE()
//    },
//    // Truyền relationRecord: null nếu chỉ muốn insert files, bỏ qua file_relations
//  });
//
//  // result = {
//  //   fileId:      99,
//  //   relationId:  55,
//  //   storagePath: 'files/incoming-docs/2024/uuid-baocao.pdf',
//  //   bucket:      'files',
//  // }
//
//  // ── Lấy presigned URL download (hết hạn sau 1 giờ) ──
//  const url = await svc.getDownloadUrl(result.storagePath, 3600);
//
//  // ── Xóa file khỏi MinIO ──
//  await svc.deleteFromStorage(result.storagePath);
//
//  // ── Dùng với SQL Transaction ──
//  const tx = await pool.transaction();
//  await tx.begin();
//  try {
//    const result = await svc.uploadAndInsert({ ..., transaction: tx });
//    await tx.commit();
//  } catch (err) {
//    await tx.rollback();
//    // MinIO đã được tự rollback bên trong nếu DB fail
//  }