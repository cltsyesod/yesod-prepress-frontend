-- Funções antigas ainda conferiam "dono do arquivo" (user_id = auth.uid()): um colega
-- da mesma empresa não conseguia reanalisar, cancelar, tentar de novo ou trocar o arquivo
-- principal de um trabalho que não enviou. Agora valem as regras da empresa, como na RLS.
-- Também: search_path fixo e funções auxiliares fora do alcance de quem não está logado.

create or replace function public.start_analysis(p_file uuid, p_production_profile text, p_version text default null)
returns public.analysis_jobs
language plpgsql set search_path = public as $$
declare
  f   public.project_files;
  job public.analysis_jobs;
begin
  select * into f from public.project_files where id = p_file and public.is_member(org_id);
  if not found then raise exception 'Arquivo não encontrado'; end if;
  if upper(f.extension) <> 'PDF' then raise exception 'Apenas arquivos PDF podem ser analisados'; end if;
  if f.status <> 'ready_for_analysis' then
    raise exception 'O arquivo não está pronto para análise (status atual: %)', f.status;
  end if;
  if coalesce(p_production_profile, '') = '' then raise exception 'productionProfile.id é obrigatório'; end if;
  if exists (select 1 from public.analysis_jobs where file = p_file
             and status not in ('completed', 'completed_with_warnings', 'failed', 'cancelled')) then
    raise exception 'Já existe uma análise ativa para este arquivo';
  end if;

  insert into public.analysis_jobs (project, file, version, production_profile, status, org_id)
  values (f.project, p_file, coalesce(p_version, f.version, ''), p_production_profile, 'queued', f.org_id)
  returning * into job;
  return job;
end
$$;

create or replace function public.retry_analysis(p_id uuid)
returns public.analysis_jobs
language plpgsql set search_path = public as $$
declare job public.analysis_jobs;
begin
  select * into job from public.analysis_jobs where id = p_id and public.is_member(org_id);
  if not found then raise exception 'Análise não encontrada'; end if;
  if job.status <> 'failed' then
    raise exception 'Apenas análises com status "failed" podem ser retentadas (status atual: %)', job.status;
  end if;
  update public.analysis_jobs
    set status = 'queued', progress = 0, current_step = '', error_code = '', error_message = '',
        retry_count = retry_count + 1, completed_at = null, started_at = null
    where id = p_id returning * into job;
  return job;
end
$$;

create or replace function public.cancel_analysis(p_id uuid)
returns public.analysis_jobs
language plpgsql set search_path = public as $$
declare job public.analysis_jobs;
begin
  select * into job from public.analysis_jobs where id = p_id and public.is_member(org_id);
  if not found then raise exception 'Análise não encontrada'; end if;
  if job.status in ('completed', 'completed_with_warnings', 'failed', 'cancelled') then
    raise exception 'Apenas análises ativas podem ser canceladas (status atual: %)', job.status;
  end if;
  update public.analysis_jobs set status = 'cancelled', completed_at = now()
    where id = p_id returning * into job;
  return job;
end
$$;

create or replace function public.set_primary_project_file(p_id uuid)
returns public.project_files
language plpgsql set search_path = public as $$
declare rec public.project_files;
begin
  select * into rec from public.project_files where id = p_id and public.is_member(org_id);
  if not found then raise exception 'Arquivo não encontrado'; end if;
  update public.project_files set is_primary = false
    where project = rec.project and org_id = rec.org_id and status <> 'removed' and is_primary;
  update public.project_files set is_primary = true where id = p_id returning * into rec;
  return rec;
end
$$;

create or replace function public.confirm_project_file(p_id uuid)
returns public.project_files
language plpgsql security definer set search_path = public, storage as $$
declare rec public.project_files;
begin
  select * into rec from public.project_files where id = p_id and public.is_member(org_id);
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
end
$$;

-- Nome repetido conferido dentro da empresa (antes, por dono).
create or replace function public.register_project_file(
  p_project text, p_original_name text, p_extension text, p_mime_type text, p_size_bytes bigint,
  p_version text default ''
)
returns public.project_files
language plpgsql set search_path = public as $$
declare rec public.project_files;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  if coalesce(trim(p_project), '') = '' then raise exception 'project é obrigatório'; end if;
  if coalesce(trim(p_original_name), '') = '' then raise exception 'original_name é obrigatório'; end if;
  if upper(trim(coalesce(p_extension, ''))) <> 'PDF' then
    raise exception 'Este formato será disponibilizado em uma próxima fase. Para a análise real atual, envie um arquivo PDF.';
  end if;
  if coalesce(p_mime_type, '') not in ('', 'application/pdf') then
    raise exception 'Apenas arquivos PDF são aceitos';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then raise exception 'size_bytes deve ser positivo'; end if;
  if p_size_bytes > 104857600 then raise exception 'Arquivo muito grande (máx 100MB)'; end if;

  if exists (select 1 from public.project_files
             where project = trim(p_project) and original_name = trim(p_original_name)
               and public.is_member(org_id) and status <> 'removed') then
    raise exception 'Um arquivo com este nome já existe neste projeto';
  end if;

  insert into public.project_files (project, version, original_name, safe_name, extension, mime_type, size_bytes, status)
  values (trim(p_project), coalesce(p_version, ''), trim(p_original_name),
          regexp_replace(trim(p_original_name), '[^a-zA-Z0-9._-]', '_', 'g'),
          'PDF', 'application/pdf', p_size_bytes, 'pending')
  returning * into rec;
  return rec;
end
$$;

alter function public.set_updated() set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- Quem não está logado não chama nada; as auxiliares da RLS ficam só para logados, e as
-- internas (gatilho, empresa de outra conta) para ninguém de fora.
revoke execute on function public.current_org() from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_teammate_folder(text) from public, anon;
revoke execute on function public.org_storage_bytes() from public, anon;
revoke execute on function public.confirm_project_file(uuid) from public, anon;
revoke execute on function public.org_of_user(uuid) from public, anon, authenticated;
revoke execute on function public.fill_org_id() from public, anon, authenticated;
grant execute on function public.current_org() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_teammate_folder(text) to authenticated;
grant execute on function public.org_storage_bytes() to authenticated;
grant execute on function public.confirm_project_file(uuid) to authenticated;

-- RLS sem reavaliar auth.uid() a cada linha.
drop policy if exists org_owner_update on public.organizations;
create policy org_owner_update on public.organizations for update
  using (exists (
    select 1 from public.memberships m
    where m.org_id = organizations.id and m.user_id = (select auth.uid()) and m.role = 'owner' and m.active
  ));

-- Chaves estrangeiras sem índice (consultas e exclusões em cascata mais lentas).
create index if not exists analysis_callback_events_analysis_idx on public.analysis_callback_events (analysis);
create index if not exists analysis_issues_file_idx on public.analysis_issues (file);
create index if not exists material_offcuts_source_run_idx on public.material_offcuts (source_run);
create index if not exists tiling_projects_file_idx on public.tiling_projects (file_id);
create index if not exists tiling_projects_project_idx on public.tiling_projects (project_id);
