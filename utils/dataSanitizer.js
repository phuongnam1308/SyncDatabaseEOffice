/**
 * Data Sanitizer Utility
 * Converts string values like 'NULL' to actual null values
 * Handles type conversions for database insertion
 */

const logger = require('./logger');

class DataSanitizer {
  /**
   * List of fields that should be converted to integers/bigints
   * These match the int and bigint columns in outgoing_documents2 table
   */
  static INTEGER_FIELDS = [
    'CodeItemId', 'SoBan', 'SoTrang', 'ModuleId', 'ItemId', 
    'MigrateFlg', 'MigrateErrFlg', 'DGPId', 'to_book',
    'book_document_id', 'status', 'type_doc', 'DocSignType'
  ];

  /**
   * List of fields that should be converted to bit (0 or 1)
   * These match the bit columns in outgoing_documents2 table
   */
  static BIT_FIELDS = [
    'ChenSo', 'IsLibrary', 'PhanCong', 'IsKyQuyChe', 'IsConverting'
  ];

  /**
   * Sanitize a single value
   * @param {*} value - The value to sanitize
   * @param {string} fieldName - The field name for context
   * @returns {*} - The sanitized value
   */
  static sanitizeValue(value, fieldName = '') {
    // CRITICAL: Convert string 'NULL' variants to actual null FIRST, before any other conversions
    // This must happen before trying to convert to integer, otherwise we get conversion errors
    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      if (trimmedValue === 'NULL' || trimmedValue === 'null' || trimmedValue === '') {
        return null;
      }
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return null;
    }

    // Convert string numbers to actual numbers for integer/bigint fields
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      // Check against explicit list of integer fields
      if (this.INTEGER_FIELDS.includes(fieldName)) {
        try {
          return parseInt(value.trim(), 10);
        } catch (e) {
          logger.warn(`Failed to convert ${fieldName}="${value}" to int: ${e.message}`);
          return value;
        }
      }

      // Also check field name patterns
      const numericFieldPatterns = ['Id', 'id', 'count', 'Count', 'number', 'Number', 'qty', 'Qty', 'flag', 'Flag'];
      if (numericFieldPatterns.some(p => fieldName.includes(p))) {
        try {
          return parseInt(value.trim(), 10);
        } catch (e) {
          logger.warn(`Failed to convert ${fieldName}="${value}" to int: ${e.message}`);
          return value;
        }
      }
    }

    // Convert string booleans to actual bit (0/1 or boolean)
    if (typeof value === 'string' && this.BIT_FIELDS.includes(fieldName)) {
      const trimmedValue = value.trim().toLowerCase();
      if (trimmedValue === 'true' || trimmedValue === '1') return 1;
      if (trimmedValue === 'false' || trimmedValue === '0' || trimmedValue === '') return 0;
      if (trimmedValue === 'null' || trimmedValue === 'NULL') return null;
    }

    return value;
  }

  /**
   * Sanitize an entire object (record from database)
   * @param {Object} data - The data object to sanitize
   * @param {Object} options - Options for sanitization
   * @returns {Object} - The sanitized data
   */
  static sanitizeRecord(data, options = {}) {
    const {
      excludeFields = [],
      truncateMap = {},
      maxTruncateLength = 100
    } = options;

    const sanitized = {};

    for (const [field, value] of Object.entries(data)) {
      // Skip excluded fields
      if (excludeFields.includes(field)) {
        sanitized[field] = value;
        continue;
      }

      // Sanitize the value
      let sanitizedValue = this.sanitizeValue(value, field);

      // Apply truncation for known columns
      if (typeof sanitizedValue === 'string' && truncateMap[field]) {
        const max = truncateMap[field];
        if (sanitizedValue.length > max) {
          sanitizedValue = sanitizedValue.substring(0, max);
        }
        sanitizedValue = sanitizedValue.trim();
      } else if (typeof sanitizedValue === 'string' && sanitizedValue.length > maxTruncateLength) {
        // Safety catch-all: truncate any unlisted string field > maxTruncateLength chars
        sanitizedValue = sanitizedValue.substring(0, maxTruncateLength).trim();
      }

      sanitized[field] = sanitizedValue;
    }

    return sanitized;
  }

  /**
   * Format value for logging preview
   * @param {*} value - The value to format
   * @returns {string} - The formatted preview
   */
  static formatPreview(value, maxLength = 200) {
    try {
      if (typeof value === 'string') {
        return value.length > maxLength ? value.slice(0, maxLength) + '... (truncated)' : value;
      } else if (value instanceof Date) {
        return value.toISOString();
      } else if (value === null || value === undefined) {
        return String(value);
      } else {
        return String(value);
      }
    } catch (e) {
      return '[unable to preview]';
    }
  }

  /**
   * Get type string for logging
   * @param {*} value - The value
   * @returns {string} - The type string
   */
  static getTypeString(value) {
    if (value === null || value === undefined) {
      return String(value);
    }
    return typeof value;
  }
}

module.exports = DataSanitizer;
