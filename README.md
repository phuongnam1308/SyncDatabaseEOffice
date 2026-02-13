# Hệ thống Migration Dữ liệu SQL Server

Hệ thống migration dữ liệu từ SQL Server cũ (DataEOfficeSNP) sang SQL Server mới (DiOffice) với kiến trúc MVC.

## 📋 Mô tả

Migration dữ liệu từ bảng `PhongBan` sang bảng `organization_units` với các tính năng:

- ✅ Mapping tự động các trường dữ liệu
- ✅ Xử lý ID trùng lặp (lưu vào `Id_backups`)
- ✅ Batch processing để tối ưu hiệu suất
- ✅ Logging chi tiết
- ✅ API REST để quản lý
- ✅ CLI mode để chạy migration trực tiếp

## 🚀 Cài đặt

### 1. Clone project và cài đặt dependencies

```bash
cd chuyen-doi-tan-cang
npm install
```

### 2. Cấu hình môi trường

Chỉnh sửa file `.env` với thông tin database của bạn:

```env
# Database cũ
OLD_DB_SERVER=192.168.0.148
OLD_DB_NAME=DataEOfficeSNP
OLD_DB_USER=lifetex
OLD_DB_PASSWORD=12345678

# Database mới
NEW_DB_SERVER=192.168.0.999
NEW_DB_NAME=DiOffice
NEW_DB_USER=lifetex
NEW_DB_PASSWORD=cccjjj
```

## 📖 Sử dụng

### Chế độ 1: Chạy migration trực tiếp (CLI)

```bash
npm run migrate
```

### Chế độ 2: Chạy API Server

```bash
# Development
npm run dev

# Production
npm start
```

Server sẽ chạy tại: `http://localhost:3000`

## 🌐 API Endpoints

### 1. Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "message": "Server đang hoạt động",
  "data": {
    "status": "OK",
    "timestamp": "2025-01-09T...",
    "uptime": 123.45,
    "environment": "development"
  }
}
```

### 2. Kiểm tra kết nối Database
```http
GET /api/check-connection
```

**Response:**
```json
{
  "success": true,
  "message": "Kiểm tra kết nối thành công",
  "data": {
    "oldDb": {
      "connected": true,
      "recordCount": 150
    },
    "newDb": {
      "connected": true,
      "recordCount": 0
    }
  }
}
```

### 3. Lấy thống kê Migration
```http
GET /api/statistics
```

**Response:**
```json
{
  "success": true,
  "message": "Lấy thống kê thành công",
  "data": {
    "source": {
      "database": "DataEOfficeSNP",
      "table": "PhongBan",
      "count": 150
    },
    "destination": {
      "database": "DiOffice",
      "table": "organization_units",
      "count": 145
    },
    "migrated": 145,
    "remaining": 5,
    "percentage": "96.67"
  }
}
```

### 4. Thực hiện Migration
```http
POST /api/migrate/phongban
```

**Response:**
```json
{
  "success": true,
  "message": "Migration hoàn thành",
  "data": {
    "total": 150,
    "inserted": 145,
    "duplicates": 5,
    "errors": 0,
    "duration": "2.35"
  }
}
```

## 📊 Mapping Dữ liệu

| Database Cũ (PhongBan) | Database Mới (organization_units) |
|------------------------|-----------------------------------|
| ID                     | id (hoặc Id_backups nếu trùng)    |
| TitleVn                | name                              |
| Code                   | code                              |
| ParentID               | parentId                          |

### Các trường được tạo tự động:

- `type`: null
- `status`: 1
- `display_order`: 0
- `created_at`: timestamp hiện tại
- `updated_at`: timestamp hiện tại
- `table_backups`: "PhongBan"

## 🔧 Cấu hình

### Batch Size

Điều chỉnh số lượng record xử lý mỗi batch trong `.env`:

```env
BATCH_SIZE=100
```

### Logging

Bật/tắt logging:

```env
ENABLE_LOGGING=true
LOG_LEVEL=info  # error, warn, info, debug
```

Logs được lưu tại thư mục `logs/`:
- `error.log` - Chỉ lỗi
- `combined.log` - Tất cả logs
- `migration.log` - Migration logs

## 📁 Cấu trúc thư mục

```
chuyen-doi-tan-cang/
├── config/          # Cấu hình database và mapping
├── db/              # Quản lý kết nối database
├── models/          # Models (PhongBan, Base)
├── controllers/     # Controllers (Migration, Base)
├── services/        # Business logic
├── routes/          # API routes
├── utils/           # Utilities (logger, helpers)
├── logs/            # Log files
├── .env             # Environment variables
└── index.js         # Entry point
```

## ⚠️ Xử lý ID trùng lặp

Khi ID từ database cũ đã tồn tại trong database mới:

1. ID gốc được lưu vào trường `Id_backups`
2. Trường `id` để trống, database sẽ tự generate ID mới
3. Ghi log cảnh báo về ID trùng

## 🧪 Testing

Sử dụng file `POSTMAN_COLLECTION.json` để test API.

Import vào Postman và chạy các request:
1. Health Check
2. Check Connection
3. Get Statistics
4. Migrate PhongBan

## 📝 Logs

Xem logs realtime:

```bash
# Tất cả logs
tail -f logs/combined.log

# Chỉ lỗi
tail -f logs/error.log

# Migration logs
tail -f logs/migration.log
```

## 🐛 Troubleshooting

### Lỗi kết nối database

Kiểm tra:
- Server IP và Port
- Username/Password
- Database name
- Firewall settings

### Migration chạy chậm

Tăng `BATCH_SIZE` trong `.env`:
```env
BATCH_SIZE=200  # Hoặc cao hơn
```

### Lỗi ID trùng

Kiểm tra dữ liệu đã migrate trước đó. Có thể:
- Xóa dữ liệu bảng `organization_units` trước khi migrate lại
- Hoặc để hệ thống tự xử lý (lưu vào `Id_backups`)

## 📞 Support

Nếu có vấn đề, kiểm tra logs hoặc liên hệ team phát triển.

---

**Phiên bản:** 1.0.0  
**Ngày cập nhật:** 09/01/2025