const BaseModel = require('./BaseModel');

class FileRelationsMappingModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'file_relations2';
  }

  async updateMappedObjectType() {
    const sql = `
      UPDATE ${this.schema}.${this.table}
      SET object_type =
        CASE
          WHEN type_doc = 'docProposal' THEN N'Văn bản trình'
          WHEN type_doc = 'docDraft' THEN N'Văn bản dự thảo'
          WHEN type_doc = 'finaldocuments' THEN N'Văn bản ban hành'
          WHEN type_doc = 'incommingdocument' THEN N'Văn bản đến'
          WHEN type_doc = 'docAttachments' THEN N'File đính kèm'
          WHEN type_doc = 'file_revision' THEN N'Phiên bản file'
          WHEN type_doc = 'archivestorage' THEN N'Kho lưu trữ'
          WHEN type_doc = 'document-library' THEN N'Thư viện tài liệu'
          WHEN type_doc = 'profile-storage' THEN N'Hồ sơ lưu trữ'
          WHEN type_doc = 'tasks' THEN N'Danh sách task'
          WHEN type_doc = 'taskdocuments' THEN N'Task gắn văn bản'
          WHEN type_doc = 'delegation' THEN N'Phân công'
          WHEN type_doc = 'MeetingTask' THEN N'Task cuộc họp'
          WHEN type_doc = 'meeting_room' THEN N'Phòng họp'
          WHEN type_doc = 'RecordMeeting' THEN N'Biên bản họp'
          WHEN type_doc = 'audioMeeting' THEN N'Ghi âm cuộc họp'
          WHEN type_doc = 'video_file' THEN N'File video'
          WHEN type_doc = 'video_thumbnail' THEN N'Thumbnail video'
          WHEN type_doc = 'featured-video' THEN N'Video nổi bật'
          WHEN type_doc = 'album' THEN N'Album ảnh'
          WHEN type_doc = 'album_images' THEN N'Ảnh album'
          WHEN type_doc = 'banner' THEN N'Banner'
          WHEN type_doc = 'news' THEN N'Tin tức'
          WHEN type_doc = 'testkyso' THEN N'Ký số'
          WHEN type_doc = 'default' THEN N'Cấu hình mặc định'
          ELSE NULL
        END
      WHERE object_type IS NULL
    `;
    const result = await this.newPool.request().query(sql);
    return result.rowsAffected[0];
  }

  async updateRemainObjectType() {
    const sql = `
      UPDATE ${this.schema}.${this.table}
      SET object_type = type_doc
      WHERE object_type IS NULL
    `;
    const result = await this.newPool.request().query(sql);
    return result.rowsAffected[0];
  }

  async countAll() {
    const sql = `SELECT COUNT(*) AS total FROM ${this.schema}.${this.table}`;
    const rs = await this.queryNewDb(sql);
    return rs[0].total;
  }
}

module.exports = FileRelationsMappingModel;
