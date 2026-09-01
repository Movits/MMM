-- Semeia o catálogo fixo de tipos de contexto (etapa 5 — Organização por Contexto).
-- Sem estas linhas, um banco criado do zero nasce com a lista de tipos vazia:
-- a tela de contextos não tem o que filtrar e o formulário não tem o que escolher.
-- Os valores (ids, slugs, ícones e cores) espelham o banco recuperado do Manus,
-- para que todos os ambientes falem dos mesmos tipos. Cada INSERT é condicionado
-- ao slug não existir: rodar num banco que já tem o catálogo não duplica nada.
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d38df8-94f8-11f1-aafa-425d0a05a0d0','Congresso','congresso','building-2','#3B82F6',1,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'congresso');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d942e3-94f8-11f1-aafa-425d0a05a0d0','Missão Empresarial','missao-empresarial','briefcase','#F59E0B',2,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'missao-empresarial');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d94320-94f8-11f1-aafa-425d0a05a0d0','Evento Internacional','evento-internacional','globe','#8B5CF6',3,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'evento-internacional');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d94355-94f8-11f1-aafa-425d0a05a0d0','Jantar','jantar','utensils','#EC4899',4,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'jantar');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d9437e-94f8-11f1-aafa-425d0a05a0d0','Embaixada','embaixada','landmark','#0EA5E9',5,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'embaixada');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d943ac-94f8-11f1-aafa-425d0a05a0d0','Reunião Particular','reuniao-particular','users','#22C55E',6,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'reuniao-particular');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d943da-94f8-11f1-aafa-425d0a05a0d0','Feira Internacional','feira-internacional','store','#EF4444',7,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'feira-internacional');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d94408-94f8-11f1-aafa-425d0a05a0d0','CPHI','cphi','flask-conical','#6366F1',8,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'cphi');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d94433-94f8-11f1-aafa-425d0a05a0d0','Evento do MMM','evento-mmm','star','#F59E0B',9,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'evento-mmm');
--> statement-breakpoint
INSERT INTO `context_types` (`id`,`name`,`slug`,`icon_name`,`color_token`,`sort_order`,`is_active`,`created_at`,`updated_at`)
SELECT '79d94463-94f8-11f1-aafa-425d0a05a0d0','Associação Comercial','associacao-comercial','handshake','#14B8A6',10,1,1788264320461,1788264320461 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `context_types` WHERE `slug` = 'associacao-comercial');
