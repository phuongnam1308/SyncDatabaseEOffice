			SELECT 
			CoQuanGui2,
			DonVi
			SoDen,
			Files,						
			TrichYeu,
			DoKhan, 
			DoMat, 
			LoaiVanBan, 
			SoVanBan,
			NgayDen,					
			NgayTrenVB
			Created, 
			CreatedBy  
			FROM [DataEOfficeSNP].[dbo].[VanBanDen] where ID = 412734

			--data field Files
			/record/FilesDen2025/7515300720250825403731.pdf
			/record/FilesDen2025/7515Ke hoach DVCTT 670 2025300720250825403731.pdf|7515-Ke hoach DVCTT 670 2025|
			/record/FilesDen2025/7515 KH 1565300720250825403731.pdf|7515- KH 1565|
			/record/FilesDen2025/7515 QD 1565300720250825403731.pdf|7515- QD 1565|

	SELECT *
	FROM dbo.[LuanChuyenVanBan]
	WHERE VBId = 412734
	  AND Category IN (N'Văn bản đến TCT', N'Văn bản đến')
	ORDER BY
	  COALESCE(
		TRY_CONVERT(datetime, NgayTao, 120),
		TRY_CONVERT(datetime, NgayTao, 121),
		TRY_CONVERT(datetime, NgayTao, 103),
		TRY_CONVERT(datetime, NgayTao, 105),
		TRY_CONVERT(datetime, NgayTao),
		GETDATE()
	  ) ASC,
	  ID ASC;

					Select 
						l.*, v.TrichYeu 
					from LuanChuyenVanBan_VP l 
					INNER JOIN VanBanDen v ON l.VBId = v.ID 
					WHERE 
						NguoiXuLy LIKE N'Vũ Việt Hải%'



								Select 
									l.*
									, v.TrichYeu 
								from LuanChuyenVanBan_VP l 
								INNER JOIN VanBanBanHanh v ON l.VBId = v.ID 
								WHERE 
									Category = N'Văn bản đi' OR Category = N'Phát hành văn bản ĐV' 
									AND NguoiXuLy LIKE N'%Hà Thị Hiền - VP%'
								ORDER BY VBId DESC

								Select 
									l.*
									, v.TrichYeu 
								from LuanChuyenVanBan l 
								INNER JOIN VanBanBanHanh v ON l.VBId = v.ID 
								WHERE 
									Category = N'Văn bản đi' OR Category = N'Phát hành văn bản ĐV' OR Category = N'Văn bản trình ký'
									AND NguoiXuLy LIKE N'%Hà Thị Hiền - VP%'
								ORDER BY VBId DESC

						select distinct(Category) from LuanChuyenVanBan

			SELECT 
				ci.ID AS CodeItemID, ci.Subject AS TrichYeu,
				s.Step AS BuocXuLy, s.StartDate AS NgayBatDau, s.CompletedDate AS NgayHoanThanh,
				pUser.FullName AS TenNguoiXuLy, pCreated.FullName AS TenNguoiTao, pModified.FullName AS TenNguoiCapNhat,
				CASE 
					WHEN s.CompletedDate IS NOT NULL THEN N'Đã xử lý'
					ELSE N'Đang xử lý'
				END AS TrangThaiBuoc

			FROM [SNP].[CodeItem] ci
			INNER JOIN (
				SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy, StartDate, CompletedDate, UsedSLAMinutes, ActualSLAMinutes, Modified
				FROM [SNP].[SLAStepDetail]
				UNION ALL
				SELECT ItemID, Step, UserID, CreatedBy, ModifiedBy, StartDate, CompletedDate, UsedSLAMinutes, ActualSLAMinutes, Modified
				FROM [SNP].[SLAStepDetail_History]
			) s ON ci.ID = s.ItemID
			LEFT JOIN [dbo].[PersonalProfile] pUser ON s.UserID = pUser.ID
			LEFT JOIN [dbo].[PersonalProfile] pCreated ON s.CreatedBy = pCreated.ID
			LEFT JOIN [dbo].[PersonalProfile] pModified ON s.ModifiedBy = pModified.ID
			WHERE s.UserID = '1C6262AA-11BD-43DC-89DA-A96E8B84A68C' 
--ci.ID = 202896

ORDER BY 
    ci.ID DESC,
    s.Step ASC,
    s.StartDate ASC;

select 
	v.ID, 
	p.FullName as NguoiTao, 
	v.DoKhan, 
	v.DoMat, 
	v.LoaiVanBan, 
	v.NgayBanHanh,
	v.SoVanBan, 
	v.TrichYeu,
	v.Files,
	v.* 
from VanBanBanHanh v 
	inner join PersonalProfile p on v.CreatedBy = p.ID
where v.ID = 70965

--/record/FilesDi2026/5d7f81cf-bfda-49b2-a069-486e20e6d998.pdf|1. 26 CLL (TL đính kèm)|Tài liệu đính kèm;#
--/record/FilesDi2026/06aa128b-8b0a-4824-8c3b-6942cefbbfbe.pdf|1.1 BCTC HN 2025 (TL đính kèm)|Tài liệu đính kèm;#
--/record/FilesDi2026/a8f6fa0c-bcfd-4f72-92f0-978d461a63d4.xlsx|1.0 KHKD 2026 - chi tiet khoan muc (TL đính kèm)|Tài liệu đính kèm;#
--/record/FilesDi2026/5aeab66a-a87c-41e3-a8ae-bd367fb9c926.pdf|1.2 BCTC cty me 2025 (TL đính kèm)|Tài liệu đính kèm;#
--/record/FilesDi2026/171544a8-4fe6-4bd7-94c6-41717deaf59c.pdf|Phiếu lấy ý kiến các CQĐV về nội dung PYK của CLL ĐHĐCĐ (Vb trình duyệt)_Approved|Văn bản để phê duyệt;#
--/record/FilesDi2026/6a8e7d0a9c514b428139ea474864267b.pdf|Phiếu lấy ý kiến các CQĐV về nội dung PYK của CLL ĐHĐCĐ (Vb trình duyệt)_Print|Print

SELECT t.Title, t.VBId as ID_VB, t.StartDate, t.TrangThai, t.CreatedBy, v.TrichYeu
from TaskVBDen t
INNER JOIN VanBanDen v ON t.VBId = v.ID
