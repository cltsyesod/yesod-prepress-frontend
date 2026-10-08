-- Bucket do painelamento: PDFs dos painéis, o pacote .zip, o guia e a imagem de
-- referência (veículo/fachada). Privado; cada usuário só acessa a própria pasta.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tiling',
  'tiling',
  false,
  524288000,
  array['application/pdf', 'application/zip', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "tiling read own" on storage.objects
  for select using (bucket_id = 'tiling' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "tiling upload own" on storage.objects
  for insert with check (bucket_id = 'tiling' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "tiling update own" on storage.objects
  for update using (bucket_id = 'tiling' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "tiling delete own" on storage.objects
  for delete using (bucket_id = 'tiling' and (storage.foldername(name))[1] = auth.uid()::text);
