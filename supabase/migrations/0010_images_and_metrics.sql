-- Arte em imagem (TIFF, JPEG, PNG): o analisador converte em PDF sem reamostrar.
-- Limite de 50 MB por arquivo, o do plano gratuito da Supabase (acima disso o envio falha
-- de qualquer forma; com o limite no bucket, o erro é claro).
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/tiff', 'image/jpeg', 'image/png'],
       file_size_limit = 52428800
 where id in ('pdfs', 'project-files');

update storage.buckets
   set file_size_limit = 52428800
 where id = 'tiling';

-- Desempenho de cada análise (tempo por etapa, tamanhos, memória), vindo do analisador.
alter table public.analysis_jobs
  add column if not exists metrics jsonb not null default '{}'::jsonb;
