-- app_tancang.dbo.outgoing_assignment definition

-- Drop table

-- DROP TABLE app_tancang.dbo.outgoing_assignment;

CREATE TABLE app_tancang.dbo.outgoing_assignment (
	document_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	receiver nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	role_process nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	stage_status nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	deadline datetime2(3) NULL,
	created_at datetime2(3) NOT NULL,
	last_audit_id bigint NULL,
	updated_at datetime2(3) DEFAULT sysdatetime() NOT NULL,
	receiver_unit nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	is_creator bit DEFAULT 0 NOT NULL,
	CONSTRAINT PK_outgoing_assignment PRIMARY KEY (document_id,receiver,role_process),
	CONSTRAINT FK_outgoing_assignment_doc FOREIGN KEY (document_id) REFERENCES app_tancang.dbo.outgoing_documents(document_id)
);
 CREATE NONCLUSTERED INDEX IX_outgoing_assignment_creator ON app_tancang.dbo.outgoing_assignment (  is_creator ASC  , receiver ASC  , stage_status ASC  )  
	 INCLUDE ( document_id , receiver_unit , role_process ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_assignment_doc ON app_tancang.dbo.outgoing_assignment (  document_id ASC  , created_at DESC  )  
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_assignment_lookup ON app_tancang.dbo.outgoing_assignment (  receiver ASC  , role_process ASC  , stage_status ASC  , created_at DESC  )  
	 INCLUDE ( deadline , document_id , last_audit_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_assignment_receiver_unit ON app_tancang.dbo.outgoing_assignment (  receiver_unit ASC  , role_process ASC  , stage_status ASC  )  
	 INCLUDE ( deadline , document_id , is_creator , last_audit_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_assignment_stage ON app_tancang.dbo.outgoing_assignment (  stage_status ASC  , role_process ASC  , receiver ASC  )  
	 INCLUDE ( created_at , deadline , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;

-- app_tancang.dbo.outgoing_current_state definition

-- Drop table

-- DROP TABLE app_tancang.dbo.outgoing_current_state;

CREATE TABLE app_tancang.dbo.outgoing_current_state (
	document_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	current_stage_status nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	current_action_code nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_receiver nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_role_process nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_deadline datetime2(3) NULL,
	last_audit_id bigint NULL,
	last_audit_time datetime2(3) NULL,
	is_transfer_to_room bit DEFAULT 0 NOT NULL,
	has_open_workitem bit DEFAULT 0 NOT NULL,
	is_completed_doc bit DEFAULT 0 NOT NULL,
	updated_at datetime2(3) DEFAULT sysdatetime() NOT NULL,
	has_ban_hanh bit DEFAULT 0 NOT NULL,
	has_ht_vbtt bit DEFAULT 0 NOT NULL,
	has_da_xu_ly bit DEFAULT 0 NOT NULL,
	last_da_xu_ly_audit_id bigint NULL,
	has_tra_lai_after_da_xu_ly bit DEFAULT 0 NOT NULL,
	CONSTRAINT PK_outgoing_current_state PRIMARY KEY (document_id),
	CONSTRAINT FK_outgoing_current_state_doc FOREIGN KEY (document_id) REFERENCES app_tancang.dbo.outgoing_documents(document_id)
);
 CREATE NONCLUSTERED INDEX IX_outgoing_current_state_action ON app_tancang.dbo.outgoing_current_state (  current_action_code ASC  )  
	 INCLUDE ( current_deadline , current_stage_status , document_id , is_completed_doc , last_audit_time ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_current_state_ban_hanh ON app_tancang.dbo.outgoing_current_state (  has_ban_hanh ASC  , is_completed_doc ASC  )  
	 INCLUDE ( current_action_code , current_stage_status , document_id , last_audit_time ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_current_state_ht_vbtt ON app_tancang.dbo.outgoing_current_state (  has_ht_vbtt ASC  , current_stage_status ASC  )  
	 INCLUDE ( current_action_code , document_id , has_ban_hanh , last_audit_time ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_current_state_lookup ON app_tancang.dbo.outgoing_current_state (  current_stage_status ASC  , current_role_process ASC  , current_receiver ASC  , last_audit_time DESC  )  
	 INCLUDE ( current_deadline , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_outgoing_current_state_time ON app_tancang.dbo.outgoing_current_state (  last_audit_time DESC  )  
	 INCLUDE ( current_stage_status , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;

-- app_tancang.dbo.audit definition

-- Drop table

-- DROP TABLE app_tancang.dbo.audit;

CREATE TABLE app_tancang.dbo.audit (
	id bigint IDENTITY(1,1) NOT NULL,
	document_id nvarchar(64) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	[time] datetime DEFAULT getdate() NULL,
	user_id nvarchar(64) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	display_name nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	[role] nvarchar(64) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	action_code nvarchar(64) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	from_node_id nvarchar(128) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	to_node_id nvarchar(128) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	details nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	origin_id nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	created_by nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	receiver nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	receiver_unit nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	group_ nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	roleProcess nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	[action] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	deadline datetime NULL,
	stage_status nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	curStatusCode nvarchar(64) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	created_at datetime DEFAULT getdate() NULL,
	updated_at datetime DEFAULT getdate() NULL,
	type_document varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	processed_by varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	acting_as varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	table_backups nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	CONSTRAINT PK__audit__3213E83F1D06EBF8 PRIMARY KEY (id)
);
 CREATE NONCLUSTERED INDEX IX_audit_action_code ON app_tancang.dbo.audit (  action_code ASC  )  
	 INCLUDE ( created_at , document_id , type_document ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_action ON app_tancang.dbo.audit (  document_id ASC  , action_code ASC  , id DESC  )  
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_id_desc ON app_tancang.dbo.audit (  document_id ASC  , id DESC  )  
	 INCLUDE ( action_code , created_by , deadline , receiver , receiver_unit , stage_status , time , user_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_receiverunit_id_desc ON app_tancang.dbo.audit (  document_id ASC  , receiver_unit ASC  , id DESC  )  
	 INCLUDE ( action_code , created_at , deadline , receiver , roleProcess , stage_status ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_role_receiver_id_desc ON app_tancang.dbo.audit (  document_id ASC  , roleProcess ASC  , receiver ASC  , id DESC  )  
	 INCLUDE ( action_code , created_at , deadline , processed_by , receiver_unit , stage_status ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_stage ON app_tancang.dbo.audit (  document_id ASC  , stage_status ASC  , id DESC  )  
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_stage_id_desc ON app_tancang.dbo.audit (  document_id ASC  , stage_status ASC  , id DESC  )  
	 INCLUDE ( created_at , created_by , processed_by , receiver , receiver_unit , roleProcess , user_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_doc_time_created_getdetails ON app_tancang.dbo.audit (  document_id ASC  , time ASC  , created_at ASC  )  
	 INCLUDE ( action , action_code , created_by , display_name , from_node_id , receiver , role , roleProcess , stage_status , to_node_id , type_document , updated_at , user_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_latest ON app_tancang.dbo.audit (  document_id ASC  , type_document ASC  , id DESC  )  
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_pick_receive ON app_tancang.dbo.audit (  document_id ASC  , receiver ASC  , receiver_unit ASC  , id DESC  )  
	 INCLUDE ( action_code , roleProcess , stage_status ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_receiver ON app_tancang.dbo.audit (  receiver ASC  , document_id ASC  , id DESC  )  
	 INCLUDE ( stage_status ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_receiver_doc_id_desc ON app_tancang.dbo.audit (  receiver ASC  , document_id ASC  , id DESC  )  
	 INCLUDE ( action_code , created_by , processed_by , receiver_unit , roleProcess , stage_status , user_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_receiver_unit ON app_tancang.dbo.audit (  receiver_unit ASC  , document_id ASC  , id DESC  )  
	 INCLUDE ( stage_status ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_audit_submited_processed ON app_tancang.dbo.audit (  document_id ASC  , processed_by ASC  , id DESC  )  
	 INCLUDE ( action_code , deadline , receiver , receiver_unit , roleProcess ) 
	 WHERE  ([stage_status]='DA_XU_LY')
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX idx_audit_doc_stage_role ON app_tancang.dbo.audit (  document_id ASC  , stage_status ASC  , roleProcess ASC  , receiver ASC  )  
	 INCLUDE ( action_code , details ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;


-- app_tancang.dbo.incomming_current_state definition

-- Drop table

-- DROP TABLE app_tancang.dbo.incomming_current_state;

CREATE TABLE app_tancang.dbo.incomming_current_state (
	document_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	current_stage_status nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	current_action_code nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_receiver nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_role_process nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
	current_deadline datetime2(3) NULL,
	last_audit_id bigint NULL,
	last_audit_time datetime2(3) NULL,
	is_transfer_to_room bit DEFAULT 0 NOT NULL,
	has_open_workitem bit DEFAULT 0 NOT NULL,
	is_completed_doc bit DEFAULT 0 NOT NULL,
	updated_at datetime2(3) DEFAULT sysdatetime() NOT NULL,
	CONSTRAINT PK_incoming_current_state PRIMARY KEY (document_id),
	CONSTRAINT FK_incomming_current_state_doc FOREIGN KEY (document_id) REFERENCES app_tancang.dbo.incomming_documents(document_id)
);
 CREATE NONCLUSTERED INDEX IX_incomming_current_state_action ON app_tancang.dbo.incomming_current_state (  current_action_code ASC  )  
	 INCLUDE ( current_deadline , current_stage_status , document_id , is_completed_doc , last_audit_time ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_incomming_current_state_lookup ON app_tancang.dbo.incomming_current_state (  current_stage_status ASC  , current_role_process ASC  , current_receiver ASC  , last_audit_time DESC  )  
	 INCLUDE ( current_deadline , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_incomming_current_state_time ON app_tancang.dbo.incomming_current_state (  last_audit_time DESC  )  
	 INCLUDE ( current_stage_status , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;


-- app_tancang.dbo.incomming_assignment definition

-- Drop table

-- DROP TABLE app_tancang.dbo.incomming_assignment;

CREATE TABLE app_tancang.dbo.incomming_assignment (
	document_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	receiver nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	role_process nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	stage_status nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
	deadline datetime2(3) NULL,
	created_at datetime2(3) NOT NULL,
	last_audit_id bigint NULL,
	updated_at datetime2(3) DEFAULT sysdatetime() NOT NULL,
	CONSTRAINT PK_incomming_assignment PRIMARY KEY (document_id,receiver,role_process),
	CONSTRAINT FK_incomming_assignment_doc FOREIGN KEY (document_id) REFERENCES app_tancang.dbo.incomming_documents(document_id)
);
 CREATE NONCLUSTERED INDEX IX_incomming_assignment_doc ON app_tancang.dbo.incomming_assignment (  document_id ASC  , created_at DESC  )  
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_incomming_assignment_lookup ON app_tancang.dbo.incomming_assignment (  receiver ASC  , role_process ASC  , stage_status ASC  , created_at DESC  )  
	 INCLUDE ( deadline , document_id , last_audit_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;
 CREATE NONCLUSTERED INDEX IX_incomming_assignment_stage ON app_tancang.dbo.incomming_assignment (  stage_status ASC  , role_process ASC  , receiver ASC  )  
	 INCLUDE ( created_at , deadline , document_id ) 
	 WITH (  PAD_INDEX = OFF ,FILLFACTOR = 100  ,SORT_IN_TEMPDB = OFF , IGNORE_DUP_KEY = OFF , STATISTICS_NORECOMPUTE = OFF , ONLINE = OFF , ALLOW_ROW_LOCKS = ON , ALLOW_PAGE_LOCKS = ON  )
	 ON [PRIMARY ] ;