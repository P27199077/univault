-- Extend section labels while preserving all material ownership and storage policies.
begin;
alter table public.materials drop constraint materials_category_check;
alter table public.materials add constraint materials_category_check check (
  category in ('slides','notes','papers','handouts','tutorials')
  or category ~ '^page-[a-z0-9-]{1,80}$'
);
commit;
