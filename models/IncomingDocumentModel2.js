const BaseModel = require('./BaseModel');

class IncomingDocumentModel2 extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'incomming_documents2';
  }

  /**
   * Lấy các bản ghi cần update
   */
  async getNeedUpdate(limit = 100) {
    const query = `
      SELECT TOP (@limit)
        document_id,
        to_book,
        to_book_code
      FROM DiOffice.dbo.incomming_documents2
      WHERE book_document_id IS NULL
        AND (to_book IS NOT NULL OR to_book_code IS NOT NULL)
      ORDER BY created_at
    `;

    const result = await this.newPool
      .request()
      .input('limit', limit)
      .query(query);

    return result.recordset;
  }

  /**
   * Chuẩn hóa chuỗi:
   * - LOWER
   * - bỏ ?, /, -, ., space
   * - không dấu
   */
  buildNormalizeSql(field) {
    return `
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        LOWER(${field}),
        '?',''
      ),'/',''),'-',''),' ',''),'.','')
    `;
  }

  /**
   * incoming.to_book -> book_documents.to_book_code
   */
  async findBookDocumentIdByIncomingToBook(toBook) {
    const query = `
      SELECT TOP 1 book_document_id
      FROM DiOffice.dbo.book_documents
      WHERE type_document = 'IncommingDocument'
        AND ${this.buildNormalizeSql('to_book_code')}
            COLLATE Vietnamese_CI_AI
            LIKE '%' + ${this.buildNormalizeSql('@text')} + '%'
      ORDER BY LEN(to_book_code) DESC, created_at DESC
    `;

    const result = await this.newPool
      .request()
      .input('text', toBook)
      .query(query);

    return result.recordset.length
      ? result.recordset[0].book_document_id
      : null;
  }

  /**
   * incoming.to_book_code -> book_documents.to_book_code
   */
  async findBookDocumentIdByIncomingToBookCode(toBookCode) {
    const query = `
      SELECT TOP 1 book_document_id
      FROM DiOffice.dbo.book_documents
      WHERE type_document = 'IncommingDocument'
        AND ${this.buildNormalizeSql('to_book_code')}
            COLLATE Vietnamese_CI_AI
            LIKE '%' + ${this.buildNormalizeSql('@text')} + '%'
      ORDER BY LEN(to_book_code) DESC, created_at DESC
    `;

    const result = await this.newPool
      .request()
      .input('text', toBookCode)
      .query(query);

    return result.recordset.length
      ? result.recordset[0].book_document_id
      : null;
  }

  /**
   * Update book_document_id
   */
  async updateBookDocumentId(documentId, bookDocumentId) {
    const query = `
      UPDATE DiOffice.dbo.incomming_documents2
      SET book_document_id = @bookDocumentId,
          updated_at = GETDATE()
      WHERE document_id = @documentId
    `;

    await this.newPool
      .request()
      .input('bookDocumentId', bookDocumentId)
      .input('documentId', documentId)
      .query(query);
  }
}

module.exports = IncomingDocumentModel2;
