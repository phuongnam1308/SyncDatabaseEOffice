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
   * Map SharePoint Status to System Process Status
   */
  mapProcessStatus(statusText) {
    const status = String(statusText || '').toLowerCase();
    if (status.includes('hoàn thành') || status.includes('completed')) return '4';
    if (status.includes('đang thực hiện') || status.includes('in progress')) return '2';
    if (status.includes('chưa bắt đầu') || status.includes('not started')) return '1';
    if (status.includes('tạm dừng') || status.includes('waiting')) return '3';
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
   * Map SharePoint User ID to System User GUID
   * This is a placeholder logic - usually involves a lookup table or naming convention
   */
  /**
   * Map SharePoint User Name to System User GUID
   */
  async mapUser(fullname, transaction) {
    if (!fullname) return null;
    try {
      let cleanName = String(fullname).trim();
      // Bỏ phần phòng ban (ví dụ "Nguyễn Văn Hải - HT" -> "Nguyễn Văn Hải")
      cleanName = cleanName.split(/\s*[-–—(]\s*/)[0].trim();
      // Loại bỏ các tiền tố danh xưng (Ông, Bà, Anh, Chị,...)
      cleanName = cleanName.replace(/^(Đ\/c\.|Đ\/c|Ông|Bà|Anh|Chị|Đồng chí|Đại tá|Thượng tá)\s+/i, "").trim();

      const result = await this.queryNewDbTx(
        `SELECT TOP 1 id FROM users WHERE name = @fullname OR fullname = @fullname OR username = @fullname`,
        { fullname: cleanName },
        transaction
      );
      return result?.[0]?.id || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Strip HTML tags and decode HTML entities from text
   */
  stripHtml(html) {
    if (!html) return null;
    
    // Replace line-break tags with newlines to preserve formatting
    let text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n');
      
    // Remove all other HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Replace decimal HTML entities like &#160;
    text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    
    // Replace hex HTML entities like &#x20;
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    
    // Replace named entities
    const entities = {
      'nbsp': ' ',
      'lt': '<',
      'gt': '>',
      'amp': '&',
      'quot': '"',
      'apos': "'"
    };
    text = text.replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] || match);
    
    // Trim each line, remove empty lines, and join with newlines
    text = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
      
    return text.trim() || null;
  }

  async mapRecord(raw) {
    const id = String(raw.ID || raw.Id);
    
    return {
      id_task_bak: `${id}_general`,
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
      
      // User Names for mapping
      author_name: raw.AuthorName,
      editor_name: raw.EditorName,
      assigned_to_names: raw.AssignedToNames, // JSON array of Names
      followers_names: raw.TheoDoiCongViecNames // JSON array of Names
    };
  }
}

module.exports = TaskMapper;
