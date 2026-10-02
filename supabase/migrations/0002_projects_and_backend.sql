-- Migration 0002: Projects, Storage, RLS, RPCs e Realtime

-- 1. Buckets de Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values 
  ('project-files', 'project-files', false, 104857600, array['application/pdf']),
  ('pdfs', 'pdfs', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;

-- 2. Políticas de Storage
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'project-files read own' and tablename = 'objects') then
    create policy "project-files read own" on storage.objects for select to authenticated
      using (bucket_id in ('project-files', 'pdfs') and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'project-files upload own' and tablename = 'objects') then
    create policy "project-files upload own" on storage.objects for insert to authenticated
      with check (bucket_id in ('project-files', 'pdfs') and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'project-files update own' and tablename = 'objects') then
    create policy "project-files update own" on storage.objects for update to authenticated
      using (bucket_id in ('project-files', 'pdfs') and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'project-files delete own' and tablename = 'objects') then
    create policy "project-files delete own" on storage.objects for delete to authenticated
      using (bucket_id in ('project-files', 'pdfs') and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- 3. Políticas RLS para project_files, analysis_jobs e analysis_issues
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'project_files' and policyname = 'own_select') then
    create policy own_select on public.project_files for select using (user_id = auth.uid());
    create policy own_insert on public.project_files for insert with check (user_id = auth.uid());
    create policy own_update on public.project_files for update using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_delete on public.project_files for delete using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'analysis_jobs' and policyname = 'own_select') then
    create policy own_select on public.analysis_jobs for select using (user_id = auth.uid());
    create policy own_insert on public.analysis_jobs for insert with check (user_id = auth.uid());
    create policy own_update on public.analysis_jobs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_delete on public.analysis_jobs for delete using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'analysis_issues' and policyname = 'own_select') then
    create policy own_select on public.analysis_issues for select using (user_id = auth.uid());
    create policy own_insert on public.analysis_issues for insert with check (user_id = auth.uid());
    create policy own_update on public.analysis_issues for update using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_delete on public.analysis_issues for delete using (user_id = auth.uid());
  end if;
end $$;

-- 4. Funções RPC
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
       select 1 from storage.objects where bucket_id in ('project-files', 'pdfs') and name = rec.storage_path) then
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

-- 5. Tabela projects
create table if not exists public.projects (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                text not null,
  client_id           text not null default '',
  client_name         text not null default '',
  order_number        text not null default '',
  responsible_id      text not null default '',
  responsible_name    text not null default '',
  deadline            text not null default '',
  description         text not null default '',
  observations        text not null default '',
  tags                text[] not null default '{}',
  profile_id          text not null default '',
  production_profile  text not null default '',
  production_type     text not null default '',
  status              text not null default 'draft',
  severity            text not null default 'none',
  issue_count         int not null default 0,
  filename            text not null default '',
  file_type           text not null default 'PDF',
  file_size           bigint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_projects_user on public.projects (user_id);
create index if not exists idx_projects_status on public.projects (status);

create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated();

alter table public.projects enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'projects' and policyname = 'own_select') then
    create policy own_select on public.projects for select using (user_id = auth.uid());
    create policy own_insert on public.projects for insert with check (user_id = auth.uid());
    create policy own_update on public.projects for update using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_delete on public.projects for delete using (user_id = auth.uid());
  end if;
end $$;

-- 6. Realtime Publication
do $$
begin
  alter publication supabase_realtime add table public.project_files;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.analysis_jobs;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.analysis_issues;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.projects;
exception when others then null;
end $$;
