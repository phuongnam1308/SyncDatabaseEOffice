const path = require('path');
require('dotenv').config();
const { downloadFile } = require('./src/sync-file-copy/SharePointAuthService');
const fs = require('fs');

async function testVerbose() {
    const targetUrl = 'https://eoffice.saigonnewport.com.vn/tintuc/Pages/tan-cang-2.aspx';
    console.log(`\n================================================================`);
    console.log(`[DIAGNOSTIC] KIỂM TRA CHI TIẾT KẾT NỐI SHAREPOINT`);
    console.log(`================================================================`);
    
    // 1. Kiểm tra trạng thái Cookie hiện tại
    const cookiePath = path.join(process.cwd(), 'auth', 'cookie.txt');
    let hasCookie = false;
    if (fs.existsSync(cookiePath)) {
        const cookie = fs.readFileSync(cookiePath, 'utf8');
        hasCookie = cookie.length > 5;
        console.log(`[AUTH] Đã tìm thấy file cookie.txt (Dài: ${cookie.length} ký tự)`);
        console.log(`[AUTH] Nội dung cookie (30 ký tự đầu): ${cookie.substring(0, 30)}...`);
    } else {
        console.log(`[AUTH] ❌ KHÔNG tìm thấy file cookie.txt. Hệ thống sẽ phải chạy login ngầm.`);
    }

    // 2. Thực hiện tải và đo thời gian chi tiết
    const start = Date.now();
    try {
        console.log(`[NETWORK] Đang gửi request tới SharePoint...`);
        console.log(`[NETWORK] URL: ${targetUrl}`);
        
        // Gọi hàm download với timeout 70s để bắt được sự kiện phía dưới 60s
        // Truyền retryCount = 0 để xem nó có tự refresh ko
        const buffer = await downloadFile(targetUrl, null, 0, 70000);
        
        const end = Date.now();
        const duration = (end - start) / 1000;

        console.log(`[RESULT] ✅ Phản hồi nhận được sau ${duration.toFixed(2)} giây.`);
        console.log(`[RESULT] - Dung lượng: ${(buffer.length / 1024).toFixed(2)} KB`);

        // Kiểm tra xem có phải trang login giả mạo không
        const html = buffer.toString('utf8').toLowerCase();
        if (html.includes('signincontrol_username') || html.includes('login.aspx') || html.includes('id="login"')) {
            console.log(`[WARNING] ⚠️ KẾT QUẢ GIAO DIỆN: Đây là TRANG ĐĂNG NHẬP, không phải nội dung bài viết.`);
            console.log(`[WARNING] => Kết luận: Cookie hiện tại KHÔNG có quyền truy cập hoặc hết hạn nhưng chưa refresh thành công.`);
        } else if (html.includes('<html') && (html.includes('article') || html.includes('content') || html.includes('pages'))) {
            console.log(`[SUCCESS] ✨ KẾT QUẢ GIAO DIỆN: Đã nhận được nội dung HTML hợp lệ của bài viết.`);
        } else {
            console.log(`[INFO] Nội dung HTML lạ, có thể là trang khác của SharePoint.`);
            // Lưu mẫu để xem nếu cần
            if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');
            fs.writeFileSync('tmp/debug_news.html', buffer);
            console.log(`[INFO] Đã lưu nội dung debug vào tmp/debug_news.html`);
        }

    } catch (err) {
        const duration = (Date.now() - start) / 1000;
        console.log(`[ERROR] ❌ THẤT BẠI sau ${duration.toFixed(2)} giây.`);
        console.log(`[ERROR] Thông báo lỗi: ${err.message}`);
        
        if (duration >= 59) {
            console.log(`[LOGIC] 📉 NHẬN ĐỊNH: Bị treo đúng ngưỡng Timeout 60s.`);
            console.log(`       -> SharePoint "ngậm" kết nối mà không trả về lỗi (thường do Proxy hoặc Firewall).`);
            console.log(`       -> Hoặc Cookie bị server từ chối lặng lẽ.`);
        }
    }
    console.log(`================================================================\n`);
}

testVerbose();
