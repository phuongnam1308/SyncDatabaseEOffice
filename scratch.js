const XLSX = require('xlsx');
const path = require('path');
const p = path.resolve(__dirname, 'ReportDSHoChieu.xlsx');
try {
  const wb = XLSX.readFile(p, { cellDates: true });
  console.log('Sheets:', wb.SheetNames);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log('Total rows:', rows.length);
  if (rows.length > 9) {
    console.log('Header row (index 9):', rows[9]);
  }
  if (rows.length > 10) {
    console.log('Row 11:', rows[10]);
    console.log('Row 12:', rows[11]);
  }
} catch (e) {
  console.error(e);
}
