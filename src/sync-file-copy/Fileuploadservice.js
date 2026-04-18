const { Client: MinioClient } = require('minio');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');
const FileModel = require('./FileModel');
const FileRelationsModel = require('./FileRelationsModel');
const fs = require('fs/promises');
const fsSync = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const https = require('https');

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
function resolveMinioConfig() {
  // Support both MINIO_URL and legacy typo MINO_URL
  const urlVarName = process.env.MINIO_URL ? 'MINIO_URL' : (process.env.MINO_URL ? 'MINO_URL' : null);
  const rawUrl = (process.env.MINIO_URL || process.env.MINO_URL || '').trim();
  if (!rawUrl) {
    throw new Error('[FileUploadService][MinIO] Thiếu biến môi trường MINIO_URL (hoặc MINO_URL).');
  }

  const u = new URL(rawUrl);
  const hostFromUrl = u.hostname;
  const portFromUrl = u.port ? parseInt(u.port, 10) : null;
  const sslFromUrl = u.protocol === 'https:';

  // Ghi rõ quá trình "mã hóa/giải mã": ENV -> host/port/ssl dùng để kết nối
  // (Không log mật khẩu)
  logger.info(
    `[FileUploadService][MinIO] Đọc biến môi trường để cấu hình MinIO` +
    ` | biến=${urlVarName || 'MINIO_URL/MINO_URL'}` +
    ` | giá trị=${rawUrl}`
  );
  logger.info(
    `[FileUploadService][MinIO] Tách từ URL ra thông tin kết nối` +
    ` | host(endPoint)=${hostFromUrl}` +
    (portFromUrl != null ? ` | port(trong URL)=${portFromUrl}` : '') +
    ` | SSL(trong URL)=${sslFromUrl}`
  );
  logger.info(
    `[FileUploadService][MinIO] Áp dụng cấu hình kết nối thực tế` +
    ` | host=${hostFromUrl}` +
    ` | port=${portFromUrl || (sslFromUrl ? 443 : 80)}` +
    ` | SSL=${sslFromUrl}` +
    ` | user=${process.env.MINIO_USER ? '[ĐÃ CÓ]' : '[CHƯA CÓ]'}` +
    ` | password=${process.env.MINIO_PASSWORD ? '[ĐÃ CÓ]' : '[CHƯA CÓ]'}`
  );

  return {
    urlVarName,
    rawUrl,
    endPoint: hostFromUrl,
    // Use port from URL if available, otherwise default based on protocol
    port: portFromUrl || (sslFromUrl ? 443 : 80),
    useSSL: sslFromUrl,
    accessKey: process.env.MINIO_USER,
    secretKey: process.env.MINIO_PASSWORD,
  };
}

const MINIO_CONFIG = resolveMinioConfig();

const minioClient = new MinioClient({
  endPoint: MINIO_CONFIG.endPoint,
  port: MINIO_CONFIG.port,
  useSSL: MINIO_CONFIG.useSSL,
  accessKey: MINIO_CONFIG.accessKey,
  secretKey: MINIO_CONFIG.secretKey,
});

const DEFAULT_BUCKET = process.env.MINIO_BUCKET || 'files';
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '..', '..', 'uploads');

// Log cấu hình MinIO (không log secret)
logger.info(
  `[FileUploadService][MinIO] Đã cấu hình kết nối MinIO từ biến ${MINIO_CONFIG.urlVarName || 'MINIO_URL/MINO_URL'}` +
  ` | URL=${MINIO_CONFIG.rawUrl}` +
  ` | Tách ra host(endPoint)=${MINIO_CONFIG.endPoint}` +
  ` | port=${MINIO_CONFIG.port}` +
  ` | SSL=${MINIO_CONFIG.useSSL}` +
  ` | bucket mặc định=${DEFAULT_BUCKET}` +
  ` | (thư viện minio cần endPoint/port/SSL nên phải tách từ URL)`
);

function formatAggregateError(err) {
  if (!err) return null;
  const out = {
    name: err.name,
    code: err.code,
    message: err.message,
  };
  if (err instanceof AggregateError && Array.isArray(err.errors)) {
    out.errors = err.errors.map((e) => ({
      name: e?.name,
      code: e?.code,
      message: e?.message,
      address: e?.address,
      port: e?.port,
    }));
  }
  return out;
}


class FileUploadService {
  /**
   * @param {import('mssql').ConnectionPool|null} pool - DB pool đã được khởi tạo (this.newPool từ BaseModel)
   */
  constructor(pool = null) {
    this.fileModel = new FileModel();
    this.fileRelationsModel = new FileRelationsModel();
    // Gán pool trực tiếp vào 2 model — tránh phải gọi initialize() riêng
    if (pool) {
      this.fileModel.newPool = pool;
      this.fileRelationsModel.newPool = pool;
    }
  }

  /**
   * Lấy token từ Keycloak dùng password grant flow
   * @param {boolean} forceRefresh - Nếu true, bỏ qua cache và lấy mới
   */
  async _getNewSystemToken(forceRefresh = false) {
    const TOKEN_CACHE_PATH = path.join(__dirname, '..', '..', 'uploads', '.keycloak_token_cache');

    try {
      if (!forceRefresh) {
        try {
          const cached = await fs.readFile(TOKEN_CACHE_PATH, 'utf-8');
          if (cached) {
            const { token, expiresAt } = JSON.parse(cached);
            if (token && expiresAt && Date.now() < expiresAt) {
              return token;
            }
          }
        } catch (_) { }
      }

      const issuer = process.env.KEYCLOAK_ISSUER || 'https://iam-uat.snp.com.vn/realms/snp-internal';
      const clientId = process.env.KEYCLOAK_CLIENT_ID || 'doffice';
      const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || 'wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF';
      const username = process.env.KEYCLOAK_USERNAME;
      const password = process.env.KEYCLOAK_PASSWORD;

      if (!username || !password) {
        throw new Error('[FileUploadService] Thiếu KEYCLOAK_USERNAME hoặc KEYCLOAK_PASSWORD');
      }

      const tokenUrl = `${issuer}/protocol/openid-connect/token`;
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('username', username);
      params.append('password', password);
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const agent = new https.Agent({ rejectUnauthorized: false });

      logger.info('[FileUploadService] Đang lấy token Keycloak mới...');
      const response = await axios.post(tokenUrl, params.toString(), {
        httpsAgent: agent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, expires_in } = response.data;
      if (!access_token) {
        throw new Error('[FileUploadService] Keycloak không trả về access_token');
      }

      const expiresAt = Date.now() + (expires_in - 60) * 1000;
      await fs.writeFile(TOKEN_CACHE_PATH, JSON.stringify({ token: access_token, expiresAt }), 'utf-8');

      logger.info(`[FileUploadService] Token Keycloak mới: expires_in=${expires_in}s`);
      return access_token;
    } catch (error) {
      logger.error(`[FileUploadService] Lỗi lấy token Keycloak: ${error.message}`);
      return null;
    }
  }

  /**
   * Helper: Sleep for ms
   */
  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Upload file lên hệ thống mới (Lifetex API)
   */
  async uploadToNewSystem({ fileBuffer, originalName, objectType, objectId }, retryCount = 0) {
    const url = process.env.NEW_SYSTEM_UPLOAD_URL;
    if (!url) {
      logger.warn('[FileUploadService] NEW_SYSTEM_UPLOAD_URL chưa được cấu hình, bỏ qua upload hệ thống mới.');
      return null;
    }

    const token = await this._getNewSystemToken();
    if (!token) {
      logger.error('[FileUploadService] Không có token hệ thống mới, không thể upload.');
      return null;
    }

    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: originalName,
      contentType: 'application/octet-stream' // Sẽ để detect tự động hoặc pass từ ngoài
    });
    formData.append('object_type', objectType || '');
    formData.append('object_id', String(objectId || ''));

    if (retryCount === 0) {
      logger.info(`[FileUploadService] Đang upload lên hệ thống mới: ${url} | object_type=${objectType} | object_id=${objectId} | size=${fileBuffer.length} bytes`);
    } else {
      logger.info(`[FileUploadService] Đang upload lại (lần ${retryCount}): ${url} | object_type=${objectType} | object_id=${objectId} | size=${fileBuffer.length} bytes`);
    }

    try {
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000 // 1 phút timeout cho file lớn
      });

      logger.info(`[FileUploadService] Upload hệ thống mới thành công: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      const isRateLimit = error.response && (
        error.response.status === 429 ||
        (error.response.data && error.response.data.message === 'API rate limit exceeded')
      );

      // Mở rộng retry cho các lỗi mạng (ECONNRESET, ETIMEDOUT, etc.)
      const isNetworkError = !error.response && (
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNABORTED' ||
        error.code === 'EPIPE' ||
        (error.message && error.message.includes('ECONNRESET'))
      );

      // Nếu là lỗi 401 (Unauthorized), thử xóa token và login lại 1 lần duy nhất
      const isUnauthorized = error.response && error.response.status === 401;

      const maxRetries = parseInt(process.env.NEW_SYSTEM_UPLOAD_RETRY_COUNT || '5', 10);
      const retryDelay = parseInt(process.env.NEW_SYSTEM_UPLOAD_RETRY_DELAY_MS || '3000', 10);

      if (isUnauthorized && retryCount === 0) {
        logger.warn('[FileUploadService] Bị lỗi 401 (Unauthorized). Đang xóa token cũ và thử lại với token mới...');
        // Force refresh token
        await this._getNewSystemToken(true);
        return this.uploadToNewSystem({ fileBuffer, originalName, objectType, objectId }, retryCount + 1);
      }

      if ((isRateLimit || isNetworkError) && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * retryDelay;
        const reason = isRateLimit ? 'rate limit (429)' : `lỗi mạng (${error.code || error.message})`;
        logger.warn(`[FileUploadService] Bị ${reason}. Đang chờ ${delay}ms trước khi thử lại lần ${retryCount + 1}/${maxRetries}...`);
        await this._sleep(delay);
        return this.uploadToNewSystem({ fileBuffer, originalName, objectType, objectId }, retryCount + 1);
      }

      const errorDetail = error.response ? JSON.stringify(error.response.data) : (error.code ? `${error.code}: ${error.message}` : error.message);
      logger.error(`[FileUploadService] Upload he thong moi (API) THAT BAI (retry=${retryCount}): ${errorDetail}`);
      return null;
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
    localFolder,
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
    const objectName = this._buildObjectName(originalName, folder);
    const fileSize = fileBuffer.length;
    const mime = mimeType || fileRecord?.mime_type || null;

    // ── (Optional) save local copy before DB insert ──
    let localFullPath = null;
    if (localFolder) {
      const uniqueFileName = path.basename(objectName);
      const targetLocalFolder = path.join(LOCAL_STORAGE_PATH, localFolder);
      localFullPath = path.join(targetLocalFolder, uniqueFileName);
      if (!fsSync.existsSync(targetLocalFolder)) {
        await fs.mkdir(targetLocalFolder, { recursive: true });
        logger.info(`[FileUploadService][Local] Đã tạo thư mục cục bộ: ${targetLocalFolder}`);
      }
      await fs.writeFile(localFullPath, fileBuffer);
    }

    // ── BƯỚC 1: Chọn phương thức upload (CHỈ DÙNG HỆ THỐNG MỚI) ──
    let apiResponse = null;
    let storagePath = null;

    if (process.env.NEW_SYSTEM_UPLOAD_URL && relationRecord && relationRecord.object_id) {
      apiResponse = await this.uploadToNewSystem({
        fileBuffer,
        originalName,
        objectType: relationRecord.object_type,
        objectId: relationRecord.object_id
      });

      if (apiResponse && apiResponse.id) {
        uploadSuccess = true;
        storagePath = apiResponse.file_path;
        logger.info(`[FileUploadService] THANH CONG: Da upload qua API hệ thống mới. storagePath: ${storagePath}`);
      } else {
        throw new Error(`[FileUploadService] Upload qua API thất bại: ${JSON.stringify(apiResponse)}`);
      }
    } else {
      // Nếu không có cấu hình hệ thống mới, lỗi luôn vì người dùng không muốn dùng MinIO cũ
      throw new Error('[FileUploadService] NEW_SYSTEM_UPLOAD_URL chưa được cấu hình hoặc thiếu thông tin relationRecord.objectId. (Cơ chế MinIO cũ đã bị tắt)');
    }

    // ── BƯỚC 2 & 3: Insert files + file_relations ──
    let fileId = null;
    let relationId = null;

    try {
      // BƯỚC 2: Insert vào bảng files
      const enrichedFileRecord = {
        ...fileRecord,
        // Ưu tiên: tên file gốc (fileRecord.file_name) → originalName → cuối cùng mới dùng apiResponse.file_name
        // Lý do: apiResponse.file_name thường trả về UUID/ID thay vì tên file thật
        file_name: fileRecord.file_name || originalName || apiResponse?.file_name,
        mime_type: fileRecord.mime_type || mime || null,
        file_size: fileRecord.file_size ?? fileSize,
        storage_path: storagePath,
        storage_type: apiResponse?.storage_type || 'minio',
        id_bak: apiResponse?.id ? String(apiResponse.id) : (fileRecord.id_bak || null), // Lưu ID từ hệ thống mới
      };

      logger.info(
        `[FileUploadService][DB] Bắt đầu ghi bảng files` +
        ` | storagePath=${storagePath}` +
        ` | storageType=${enrichedFileRecord.storage_type}` +
        ` | id_bak=${enrichedFileRecord.id_bak}`
      );

      const fileResult = await this.fileModel.insert(enrichedFileRecord, transaction);
      fileId = fileResult.newId;

      // BƯỚC 3: Insert vào bảng file_relations
      if (relationRecord && typeof relationRecord === 'object') {
        const enrichedRelationRecord = {
          ...relationRecord,
          file_id: fileId,
        };

        const relationResult = await this.fileRelationsModel.insert(enrichedRelationRecord, transaction);
        relationId = relationResult.newId;
      }

    } catch (dbError) {
      logger.error(`[FileUploadService] Lỗi ghi DB: ${dbError.message}.`);

      // Rollback MinIO if we uploaded it ourselves
      if (!apiResponse && storagePath) { // Only rollback if it was MinIO and we have a storagePath
        try {
          logger.info(`[FileUploadService][MinIO] Đang rollback: xóa object trên MinIO | bucket=${targetBucket} | object=${objectName}`);
          await minioClient.removeObject(targetBucket, objectName);
          logger.info(`[FileUploadService][MinIO] Rollback OK: đã xóa object trên MinIO | bucket=${targetBucket} | object=${objectName}`);
        } catch (rollbackErr) {
          logger.error(
            `[FileUploadService] ⚠ ROLLBACK MINIO THẤT BẠI — file rác tồn tại trên MinIO!` +
            ` bucket=${targetBucket}, object=${objectName}. Lỗi rollback: ${rollbackErr.message}`
          );
        }
      }

      // rollback local copy too (if written)
      if (localFullPath) {
        try {
          logger.info(`[FileUploadService][Local] Đang rollback: xóa file cục bộ ${localFullPath}`);
          await fs.unlink(localFullPath);
          logger.info(`[FileUploadService][Local] Rollback OK: đã xóa file cục bộ ${localFullPath}`);
        } catch (rollbackErr) {
          logger.error(
            `[FileUploadService] ⚠ ROLLBACK FILE CỤC BỘ THẤT BẠI — file rác tồn tại! Path: ${localFullPath}. Lỗi rollback: ${rollbackErr.message}`
          );
        }
      }

      // Ném lại lỗi gốc để caller xử lý (rollback transaction nếu có)
      throw dbError;
    }

    logger.info(
      `[FileUploadService] Hoàn tất đồng bộ file` +
      ` | fileId=${fileId}` +
      (relationId ? ` | relationId=${relationId}` : '') +
      ` | storagePath=${storagePath}` +
      (localFullPath ? ` | localPath=${localFullPath}` : '')
    );

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
        `[FileUploadService] Lỗi ghi DB, đang rollback file cục bộ` +
        ` | path=${fullPath}` +
        ` | lỗi=${dbError.message}`
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
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 80);
    const uniqueName = `${uuidv4()}-${baseName}${ext}`;
    return folder ? `${folder.replace(/\/$/, '')}/${uniqueName}` : uniqueName;
  }

  /** Tự tạo bucket nếu chưa tồn tại */
  async _ensureBucket(bucket) {
    const start = Date.now();
    try {
      const exists = await minioClient.bucketExists(bucket);
      if (!exists) {
        logger.info(`[FileUploadService][MinIO] Chưa có bucket, đang tạo mới | bucket=${bucket}`);
        await minioClient.makeBucket(bucket);
        logger.info(`[FileUploadService][MinIO] Tạo bucket thành công | bucket=${bucket} | thời gian=${Date.now() - start}ms`);
        return;
      }
      logger.info(`[FileUploadService][MinIO] Bucket đã tồn tại | bucket=${bucket} | thời gian=${Date.now() - start}ms`);
    } catch (err) {
      logger.error(
        `[FileUploadService][MinIO] Lỗi khi kiểm tra/tạo bucket` +
        ` | bucket=${bucket}` +
        ` | host=${MINIO_CONFIG.endPoint}` +
        ` | port=${MINIO_CONFIG.port}` +
        ` | SSL=${MINIO_CONFIG.useSSL}` +
        ` | lỗi=${err?.message}`,
        { detail: formatAggregateError(err), stack: err?.stack }
      );
      throw err;
    }
  }

  /** Upload Buffer lên MinIO, trả về storage_path dạng "bucket/objectName" */
  async _upload(bucket, objectName, buffer, mimeType) {
    const meta = mimeType ? { 'Content-Type': mimeType } : {};
    const start = Date.now();
    try {
      await minioClient.putObject(bucket, objectName, buffer, buffer.length, meta);
    } catch (err) {
      logger.error(
        `[FileUploadService][MinIO] Lỗi khi upload object (putObject)` +
        ` | bucket=${bucket}` +
        ` | object=${objectName}` +
        ` | host=${MINIO_CONFIG.endPoint}` +
        ` | port=${MINIO_CONFIG.port}` +
        ` | SSL=${MINIO_CONFIG.useSSL}` +
        ` | dung lượng=${buffer.length} bytes` +
        (mimeType ? ` | mime=${mimeType}` : '') +
        ` | lỗi=${err?.message}`,
        { detail: formatAggregateError(err), stack: err?.stack }
      );
      throw err;
    }
    logger.info(
      `[FileUploadService][MinIO] Upload object thành công (putObject)` +
      ` | bucket=${bucket}` +
      ` | object=${objectName}` +
      ` | dung lượng=${buffer.length} bytes` +
      ` | thời gian=${Date.now() - start}ms` +
      (mimeType ? ` | mime=${mimeType}` : '')
    );
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
      bucket: storagePath.substring(0, idx),
      objectName: storagePath.substring(idx + 1),
    };
  }
}

module.exports = FileUploadService;

