-- Biblioteca de perfis ICC da empresa (gestão de cor): os arquivos .icc ficam no bucket
-- pdfs, na pasta de quem enviou (<dono>/icc/...), e esta tabela guarda o que foi lido
-- do cabeçalho do perfil. Os perfis de produção apontam para estes registros.

update storage.buckets
  set allowed_mime_types = array_append(allowed_mime_types, 'application/vnd.iccprofile')
  where id = 'pdfs' and not ('application/vnd.iccprofile' = any(allowed_mime_types));

create table if not exists public.icc_profiles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  storage_path  text not null,
  profile_class text not null default '',   -- prtr (saída), mntr, scnr, spac, link…
  color_space   text not null default '',   -- CMYK, RGB, GRAY, Lab…
  pcs           text not null default '',
  version       text not null default '',
  description   text not null default '',
  size_bytes    bigint not null default 0,
  md5           text not null default '',   -- ID do perfil (cabeçalho), quando houver
  created_at    timestamptz not null default now()
);

create index if not exists icc_profiles_org_idx on public.icc_profiles (org_id);

drop trigger if exists icc_profiles_fill_org on public.icc_profiles;
create trigger icc_profiles_fill_org before insert on public.icc_profiles
  for each row execute function public.fill_org_id();

alter table public.icc_profiles enable row level security;

create policy org_select on public.icc_profiles for select using (public.is_member(org_id));
create policy org_insert on public.icc_profiles for insert with check (public.is_member(org_id));
create policy org_update on public.icc_profiles for update
  using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy org_delete on public.icc_profiles for delete using (public.is_member(org_id));
