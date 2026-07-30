const logger = require('../../../utils/logger');

class TaskMapper {
  constructor(queryNewDbTx, queryOldDb) {
    this.queryNewDbTx = queryNewDbTx;
    this.queryOldDb = queryOldDb;
  }

  /**
   * Safe date parser for SharePoint ISO strings
   */
  safeDateParse(dateValue) {
    if (!dateValue) return null;
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().replace('T', ' ').replace('Z', '');
  }

  /**
   * Helper to normalize Vietnamese accented text to plain ASCII
   */
  removeVietnameseTones(str) {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }

  /**
   * Map SharePoint Status to System Process Status
   */
  mapProcessStatus(statusText) {
    const status = this.removeVietnameseTones(String(statusText || ''));
    if (status.includes('hoan thanh') || status.includes('completed')) return '4';
    if (status.includes('dang thuc hien') || status.includes('in progress') || status.includes('dang tien hanh')) return '2';
    if (status.includes('chua bat dau') || status.includes('not started')) return '1';
    if (status.includes('tam dung') || status.includes('waiting')) return '3';
    return '1'; // Default
  }

  /**
   * Map SharePoint Priority to System Priority
   */
  mapPriority(priorityText) {
    const p = String(priorityText || '').toLowerCase();
    if (p.includes('cao') || p.includes('high')) return 'cao';
    if (p.includes('thấp') || p.includes('low')) return 'thap';
    return 'binhthuong';
  }

  /**
   * Bóc tách username từ tên tài khoản SharePoint (ví dụ: "i:0#.f|admembers|duongvk" -> "duongvk")
   */
  extractUsernameFromSpName(spName) {
    if (!spName || typeof spName !== 'string') return null;
    if (spName.includes('|')) {
      const parts = spName.split('|');
      return parts[parts.length - 1].trim().toLowerCase();
    }
    return spName.trim().toLowerCase();
  }

  /**
   * Map SharePoint User (fullname + AD Account Name) to System User GUID
   */
  async mapUser(fullname, adName, transaction) {
    if (!adName && !fullname) return null;
    try {
      // 1. Ưu tiên tìm kiếm chính xác bằng username được bóc tách từ tên tài khoản AD
      const username = this.extractUsernameFromSpName(adName);
      if (username) {
        const userRes = await this.queryNewDbTx(
          `SELECT TOP 1 id FROM users WHERE LTRIM(RTRIM(username)) = LTRIM(RTRIM(@username))`,
          { username },
          transaction
        );
        if (userRes?.[0]?.id) return userRes[0].id;
      }

      // 2. Fallback: Tìm bằng họ tên nhân viên đã chuẩn hóa
      let cleanName = String(fullname || '').trim();
      if (cleanName) {
        cleanName = cleanName.split(/\s*[-–—(]\s*/)[0].trim();
        cleanName = cleanName.replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, "").trim();

        const nameResult = await this.queryNewDbTx(
          `SELECT TOP 1 id FROM users WHERE name = @fullname OR fullname = @fullname OR username = @fullname`,
          { fullname: cleanName },
          transaction
        );
        if (nameResult?.[0]?.id) return nameResult[0].id;
      }

      return null;
    } catch (e) {
      logger.warn(`[TaskMapper] mapUser error: ${e.message}`);
      return null;
    }
  }

  /**
   * Strip HTML tags and decode HTML entities from text
   */
  stripHtml(html) {
    if (!html) return null;
    
    let text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n');
      
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    
    const entities = {
      'nbsp': ' ',
      'lt': '<',
      'gt': '>',
      'amp': '&',
      'quot': '"',
      'apos': "'"
    };
    text = text.replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] || match);
    
    text = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
      
    return text.trim() || null;
  }

  async mapRecord(raw) {
    const id = String(raw.ID || raw.Id);
    
    // Phân tách họ tên hiển thị và tên tài khoản AD từ trường ghép dạng "Tên hiển thị|Name"
    const parseSpUser = (combinedStr) => {
      if (!combinedStr) return { displayName: null, adName: null };
      const parts = combinedStr.split('|');
      const displayName = parts[0];
      const adName = parts.slice(1).join('|');
      return { displayName, adName };
    };

    const author = parseSpUser(raw.AuthorName);
    const editor = parseSpUser(raw.EditorName);

    return {
      id_task_bak: `${id}_general`, // Chứa tên site ở đầu: e.g. "cntt_12_general"
      name: raw.Title || null,
      note: this.stripHtml(raw.Body),
      start_date: this.safeDateParse(raw.StartDate),
      end_date: this.safeDateParse(raw.DueDate) || this.safeDateParse(raw.DateCompleted),
      created_at: this.safeDateParse(raw.Created),
      update_at: this.safeDateParse(raw.Modified),
      progress: Math.round((raw.PercentComplete || 0) * 100),
      process_status: this.mapProcessStatus(raw.nStatus || raw.StatusEN),
      priority: this.mapPriority(raw.Priority),
      status: 1,
      type_task: 'general', // Default for migrated tasks
      is_confidential: 0,
      
      // Thông tin người tạo / người sửa
      author_name: author.displayName,
      author_ad: author.adName,
      editor_name: editor.displayName,
      editor_ad: editor.adName,
      
      assigned_to_names: raw.AssignedToNames, // Mảng JSON chứa [{Title, Name}]
      followers_names: raw.TheoDoiCongViecNames // Mảng JSON chứa [{Title, Name}]
    };
  }
}

module.exports = TaskMapper;
