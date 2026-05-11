import pandas as pd
import pyodbc
import uuid
import datetime
import os
import sys
import logging

# === CONFIGURATION ===
# Cấu hình kết nối SQL Server
SERVER = '10.1.252.30'
DATABASE = 'app_tancang'
UID = 'admin_dioffice'
PWD = 'Admin#Di0ffice#9370'
EXCEL_PATH = r'C:\Users\DELL\Downloads\sync_too_905l\sync_tool\ReportDSHoChieu.xlsx'
BATCH_SIZE = 100

# Thiết lập logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def get_connection():
    conn_str = (
        f'DRIVER={{SQL Server}};'
        f'SERVER={SERVER};'
        f'DATABASE={DATABASE};'
        f'UID={UID};'
        f'PWD={PWD};'
        'Connect Timeout=30;'
    )
    return pyodbc.connect(conn_str)

def alter_table(cursor):
    """Bước 1: Alter table - Thêm các cột mới nếu chưa tồn tại"""
    logger.info("--- Bước 1: Kiểm tra và cập nhật schema ---")
    
    columns_to_add = [
        ("borrow_status", "nvarchar(50) DEFAULT 'NOT_BORROWED' NOT NULL"),
        ("source_system", "nvarchar(50) DEFAULT 'APP' NULL"),
        ("imported_at", "datetime2 DEFAULT NULL NULL"),
        ("tb_bak", "int DEFAULT 1 NULL")
    ]
    
    for col_name, col_def in columns_to_add:
        # Kiểm tra sự tồn tại của cột trong bảng passports
        check_sql = f"""
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'passports' AND COLUMN_NAME = '{col_name}'
        )
        BEGIN
            ALTER TABLE passports ADD {col_name} {col_def};
        END
        """
        cursor.execute(check_sql)
    cursor.commit()
    logger.info("Hoàn tất cập nhật schema.")

def map_data(df):
    """Bước 2: Xử lý dữ liệu Excel"""
    logger.info("--- Bước 2: Đọc và xử lý dữ liệu Excel ---")
    
    # Mapping các trạng thái từ Excel sang DB theo yêu cầu
    passport_type_map = {
        'Phổ thông': 'ORDINARY',
        'Công vụ': 'OFFICIAL',
        'Ngoại giao': 'DIPLOMATIC'
    }
    
    usage_status_map = {
        'Đang sử dụng': 'IN_USE',
        'Đã hết hạn': 'EXPIRED',
        'Sắp hết hạn': 'EXPIRING_SOON',
        'Đã hoàn trả': 'RETURNED',
        'Không sử dụng': 'STORING'
    }
    
    borrow_status_map = {
        'Không mượn': 'NOT_BORROWED',
        'Đang mượn': 'BORROWED'
    }

    processed_data = []
    now = datetime.datetime.now()
    
    for index, row in df.iterrows():
        # Bỏ qua dòng rỗng hoặc dòng tổng kết (Cột 1 là Số hộ chiếu)
        # Excel columns mapping: 
        # 0: STT, 1: Số hộ chiếu, 2: Nhân viên, 3: Ngày cấp, 4: Ngày hết hạn, 
        # 5: Các nước đã đi, 6: Trạng thái sử dụng, 7: Trạng thái trả, 8: Đơn vị, 9: Loại hộ chiếu
        
        p_number = str(row[1]).strip() if pd.notna(row[1]) else None
        if not p_number or p_number.lower() in ['nan', '', 'tổng cộng', 'tổng số'] or not any(c.isdigit() for c in p_number):
            continue
            
        full_name = str(row[2]).strip() if pd.notna(row[2]) else ''
        
        # Hàm parse ngày tháng định dạng dd/MM/yyyy
        def parse_vn_date(val):
            if pd.isna(val) or not val: return None
            if isinstance(val, datetime.datetime): return val.date()
            try:
                # Thử parse chuỗi dd/MM/yyyy
                return datetime.datetime.strptime(str(val).strip(), '%d/%m/%Y').date()
            except:
                return None

        issue_date = parse_vn_date(row[3])
        expiry_date = parse_vn_date(row[4])
        
        # DB yêu cầu NOT NULL cho các trường ngày tháng, nếu lỗi thì bỏ qua dòng này
        if not issue_date or not expiry_date:
            logger.warning(f"Bỏ qua dòng {index+11}: Lỗi định dạng ngày tháng ({row[3]} - {row[4]})")
            continue

        # Map giá trị trạng thái
        p_type_excel = str(row[9]).strip() if pd.notna(row[9]) else ''
        u_status_excel = str(row[6]).strip() if pd.notna(row[6]) else ''
        b_status_excel = str(row[7]).strip() if pd.notna(row[7]) else ''
        
        p_type = passport_type_map.get(p_type_excel, 'ORDINARY')
        u_status = usage_status_map.get(u_status_excel, 'STORING')
        b_status = borrow_status_map.get(b_status_excel, 'NOT_BORROWED')
        
        countries = str(row[5]).strip() if pd.notna(row[5]) else None
        unit_name = str(row[8]).strip() if pd.notna(row[8]) else None

        record = {
            'id': str(uuid.uuid4()),
            'eoffice_account': '', # Theo yêu cầu: để chuỗi rỗng
            'full_name': full_name,
            'passport_number': p_number,
            'passport_type': p_type,
            'issue_date': issue_date,
            'expiry_date': expiry_date,
            'countries_visited': countries,
            'usage_status': u_status,
            'borrow_status': b_status,
            'unit_name': unit_name,
            'nationality': 'Việt Nam',
            'source_system': 'EXCEL_IMPORT',
            'imported_at': now,
            'is_deleted': 0,
            'created_at': now,
            'updated_at': now
        }
        processed_data.append(record)
        
    logger.info(f"Đã tiền xử lý thành công {len(processed_data)} bản ghi.")
    return processed_data

def get_user_id(cursor, full_name):
    """Lấy user_id từ bảng users dựa trên tên nhân viên (Logic tương tự MigrationHelper.js)"""
    if not full_name: return None
    try:
        # Tìm trong bảng users (giả định bảng users nằm cùng database hoặc schema dbo)
        # Nếu users nằm ở database DiOffice như trong .env, ta dùng DiOffice.dbo.users
        sql = "SELECT TOP 1 id FROM dbo.users WHERE name = ?"
        cursor.execute(sql, (full_name,))
        row = cursor.fetchone()
        if row:
            return row[0]
    except:
        pass
    return None

def main():
    if not os.path.exists(EXCEL_PATH):
        logger.error(f"Không tìm thấy file Excel tại: {EXCEL_PATH}")
        return

    try:
        # Bước 2: Đọc Excel
        logger.info(f"Đang đọc file Excel: {EXCEL_PATH}")
        # Skip 9 dòng đầu, header ở dòng 10 (index 9)
        df = pd.read_excel(EXCEL_PATH, skiprows=9, header=None, engine='openpyxl')
        
        data_to_insert = map_data(df)
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Bước 1: Alter table
        alter_table(cursor)
        
        # Bước 3: Insert dữ liệu
        logger.info("--- Bước 3: Tiến hành Insert dữ liệu vào database ---")
        
        total = len(data_to_insert)
        inserted_count = 0
        skipped = []
        errors = []
        
        for i, item in enumerate(data_to_insert):
            # Lấy user_id từ database
            item['user_id'] = get_user_id(cursor, item['full_name'])
            
            # Kiểm tra trùng lặp dựa trên passport_number trước khi insert
            check_exists_sql = "SELECT id FROM passports WHERE passport_number = ?"
            cursor.execute(check_exists_sql, (item['passport_number'],))
            exists = cursor.fetchone()
            
            if exists:
                skipped.append({
                    'passport_number': item['passport_number'],
                    'full_name': item['full_name'],
                    'reason': 'Hộ chiếu đã tồn tại trong hệ thống'
                })
                continue

            try:
                insert_sql = """
                INSERT INTO passports (
                    id, eoffice_account, full_name, passport_number, passport_type, 
                    issue_date, expiry_date, countries_visited, usage_status, 
                    borrow_status, unit_name, nationality, source_system, 
                    imported_at, is_deleted, created_at, updated_at, user_id,
                    tb_bak
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                cursor.execute(insert_sql, (
                    item['id'], item['eoffice_account'], item['full_name'], item['passport_number'], item['passport_type'],
                    item['issue_date'], item['expiry_date'], item['countries_visited'], item['usage_status'],
                    item['borrow_status'], item['unit_name'], item['nationality'], item['source_system'],
                    item['imported_at'], item['is_deleted'], item['created_at'], item['updated_at'], item['user_id'],
                    1 # tb_bak = 1 cho dữ liệu import/migration
                ))
                conn.commit()
                inserted_count += 1
            except Exception as e:
                errors.append({
                    'passport_number': item['passport_number'],
                    'full_name': item['full_name'],
                    'reason': str(e)
                })
                conn.rollback()
            
            # Cập nhật tiến độ mỗi 10 dòng
            if (i + 1) % 10 == 0 or (i + 1) == total:
                print(f"Tiến độ: {i + 1}/{total} (Inserted: {inserted_count}, Skipped: {len(skipped)}, Errors: {len(errors)})", end='\r')
            
        print(f"\n--- Báo cáo kết quả ---")
        print(f"Thành công: {inserted_count}")
        print(f"Bỏ qua (Trùng): {len(skipped)}")
        print(f"Lỗi: {len(errors)}")
        
        # Bước 4: Xuất báo cáo lỗi nếu có
        if skipped or errors:
            report_df = pd.DataFrame(skipped + errors)
            report_df.to_excel('import_errors.xlsx', index=False)
            logger.info(f"Đã lưu danh sách lỗi vào file: import_errors.xlsx")
            
        conn.close()
        logger.info("Hoàn tất quá trình import.")

        # Thêm dòng này cuối cùng để Node.js parse được
        import json
        result = {
            "success": True,
            "inserted": inserted_count,
            "skipped": len(skipped),
            "errors": len(errors),
            "report_file": "import_errors.xlsx" if (skipped or errors) else None
        }
        print(f"JSON_RESULT:{json.dumps(result)}")
        
    except Exception as e:
        logger.error(f"Lỗi hệ thống: {e}")
        import json
        print(f"JSON_RESULT:{json.dumps({'success': False, 'message': str(e)})}")

if __name__ == "__main__":
    main()
