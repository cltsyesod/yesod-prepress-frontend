-- Raio-X do arquivo analisado (formato, caixas, sangria, imagens, cores, fontes, faca,
-- estrutura do PDF e o que a ficha pede), vindo do analisador. Guardado por análise, para
-- comparar o arquivo do cliente com a versão corrigida que vai para a produção.
alter table public.analysis_jobs
  add column if not exists file_profile jsonb not null default '{}'::jsonb;
