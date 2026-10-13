-- Empresa (organização) e equipe: vários operadores trabalham nos mesmos trabalhos.
--
-- Cada conta pertence a uma empresa (memberships, uma por conta). Todas as tabelas do
-- sistema ganham org_id e a segurança passa a ser "membro da empresa", não "dono da
-- linha". user_id continua como "quem criou". Contas nunca são apagadas (as tabelas têm
-- ON DELETE CASCADE para auth.users): remover um operador só desativa o acesso.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'operator')),
  name text not null default '',
  email text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (user_id)
);

-- Funções de segurança (security definer: leem memberships sem cair na própria RLS).
create or replace function public.current_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.memberships where user_id = auth.uid() and active
$$;

create or replace function public.org_of_user(target uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.memberships where user_id = target
$$;

create or replace function public.is_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and org_id = target and active
  )
$$;

-- Pasta de arquivos (o 1º nível é o id de quem enviou) de alguém da mesma empresa.
create or replace function public.is_teammate_folder(folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships other on other.org_id = me.org_id
    where me.user_id = auth.uid() and me.active and other.user_id::text = folder
  )
$$;

-- Linhas inseridas sem org_id (pela tela ou pelas funções com a service role) herdam a
-- empresa de quem está logado ou, sem sessão, a de quem criou a linha.
create or replace function public.fill_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    new.org_id := coalesce(public.current_org(), public.org_of_user(new.user_id));
  end if;
  return new;
end
$$;

-- As contas que já existem viram donas de uma empresa cada (hoje há uma só).
do $$
declare
  account record;
  org uuid;
begin
  for account in
    select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'name', '') as name
    from auth.users u
    where not exists (select 1 from public.memberships m where m.user_id = u.id)
    order by u.created_at
  loop
    insert into public.organizations (name) values ('Yesod Automation') returning id into org;
    insert into public.memberships (org_id, user_id, role, name, email)
    values (org, account.id, 'owner', account.name, coalesce(account.email, ''));
  end loop;
end
$$;

-- org_id em todas as tabelas, preenchido pela empresa de quem criou cada linha.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'projects', 'project_files', 'analysis_jobs', 'analysis_issues', 'production_profiles',
    'nesting_runs', 'material_offcuts', 'tiling_projects', 'tiling_templates'
  ] loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.organizations(id) on delete cascade',
      t
    );
    execute format(
      'update public.%I x set org_id = coalesce(
         (select m.org_id from public.memberships m where m.user_id = x.user_id),
         (select id from public.organizations order by created_at limit 1))
       where org_id is null',
      t
    );
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_fill_org', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.fill_org_id()',
      t || '_fill_org', t
    );

    -- Troca "dono da linha" por "membro da empresa".
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy org_select on public.%I for select using (public.is_member(org_id))', t);
    execute format('create policy org_insert on public.%I for insert with check (public.is_member(org_id))', t);
    execute format(
      'create policy org_update on public.%I for update using (public.is_member(org_id)) with check (public.is_member(org_id))',
      t
    );
    execute format('create policy org_delete on public.%I for delete using (public.is_member(org_id))', t);
  end loop;
end
$$;

-- Empresa e equipe: membros veem a empresa e os colegas; só o dono renomeia a empresa.
-- Incluir, desativar e mudar papéis é feito pela função manage_team (service role).
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

drop policy if exists org_members_select on public.organizations;
create policy org_members_select on public.organizations for select using (public.is_member(id));
drop policy if exists org_owner_update on public.organizations;
create policy org_owner_update on public.organizations for update
  using (exists (
    select 1 from public.memberships m
    where m.org_id = organizations.id and m.user_id = auth.uid() and m.role = 'owner' and m.active
  ));

drop policy if exists team_select on public.memberships;
create policy team_select on public.memberships for select using (public.is_member(org_id));

-- Gestão do trabalho: prazo, prioridade, responsável e envio ao RIP.
alter table public.projects
  add column if not exists due_date date,
  add column if not exists priority text not null default 'normal',
  add column if not exists assignee_id uuid references auth.users(id) on delete set null,
  add column if not exists sent_to_rip_at timestamptz,
  add column if not exists sent_to_rip_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_priority_check') then
    alter table public.projects
      add constraint projects_priority_check check (priority in ('baixa', 'normal', 'alta', 'urgente'));
  end if;
end
$$;

create index if not exists projects_assignee_idx on public.projects (assignee_id);
create index if not exists projects_due_date_idx on public.projects (due_date);

-- Arquivos: colegas da mesma empresa leem, substituem e apagam os arquivos uns dos
-- outros; cada um continua enviando só para a própria pasta.
drop policy if exists "project-files read own" on storage.objects;
drop policy if exists "project-files update own" on storage.objects;
drop policy if exists "project-files delete own" on storage.objects;
drop policy if exists "tiling read own" on storage.objects;
drop policy if exists "tiling update own" on storage.objects;
drop policy if exists "tiling delete own" on storage.objects;

create policy "files read team" on storage.objects for select
  using (bucket_id in ('project-files', 'pdfs', 'tiling') and public.is_teammate_folder((storage.foldername(name))[1]));
create policy "files update team" on storage.objects for update
  using (bucket_id in ('project-files', 'pdfs', 'tiling') and public.is_teammate_folder((storage.foldername(name))[1]));
create policy "files delete team" on storage.objects for delete
  using (bucket_id in ('project-files', 'pdfs', 'tiling') and public.is_teammate_folder((storage.foldername(name))[1]));
