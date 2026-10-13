-- Situação de cada trabalho e números do painel, calculados no banco a partir da última
-- análise (não dependem de alguém ter aberto a tela do trabalho). security_invoker: a
-- visão e as funções respeitam a RLS, cada empresa vê só os seus números.

create or replace view public.job_overview with (security_invoker = true) as
select
  p.id,
  p.org_id,
  p.name,
  p.client_name,
  p.status,
  p.created_at,
  p.updated_at,
  p.due_date,
  p.priority,
  p.assignee_id,
  p.user_id as created_by,
  p.sent_to_rip_at,
  p.sent_to_rip_by,
  a.id as analysis_id,
  a.status as analysis_status,
  a.created as analysis_created,
  a.completed_at as analysis_completed_at,
  coalesce(i.critical, 0) as pending_critical,
  coalesce(i.warning, 0) as pending_warning,
  coalesce(i.returned, 0) as returned,
  greatest(p.updated_at, a.created, a.completed_at, i.last_decision) as last_activity,
  case
    when p.status = 'archived' then 'archived'
    when p.sent_to_rip_at is not null then 'sent'
    when a.id is null then 'waiting'
    when a.status in ('queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview')
      then 'analyzing'
    when a.status in ('failed', 'cancelled') then 'failed'
    when coalesce(i.returned, 0) > 0 then 'returned'
    when coalesce(i.critical, 0) > 0 then 'blocked'
    when coalesce(i.warning, 0) > 0 then 'decision'
    else 'ready'
  end as stage
from public.projects p
left join lateral (
  -- A análise do arquivo principal ou, se houver, a que está rodando agora (correção).
  select aj.*
  from public.analysis_jobs aj
  where aj.project = p.id::text
    and (
      aj.file = (select pf.id from public.project_files pf where pf.project = p.id::text and pf.is_primary limit 1)
      or aj.status in ('queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview')
    )
  order by aj.created desc
  limit 1
) a on true
left join lateral (
  select
    count(*) filter (where ii.status = 'pending' and ii.severity = 'critical') as critical,
    count(*) filter (where ii.status = 'pending' and ii.severity = 'warning') as warning,
    count(*) filter (where ii.status = 'rejected') as returned,
    max(ii.decision_at) as last_decision
  from public.analysis_issues ii
  where ii.analysis = a.id
) i on true;

grant select on public.job_overview to authenticated;

-- Números do painel no período: problemas mais comuns, clientes, decisões, correções
-- aplicadas, análises, montagens e painéis.
create or replace function public.dashboard_stats(p_days integer default 30)
returns jsonb
language sql stable security invoker set search_path = public as $$
with since as (select now() - make_interval(days => greatest(p_days, 1)) as t),
issues as (
  select ii.id, ii.rule_code, ii.title, ii.severity, ii.status, aj.project as job_project
  from public.analysis_issues ii
  join public.analysis_jobs aj on aj.id = ii.analysis
  where aj.created >= (select t from since)
),
top_rules as (
  select rule_code, max(title) as title, max(severity) as severity,
         count(*) as occurrences, count(distinct job_project) as jobs
  from issues
  where severity <> 'informational'
  group by rule_code
  order by count(distinct job_project) desc, count(*) desc
  limit 8
),
clients as (
  select coalesce(nullif(trim(p.client_name), ''), 'Sem cliente') as client,
         count(distinct p.id) as jobs,
         count(distinct p.id) filter (where exists (
           select 1 from issues x where x.job_project = p.id::text and x.severity = 'critical'
         )) as jobs_with_blockers,
         count(x.id) filter (where x.severity in ('critical', 'warning')) as problems
  from public.projects p
  left join issues x on x.job_project = p.id::text
  where p.created_at >= (select t from since)
  group by 1
  order by problems desc, jobs desc
  limit 8
),
decisions as (
  select status, count(*) as n from issues where severity <> 'informational' group by status
),
fixes as (
  select f ->> 'id' as id, max(f ->> 'label') as label, count(*) as n
  from public.project_files pf, jsonb_array_elements(pf.applied_fixes) f
  where pf.created >= (select t from since) and pf.status <> 'removed'
  group by 1
  order by n desc
),
analyses as (
  select count(*) as total,
         count(*) filter (where status = 'failed') as failed,
         round(avg(extract(epoch from (completed_at - started_at)))
               filter (where completed_at is not null and started_at is not null)::numeric, 1) as avg_seconds,
         count(*) filter (
           where status in ('queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview')
             and created < now() - interval '30 minutes'
         ) as stuck
  from public.analysis_jobs
  where created >= (select t from since)
),
nesting as (
  select count(*) as runs,
         coalesce(sum((n.result ->> 'totalLengthMm')::numeric), 0) as length_mm,
         (select round(avg((s ->> 'efficiency')::numeric) * 100, 1)
          from public.nesting_runs n2,
               jsonb_array_elements(coalesce(n2.result -> 'sheets', '[]'::jsonb)) s
          where n2.created >= (select t from since) and n2.status = 'completed') as efficiency
  from public.nesting_runs n
  where n.created >= (select t from since) and n.status = 'completed'
),
tiling as (
  select count(*) as exports from public.tiling_projects
  where updated >= (select t from since) and status = 'completed'
)
select jsonb_build_object(
  'days', greatest(p_days, 1),
  'topRules', coalesce((select jsonb_agg(to_jsonb(r)) from top_rules r), '[]'::jsonb),
  'clients', coalesce((select jsonb_agg(to_jsonb(c)) from clients c), '[]'::jsonb),
  'decisions', coalesce((select jsonb_object_agg(status, n) from decisions), '{}'::jsonb),
  'fixes', coalesce((select jsonb_agg(to_jsonb(f)) from fixes f), '[]'::jsonb),
  'analyses', (select to_jsonb(a) from analyses a),
  'nesting', (select to_jsonb(n) from nesting n),
  'tiling', (select to_jsonb(t) from tiling t)
)
$$;

grant execute on function public.dashboard_stats(integer) to authenticated;

-- Espaço ocupado pelos arquivos da empresa (o plano gratuito da Supabase tem 1 GB no total).
create or replace function public.org_storage_bytes()
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  from storage.objects o
  where public.is_teammate_folder((storage.foldername(o.name))[1])
$$;

grant execute on function public.org_storage_bytes() to authenticated;
