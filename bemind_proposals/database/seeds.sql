-- BE MIND PROPOSALS — seeds iniciais
-- Executado após schema.sql. Idempotente (usa INSERT IGNORE onde há UNIQUE).

SET NAMES utf8mb4;

-- Categorias de serviço (ordem do wizard: MARKETING, DESIGN, WEB, COM. VISUAL, BE MIND CLOUD)
INSERT IGNORE INTO `service_categories` (`id`,`name`,`slug`,`sort_order`) VALUES
  (1, 'Marketing',            'marketing',   1),
  (2, 'Design',               'design',      2),
  (3, 'Web',                  'web',         3),
  (4, 'Comunicação Visual',   'com-visual',  4),
  (5, 'Be Mind Cloud',        'cloud',       5),
  (6, 'Branding',             'branding',    6);

-- Serviços iniciais (preços padrão editáveis por proposta)
INSERT IGNORE INTO `services`
  (`category_id`,`name`,`short_description`,`default_price`,`unit`,`recurrence`,`sort_order`,`active`)
VALUES
  (1, 'Gestão de Redes Sociais',        'Planejamento, criação e publicação mensal',        1500.00, 'mes',      'mensal', 1, 1),
  (1, 'Tráfego Pago',                   'Google Ads e Meta Ads com relatório mensal',        1200.00, 'mes',      'mensal', 2, 1),
  (1, 'Consultoria de Marketing',       'Diagnóstico + plano estratégico',                    800.00, 'projeto',  'unico',  3, 1),
  (1, 'Produção de Vídeo (mensal)',     'Roteiro, gravação e edição — 4 vídeos/mês',         1800.00, 'mes',      'mensal', 4, 1),
  (2, 'Identidade Visual',              'Logo, paleta, tipografia e manual de marca',        2500.00, 'projeto',  'unico',  1, 1),
  (2, 'Design de Peças Avulsas',        'Posts, banners, apresentações',                      150.00, 'unidade',  'unico',  2, 1),
  (2, 'Apresentação Comercial',         'Deck institucional (até 20 slides)',                1200.00, 'projeto',  'unico',  3, 1),
  (3, 'Site Institucional',             'Até 5 páginas responsivas',                         3500.00, 'projeto',  'unico',  1, 1),
  (3, 'Landing Page',                   'Página única otimizada para conversão',             1800.00, 'projeto',  'unico',  2, 1),
  (3, 'Loja Virtual',                   'E-commerce completo com integração de pagamento',   6500.00, 'projeto',  'unico',  3, 1),
  (3, 'Manutenção de Site',             'Atualizações, backup e suporte',                     280.00, 'mes',      'mensal', 4, 1),
  (4, 'Fachada e Sinalização',          'Projeto e produção (produção sob orçamento)',       1500.00, 'projeto',  'unico',  1, 1),
  (4, 'Materiais Impressos',            'Cartão, folder, cardápio (arte final)',              300.00, 'unidade',  'unico',  2, 1),
  (5, 'Hospedagem Básica',              'Plano inicial (piso R$ 150,00)',                     150.00, 'mes',      'mensal', 1, 1),
  (5, 'Hospedagem Profissional',        'Plano intermediário',                                280.00, 'mes',      'mensal', 2, 1),
  (5, 'Hospedagem Empresarial',         'Plano avançado',                                     480.00, 'mes',      'mensal', 3, 1),
  (6, 'Branding — Marca do Zero',       'Pesquisa, naming, identidade e aplicações',         5500.00, 'projeto',  'unico',  1, 1),
  (6, 'Rebranding',                     'Reposicionamento e atualização de marca',           3800.00, 'projeto',  'unico',  2, 1);

-- Planos Cloud (BE MIND CLOUD)
INSERT IGNORE INTO `cloud_plans`
  (`id`,`name`,`monthly_price`,`annual_price`,`min_price`,`disk`,`traffic`,`sites`,`mailboxes`,`databases`,`ssl`,`backup`,`support`,`migration`,`notes`,`active`,`sort_order`)
VALUES
  (1, 'Básico',          150.00, 1620.00, 150.00, '10 GB SSD',  'Ilimitado', '1 site',     '5 contas',       '2',          'Sim', 'Semanal',   'E-mail',                'Sob orçamento', 'Piso configurado (editável).', 1, 1),
  (2, 'Profissional',    280.00, 3024.00, 150.00, '30 GB SSD',  'Ilimitado', '5 sites',    '20 contas',      '10',         'Sim', 'Diário',    'E-mail e WhatsApp',     'Grátis',        'Ideal para PMEs.',              1, 2),
  (3, 'Empresarial',     480.00, 5184.00, 150.00, '100 GB SSD', 'Ilimitado', 'Ilimitado',  '50 contas',      'Ilimitado',  'Sim', 'Diário +off','Prioritário',           'Grátis',        'Alta disponibilidade.',         1, 3),
  (4, 'Personalizado',     0.00,    0.00, 150.00, 'Sob medida', 'Sob medida','Sob medida', 'Sob medida',     'Sob medida', 'Sim', 'Sob medida','Sob medida',            'Sob medida',    'Valor definido na proposta.',   1, 4);

-- 12 perguntas do briefing (4 seções × 3 perguntas)
-- section: empresa | publico | objetivos | projeto
-- type: text | textarea | single | multi
INSERT IGNORE INTO `briefing_questions`
  (`id`,`section`,`label`,`hint`,`type`,`options`,`required`,`sort_order`)
VALUES
  (1,  'empresa',   'Nome da empresa e responsável',                       NULL, 'text',     NULL, 1, 1),
  (2,  'empresa',   'Segmento',                                            NULL, 'single',   JSON_ARRAY('Saúde e estética','Alimentação','Varejo','Serviços','Indústria'), 1, 2),
  (3,  'empresa',   'O que a empresa faz, em uma frase?',                  'Escreva do seu jeito, sem formalidade.', 'textarea', NULL, 1, 3),

  (4,  'publico',   'Como é o seu cliente ideal?',                         NULL, 'textarea', NULL, 1, 1),
  (5,  'publico',   'Faixa de idade',                                      NULL, 'single',   JSON_ARRAY('18–24','25–44','45–60','60+'), 1, 2),
  (6,  'publico',   'Canais atuais',                                       NULL, 'multi',    JSON_ARRAY('Instagram','Facebook','Google','TikTok','WhatsApp','Nenhum'), 1, 3),

  (7,  'objetivos', 'O que quer alcançar?',                                NULL, 'multi',    JSON_ARRAY('Vender mais','Ganhar seguidores','Reposicionar a marca','Lançar um produto','Ser encontrado no Google'), 1, 1),
  (8,  'objetivos', 'O que já tentaram?',                                  NULL, 'textarea', NULL, 0, 2),
  (9,  'objetivos', 'Concorrentes de referência',                          NULL, 'textarea', NULL, 0, 3),

  (10, 'projeto',   'Serviços de interesse',                               NULL, 'multi',    JSON_ARRAY('Redes sociais','Vídeo','Identidade visual','Site','Tráfego pago','Hospedagem'), 1, 1),
  (11, 'projeto',   'Investimento previsto por mês',                       'Serve para calibrar o escopo, não é compromisso.', 'single', JSON_ARRAY('até 1.500','1.500–3.000','3.000–6.000','acima de 6.000'), 1, 2),
  (12, 'projeto',   'Quando pretende começar?',                            NULL, 'single',   JSON_ARRAY('Imediato','15 dias','Próximo mês','Ainda avaliando'), 1, 3);

-- Configuração inicial da empresa (singleton). O installer preenche os campos definitivos.
INSERT IGNORE INTO `company_settings`
  (`id`,`name`,`proposal_prefix`,`default_validity_days`,`show_pix_in_proposals`,`auto_save_enabled`,`dark_mode`)
VALUES
  (1, 'Be Mind Marketing', 'BEMIND-', 15, 1, 1, 0);
