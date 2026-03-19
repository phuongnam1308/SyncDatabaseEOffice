const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../tintucraw/tintuc/Pages/10-ket-qua-noi-bat-cua-tong-cong-ty-nam-2014.aspx');
const html = fs.readFileSync(filePath, 'utf-8');

// 1. Title
const titleMatch = html.match(/<h1>(.*?)<\/h1>/);
const title = titleMatch ? titleMatch[1].replace(/&nbsp;/g, '').trim() : '';

// 2. Date
const dateMatch = html.match(/<span id='date-modified'>(.*?)<\/span>/);
const publishedAt = dateMatch ? dateMatch[1].trim() : '';

// 3. Content
const contentMatch = html.match(/<div class="content">([\s\S]*?)<\/div><!-- end content -->/);
const content = contentMatch ? contentMatch[1].trim() : '';

// 4. Author
const authorBlockMatch = html.match(/<div class="author"([^>]*)>([\s\S]*?)<\/div>\s*<\/strong>\s*<\/div>/);
let author = '';
if (authorBlockMatch) {
    const b = authorBlockMatch[2];
    const aMatch = b.match(/WebPart="true">([\s\S]*?)<\/div>/);
    author = aMatch ? aMatch[1].trim() : '';
}

if (!author) {
    // try fallback for author
    const fallbackAuthorMatch = html.match(/WebPart="true">\s*([^-]+-\s*[^<]+?)\s*<\/div>\s*<\/strong>\s*<\/div>/);
    if(fallbackAuthorMatch) author = fallbackAuthorMatch[1].trim();
}

// 5. slug (from filename)
const slug = path.basename(filePath, '.aspx');

const parsedData = {
    title: title,
    slug: slug,
    publishedAt: publishedAt,
    authorName: author, // Sẽ map sang authorId dựa vào user table
    contentPreview: content.substring(0, 150) + '...', // In 150 ký tự đầu của content để check
    contentImages: [] 
};

// Check for images in content
const imgRegex = /<img[^>]+src="([^">]+)"/g;
let match;
while ((match = imgRegex.exec(content)) !== null) {
    parsedData.contentImages.push(match[1]);
}

console.log('--- DỮ LIỆU ĐƯỢC BÓC TÁCH KHỚP VỚI BẢNG NEWS ---');
console.log(JSON.stringify(parsedData, null, 2));

