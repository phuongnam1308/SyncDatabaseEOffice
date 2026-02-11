const sql = require('mssql');
const normalize = require('../utils/normalize');

class FileRelationTypeResolverModel {
  constructor(pool) {
    this.pool = pool;

    /**
     * RULES: suy luận object_type từ type_doc
     * KHÔNG map cứng – chỉ tìm tương đồng
     */
    this.RULES = [

      {
        object_type: 'docProposal',
        keywords: ['73;#Đề xuất', '33;#Tờ trình', '23;#Kiến nghị','39;#Chỉ lệnh','52;#Bổ sung','59;#Ý định','6;#Chỉ thị','53;#Đề nghị','57;#Đơn đề nghị']
      },
      {
        object_type: 'docDraft',
        keywords: ['VB đi','du VB đi', 'soan 58;#Đơn','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=24889&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fK%e1%ba%bf+ho%e1%ba%a1ch+s%e1%bb%ada+ch%e1%bb%afa+c%e1%bb%a5m+%c4%91%e1%bb%99ng+c%c6%a1%2c+cabin%2c+chassis+xe+%c4%91%e1%ba%a7u+k%c3%a9o+n%e1%bb%99i+b%e1%bb%99++Terberg+NB127%2c+NB132%2c+NB133','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=44927&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fQuy%e1%ba%bft+%c4%91%e1%bb%8bnh+Thanh+l%c3%bd+d%e1%bb%a5ng+c%e1%bb%a5%2c+doanh+c%e1%bb%a5+nh%c3%b3m+III+v%c3%a0+trang+b%e1%bb%8b+CT%c4%90-CTCT','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=48691&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fQuy%e1%ba%bft+%c4%91%e1%bb%8bnh+ph%c3%aa+duy%e1%bb%87t+d%e1%bb%b1+to%c3%a1n+g%c3%b3i+th%e1%ba%a7u+v%c3%a0+k%e1%ba%bf+ho%e1%ba%a1ch+l%e1%bb%b1a+ch%e1%bb%8dn+nh%c3%a0+th%e1%ba%a7u','0701/VBĐ/2018','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=12547&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fKH+t%c4%83ng+c%c6%b0%e1%bb%9dng+l%e1%bb%b1c+l%c6%b0%e1%bb%a3ng+b%e1%ba%a3o+%c4%91%e1%ba%a3m+ATGT%2c+ANTT%2c+PCCN+d%e1%bb%8bp+gi%e1%bb%97+T%e1%bb%95+H%c3%b9ng+V%c6%b0%c6%a1ng%2c+30.4%2c+01.5','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=41311&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fC%c3%b4ng+v%c4%83n+g%e1%bb%adi+c%c3%a1c+l%e1%bb%b1c+l%c6%b0%e1%bb%a3ng+C%c3%b4ng+an%2c+Bi%c3%aan+ph%c3%b2ng+v%e1%bb%81+ph%e1%bb%91i+h%e1%bb%a3p+ki%e1%bb%83m+tra+ma+t%c3%bay%2c+hung+kh%c3%ad%2c+v%e1%ba%adt+li%e1%bb%87u+n%e1%bb%95+t%e1%ba%a1i+C%c3%a1t+L%c3%a1i%2c+Ph%c3%ba+H%e1%bb%afu','/vanbantct/VanBanDi/Forms/DocumentsSet.aspx?ID=37930&List=544ac235-d82d-4503-91e7-6de488b861e4&RootFolder=%2fvanbantct%2fVanBanDi%2fH%c6%b0%e1%bb%9bng+d%e1%ba%abn+n%c3%a2ng+b%e1%ba%adc%2c+n%c3%a2ng+lo%e1%ba%a1i%2c+ng%e1%ba%a1ch%2c+chuy%e1%bb%83n+nh%c3%b3m+l%c6%b0%c6%a1ng+QNCN%2c+CNVCQP+v%c3%a0+tuy%e1%bb%83n+ch%e1%bb%8dn+QNCN+t%e1%bb%ab+CNVCQP']
      },
      {
        object_type: 'docAttachments',
        keywords: ['39;#Hướng dẫn', '43;#Qui chế', '44;#Qui chế', '57;#Nội dung','52;#Bổ sung','3;#Biên bản','17;#Giấy giới thiệu']
      },
      {
        object_type: 'incommingdocument',
        keywords: ['Văn bản đến', 'cong van den', 'thu den']
      },
      {
        object_type: 'document-library',
        keywords: ['thu vien', 'tai lieu', 'van kien']
      },
    {
        object_type: 'finaldocuments',
        keywords: [
          '56;#Tổng hợp', '1;#Báo cáo', '3;#Biên bản', '39;#Hướng dẫn',
          '43;#Qui chế', '44;#Qui chế', '62;#Trích Nghị quyết', '25;#Nghị định',
          '58;#Đơn', '44;#Lệnh khởi công', '13;#Giấy báo', '57;#Nội dung','15;#Giấy chứng nhận','83;#Quy tắc',
          '"107;#Giản ngữ "','11494;544ac235-d82d-4503-91e7-6de488b861e4','58;#Qui trình','43;#Kết luận',
          '43;#Thông Tư liên tịch','3036',
          '41;#Hướng dẫn','51;#Thư mời'
        ]
      },
    ];
  }

  /**
   * Suy luận object_type từ type_doc
   * Không match → return null
   */
  resolveObjectType(typeDoc) {
    if (!typeDoc) return null;

    const text = normalize(typeDoc);

    for (const rule of this.RULES) {
      for (const keyword of rule.keywords) {
        if (text.includes(keyword)) {
          return rule.object_type;
        }
      }
    }
    return null;
  }

  // ===== DB =====

  async getCandidates() {
    const rs = await this.pool.request().query(`
      SELECT id, type_doc, object_type
      FROM camunda.dbo.file_relations2
      WHERE type_doc IS NOT NULL
    `);
    return rs.recordset;
  }

  async updateObjectType(id, objectType) {
    return this.pool.request()
      .input('id', sql.BigInt, id)
      .input('object_type', sql.NVarChar, objectType)
      .query(`
        UPDATE camunda.dbo.file_relations2
        SET object_type = @object_type
        WHERE id = @id
      `);
  }
}

module.exports = FileRelationTypeResolverModel;
