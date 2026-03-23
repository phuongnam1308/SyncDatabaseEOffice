const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || 'tintucraw/tintuc/Pages/ke-hoach-don-doan-cbam-ngay-18-04.aspx';
const html = fs.readFileSync(filePath, 'utf-8');
const $ = cheerio.load(html);

console.log('--- Checking for View Count in', filePath, '---');

// Check common classes
['.view', '.viewcount', '.views', '#viewcount', '.lượt-xem', '.count'].forEach(cls => {
    $(cls).each((i, el) => {
        console.log(`Found ${cls}: "${$(el).text().trim()}"`);
    });
});

// Check all spans/divs for "Lượt xem"
$('span, div, p, strong, font').each((i, el) => {
    const text = $(el).text();
    if (text.includes('Lượt xem') || text.includes('view')) {
        console.log(`Potential match (${el.tagName}): "${text.trim().substring(0, 50)}"`);
    }
});

// Check meta tags
$('meta').each((i, el) => {
    const name = $(el).attr('name') || '';
    const prop = $(el).attr('property') || '';
    const content = $(el).attr('content') || '';
    if (name.includes('view') || prop.includes('view') || content.includes('view')) {
        console.log(`Meta: ${name || prop} = ${content}`);
    }
});
