// utils/normalize.js
function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/^[0-9]+;#/g, '')   // bỏ "39;#"
    .normalize('NFD')            // tách dấu
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = normalize;
