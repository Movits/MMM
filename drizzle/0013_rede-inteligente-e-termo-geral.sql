CREATE TABLE `assinaturas_de_minutos` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`plano_id` varchar(36) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'pendente',
	`inicio_em` bigint,
	`fim_em` bigint,
	`provedor` varchar(40),
	`referencia_externa` varchar(128),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `assinaturas_de_minutos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conexoes_participantes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`conexao_id` varchar(36) NOT NULL,
	`lado` varchar(1) NOT NULL,
	`tipo` varchar(12) NOT NULL,
	`owner_id` varchar(128),
	`userId` int,
	`contact_id` bigint,
	`codigo_anonimo` varchar(16),
	`originador` boolean NOT NULL DEFAULT false,
	`status_comissao_originador` varchar(16),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`descartada_em` bigint,
	`fechamento_confirmado_em` bigint,
	CONSTRAINT `conexoes_participantes_id` PRIMARY KEY(`id`),
	CONSTRAINT `conexoes_participantes_conexao_lado_unique` UNIQUE(`conexao_id`,`lado`)
);
--> statement-breakpoint
CREATE TABLE `conexoes_registradas` (
	`id` varchar(36) NOT NULL,
	`origem` varchar(32) NOT NULL,
	`chave_do_par` varchar(190) NOT NULL,
	`motivo` text NOT NULL,
	`itens` json NOT NULL,
	`pontuacao` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'identificada',
	`apresentacao_em` bigint,
	`negociacao_em` bigint,
	`fechamento_em` bigint,
	`descartada_em` bigint,
	`status_comissao` varchar(16) NOT NULL DEFAULT 'sem_negocio',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `conexoes_registradas_id` PRIMARY KEY(`id`),
	CONSTRAINT `conexoes_registradas_chave_unique` UNIQUE(`chave_do_par`)
);
--> statement-breakpoint
CREATE TABLE `consumo_de_minutos` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`origem` varchar(10) NOT NULL,
	`referencia` varchar(36) NOT NULL,
	`segundos` int NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `consumo_de_minutos_id` PRIMARY KEY(`id`),
	CONSTRAINT `consumo_de_minutos_referencia_unique` UNIQUE(`owner_id`,`origem`,`referencia`)
);
--> statement-breakpoint
CREATE TABLE `network_sugestoes` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint,
	`meeting_id` varchar(36),
	`meeting_suggestion_id` varchar(36),
	`origem` varchar(10) NOT NULL,
	`campo` varchar(12) NOT NULL,
	`valor` varchar(320) NOT NULL,
	`categoria` varchar(120),
	`trecho` text,
	`confianca` decimal(4,3) NOT NULL DEFAULT '0.000',
	`status` varchar(12) NOT NULL DEFAULT 'pendente',
	`decidida_em` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `network_sugestoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `planos_de_minutos` (
	`id` varchar(36) NOT NULL,
	`nome` varchar(80),
	`limite_por_reuniao_segundos` int,
	`limite_mensal_segundos` int,
	`minutos_adicionais` int,
	`preco_centavos` int,
	`moeda` varchar(3),
	`periodicidade` varchar(20),
	`ativo` boolean NOT NULL DEFAULT false,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `planos_de_minutos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `document_versions` MODIFY COLUMN `type` enum('termo_smart_match','acordo_intermediacao','contrato_comissao','termo_gravacao','termo_acesso_ouro','termo_geral_de_uso') NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` MODIFY COLUMN `companyCnpj` varchar(255);--> statement-breakpoint
ALTER TABLE `private_contacts` ADD `codigo_anonimo` varchar(16);--> statement-breakpoint
ALTER TABLE `private_contacts` ADD `disponivel_rede_global` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `private_contacts` ADD `disponibilidade_alterada_em` bigint;--> statement-breakpoint
ALTER TABLE `private_contacts` ADD `tipo_pessoa` varchar(10);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `whatINeedDetails` json;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `seekingOtherNeed` text;--> statement-breakpoint
ALTER TABLE `private_contacts` ADD CONSTRAINT `pc_codigo_anonimo_unique` UNIQUE(`codigo_anonimo`);--> statement-breakpoint
CREATE INDEX `assinaturas_de_minutos_user_status_idx` ON `assinaturas_de_minutos` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `conexoes_participantes_owner_idx` ON `conexoes_participantes` (`owner_id`);--> statement-breakpoint
CREATE INDEX `conexoes_participantes_user_idx` ON `conexoes_participantes` (`userId`);--> statement-breakpoint
CREATE INDEX `conexoes_participantes_contact_idx` ON `conexoes_participantes` (`contact_id`);--> statement-breakpoint
CREATE INDEX `conexoes_registradas_origem_idx` ON `conexoes_registradas` (`origem`,`created_at`);--> statement-breakpoint
CREATE INDEX `consumo_de_minutos_owner_created_idx` ON `consumo_de_minutos` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `nw_sug_owner_contact_idx` ON `network_sugestoes` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `nw_sug_owner_meeting_idx` ON `network_sugestoes` (`owner_id`,`meeting_id`);--> statement-breakpoint
CREATE INDEX `nw_sug_owner_meeting_suggestion_idx` ON `network_sugestoes` (`owner_id`,`meeting_suggestion_id`);--> statement-breakpoint
CREATE INDEX `pc_disponivel_rede_global_idx` ON `private_contacts` (`disponivel_rede_global`);