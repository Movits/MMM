CREATE INDEX `cc_owner_context_idx` ON `contact_contexts` (`owner_id`,`context_id`);--> statement-breakpoint
CREATE INDEX `cc_owner_contact_idx` ON `contact_contexts` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `cmedia_owner_context_idx` ON `context_media` (`owner_id`,`context_id`);--> statement-breakpoint
CREATE INDEX `cpart_owner_context_idx` ON `context_participants` (`owner_id`,`context_id`);--> statement-breakpoint
CREATE INDEX `ctx_owner_idx` ON `contexts` (`owner_id`);--> statement-breakpoint
CREATE INDEX `enr_msg_owner_session_idx` ON `enrichment_messages` (`owner_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `enr_sess_owner_contact_idx` ON `enrichment_sessions` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `enr_sug_owner_contact_idx` ON `enrichment_suggestions` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `enr_sug_owner_session_status_idx` ON `enrichment_suggestions` (`owner_id`,`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `sivc_doc_user_idx` ON `sivc_documents` (`userId`);