const cheerio = require('cheerio');
const fs = require('fs');

const filePath = 'c:\\Users\\DELL\\Documents\\fixtintucchuanchuan - Copy (2)\\tintucraw\\tintuc\\Pages\\v-v-cu-the-hoa-phan-can-cu-cua-quyet-dinh-hanh-chinh.aspx';
const html = fs.readFileSync(filePath, 'utf-8');
const $ = cheerio.load(html, { decodeEntities: false });

const blocksToRemove = [
    '#s4-ribbonrow', '#suiteBarDelta', '#s4-titlerow', '#sideNavBox', '#footer', 
    '.ms-breadcrumb', '.ms-core-listMenu-verticalBox', '.ms-pub-breadcrumb',
    '.ms-belltown-sideNav', '#DeltaPlaceHolderLeftNavBar', '#DeltaPlaceHolderPageTitleInTitleArea',
    'script', 'style', 'link', 'iframe', 'object', 'embed', '.other-news', '.tags', '.social-share',
    '.ms-helper', '.ms-skipToContent', '.ms-access-key', '.ms-hide', '.ms-hidden',
    '.ms-comm-pageTitle', '.ms-core-sideNavBox-removed', '.ms-vertical-sideNav',
    '#ms-accessible-navigation', '#ms-skipped-resource-msg', '.ms-skipToMainContent',
    '#top-navigation', '#global-navigation',
    '.other-category', '.keyword', '.likebook', '.Form', '.feedbackSend', '.feedback',
    '.news-title', '.Title', '.subtitle', '.des', '.tbimg-news', '.day', '.author',
    '[id^="ctl00_PlaceHolderMain_EditModePanel"]', '.linkadmin', '.link-banner', '.menu-cover'
];

let docMainArea = #DeltaPlaceHolderMain, .article-content, .news-content-body, #MSO_ContentTable.first();
if (!docMainArea.length) {
    docMainArea = .news-detail, .NewsMainArea, .article-body.first();
}

let contentContainer = .content.first();
if (!contentContainer.length || contentContainer.text().trim().length < 20) {
    contentContainer = docMainArea;
}

contentContainer = contentContainer.clone();
blocksToRemove.forEach(selector => contentContainer.find(selector).remove());

contentContainer.find('*').each((i, el) => {
    const txt = $text = .text();
    if (/Ngày dang:|Ngày s?a:|Ngu?i so?n tin:|Ngày t?o:/i.test(txt)) {
        .closest('div, p, span').remove();
    }
});

console.log('--- N?I DUNG CONTENT SAU KHI L?C ---');
console.log(contentContainer.html().trim());
console.log('------------------------------------');
