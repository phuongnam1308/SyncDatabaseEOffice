# TÀI LIỆU KHẢO SÁT, ĐỐI CHIẾU DỮ LIỆU & BẢO ĐẢM PHÂN QUYỀN CHUYỂN ĐỔI CSDL TỪ EOFFICE SANG DOFFICE (BẢN BỔ SUNG NỘI DUNG KỸ THUẬT/DEV)

---

> [!NOTE]
> **Phiên bản:** 2.2 (Chuẩn hóa chính xác Tên trường Vết dữ liệu & Cơ chế Rollback theo Codebase `SyncDatabaseEOffice`)
> **Ngày cập nhật:** 04/08/2026
> **Trạng thái:** DỰ THẢO TRÌNH XÁC NHẬN KỸ THUẬT & NGHIỆP VỤ

---

## I. TỔNG QUAN TÀI LIỆU

### 1. Mục đích tài liệu
Tài liệu này được xây dựng nhằm mô tả, tổng hợp, đối chiếu dữ liệu nghiệp vụ và **chứng minh bằng dữ liệu/bằng chứng kỹ thuật** tính đúng đắn, đầy đủ và tương đương về phân quyền giữa hệ thống cũ (Eoffice - EO) và hệ thống mới (Doffice - DO) trong quá trình chuyển đổi, nâng cấp CSDL.

Nội dung tài liệu tập trung làm rõ:
- Các quy trình nghiệp vụ đã và đang vận hành trên EO.
- Cơ chế phân quyền, luân chuyển và bảo mật dữ liệu trên DO.
- Ma trận ánh xạ dữ liệu, ma trận trạng thái, ma trận tài khoản/đơn vị giữa EO và DO.
- **Rà soát logic xử lý của các Module đồng bộ Backend (`services/Migration*.js`)** đảm bảo dữ liệu ghi sang DO tái lập chính xác 11 loại quyền thao tác.
- Bộ câu lệnh truy vấn (SQL) tiêu chuẩn hóa phục vụ kiểm tra, đối soát 2 chiều (Dương tính & Âm tính).
- Tiêu chí nghiệm thu kỹ thuật định lượng và phương án chuyển đổi (Migration / Cutover / Rollback).

### 2. Phạm vi tài liệu
Tài liệu bao gồm các nhóm nghiệp vụ chính:
1. **Nghiệp vụ Quản lý Văn bản đến & Văn bản đi/Dự thảo.**
2. **Nghiệp vụ Quản lý Công việc & Dự án.**
3. **Nghiệp vụ Quản lý Lịch họp.**
4. **Nghiệp vụ Quản lý Hộ chiếu.**
5. **Nghiệp vụ Quản lý Đăng ký xe.**
6. **Quản lý trang Tin tức công khai.**
7. **Cơ chế Phân quyền, Lịch sử luân chuyển, File đính kèm và Audit Trail.**

### 3. Đối tượng sử dụng tài liệu
- Đơn vị nghiệp vụ & Ban Quản lý dự án phía Khách hàng.
- Nhóm Phân tích Nghiệp vụ (BA).
- Nhóm Phát triển Phần mềm & Quản trị CSDL (Dev & DBA).
- Nhóm Chuyển đổi Dữ liệu (Data Migration Team).
- Nhóm Kiểm thử & Nghiệm thu (QC/QA).

### 4. Định nghĩa kỹ thuật & Nguyên tắc thực hiện đối chiếu dữ liệu

> [!IMPORTANT]
> **Định nghĩa "Quyền truy cập tương đương" (Equivalent Permission):**
> Đối với mỗi tài khoản được ánh xạ ($User\_ID$), trên cùng một đối tượng dữ liệu ($ID$) và cùng một thao tác ($Action$), kết quả truy cập (*Cho phép/Allow* hoặc *Từ chối/Deny*) trên hệ thống mới Doffice phải tương đương 100% với hệ thống cũ Eoffice tại thời điểm chốt CSDL (Cutoff date), ngoại trừ các trường hợp ngoại lệ đã được Khách hàng chấp thuận.

Việc đối chiếu dữ liệu tuân thủ 5 nguyên tắc:
1. **Bám sát nghiệp vụ thực tế & Quy tắc kỹ thuật:** Kết quả phân quyền trên DO phải dựa trên bằng chứng dữ liệu trong CSDL EO (`LuanChuyenVanBan`, `VanBanDen`, `VanBanBanHanh`, `TaskVBDen`, `TaskVBDi`...).
2. **Bảo đảm kế thừa vẹn toàn lịch sử xử lý:** Lưu giữ nguyên vẹn thứ tự thời gian, người xử lý, đơn vị xử lý và nhật ký thao tác.
3. **Bảo đảm đúng và đủ quyền truy cập (Không thừa, không thiếu):**
   - **Chỉ số Quyền thiếu (Missing Permission):** $\text{Quyền EO} - \text{Quyền DO} = 0$.
   - **Chỉ số Quyền cấp thừa (Excess Permission):** $\text{Quyền DO} - \text{Quyền EO} = 0$.
4. **Đối soát file đính kèm đa chiều:** Đảm bảo khớp số lượng tệp, dung lượng (Bytes) và mã băm Checksum (MD5/SHA256).
5. **Không tự động suy diễn dữ liệu:** Mọi trường hợp dữ liệu cũ bị thiếu, không rõ ràng hoặc không mapping được phải được gắn mã Ngoại lệ (`EX-xxx`) và trình phê duyệt.

---

## II. MA TRẬN PHÂN QUYỀN THAO TÁC & MODULE ĐỒNG BỘ CHỊU TRÁCH NHIỆM (ACTION PERMISSION & SYNC MODULE MATRIX)

> [!NOTE]
> 11 loại quyền thao tác dưới đây **bắt buộc phải được kiểm tra logic trực tiếp trong các file Service đồng bộ** (`services/Migration*.js`) để đảm bảo quá trình Migration ghi đúng các trường phân quyền (`roleProcess`, `view_group`, `receiver`, `status`, `stage_status`, `file_relations`).

| Mã Quyền | Đối Tượng | Thao Tác (Action) | Điều Kiện Eoffice (AS-IS) | Điều Kiện Doffice (TO-BE) | Module Sync Chịu Trách Nhiệm (Codebase) |
|---|---|---|---|---|---|
| `VB-XEM-01` | Văn bản đến | Xem thông tin chung | Nằm trong lịch sử luân chuyển `LuanChuyenVanBan` | Có bản ghi `audit` liên quan | `services/MigrationAuditService.js`, `IncommingAuditCreateService.js` |
| `VB-XEM-02` | Văn bản đến | Xem nội dung/Tải tệp | Người xử lý chính / Phối hợp | `roleProcess` IN (`processor`, `supporter`) | `services/MigrationIncomingDocumentService.js` |
| `VB-XEM-03` | Văn bản đến | Nhận để biết | Được chuyển nhận để biết | `roleProcess = 'viewer'` trong `audit` | `services/MigrationAuditService.js` |
| `VB-XEM-04` | Văn bản đến | Xem theo nhóm | Đội ngũ thuộc Nhóm xem VB | `view_group` khớp `group_users` / `user_group_users` | `services/MigrationUserGroupService.js`, `MigrationSharePointGroupService.js` |
| `VB-TAI-01` | File đính kèm | Tải file | Có quyền xem văn bản | Có liên kết `file_relations` & thuộc data scope | `services/MigrationFileRelationsService3.js`, `FileRelationsMappingService.js` |
| `VB-SUA-01` | Văn bản | Chỉnh sửa | Văn thư tạo VB + chưa kết thúc | Vai trò Văn thư + `status = 1` | `services/MigrationIncomingDocumentSyncService.js` |
| `VB-KY-01` | Văn bản đi | Ký số / Phê duyệt | Người giữ việc ở bước ký | Task/WorkItem ở trạng thái `open` | `services/MigrationOutgoingDocumentService.js` |
| `VB-DENY-01` | Văn bản | Truy cập trái phép | **Không thuộc luồng/nhóm/đơn vị** | **Không có trong `receiver`/`view_group`** | Tất cả các `Migration*.js` (Ghi dữ liệu cách ly) |
| `CV-XEM-01` | Công việc | Xem & Xử lý | Nằm trong danh sách giao việc | `task_users.process_id = UserId` | `services/MigrationTaskUsersService.js`, `MigrationTaskVBDiService.js` |
| `HC-XEM-01` | Hộ chiếu | Xem yêu cầu | Người tạo / Người mượn / Duyệt | Requester/Creator/Delegation/Audit | `import_passport.js` / Service đồng bộ Hộ chiếu |
| `XE-XEM-01` | Đăng ký xe | Xem tiến trình | Cán bộ đăng ký xe | `created_by = UserId` & `vehicle_state = 'TRONG_TIEN_TRINH'` | Service đồng bộ Đăng ký xe |

---

## III. CHI TIẾT TRUY VẤN KỸ THUẬT & ĐỐI CHIẾU DỮ LIỆU (DEV PERSPECTIVE)

### 1. Nghiệp vụ Quản lý Văn bản Đến

#### 1.1. Phía Eoffice (CSDL Cũ)

* **Mã SQL:** `SQL-EO-VBDEN-01`
  * **Mục tiêu:** Lấy thông tin chung và danh sách tệp đính kèm văn bản đến theo ID.
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        CoQuanGui2, DonVi, SoDen, Files, TrichYeu, 
        DoKhan, DoMat, LoaiVanBan, SoVanBan, NgayDen, NgayTrenVB, Created, CreatedBy  
    FROM [DataEOfficeSNP].[dbo].[VanBanDen] 
    WHERE ID = @VBId; -- Tham số: ID Văn bản đến (Ví dụ: 412734)
    ```

* **Mã SQL:** `SQL-EO-VBDEN-02`
  * **Mục tiêu:** Lấy lịch sử luân chuyển văn bản đến để xác định danh sách người từng tham gia xử lý.
  * **Cú pháp SQL:**
    ```sql
    SELECT *
    FROM dbo.[LuanChuyenVanBan]
    WHERE VBId = @VBId AND Category IN (N'Văn bản đến TCT', N'Văn bản đến')
    ORDER BY 
        COALESCE(
            TRY_CONVERT(datetime, NgayTao, 120),
            TRY_CONVERT(datetime, NgayTao, 121),
            TRY_CONVERT(datetime, NgayTao, 103),
            TRY_CONVERT(datetime, NgayTao, 105),
            TRY_CONVERT(datetime, NgayTao),
            GETDATE()
        ) ASC, ID ASC;
    ```

* **Mã SQL:** `SQL-EO-VBDEN-03`
  * **Mục tiêu:** Lấy danh sách văn bản đến theo tên cán bộ xử lý trên Eoffice.
  * **Cú pháp SQL:**
    ```sql
    SELECT l.*, v.TrichYeu 
    FROM dbo.LuanChuyenVanBan_VP l 
    INNER JOIN dbo.VanBanDen v ON l.VBId = v.ID 
    WHERE l.NguoiXuLy LIKE N'%' + @TenNguoiXuLy + '%';
    ```

#### 1.2. Phía Doffice (CSDL Mới)

* **Mã SQL:** `SQL-DO-VBDEN-01`
  * **Mục tiêu:** Lấy thông tin chi tiết văn bản đến sau chuyển đổi.
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        b.name AS TenSoVB,
        o1.name AS DonViGui, 
        o2.name AS DonViNhan,
        i.receive_date,
        i.document_date,
        i.to_book_code,
        i.abstract_note,
        i.private_level AS DoMat,
        i.document_type AS LoaiVanBan,
        i.urgency_level AS DoKhan
    FROM dbo.incomming_documents i 
    INNER JOIN dbo.book_documents b ON i.book_document_id = b.book_document_id
    INNER JOIN dbo.custom_sender_units o1 ON i.sender_unit = o1.id
    INNER JOIN dbo.organization_units o2 ON i.receiver_unit = o2.id
    WHERE i.document_id = @DocumentId; -- GUID Doffice
    ```

* **Mã SQL:** `SQL-DO-VBDEN-02`
  * **Mục tiêu:** Lấy danh sách tệp đính kèm liên kết với văn bản đến trên Doffice.
  * **Cú pháp SQL:**
    ```sql
    SELECT DISTINCT f.id, f.file_name 
    FROM dbo.files f 
    INNER JOIN dbo.file_relations fr ON f.id = fr.file_id 
    WHERE fr.object_id = @DocumentId;
    ```

* **Mã SQL:** `SQL-DO-VBDEN-03`
  * **Mục tiêu:** Lấy danh sách văn bản "Nhận để biết" (`roleProcess = 'viewer'`).
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        i.abstract_note AS TrichYeu, a.*
    FROM dbo.incomming_documents i
    INNER JOIN dbo.audit a ON i.document_id = a.document_id
    WHERE i.status = 1 
      AND a.stage_status = 'CHUA_XU_LY' 
      AND a.receiver = @UserId 
      AND a.roleProcess = 'viewer';
    ```

* **Mã SQL:** `SQL-DO-VBDEN-04`
  * **Mục tiêu:** Truy vấn danh sách văn bản đến theo Nhóm người dùng phân quyền xem (`view_group`).
  * **Cú pháp SQL:**
    ```sql
    SELECT DISTINCT d.document_id, d.abstract_note, d.view_group
    FROM dbo.incomming_documents d WITH (NOLOCK)
    WHERE d.status = 1
      AND d.view_group IS NOT NULL
      AND d.view_group <> ''
      AND EXISTS (
        SELECT 1
        FROM STRING_SPLIT(d.view_group, ',') s
        INNER JOIN dbo.group_users gu_target WITH (NOLOCK) ON gu_target.code = LTRIM(RTRIM(s.value))
        WHERE EXISTS (
            SELECT 1 FROM dbo.user_group_users ugu WITH (NOLOCK)
            WHERE ugu.group_user_id = gu_target.id AND ugu.user_id = @UserId
        )
        OR EXISTS (
            SELECT 1 FROM dbo.user_group_users ugu_mgr WITH (NOLOCK)
            INNER JOIN dbo.group_users gu_mgr WITH (NOLOCK) ON gu_mgr.id = ugu_mgr.group_user_id
            WHERE ugu_mgr.user_id = @UserId
        )
      );
    ```

---

### 2. Nghiệp vụ Quản lý Văn bản Đi & Dự thảo

#### 2.1. Phía Eoffice (CSDL Cũ)

* **Mã SQL:** `SQL-EO-VBDI-01`
  * **Mục tiêu:** Lấy thông tin chung văn bản ban hành / đi.
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        v.ID, p.FullName AS NguoiTao, v.DoKhan, v.DoMat, 
        v.LoaiVanBan, v.NgayBanHanh, v.SoVanBan, v.TrichYeu, v.Files
    FROM dbo.VanBanBanHanh v 
    INNER JOIN dbo.PersonalProfile p ON v.CreatedBy = p.ID
    WHERE v.ID = @VBId; -- Ví dụ: 70965
    ```

* **Mã SQL:** `SQL-EO-VBDI-02`
  * **Mục tiêu:** Truy vấn luồng xử lý văn bản đi/dự thảo theo cán bộ.
  * **Cú pháp SQL:**
    ```sql
    SELECT l.*, v.TrichYeu 
    FROM dbo.LuanChuyenVanBan l 
    INNER JOIN dbo.VanBanBanHanh v ON l.VBId = v.ID 
    WHERE (l.Category = N'Văn bản đi' OR l.Category = N'Phát hành văn bản ĐV' OR l.Category = N'Văn bản trình ký')
      AND l.NguoiXuLy LIKE N'%' + @TenNguoiXuLy + '%'
    ORDER BY l.VBId DESC;
    ```

* **Mã SQL:** `SQL-EO-VBDI-03`
  * **Mục tiêu:** Truy vấn chi tiết các bước xử lý SLA trong quy trình trình ký.
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        ci.ID AS CodeItemID, ci.Subject AS TrichYeu,
        s.Step AS BuocXuLy, s.StartDate AS NgayBatDau, s.CompletedDate AS NgayHoanThanh,
        pUser.FullName AS TenNguoiXuLy, pCreated.FullName AS TenNguoiTao, pModified.FullName AS TenNguoiCapNhat,
        CASE WHEN s.CompletedDate IS NOT NULL THEN N'Đã xử lý' ELSE N'Đang xử lý' END AS TrangThaiBuoc
    FROM [SNP].[CodeItem] ci
    INNER JOIN (
        SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy, StartDate, CompletedDate FROM [SNP].[SLAStepDetail]
        UNION ALL
        SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy, StartDate, CompletedDate FROM [SNP].[SLAStepDetail_History]
    ) s ON ci.ID = s.ItemID
    LEFT JOIN dbo.PersonalProfile pUser ON s.UserID = pUser.ID
    LEFT JOIN dbo.PersonalProfile pCreated ON s.CreatedBy = pCreated.ID
    LEFT JOIN dbo.PersonalProfile pModified ON s.ModifiedBy = pModified.ID
    WHERE s.UserID = @PersonalProfileId
    ORDER BY ci.ID DESC, s.Step ASC, s.StartDate ASC;
    ```

#### 2.2. Phía Doffice (CSDL Mới)

* **Mã SQL:** `SQL-DO-VBDI-01`
  * **Mục tiêu:** Truy vấn văn bản đi theo ID kế thừa (`id_outgoing_bak`).
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        o.id_outgoing_bak, u.name AS NguoiTao, o.private_level, o.urgency_level, o.document_type, o.* 
    FROM dbo.outgoing_documents o
    INNER JOIN dbo.users u ON u.id = o.drafter
    WHERE o.id_outgoing_bak = @IdOutgoingBak;
    ```

* **Mã SQL:** `SQL-DO-VBDI-02`
  * **Mục tiêu:** Truy vấn danh sách văn bản đi đang trong danh sách "Chờ xử lý" của người dùng.
  * **Cú pháp SQL:**
    ```sql
    SELECT 
        ocs.current_action_code AS status_code,
        ocs.current_stage_status AS stageStatus,
        outgoing_documents.abstract_note
    FROM dbo.outgoing_documents
    INNER JOIN dbo.outgoing_current_state ocs ON ocs.document_id = outgoing_documents.document_id
    OUTER APPLY (
        SELECT TOP 1 oa_inner.document_id, oa_inner.receiver, oa_inner.stage_status, oa_inner.is_creator, oa_inner.last_audit_id 
        FROM dbo.outgoing_assignment oa_inner
        WHERE oa_inner.document_id = outgoing_documents.document_id AND oa_inner.receiver = @UserId
        ORDER BY 
          CASE WHEN oa_inner.stage_status IN ('HT_VBTT', 'CHUA_XU_LY', 'CHO_KY_NOI_DUNG', 'CHO_KY_THE_THUC', 'CHO_KY_BAN_HANH', 'CHO_KY_NHAY', 'CHO_KY_CHINH_THUC', 'CHO_XAC_NHAN', 'CHO_THAM_DINH', 'CHO_KY_DONG_DAU', 'CHO_DONG_DAU', 'THU_HOI') THEN 0 ELSE 1 END,
          ISNULL(oa_inner.last_audit_id, 0) DESC, oa_inner.updated_at DESC
    ) oa
    OUTER APPLY (
        SELECT TOP 1 wi_inner.id, wi_inner.document_id, wi_inner.assignee_user_id, wi_inner.state
        FROM dbo.work_items wi_inner
        WHERE wi_inner.document_id = outgoing_documents.document_id AND wi_inner.assignee_user_id = @UserId AND wi_inner.state = 'open'
        ORDER BY wi_inner.created_at DESC
    ) wi
    WHERE (oa.last_audit_id = ocs.last_audit_id OR wi.id IS NOT NULL)
      AND (oa.stage_status IN ('HT_VBTT', 'CHUA_XU_LY', 'CHO_KY_NOI_DUNG', 'CHO_KY_THE_THUC', 'CHO_KY_BAN_HANH', 'CHO_KY_NHAY', 'CHO_KY_CHINH_THUC', 'CHO_XAC_NHAN', 'CHO_THAM_DINH', 'CHO_KY_DONG_DAU', 'CHO_DONG_DAU', 'THU_HOI') OR (wi.id IS NOT NULL AND oa.document_id IS NULL))
      AND ((oa.document_id IS NOT NULL AND ISNULL(oa.is_creator, 0) = 0) OR wi.id IS NOT NULL)
      AND outgoing_documents.status = 1
    ORDER BY outgoing_documents.updated_at DESC
    OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY;
    ```

---

### 3. Nghiệp vụ Công việc, Lịch họp, Hộ chiếu & Xe (Doffice)

* **`SQL-DO-CV-01` (Công việc chung):**
  ```sql
  SELECT t.id, t.code, t.name, t.start_date, t.end_date, t.process_status, t.priority, t.type_task
  FROM dbo.task t
  WHERE (t.type_task = 'general' OR t.type_task IS NULL)
    AND EXISTS (
        SELECT 1 FROM dbo.task_users tu_viewer
        WHERE tu_viewer.task_id = t.id AND LOWER(tu_viewer.process_id) = LOWER(@UserId)
    );
  ```

* **`SQL-DO-CV-02` (Công việc từ Văn bản):**
  ```sql
  SELECT task.id, task.code, task.name, task.start_date, task.end_date, task.process_status, task.doc_id, task.created_by
  FROM dbo.task task
  WHERE task.status = 1 AND task.type_task = 'form_doc'
    AND (task.created_by = @UserId OR EXISTS (
        SELECT 1 FROM dbo.task_users tu WHERE tu.task_id = task.id AND tu.process_id = @UserId
    ));
  ```

* **`SQL-DO-CV-03` (Công việc từ Cuộc họp):**
  ```sql
  SELECT task.code, task.name, task.start_date, task.end_date, task.process_status, task.meeting_id, task.created_by
  FROM dbo.task task
  WHERE task.status = 1 AND task.type_task = 'form_meeting'
    AND (task.created_by = @UserId OR EXISTS (
        SELECT 1 FROM dbo.task_users tu WHERE tu.task_id = task.id AND tu.process_id = @UserId
    ));
  ```

* **`SQL-DO-CV-04` (Công việc lặp lại - CTE đệ quy):**
  ```sql
  WITH AccessibleRecurringConfigs AS (
      SELECT c.id, c.code, c.name, c.status, c.priority, c.repetitive_task, c.task_id, c.parent_id, c.created_by, c.created_at
      FROM dbo.task_recurring_config c
      WHERE c.status <> 3 AND c.parent_id IS NULL
        AND (c.created_by = @UserId OR EXISTS (
            SELECT 1 FROM dbo.task_users tu WHERE tu.task_id = c.task_id AND LOWER(tu.process_id) = LOWER(@UserId)
        ))
      UNION ALL
      SELECT child.id, child.code, child.name, child.status, child.priority, child.repetitive_task, child.task_id, child.parent_id, child.created_by, child.created_at
      FROM dbo.task_recurring_config child
      INNER JOIN AccessibleRecurringConfigs parent ON child.parent_id = parent.id
      WHERE child.status <> 3
  )
  SELECT DISTINCT id, code, name, status, priority, repetitive_task, task_id, parent_id, created_by, created_at
  FROM AccessibleRecurringConfigs
  ORDER BY created_at DESC, id DESC;
  ```

* **`SQL-DO-DA-01` (Dự án tham gia):**
  ```sql
  SELECT p.id, p.code, p.name, p.typeProject, p.projectStatus, p.startDate, p.endDate
  FROM dbo.projects p
  WHERE p.status = 1
    AND EXISTS (
        SELECT 1 FROM dbo.project_members pm WHERE pm.project_id = p.id AND pm.user_id = @UserId
    );
  ```

* **`SQL-DO-LH-01` (Lịch họp chờ duyệt):**
  ```sql
  SELECT meetings.id, meetings.title, meetings.started_at, meetings.ended_at, meetings.stage_status
  FROM dbo.meetings WITH (NOLOCK)
  WHERE meetings.status = '1'
    AND (meetings.is_template = 0 OR meetings.is_template IS NULL OR (meetings.stage_status != 'DONG_Y_PHE_DUYET' OR meetings.stage_status IS NULL))
    AND meetings.meeting_state <> 'DA_HUY' AND meetings.stage_status IS NULL AND meetings.created_by = @UserId;
  ```

* **`SQL-DO-HC-01` (Yêu cầu mượn hộ chiếu PENDING):**
  ```sql
  SELECT r.request_code, r.type_request, r.name_passport_request, r.passport_number, r.borrow_date, r.return_date, r.status
  FROM dbo.passport_borrow_requests r
  WHERE r.is_deleted = 0 AND r.status = 'PENDING'
    AND (
        r.created_by = @UserId OR r.requester_id = @UserId OR r.name_passport_request = @UserId
        OR EXISTS (SELECT 1 FROM dbo.passport_delegation_items pdi WITH (NOLOCK) WHERE pdi.request_id = r.id AND pdi.user_id = @UserId)
        OR EXISTS (SELECT 1 FROM dbo.work_items wi WITH (NOLOCK) WHERE wi.document_id = CAST(r.id AS VARCHAR(64)) AND wi.state = 'open' AND wi.assignee_user_id = @UserId)
        OR EXISTS (SELECT 1 FROM dbo.audit a WITH (NOLOCK) WHERE a.document_id = CAST(r.id AS NVARCHAR(64)) AND a.type_document = 'PassportRequest' AND (a.user_id = @UserId OR a.receiver = @UserId))
    );
  ```

* **`SQL-DO-HC-02` (Hộ chiếu đang sử dụng - IN_USE):**
  ```sql
  SELECT r.id, r.request_code, r.passport_number, r.borrow_date, r.return_date, r.status
  FROM dbo.passport_borrow_requests r
  WHERE r.is_deleted = 0 AND r.status = 'IN_USE' AND (r.requester_id = @UserId OR r.created_by = @UserId);
  ```

* **`SQL-DO-XE-01` (Đăng ký xe đang tiến hành):**
  ```sql
  SELECT vehicle_registrations.id, vehicle_registrations.request_code, vehicle_registrations.destination, vehicle_registrations.vehicle_state
  FROM dbo.vehicle_registrations
  WHERE vehicle_registrations.status = '1' AND vehicle_registrations.created_by = @UserId AND vehicle_registrations.vehicle_state = 'TRONG_TIEN_TRINH';
  ```

---

## IV. NỘI DUNG CẦN CHỐT VỚI KHÁCH HÀNG & NGUYÊN TẮC XỬ LÝ NGOẠI LỆ

> [!WARNING]
> **CÁC NỘI DUNG P0 CẦN KHÁCH HÀNG & BA XÁC NHẬN CHÍNH THỨC:**

1. **Chốt quy tắc tab "Nhận để biết":**
   - *Khảo sát hiện tại:* Gợi ý rằng người dùng ở bước quy trình tương lai chưa đến lượt cũng nhìn thấy ở tab "Nhận để biết".
   - *Quy tắc kỹ thuật đề xuất:* Tab "Nhận để biết" chỉ hiển thị các bản ghi được gán rõ `roleProcess = 'viewer'`. Người ở bước ký/xử lý tương lai sẽ được quản lý qua `work_items` theo luồng, không gán vai trò viewer để tránh cấp quyền xem sớm.

2. **Chốt quy tắc "Người từng xử lý vĩnh viễn":**
   - *Khảo sát hiện tại:* Coi `LuanChuyenVanBan.NguoiXuLy` là căn cứ xem vĩnh viễn.
   - *Đề xuất chốt:* Xác nhận rõ người từng xử lý có được xem khi đã chuyển phòng ban hay nghỉ việc không, và văn bản mật/tối mật có áp dụng quy tắc này không.

3. **Định nghĩa tiêu chí "Cấp thấp hơn" trong Nhóm xem văn bản:**
   - Cần chốt rõ "Cấp thấp hơn" là thấp hơn theo cấp Chức vụ, cấp Quản lý hay cấp Đơn vị tổ chức.

---

## V. PHƯƠNG ÁN MIGRATION, CUTOVER & ROLLBACK THỰC TẾ TRÊN CODEBASE

### 1. Kế hoạch chuyển đổi theo đợt (Cutover Strategy)
1. **Đợt 1 (Full Migration):** Chuyển toàn bộ dữ liệu lịch sử từ khi khởi tạo CSDL EO đến thời điểm mốc $T_0$.
2. **Đợt 2 (Delta Migration):** Chuyển bổ sung các bản ghi phát sinh từ $T_0$ đến thời điểm đóng băng hệ thống $T_{Cutoff}$.
3. **Đóng băng hệ thống (Freeze):** Chuyển CSDL EO sang chế độ Read-Only tại thời điểm chuyển giao chính thức.

### 2. Xử lý hồ sơ dở dang (In-flight Documents)
Hồ sơ đang xử lý tại thời điểm chuyển đổi phải được di vết đồng thời:
- Trạng thái quy trình hiện tại (`stage_status`).
- Người giữ việc chính (`processor`) và người phối hợp (`supporter`).
- Công việc đang mở trong `work_items` (`state = 'open'`) để người dùng đăng nhập Doffice có thể thực hiện thao tác ký/chuyển tiếp ngay lập tức.

### 3. Cơ chế Truy vết Dữ liệu Gốc & Phương án Khôi phục (Rollback Plan)

> [!NOTE]
> **Chuẩn hóa Tên Trường Vết Dữ Liệu Thực Tế trong Codebase `SyncDatabaseEOffice`:**
> Hệ thống đồng bộ hiện tại không dùng các trường lý thuyết chung chung mà lưu trực tiếp các trường vết `_bak` và `origin_id` trên các bảng CSDL Doffice để phục vụ kiểm tra và Rollback Cleanup:
> - **`incomming_documents.id_incoming_bak`**: Mã `ID` gốc từ bảng `VanBanDen` (EO).
> - **`outgoing_documents.id_outgoing_bak`**: Mã `ID` gốc từ bảng `VanBanBanHanh` (EO).
> - **`task.id_task_bak` / `task_users.id_task_bak`**: Mã `ID` công việc gốc từ `TaskVBDen` / `TaskVBDi` / `task_users2`.
> - **`users.id_user_bak` / `user_group_users.id_user_bak`**: Mã `ID` người dùng gốc từ EO.
> - **`files.id_bak` / `file_relations.id_bak`**: Mã `ID` file gốc từ kho file EO.
> - **`table_bak` (hoặc `tb_bak`)**: Tên bảng CSDL gốc (Ví dụ: `'VanBanDen'`, `'VanBanBanHanh'`, `'task_users2'`).
> - **`origin_id`**: Mã ID dữ liệu gốc liên kết trong các bảng `audit` và `task`.

**Quy trình Rollback:**
- Nếu đợt chuyển đổi CSDL gặp sự cố trong cửa sổ thời gian (Cutover Window), tool đồng bộ sẽ thực hiện các câu lệnh `DELETE` dọn dẹp dữ liệu Doffice dựa trên các trường vết `id_*_bak` và `table_bak` (ví dụ chạy `MigrationIncomingDocumentDeleteService.js`, `MigrationOutgoingDocumentDeleteService.js`, `MigrationTaskDeleteService.js`, `MigrationUserDeleteService.js`).
- Chuyển lại CSDL EO về trạng thái ghi bình thường cho người dùng tiếp tục sử dụng.

---

## VI. BẢNG MAPPING HỆ THỐNG (EOFFICE $\leftrightarrow$ DOFFICE)

### 1. Ánh xạ Tài khoản & Tổ chức (User & Unit Mapping)

| User ID EO (`id_user_bak`) | Username EO | User ID DO (`id`) | Username DO | Đơn vị EO | Đơn vị DO | Trạng Thái | Phương Án Xử Lý |
|---|---|---|---|---|---|---|---|
| `1C62...68C` | `hai.vv` | `4f36...590` | `hai.vv@snp` | Văn phòng TCT | VP TCT | Hoạt động | Mapping 1-1 |
| `2A11...99B` | `nam.cvp` | `ea1c...ef7` | `nam.cvp@snp` | Ban Giám đốc | BGĐ | Hoạt động | Mapping 1-1 |
| `OLD_0099` | `ong_a` | `NULL` | `NULL` | Phòng Kế hoạch | - | Nghỉ việc | `EX-USR-01`: Giữ vết lịch sử audit, không tạo tài khoản mới |

### 2. Bảng Quản lý Ngoại lệ (Exception Management)

| Mã Ngoại Lệ | Phân Loại | Mô Tả Chênh Lệch | Nguyên Nhân Kỹ Thuật | Phương Án Xử Lý | Người Xác Nhận |
|---|---|---|---|---|---|
| `EX-USR-01` | Tài khoản | User EO cũ đã nghỉ việc | Không có trên SSO/DO | Giữ tên trong `audit` cũ, không cấp tài khoản DO | Trưởng ban DA |
| `EX-FILE-01` | File đính kèm | File cũ bị lỗi định dạng | Kho file cũ hỏng | Ghi log `file_errors`, giữ link tải trực tiếp file gốc | Trưởng ban DA |
