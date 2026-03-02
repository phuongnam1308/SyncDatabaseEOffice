const parseDateString = (val) => {
    if (!val || typeof val !== 'string') return null;
    val = val.replace(/NULL/ig, '').replace(/\\r/g, '').replace(/\\n/g, '').replace(/,/g, '').trim();
    if (!val || val.length < 4) return null; // Quá ngắn, không phải là dạng cấu trúc date
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;

    // Validate bounds for SQL Server (prevent out of range or junk dates like year 6065)
    const year = d.getFullYear();
    if (year < 1970 || year > 2099) return null;

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
            'Author': 'authorId'
        },
        defaultValues: {
            'status': 1, // Default status
            'content': (record) => {
                let raw = (record.Subject || '').trim();
                if (raw === 'NULL' || !raw) return '<p></p>';
                // Nếu đã có tag <p> ở đầu thì không bọc thêm (tránh <p><p>...</p></p>)
                if (raw.toLowerCase().startsWith('<p>')) return raw;
                return `<p>${raw}</p>`;
            },
            'summary': (record) => { const raw = (record.Description || '').trim(); return raw === 'NULL' || !raw ? '' : raw; },
            'viewCount': (record) => parseInt(record.ViewCount || 0, 10) || 0,
            // Giả lập authorName tạm thời, hệ thống có thể cần map hoặc query từ user
            'authorName': 'Unknown',
            'publishedAt': (record) => parseDateString(record.PostTime) || parseDateString(record.Created) || new Date(),
            'createdAt': (record) => parseDateString(record.Created) || new Date(),
            'updatedAt': (record) => parseDateString(record.Modified) || new Date()
        }
    }
};

module.exports = { tableMappings };
