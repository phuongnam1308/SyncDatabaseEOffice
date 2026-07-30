-- =========================================================================================
-- SCRIPT TRUY VẤN VÀ XUẤT DANH SÁCH USER TRÙNG NHIỀU ACTIVE USER (ĐÃ BỎ QUA ĐỂ XỬ LÝ RIÊNG)
-- =========================================================================================

WITH ActiveUsersExtracted AS (
    SELECT 
        id AS active_id,
        name AS active_name,
        username AS active_username,
        email_user AS active_email,
        code_nd AS active_code_nd,
        LTRIM(RTRIM(
            CASE 
                WHEN CHARINDEX(' - ', name) > 0 THEN LEFT(name, CHARINDEX(' - ', name) - 1)
                WHEN CHARINDEX(' -', name) > 0 THEN LEFT(name, CHARINDEX(' -', name) - 1)
                WHEN CHARINDEX('-', name) > 0 THEN LEFT(name, CHARINDEX('-', name) - 1)
                WHEN CHARINDEX(' (', name) > 0 THEN LEFT(name, CHARINDEX(' (', name) - 1)
                ELSE name
            END
        )) AS base_name
    FROM dbo.users
    WHERE status = 1 AND name IS NOT NULL AND LTRIM(RTRIM(name)) <> ''
),
JunkUsersExtracted AS (
    SELECT 
        id AS junk_id,
        name AS junk_name,
        username AS junk_username,
        email_user AS junk_email,
        code_nd AS junk_code_nd,
        LTRIM(RTRIM(
            CASE 
                WHEN CHARINDEX(' - ', name) > 0 THEN LEFT(name, CHARINDEX(' - ', name) - 1)
                WHEN CHARINDEX(' -', name) > 0 THEN LEFT(name, CHARINDEX(' -', name) - 1)
                WHEN CHARINDEX('-', name) > 0 THEN LEFT(name, CHARINDEX('-', name) - 1)
                WHEN CHARINDEX(' (', name) > 0 THEN LEFT(name, CHARINDEX(' (', name) - 1)
                ELSE name
            END
        )) AS base_name
    FROM dbo.users
    WHERE status = 99 AND name IS NOT NULL AND LTRIM(RTRIM(name)) <> ''
),
Candidates AS (
    SELECT 
        j.junk_id,
        j.junk_name,
        j.junk_username,
        j.junk_email,
        a.active_id,
        a.active_name,
        a.active_username,
        a.active_email,
        CASE 
            WHEN j.junk_email IS NOT NULL AND LTRIM(RTRIM(j.junk_email)) <> '' AND LOWER(j.junk_email) = LOWER(a.active_email) THEN 1
            WHEN j.junk_code_nd IS NOT NULL AND LTRIM(RTRIM(j.junk_code_nd)) <> '' AND LOWER(j.junk_code_nd) = LOWER(a.active_code_nd) THEN 2
            WHEN j.junk_username IS NOT NULL AND LTRIM(RTRIM(j.junk_username)) <> '' AND LOWER(j.junk_username) = LOWER(a.active_username) THEN 3
            ELSE 10
        END AS match_priority,
        COUNT(*) OVER (PARTITION BY j.junk_id) as total_base_matches
    FROM JunkUsersExtracted j
    INNER JOIN ActiveUsersExtracted a ON LOWER(j.base_name) = LOWER(a.base_name)
)
SELECT 
    junk_id,
    junk_name,
    junk_username,
    active_id,
    active_name,
    active_username,
    active_email,
    total_base_matches AS so_luong_active_user_trung
FROM Candidates
WHERE match_priority = 10 AND total_base_matches > 1
ORDER BY junk_name, active_name;
