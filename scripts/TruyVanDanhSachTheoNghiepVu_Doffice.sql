


								  select 
									  b.name as TenSoVB,
									  o1.name as DonViGui, 
									  o2.name as DonViNhan,
									  i.receive_date,
									  i.document_date,
									  i.to_book_code,
									  i.abstract_note,
									  i.private_level as DoMat,
									  i.document_type as LoaiVanBan,
									  i.urgency_level as DoKhan
									 -- i.* 
								  from incomming_documents i 
									  inner join book_documents b on i.book_document_id = b.book_document_id
									  inner join custom_sender_units o1 on i.sender_unit = o1.id
									  inner join organization_units o2 on i.receiver_unit = o2.id
								  where document_id = '4f213f43-4ce0-4b88-a04a-d74a40ba63e4'

								  select distinct(f.id), f.file_name from files f inner join file_relations fr on f.id = fr.file_id where fr.object_id = '4f213f43-4ce0-4b88-a04a-d74a40ba63e4'



			  select count(*) from incomming_documents where receiver_unit = '1775856482360718'

			  update incomming_documents set receiver_unit = 'a4c08562-50fa-5599-939c-eb6f2a83a362' where receiver_unit = '1775856482360718'
			  select * from custom_sender_units where id = '69362975018821f01f83cd2f'

			  select * from organization_units where 
			  --status = 1 and name like N'%Công nghệ%' 
			  id = '69362975018821f01f83cd2f'


			  select 
			  o.id_outgoing_bak,
			  u.name as NguoiTao, 
			  o.private_level,
			  o.urgency_level,
			  o.document_type,
			  --o1.name as NoiGui, 
			  o.* from outgoing_documents o
			  inner join users u on u.id = o.drafter
			 -- inner join custom_sender_units o1 on o.sender_unit = o1.id
			  where id_outgoing_bak = '70965'

			select distinct(f.id), f.file_name from files f inner join file_relations fr on f.id = fr.file_id where fr.object_id = '17746019260712331'




			  select * from audit where document_id = '52581aa2-ceef-430f-bd7d-ac8f567fbf42'

			  UPDATE dbo.audit
			SET receiver = NULL
				--updated_at = GETDATE()
			WHERE type_document IN ( 'IncomingDocument', 'IncommingDocument') and receiver IS NOT NULL 
			  AND created_by IS NOT NULL
			  AND LTRIM(RTRIM(receiver)) = LTRIM(RTRIM(created_by));
			  --update audit set receiver = NULL where id = 71593638

			  select * from users where name like N'%tonggiamdoc%' and status = 1

								  select 
									i.abstract_note as TrichYeu, a.*
								  from incomming_documents i
								  inner join audit a on i.document_id = a.document_id

								  where i.status = 1 and a.stage_status = 'CHUA_XU_LY' and a.receiver = '4f367e1d-d7de-4b85-b022-d2c06a196590' and a.roleProcess = 'viewer'


					SELECT DISTINCT d.document_id, d.abstract_note, d.view_group
					FROM dbo.incomming_documents d WITH (NOLOCK)
					WHERE d.status = 1
					  AND d.view_group IS NOT NULL
					  AND d.view_group <> ''
					  AND EXISTS (
						SELECT 1
						FROM STRING_SPLIT(d.view_group, ',') s
						INNER JOIN dbo.group_users gu_target WITH (NOLOCK)
						  ON gu_target.code = LTRIM(RTRIM(s.value))
						WHERE
						  EXISTS (
							SELECT 1
							FROM dbo.user_group_users ugu WITH (NOLOCK)
							WHERE ugu.group_user_id = gu_target.id
							  AND ugu.user_id = 'ea1c73eb-9462-48a0-8cd4-6da3521aeef7'
						  )
						  OR EXISTS (
							SELECT 1
							FROM dbo.user_group_users ugu_mgr WITH (NOLOCK)
							INNER JOIN dbo.group_users gu_mgr WITH (NOLOCK)
							  ON gu_mgr.id = ugu_mgr.group_user_id
							WHERE ugu_mgr.user_id = 'ea1c73eb-9462-48a0-8cd4-6da3521aeef7' )
							)			



			--Văn bản đi 
			SELECT 
				ocs.current_action_code AS status_code,
				ocs.current_stage_status AS stageStatus,
				outgoing_documents.abstract_note
			FROM dbo.outgoing_documents
			INNER JOIN dbo.outgoing_current_state ocs  ON ocs.document_id = outgoing_documents.document_id
			OUTER APPLY (
				SELECT TOP 1 oa_inner.document_id,  oa_inner.receiver, oa_inner.receiver_unit, oa_inner.stage_status, oa_inner.is_creator, oa_inner.last_audit_id FROM dbo.outgoing_assignment oa_inner
				WHERE oa_inner.document_id = outgoing_documents.document_id
				  AND (
					oa_inner.receiver = '4f367e1d-d7de-4b85-b022-d2c06a196590'
				  )
				ORDER BY
				  CASE
					WHEN oa_inner.stage_status IN (
					  'HT_VBTT', 'CHUA_XU_LY', 'CHO_KY_NOI_DUNG', 'CHO_KY_THE_THUC', 'CHO_KY_BAN_HANH', 'CHO_KY_NHAY', 'CHO_KY_CHINH_THUC', 'CHO_KY_CHINH_THUC_1', 'CHO_KY_CHINH_THUC_2', 'CHO_KY_CHINH_THUC_3',
					  'CHO_XAC_NHAN', 'CHO_THAM_DINH', 'CHO_KY_DONG_DAU', 'CHO_DONG_DAU', 'THU_HOI'
					) THEN 0							
					ELSE 1
				  END,
				  ISNULL(oa_inner.last_audit_id, 0) DESC,
				  oa_inner.updated_at DESC,
				  oa_inner.created_at DESC
			) oa
			-- 3. LẤY WORK ITEM DẠNG OPEN NẾU CÓ
			OUTER APPLY (
				SELECT TOP 1 
					wi_inner.id, 
					wi_inner.document_id, 
					wi_inner.assignee_user_id, 
					wi_inner.state
				FROM dbo.work_items wi_inner
				WHERE wi_inner.document_id = outgoing_documents.document_id
				  AND (
					wi_inner.assignee_user_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
				  )
				  AND wi_inner.state = 'open'
				ORDER BY wi_inner.created_at DESC
			) wi
			WHERE 
				(oa.last_audit_id = ocs.last_audit_id OR wi.id IS NOT NULL)
				AND (
				  oa.stage_status IN (
					'HT_VBTT', 'CHUA_XU_LY', 'CHO_KY_NOI_DUNG', 'CHO_KY_THE_THUC',
					'CHO_KY_BAN_HANH', 'CHO_KY_NHAY', 'CHO_KY_CHINH_THUC',
					'CHO_KY_CHINH_THUC_1', 'CHO_KY_CHINH_THUC_2', 'CHO_KY_CHINH_THUC_3',
					'CHO_XAC_NHAN', 'CHO_THAM_DINH', 'CHO_KY_DONG_DAU', 'CHO_DONG_DAU', 'THU_HOI'
				  )
				  OR (wi.id IS NOT NULL AND oa.document_id IS NULL)
				)
				AND (
				  (oa.document_id IS NOT NULL AND ISNULL(oa.is_creator, 0) = 0)
				  OR wi.id IS NOT NULL
				)
				AND outgoing_documents.status = 1

			ORDER BY outgoing_documents.updated_at DESC, outgoing_documents.document_id ASC
			OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY;



			-- Công việc
									SELECT 
										t.id,
										t.code,
										t.name,
										t.start_date,
										t.end_date,
										t.process_status,
										t.priority,
										t.type_task,
										t.created_at,
										t.update_at
									FROM dbo.task t
									WHERE 
										 (t.type_task = 'general' OR t.type_task IS NULL)
										AND EXISTS (
											SELECT 1
											FROM dbo.task_users tu_viewer
											WHERE tu_viewer.task_id = t.id
											  AND LOWER(tu_viewer.process_id) = LOWER('4f367e1d-d7de-4b85-b022-d2c06a196590')
										)



			-- Công việc từ văn bản 
			SELECT 
				task.id,
				task.code,
				task.name,
				task.start_date,
				task.end_date,
				task.process_status,
				task.priority,
				task.type_task,
				task.doc_id,
				task.created_by,
				task.created_at,
				task.update_at
			FROM dbo.task task
			WHERE 
				task.status = 1
				AND task.type_task = 'form_doc'
				AND (
					task.created_by ='4f367e1d-d7de-4b85-b022-d2c06a196590'
					OR EXISTS (
						SELECT 1 
						FROM dbo.task_users tu
						WHERE tu.task_id = task.id
						  AND tu.process_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
					)
				)


			-- Công việc từ cuộc họp

				SELECT 
					task.code,
					task.name,
					task.start_date,
					task.end_date,
					task.process_status,
					task.priority,
					task.type_task,
					task.meeting_id,
					task.meeting_conclusion_id,
					task.created_by,
					task.created_at,
					task.update_at
				FROM dbo.task task
				WHERE 
					task.status = 1
					AND task.type_task = 'form_meeting'
					AND (
						task.created_by = '4f367e1d-d7de-4b85-b022-d2c06a196590'
						OR EXISTS (
							SELECT 1 
							FROM dbo.task_users tu
							WHERE tu.task_id = task.id
							  AND tu.process_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
						)
					)

			-- Công việc lặp lại

			WITH AccessibleRecurringConfigs AS (
				SELECT 
					c.id, c.code, c.name, c.status, c.priority, c.repetitive_task, c.task_id, c.parent_id, c.created_by, c.created_at, c.updated_at
				FROM dbo.task_recurring_config c
				WHERE c.status <> 3
				  AND c.parent_id IS NULL
				  AND (
					c.created_by = '4f367e1d-d7de-4b85-b022-d2c06a196590'
					OR EXISTS (
						SELECT 1 FROM dbo.task_users tu WHERE tu.task_id = c.task_id  AND LOWER(tu.process_id) = LOWER('4f367e1d-d7de-4b85-b022-d2c06a196590')
					)
				  )
				UNION ALL
				SELECT 
					child.id, child.code, child.name, child.status, child.priority, child.repetitive_task, child.task_id, child.parent_id, child.created_by, child.created_at, child.updated_at
				FROM dbo.task_recurring_config child
				INNER JOIN AccessibleRecurringConfigs parent ON child.parent_id = parent.id
				WHERE child.status <> 3
			)
			SELECT DISTINCT  id, code, name,  status,  priority, repetitive_task, task_id, parent_id, created_by, created_at, updated_at
			FROM AccessibleRecurringConfigs
			ORDER BY created_at DESC, id DESC


			--Dự án

			SELECT 
				p.id,
				p.code,
				p.name,
				p.description,
				p.typeProject,
				p.projectStatus,
				p.priority,
				p.startDate,
				p.endDate,
				p.status,
				p.createdAt,
				p.updatedAt
			FROM dbo.projects p
			WHERE 
				-- 1. Chỉ lấy các dự án đang hoạt động (status = 1)
				p.status = 1
				-- 2. Lọc danh sách dự án mà User hiện tại tham gia (thành viên hoặc quản lý)
				AND EXISTS (
					SELECT 1 
					FROM dbo.project_members pm
					WHERE pm.project_id = p.id
					  AND pm.user_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
				)

			-- Lich hop cho phe duyet

			SELECT 
				meetings.id,
				meetings.title,
				meetings.started_at,
				meetings.ended_at,
				meetings.room_ids,
				meetings.stage_status,
				meetings.meeting_state,
				meetings.created_by,
				meetings.created_at,
				meetings.updated_at
			FROM dbo.meetings WITH (NOLOCK)
			WHERE 
				meetings.status = '1'
				AND (
					meetings.is_template = 0 
					OR meetings.is_template IS NULL 
					OR (meetings.stage_status != 'DONG_Y_PHE_DUYET' OR meetings.stage_status IS NULL) 
					OR NOT EXISTS (
						SELECT 1 
						FROM dbo.meetings child WITH (NOLOCK) 
						WHERE child.parent_id = meetings.id AND child.status = '1'
					)
				)
				AND meetings.meeting_state <> 'DA_HUY'
				AND meetings.stage_status IS NULL
				AND meetings.created_by = '4f367e1d-d7de-4b85-b022-d2c06a196590'



			--Ho chieu cho duyet yeu cau muon

			SELECT  r.request_code, r.type_request,  r.name_passport_request, r.passport_number, r.reason,  r.destination, r.borrow_date,  r.return_date, r.status, r.created_by
			FROM dbo.passport_borrow_requests r
			WHERE 
				r.is_deleted = 0 AND r.status = 'PENDING'
				AND (
					r.created_by = '4f367e1d-d7de-4b85-b022-d2c06a196590'
					OR r.requester_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
					OR r.name_passport_request ='4f367e1d-d7de-4b85-b022-d2c06a196590'
					OR EXISTS (
						SELECT 1 
						FROM dbo.passport_delegation_items pdi WITH (NOLOCK)
						WHERE pdi.request_id = r.id 
						  AND pdi.user_id ='4f367e1d-d7de-4b85-b022-d2c06a196590'
					)
					OR EXISTS (
						SELECT 1 
						FROM dbo.work_items wi WITH (NOLOCK)
						WHERE wi.document_id = CAST(r.id AS VARCHAR(64)) 
						  AND wi.state = 'open'
						  AND wi.assignee_user_id = '4f367e1d-d7de-4b85-b022-d2c06a196590'
					)
					OR EXISTS (
						SELECT 1 
						FROM dbo.audit a WITH (NOLOCK)
						WHERE a.document_id = CAST(r.id AS NVARCHAR(64))
						  AND a.type_document = 'PassportRequest'
						  AND (a.user_id ='4f367e1d-d7de-4b85-b022-d2c06a196590' OR a.receiver ='4f367e1d-d7de-4b85-b022-d2c06a196590')
					)
				)

			--Danh sach yeu cau muon dang su dung			


			SELECT 
				r.id,
				r.request_code,
				r.type_request,
				r.name_passport_request,
				r.passport_number,
				r.reason,
				r.destination,
				r.borrow_date,
				r.return_date,
				r.status,
				r.requester_id,
				r.created_by,
				r.created_at,
				r.updated_at
			FROM dbo.passport_borrow_requests r
			WHERE 
				-- 1. Trạng thái bản ghi chưa bị xóa (is_deleted = 0)
				r.is_deleted = 0
				-- 2. Trạng thái yêu cầu ở bước Đang sử dụng ('IN_USE')
				AND r.status = 'IN_USE'
				-- 3. Chỉ lấy bản ghi của chính tôi (do Tôi tạo HOẶC do Tôi đứng tên mượn)
				AND (r.requester_id = '6915f3aa7e39c2ba33cef98d' OR r.created_by = '6915f3aa7e39c2ba33cef98d')


			--Dang ky xe 

			SELECT 
				vehicle_registrations.id,
				vehicle_registrations.request_code,
				vehicle_registrations.rejection_reason,
				vehicle_registrations.destination,
				vehicle_registrations.vehicle_state,
				vehicle_registrations.status,
				vehicle_registrations.created_by,
				vehicle_registrations.created_at,
				vehicle_registrations.updated_at
				-- (Và các trường dữ liệu chi tiết theo buildFilterFieldsVehicleRegistrations)
			FROM dbo.vehicle_registrations
			WHERE 
				-- 1. Trạng thái bản ghi còn hoạt động (status = '1')
				vehicle_registrations.status = '1'
				-- 2. Lọc các yêu cầu do chính User hiện tại tạo ra
				AND vehicle_registrations.created_by = '6915f3aa7e39c2ba33cef98d'
				-- 3. Trạng thái chuyến xe đang trong tiến trình di chuyển (type = 'processing')
				AND vehicle_registrations.vehicle_state = 'TRONG_TIEN_TRINH'

