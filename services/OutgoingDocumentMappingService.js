const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const OutgoingDocumentSyncModel = require('../models/OutgoingDocumentSyncModel');

class OutgoingDocumentMappingService {
  constructor() {
    this.model = new OutgoingDocumentSyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  /**
   * Chuẩn hóa text cho S20/S21 (urgency_level, private_level)
   * Quy tắc: lowercase, bỏ dấu, bỏ nguyên âm, dấu cách thành dấu -
   * VD: "Thường" → "thng", "Thượng khẩn" → "thng-khn", "Mật" → "mt"
   * @param {string} text - Text cần chuẩn hóa
   * @returns {string} - Text đã chuẩn hóa
   */
  _normalizeTextForS20S21(text) {
    if (!text || typeof text !== 'string') return '';

    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
    
    const words = normalized.split(/\s+/);
    const processed = words.map(word => {
      if (!word) return '';
      const noVowel = word.replace(/[aeiouy]/g, '');
      if (noVowel.length < 2) {
        const firstChar = word[0];
        const firstVowel = word.match(/[aeiouy]/)?.[0] || '';
        return (firstChar + firstVowel).substring(0, 2);
      }
      return noVowel;
    });

    return processed.join('-');
  }

  /**
   * Chuẩn hóa text cho S19 (document_type)
   * Quy tắc: Lấy phần sau dấu #, lowercase, bỏ dấu cách
   * VD: "12;#Chỉ lệnh" → "chilenh"
   * @param {string} text - Text cần chuẩn hóa
   * @returns {string} - Text đã chuẩn hóa
   */
    _normalizeTextForS19(text) {
        if (!text || typeof text !== 'string') return '';

        console.log('\n[S19] Input:', text);

        // Tìm vị trí dấu #
        const hashIndex = text.indexOf('#');
        let extracted = '';
        
        if (hashIndex !== -1 && hashIndex < text.length - 1) {
            // Lấy phần sau dấu # (bỏ qua phần trước)
            extracted = text.substring(hashIndex + 1).trim();
            console.log('[S19] Extracted after #:', extracted);
        } else {
            // Nếu không có dấu #, lấy toàn bộ
            extracted = text.trim();
            console.log('[S19] No # found, use full text:', extracted);
        }

        // Lowercase và bỏ dấu
        const normalized = extracted
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/\s+/g, ''); // Bỏ tất cả khoảng trắng

        console.log('[S19] Output:', normalized);
        return normalized;
    }

  /**
   * Lấy source_id theo code
   * @param {string} code - Source code (ví dụ: S19, S20, S21)
   * @returns {string|null} - Source ID hoặc null
   */
  async _getSourceId(code) {
    try {
      const query = `
        SELECT TOP 1 id
        FROM camunda.dbo.crm_sources
        WHERE code = @code
      `;
      const result = await this.model.queryNewDb(query, { code });
      return result.length > 0 ? result[0].id : null;
    } catch (error) {
      logger.error(`[OutgoingDocumentMappingService._getSourceId] Lỗi lấy source_id cho code ${code}:`, error);
      return null;
    }
  }

  /**
   * Kiểm tra và insert source data nếu chưa tồn tại
   * @param {string} sourceId - Source ID
   * @param {string} value - Giá trị đã chuẩn hóa
   * @param {string} title - Tiêu đề (giá trị gốc)
   * @returns {string|null} - Giá trị đã insert hoặc null
   */
  async _checkOrInsertSourceData(sourceId, value, title) {
    try {
      if (!sourceId || !value) return null;

      // Check xem đã tồn tại chưa
      const checkQuery = `
        SELECT TOP 1 id, value
        FROM camunda.dbo.crm_source_data
        WHERE source_id = @sourceId AND value = @value
      `;
      const existing = await this.model.queryNewDb(checkQuery, { sourceId, value });
      
      if (existing.length > 0) {
        logger.info(`[OutgoingDocumentMappingService._checkOrInsertSourceData] Value "${value}" đã tồn tại cho source_id ${sourceId}`);
        return existing[0].value;
      }

      // Insert mới
      const id = uuidv4();
      const insertQuery = `
        INSERT INTO camunda.dbo.crm_source_data (id, source_id, title, value, createdAt, updatedAt)
        VALUES (@id, @sourceId, @title, @value, GETDATE(), GETDATE())
      `;
      
      const insertParams = {
        id,
        sourceId,
        title: title || value,
        value
      };

      await this.model.queryNewDb(insertQuery, insertParams);
      logger.info(`[OutgoingDocumentMappingService._checkOrInsertSourceData] Inserted new source_data: value="${value}", title="${title}" for source_id=${sourceId}`);
      return value;
    } catch (error) {
      logger.error(`[OutgoingDocumentMappingService._checkOrInsertSourceData] Lỗi check/insert source_data:`, error);
      return null;
    }
  }

  /**
   * Xử lý LoaiBanHanh/document_type (S19 - Document Type)
   * Chuẩn hóa: Lấy sau #, lowercase, bỏ space
   * @param {string} value - Giá trị LoaiBanHanh
   * @returns {string|null} - Document Type sau xử lý
   */
  async processDocumentType(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      // Chuẩn hóa theo quy tắc S19
      const normalized = this._normalizeTextForS19(value);
      
      if (!normalized) return null;

      // Lấy source_id cho S19 (Document Type)
      const sourceId = await this._getSourceId('S19');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentMappingService.processDocumentType] Không tìm thấy source_id cho code S19');
        return normalized;
      }

      // Lấy title từ giá trị sau dấu #
      const hashIndex = value.indexOf('#');
      const title = hashIndex !== -1 && hashIndex < value.length - 1 
        ? value.substring(hashIndex + 1).trim() 
        : value.trim();

      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentMappingService.processDocumentType] Lỗi xử lý document type:', error);
      return null;
    }
  }

  /**
   * Xử lý DoKhan/urgency_level (S20 - Urgency Level)
   * Chuẩn hóa: lowercase, bỏ dấu, bỏ nguyên âm, space thành -
   * @param {string} value - Giá trị DoKhan
   * @returns {string|null} - Urgency Level sau xử lý
   */
  async processUrgencyLevel(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      // Chuẩn hóa theo quy tắc S20
      const normalized = this._normalizeTextForS20S21(value);
      
      if (!normalized) return null;

      // Lấy source_id cho S20 (Urgency Level)
      const sourceId = await this._getSourceId('S20');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentMappingService.processUrgencyLevel] Không tìm thấy source_id cho code S20');
        return normalized;
      }

      // Title: giữ nguyên giá trị gốc đã trim
      const title = value.trim();
      
      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentMappingService.processUrgencyLevel] Lỗi xử lý urgency level:', error);
      return null;
    }
  }

  /**
   * Xử lý DoMat/private_level (S21 - Private Level)
   * Chuẩn hóa: lowercase, bỏ dấu, bỏ nguyên âm, space thành -
   * @param {string} value - Giá trị DoMat
   * @returns {string|null} - Private Level sau xử lý
   */
  async processPrivateLevel(value) {
    try {
      if (typeof value !== 'string' || value.trim() === '') {
        return null;
      }

      // Chuẩn hóa theo quy tắc S21
      const normalized = this._normalizeTextForS20S21(value);
      
      if (!normalized) return null;

      // Lấy source_id cho S21 (Private Level)
      const sourceId = await this._getSourceId('S21');
      if (!sourceId) {
        logger.warn('[OutgoingDocumentMappingService.processPrivateLevel] Không tìm thấy source_id cho code S21');
        return normalized;
      }

      // Title: giữ nguyên giá trị gốc đã trim
      const title = value.trim();
      
      // Check/insert vào crm_source_data
      const result = await this._checkOrInsertSourceData(sourceId, normalized, title);
      return result;
    } catch (error) {
      logger.error('[OutgoingDocumentMappingService.processPrivateLevel] Lỗi xử lý private level:', error);
      return null;
    }
  }

  /**
   * Chuẩn hóa sender_unit từ array thành string
   * @param {any} value - Giá trị sender_unit
   * @returns {string|null} - Sender unit đã chuẩn hóa
   */
  processSenderUnit(value) {
    try {
      if (Array.isArray(value) && value.length > 0) {
        // Lấy phần tử đầu tiên nếu là array
        return value[0] ? String(value[0]) : null;
      } else if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
      return null;
    } catch (error) {
      logger.error('[OutgoingDocumentMappingService.processSenderUnit] Lỗi xử lý sender unit:', error);
      return null;
    }
  }

  /**
   * Xử lý bpmn_version
   * @param {string} currentValue - Giá trị hiện tại
   * @returns {string} - BPMN version
   */
  processBpmnVersion(currentValue) {
    if (!currentValue || currentValue.trim() === '') {
      return 'VAN_BAN_DI';
    }
    return currentValue;
  }

  /**
   * Process một record đầy đủ
   * @param {object} record - Record cần xử lý
   * @returns {object} - Data đã xử lý để update
   */
  async processRecord(record) {
    const updates = {};

    try {
      // Process document_type (S19)
      if (record.document_type) {
        const processed = await this.processDocumentType(record.document_type);
        if (processed !== null) {
          updates.document_type = processed;
        }
      }

      // Process urgency_level (S20)
      if (record.urgency_level) {
        const processed = await this.processUrgencyLevel(record.urgency_level);
        if (processed !== null) {
          updates.urgency_level = processed;
        }
      }

      // Process private_level (S21)
      if (record.private_level) {
        const processed = await this.processPrivateLevel(record.private_level);
        if (processed !== null) {
          updates.private_level = processed;
        }
      }

      // Process sender_unit
      if (record.sender_unit) {
        const processed = this.processSenderUnit(record.sender_unit);
        if (processed !== null) {
          updates.sender_unit = processed;
        }
      }

      // Process bpmn_version
      const bpmnVersion = this.processBpmnVersion(record.bpmn_version);
      if (bpmnVersion) {
        updates.bpmn_version = bpmnVersion;
      }

      return updates;
    } catch (error) {
      logger.error('[OutgoingDocumentMappingService.processRecord] Lỗi xử lý record:', error);
      return updates;
    }
  }
}

module.exports = OutgoingDocumentMappingService;