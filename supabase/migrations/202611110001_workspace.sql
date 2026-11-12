-- Each account owns one versioned workspace plus private material metadata.
create table public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (
    jsonb_typeof(data) = 'object' and data->>'version' = '1'
    and jsonb_typeof(data->'values') = 'object'
    and octet_length(data::text) <= 5242880
  ),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create policy workspace_owner on public.workspaces for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.workspaces from anon;
grant select, insert, update, delete on public.workspaces to authenticated;

create or replace function public.save_workspace(payload jsonb, expected_revision bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if expected_revision = 0 then
    insert into public.workspaces(user_id,data,revision)
      values (auth.uid(),payload,1)
      on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.workspaces set data = payload, revision = revision + 1, updated_at = now()
      where user_id = auth.uid() and revision = expected_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'Workspace changed on another device' using errcode = 'UV409';
  end if;
  return next_revision;
end;
$$;
revoke all on function public.save_workspace(jsonb,bigint) from public, anon;
grant execute on function public.save_workspace(jsonb,bigint) to authenticated;

create table public.materials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9_-]+$'),
  course_id text not null,
  name text not null check (length(name) between 1 and 512),
  category text not null check (category in ('slides','notes','papers','handouts')),
  mime_type text not null,
  size bigint not null check (size between 0 and 52428800),
  uploaded_at timestamptz not null default now(),
  storage_path text not null unique,
  primary key (owner_id,id),
  check (storage_path = owner_id::text || '/' || id)
);
create index materials_course on public.materials(owner_id,course_id);
alter table public.materials enable row level security;
create policy materials_owner on public.materials for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.materials from anon;
grant select, insert, update, delete on public.materials to authenticated;

-- The bucket remains private; no public download links or service key in the client.
insert into storage.buckets(id,name,public,file_size_limit)
  values ('course-materials','course-materials',false,52428800)
  on conflict (id) do update set public = false, file_size_limit = 52428800;
create policy material_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'course-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy material_objects_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'course-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy material_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'course-materials' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'course-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy material_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'course-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
