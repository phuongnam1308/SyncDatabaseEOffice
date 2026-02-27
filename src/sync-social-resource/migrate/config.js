const parseDateString = (val) => {
    if (!val || typeof val !== 'string') return null;
    val = val.replace(/NULL/ig, '').replace(/\\r/g, '').replace(/\\n/g, '').replace(/,/g, '').trim();
    if (!val || val.length < 4) return null; // Quá ngắn, không phải là dạng cấu trúc date
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d;
};

const tableMappings = {
    news: {
        oldTable: 'Social_otherResource',
        oldSchema: 'dbo',
        oldDatabase: process.env.OLD_DB_NAME,
        newTable: 'news',
        newSchema: 'dbo',
        newDatabase: process.env.NEW_DB_NAME,
        fieldMapping: {
            'Title': 'title',
            'ResourceUrl': 'slug',
            'Description': 'summary',
            'ResourceData': 'content',
            'Author': 'authorId'
        },
        defaultValues: {
            'status': 1, // Default status
            'viewCount': (record) => parseInt(record.ViewCount || 0, 10) || 0,
            // Giả lập authorName tạm thời, hệ thống có thể cần map hoặc query từ user
            'authorName': 'Unknown',
            // Có thể thêm một cột lưu old_id nếu table news hỗ trợ, hiện map tạm vào topic hoặc bỏ qua
            'topic': (record) => record?.ID || '',
            'publishedAt': (record) => parseDateString(record.PostTime),
            'createdAt': (record) => parseDateString(record.Created) || new Date(),
            'updatedAt': (record) => parseDateString(record.Modified) || new Date()
        }
    }
};

module.exports = { tableMappings };
