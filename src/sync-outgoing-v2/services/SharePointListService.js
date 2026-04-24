const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.IGNORE_SSL !== 'true',
  keepAlive: true,
  keepAliveMsecs: 10000,
});

let _cachedCookie = null;

/**
 * Get cookie from file
 */
function getCookie() {
  const cookieFilePath = process.env.COOKIE_FILE_PATH || path.join(process.cwd(), 'auth', 'cookie.txt');
  if (!fs.existsSync(cookieFilePath)) return null;
  try {
    const content = fs.readFileSync(cookieFilePath, 'utf8').trim();
    if (_cachedCookie !== content) {
      _cachedCookie = content;
      logger.info(`[SharePointList] Loaded cookie from file. Length: ${content.length}`);
    }
    return content;
  } catch (err) {
    logger.error(`[SharePointList] Failed to read cookie file: ${err.message}`);
    return null;
  }
}

/**
 * Build SharePoint REST API URL
 */
function buildApiUrl(siteUrl, endpoint) {
  const base = siteUrl.replace(/\/$/, '');
  const apiEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}/_api${apiEndpoint}`;
}

/**
 * Get default headers with cookie auth
 */
function getHeaders(additionalHeaders = {}) {
  return {
    'Accept': 'application/json; odata=verbose',
    'Content-Type': 'application/json; odata=verbose',
    'Cookie': getCookie() || '',
    ...additionalHeaders
  };
}

/**
 * Make SharePoint REST API request with retry mechanism
 */
async function request(method, url, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 5000; // 5 seconds default
  const retryCount = options.retryCount || 0;

  // HTTP status codes that should trigger retry
  const RETRYABLE_STATUS = [401, 403, 502, 503, 504];
  // Error codes that should trigger retry
  const RETRYABLE_ERRORS = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'];

  try {
    const response = await axios({
      method,
      url,
      headers: getHeaders(options.headers || {}),
      httpsAgent,
      timeout: options.timeout || 120000,
      params: options.params,
      validateStatus: () => true
    });

    // Auth errors - clear cookie cache and retry
    if (response.status === 401 || response.status === 403) {
      if (retryCount < maxRetries) {
        logger.warn(`[SharePointList] Auth error (${response.status}). Clearing cache and retrying (${retryCount + 1}/${maxRetries})...`);
        _cachedCookie = null;
        await sleep(retryDelay);
        return request(method, url, { ...options, retryCount: retryCount + 1 });
      }
      throw new Error(`SharePoint API auth failed: HTTP ${response.status}`);
    }

    // Retryable HTTP errors
    if (RETRYABLE_STATUS.includes(response.status)) {
      if (retryCount < maxRetries) {
        logger.warn(`[SharePointList] Retryable HTTP error (${response.status}). Retrying (${retryCount + 1}/${maxRetries}) in ${retryDelay}ms...`);
        await sleep(retryDelay);
        return request(method, url, { ...options, retryCount: retryCount + 1 });
      }
      throw new Error(`SharePoint API error after ${maxRetries} retries: HTTP ${response.status}`);
    }

    if (response.status === 404) {
      throw new Error(`SharePoint resource not found: ${url}`);
    }

    if (response.status !== 200 && response.status !== 201) {
      let errorDetail = `HTTP ${response.status}`;
      if (response.status === 400 && response.data) {
        errorDetail += ` - ${JSON.stringify(response.data).substring(0, 500)}`;
      }
      throw new Error(`SharePoint API error: ${errorDetail}`);
    }

    return response.data;
  } catch (error) {
    // Retryable connection errors
    if (RETRYABLE_ERRORS.includes(error.code)) {
      if (retryCount < maxRetries) {
        logger.warn(`[SharePointList] Connection error (${error.code}). Retrying (${retryCount + 1}/${maxRetries}) in ${retryDelay}ms...`);
        await sleep(retryDelay);
        return request(method, url, { ...options, retryCount: retryCount + 1 });
      }
      throw new Error(`SharePoint API connection failed after ${maxRetries} retries: ${error.code}`);
    }

    logger.error(`[SharePointList] Request failed: ${error.message}`);
    if (error.response?.data) {
      logger.error(`[SharePointList] Response data: ${JSON.stringify(error.response.data).substring(0, 1000)}`);
    }
    throw error;
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * SharePoint List Service
 * Provides methods to interact with SharePoint Lists via REST API
 */
class SharePointListService {
  constructor() {
    // Hardcoded encoded string to avoid encoding issues
    // 'Văn bản đi' encoded = 'V%C4%83n%20b%E1%BA%A3n%20%C4%91i'
    const encodedDefault = 'V%C4%83n%20b%E1%BA%A3n%20%C4%91i';
    this.listName = process.env.UNIT_DRAFT_LIST_NAME || encodedDefault;
  }

  /**
   * Get list items with pagination
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name (optional, uses default)
   * @param {object} queryParams - Query parameters
   * @param {string} queryParams.$select - Columns to select
   * @param {string} queryParams.$filter - OData filter
   * @param {string} queryParams.$orderby - Sort field
   * @param {number} queryParams.$top - Page size (default 1000)
   * @param {number} queryParams.$skip - Skip count
   * @returns {Promise<object>} Items response with d.results
   */
  async getListItems(siteUrl, listName = this.listName, queryParams = {}) {
    const {
      $select = '*',
      $filter = '',
      $expand = '',
      $orderby = 'Modified desc',
      $top = 1000,
      $skip = 0
    } = queryParams;

    const params = { $select, $top, $skip, $orderby };
    if ($filter) params.$filter = $filter;
    if ($expand) params.$expand = $expand;

    // For SharePoint REST API with Unicode list names, pass title directly inside quotes
    // SharePoint handles Unicode in getbytitle() - no encoding needed in path
    const url = buildApiUrl(siteUrl, `web/lists/getbytitle('${listName}')/items`);

    logger.info(`[SharePointList] getListItems URL: ${url}`);
    logger.info(`[SharePointList] Params: ${JSON.stringify(params)}`);

    const response = await request('GET', url, { params });

    const result = {
      items: response.d?.results || [],
      nextSkip: $skip + ($top),
      hasMore: response.d?.__next || false
    };

    logger.info(`[SharePointList] Retrieved ${result.items.length} items (skip=${$skip}, top=${$top})`);

    return result;
  }

  /**
   * Get all items from a list (handles pagination automatically)
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name
   * @param {object} queryParams - Query parameters
   * @returns {Promise<array>} All items
   */
  async getAllListItems(siteUrl, listName = this.listName, queryParams = {}) {
    const items = [];
    let skip = queryParams.$skip || 0;
    const $top = queryParams.$top || 1000;
    const { $select = '*', $filter = '', $expand = '', $orderby = 'Modified desc' } = queryParams;

    while (true) {
      const result = await this.getListItems(siteUrl, listName, {
        $select,
        $filter,
        $expand,
        $orderby,
        $top,
        $skip
      });

      items.push(...result.items);

      if (!result.hasMore || result.items.length < $top) {
        break;
      }

      skip = result.nextSkip;
      logger.info(`[SharePointList] Pagination: fetched ${items.length} items total...`);
    }

    logger.info(`[SharePointList] getAllListItems complete: ${items.length} items from ${siteUrl}/${listName}`);
    return items;
  }

  /**
   * Get a single list item by ID
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name
   * @param {number} itemId - Item ID
   * @returns {Promise<object>} Item data
   */
  async getListItemById(siteUrl, listName = this.listName, itemId) {
    const url = buildApiUrl(siteUrl, `web/lists/getbytitle('${listName}')/items(${itemId})`);

    logger.debug(`[SharePointList] getListItemById URL: ${url}`);

    const response = await request('GET', url);
    return response.d;
  }

  /**
   * Get list columns/fields
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name
   * @returns {Promise<array>} List of field definitions
   */
  async getListColumns(siteUrl, listName = this.listName) {
    const url = buildApiUrl(siteUrl, `web/lists/getbytitle('${listName}')/fields`);

    logger.debug(`[SharePointList] getListColumns URL: ${url}`);

    const response = await request('GET', url);
    const fields = response.d?.results || [];

    logger.info(`[SharePointList] Retrieved ${fields.length} columns from ${listName}`);

    return fields.map(field => ({
      title: field.Title,
      internalName: field.InternalName,
      type: field.TypeAsString,
      required: field.Required,
      maxLength: field.MaxLength
    }));
  }

  /**
   * Get list item count
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name
   * @returns {Promise<number>} Item count
   */
  async getListItemCount(siteUrl, listName = this.listName) {
    const url = buildApiUrl(siteUrl, `web/lists/getbytitle('${listName}')/itemCount`);

    logger.debug(`[SharePointList] getListItemCount URL: ${url}`);

    const response = await request('GET', url);
    return response.d?.ItemCount || 0;
  }

  /**
   * Check if a site is reachable and has the specified list
   * @param {string} siteUrl - SharePoint site URL
   * @param {string} listName - List name (optional)
   * @returns {Promise<object>} { reachable: boolean, itemCount: number, error: string }
   */
  async checkSiteHealth(siteUrl, listName = this.listName) {
    try {
      const count = await this.getListItemCount(siteUrl, listName);
      return { reachable: true, itemCount: count, error: null };
    } catch (error) {
      logger.warn(`[SharePointList] Site health check failed for ${siteUrl}: ${error.message}`);
      return { reachable: false, itemCount: 0, error: error.message };
    }
  }
}

module.exports = new SharePointListService();