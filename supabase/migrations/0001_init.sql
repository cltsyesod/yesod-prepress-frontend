-- Yesod Prepress: schema inicial (substitui as collections/hooks do PocketBase)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.

create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function public.set_updated()
returns trigger language plpgsql as $$
begin
  new.updated = now();
  return new;
end $$;

-- ---------- project_files ----------
create table public.project_files (
  id            uuid primary key default gen_random_uuid(),
  project       text not null,
  version       text not null default '',
  original_name text not null,
  safe_name     text not null default '',
  extension     text not null,
  mime_type     text not null default 'application/pdf',
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  sha256        text not null default '',
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path  text not null default '',
  status        text not null default 'pending'
                check (status in ('pending','uploading','uploaded','validating','ready_for_analysis','failed','removed')),
  error         text not null default '',
  is_primary    boolean not null default false,
  created       timestamptz not null default now(),
  updated       timestamptz not null default now()
);
create index idx_project_files_project on public.project_files (project);
create index idx_project_files_status  on public.project_files (status);
create index idx_project_files_user    on public.project_files (user_id);
create trigger trg_project_files_updated before update on public.project_files
  for each row execute function public.set_updated();

-- ---------- analysis_jobs ----------
create table public.analysis_jobs (
  id                uuid primary key default gen_random_uuid(),
  project           text not null,
  file              uuid not null references public.project_files(id) on delete restrict,
  version           text not null default '',
  production_profile text not null default '',
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status            text not null default 'queued'
                    check (status in ('queued','preparing','downloading','validating','extracting','analyzing',
                                      'generating_preview','completed','completed_with_warnings','failed','cancelled')),
  progress          int not null default 0 check (progress between 0 and 100),
  current_step      text not null default '',
  external_job_id   text not null default '',
  started_at        timestamptz,
  completed_at      timestamptz,
  error_code        text not null default '',
  error_message     text not null default '',
  retry_count       int not null default 0,
  created           timestamptz not null default now(),
  updated           timestamptz not null default now()
);
create index idx_analysis_jobs_status  on public.analysis_jobs (status);
create index idx_analysis_jobs_file    on public.analysis_jobs (file);
create index idx_analysis_jobs_project on public.analysis_jobs (project);
create index idx_analysis_jobs_user    on public.analysis_jobs (user_id);
-- no máximo uma análise ativa por arquivo
create unique index uq_analysis_jobs_active_file on public.analysis_jobs (file)
  where status not in ('completed','completed_with_warnings','failed','cancelled');
create trigger trg_analysis_jobs_updated before update on public.analysis_jobs
  for each row execute function public.set_updated();

-- ---------- analysis_issues ----------
create table public.analysis_issues (
  id              uuid primary key default gen_random_uuid(),
  analysis        uuid not null references public.analysis_jobs(id) on delete cascade,
  project         text not null default '',
  file            uuid references public.project_files(id),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rule_code       text not null default '',
  title           text not null default '',
  category        text not null default '',
  severity        text not null default 'informational' check (severity in ('critical','warning','informational')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','ignored','corrected')),
  page            int not null default 0,
  object_id       text not null default '',
  coordinates     text not null default '',
  found_value     text not null default '',
  expected_value  text not null default '',
  description     text not null default '',
  recommendation  text not null default '',
  confidence      double precision not null default 0,
  source          text not null default 'external_analyzer',
  can_auto_correct boolean not null default false,
  decision_reason text not null default '',
  decision_user   uuid references auth.users(id),
  decision_at     timestamptz,
  created         timestamptz not null default now(),
  updated         timestamptz not null default now()
);
create index idx_analysis_issues_analysis on public.analysis_issues (analysis);
create index idx_analysis_issues_file     on public.analysis_issues (file);
create index idx_analysis_issues_project  on public.analysis_issues (project);
create index idx_analysis_issues_severity on public.analysis_issues (severity);
create index idx_analysis_issues_status   on public.analysis_issues (status);
create trigger trg_analysis_issues_updated before update on public.analysis_issues
  for each row execute function public.set_updated();

-- ---------- RLS: cada usuário só vê/edita o que é dele ----------
alter table public.project_files   enable row level security;
alter table public.analysis_jobs   enable row level security;
alter table public.analysis_issues enable row level security;

create policy own_select on public.project_files   for select using (user_id = auth.uid());
create policy own_insert on public.project_files   for insert with check (user_id = auth.uid());
create policy own_update on public.project_files   for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.project_files   for delete using (user_id = auth.uid());

create policy own_select on public.analysis_jobs   for select using (user_id = auth.uid());
create policy own_insert on public.analysis_jobs   for insert with check (user_id = auth.uid());
create policy own_update on public.analysis_jobs   for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.analysis_jobs   for delete using (user_id = auth.uid());

create policy own_select on public.analysis_issues for select using (user_id = auth.uid());
create policy own_insert on public.analysis_issues for insert with check (user_id = auth.uid());
create policy own_update on public.analysis_issues for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_delete on public.analysis_issues for delete using (user_id = auth.uid());

-- ---------- Storage (PDFs privados, pasta = id do usuário) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

create policy "project-files read own"   on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project-files upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project-files update own" on storage.objects for update to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project-files delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Funções (portam os /backend/v1/* do PocketBase) ----------
-- Todas rodam como o usuário chamador (RLS vale), exceto confirm_project_file que consulta storage.

create or replace function public.register_project_file(
  p_project text, p_original_name text, p_extension text,
  p_mime_type text, p_size_bytes bigint, p_version text default ''
) returns public.project_files
language plpgsql as $$
declare
  rec public.project_files;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  if coalesce(trim(p_project),'') = '' then raise exception 'project é obrigatório'; end if;
  if coalesce(trim(p_original_name),'') = '' then raise exception 'original_name é obrigatório'; end if;
  if upper(trim(coalesce(p_extension,''))) <> 'PDF' then
    raise exception 'Este formato será disponibilizado em uma próxima fase. Para a análise real atual, envie um arquivo PDF.';
  end if;
  if coalesce(p_mime_type,'') not in ('', 'application/pdf') then
    raise exception 'Apenas arquivos PDF são aceitos';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'size_bytes deve ser positivo'; end if;
  if p_size_bytes > 104857600 then raise exception 'Arquivo muito grande (máx 100MB)'; end if;

  if exists (select 1 from public.project_files
             where project = trim(p_project) and original_name = trim(p_original_name)
               and user_id = auth.uid() and status <> 'removed') then
    raise exception 'Um arquivo com este nome já existe neste projeto';
  end if;

  insert into public.project_files (project, version, original_name, safe_name, extension, mime_type, size_bytes, status)
  values (trim(p_project), coalesce(p_version,''), trim(p_original_name),
          regexp_replace(trim(p_original_name), '[^a-zA-Z0-9._-]', '_', 'g'),
          'PDF', 'application/pdf', p_size_bytes, 'pending')
  returning * into rec;
  return rec;
end $$;

create or replace function public.confirm_project_file(p_id uuid)
returns public.project_files
language plpgsql security definer set search_path = public, storage as $$
declare
  rec public.project_files;
begin
  select * into rec from public.project_files where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Arquivo não encontrado'; end if;

  if rec.storage_path = '' or not exists (
       select 1 from storage.objects where bucket_id = 'project-files' and name = rec.storage_path) then
    update public.project_files set status = 'failed', error = 'Arquivo não encontrado no armazenamento'
      where id = p_id returning * into rec;
    raise exception 'Arquivo não encontrado no armazenamento';
  end if;

  update public.project_files set status = 'ready_for_analysis', error = ''
    where id = p_id returning * into rec;
  return rec;
end $$;

create or replace function public.set_primary_project_file(p_id uuid)
returns public.project_files
language plpgsql as $$
declare
  rec public.project_files;
begin
  select * into rec from public.project_files where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Arquivo não encontrado'; end if;
  update public.project_files set is_primary = false
    where project = rec.project and user_id = auth.uid() and status <> 'removed' and is_primary;
  update public.project_files set is_primary = true where id = p_id returning * into rec;
  return rec;
end $$;

create or replace function public.start_analysis(
  p_file uuid, p_production_profile text, p_version text default null
) returns public.analysis_jobs
language plpgsql as $$
declare
  f   public.project_files;
  job public.analysis_jobs;
begin
  select * into f from public.project_files where id = p_file and user_id = auth.uid();
  if not found then raise exception 'Arquivo não encontrado'; end if;
  if upper(f.extension) <> 'PDF' then raise exception 'Apenas arquivos PDF podem ser analisados'; end if;
  if f.status <> 'ready_for_analysis' then
    raise exception 'O arquivo não está pronto para análise (status atual: %)', f.status;
  end if;
  if coalesce(p_production_profile,'') = '' then raise exception 'productionProfile.id é obrigatório'; end if;
  if exists (select 1 from public.analysis_jobs where file = p_file and user_id = auth.uid()
             and status not in ('completed','completed_with_warnings','failed','cancelled')) then
    raise exception 'Já existe uma análise ativa para este arquivo';
  end if;

  insert into public.analysis_jobs (project, file, version, production_profile, status)
  values (f.project, p_file, coalesce(p_version, f.version, ''), p_production_profile, 'queued')
  returning * into job;
  return job;
end $$;

create or replace function public.retry_analysis(p_id uuid)
returns public.analysis_jobs
language plpgsql as $$
declare job public.analysis_jobs;
begin
  select * into job from public.analysis_jobs where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Análise não encontrada'; end if;
  if job.status <> 'failed' then
    raise exception 'Apenas análises com status "failed" podem ser retentadas (status atual: %)', job.status;
  end if;
  update public.analysis_jobs
    set status = 'queued', progress = 0, current_step = '', error_code = '', error_message = '',
        retry_count = retry_count + 1, completed_at = null, started_at = null
    where id = p_id returning * into job;
  return job;
end $$;

create or replace function public.cancel_analysis(p_id uuid)
returns public.analysis_jobs
language plpgsql as $$
declare job public.analysis_jobs;
begin
  select * into job from public.analysis_jobs where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Análise não encontrada'; end if;
  if job.status in ('completed','completed_with_warnings','failed','cancelled') then
    raise exception 'Apenas análises ativas podem ser canceladas (status atual: %)', job.status;
  end if;
  update public.analysis_jobs set status = 'cancelled', completed_at = now()
    where id = p_id returning * into job;
  return job;
end $$;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.project_files, public.analysis_jobs, public.analysis_issues;
