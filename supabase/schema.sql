-- wyw의 포트폴리오: 전시 페이지용 Supabase 설정
-- Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전하도록 작성했습니다.

-- ---------- 관리자 ----------
-- 이 표에 들어 있는 계정만 등록·수정·삭제를 할 수 있습니다.
-- 표 수정 정책을 일부러 만들지 않았으므로, 관리자 추가는 SQL Editor(대시보드)에서만 가능합니다.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- 카테고리 ----------
create table if not exists public.categories (
  name text primary key check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);

-- ---------- 작업물 ----------
create table if not exists public.works (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 100),
  category text references public.categories (name) on update cascade on delete set null,
  media_type text not null check (media_type in ('image', 'video')),
  path text not null,          -- 저장소 안의 원본(웹용) 파일 경로
  thumb_path text,             -- 썸네일 경로 (영상·GIF는 없음)
  width int,
  height int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 사이트 설정 + 캔버스 배치 (행 1개만 사용) ----------
create table if not exists public.site_settings (
  id int primary key check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  layout jsonb not null default '{"items": [], "texts": []}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;
insert into public.categories (name)
values ('일러스트'), ('캐릭터'), ('배경'), ('스케치')
on conflict (name) do nothing;

-- ---------- 수정 시각 자동 기록 ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists works_touch_updated_at on public.works;
create trigger works_touch_updated_at
  before update on public.works
  for each row execute function public.touch_updated_at();

drop trigger if exists site_settings_touch_updated_at on public.site_settings;
create trigger site_settings_touch_updated_at
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

-- ---------- 권한 (Row Level Security) ----------
-- 읽기는 누구나, 쓰기는 관리자만. 화면이 아니라 데이터베이스가 직접 막습니다.
alter table public.admins enable row level security;
alter table public.categories enable row level security;
alter table public.works enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "admins: read own row" on public.admins;
create policy "admins: read own row" on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "categories: public read" on public.categories;
create policy "categories: public read" on public.categories
  for select using (true);
drop policy if exists "categories: admin write" on public.categories;
create policy "categories: admin write" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "works: public read" on public.works;
create policy "works: public read" on public.works
  for select using (true);
drop policy if exists "works: admin write" on public.works;
create policy "works: admin write" on public.works
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "site_settings: public read" on public.site_settings;
create policy "site_settings: public read" on public.site_settings
  for select using (true);
drop policy if exists "site_settings: admin write" on public.site_settings;
create policy "site_settings: admin write" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 파일 저장소 ----------
-- 공개 버킷: 누구나 이미지 주소로 볼 수 있고, 올리기·바꾸기·지우기는 관리자만 가능합니다.
-- SVG는 스크립트를 품을 수 있어 허용하지 않습니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio', 'portfolio', true, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm',
        'font/woff', 'font/woff2', 'font/ttf', 'font/otf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "portfolio: admin select" on storage.objects;
create policy "portfolio: admin select" on storage.objects
  for select to authenticated using (bucket_id = 'portfolio' and public.is_admin());
drop policy if exists "portfolio: admin insert" on storage.objects;
create policy "portfolio: admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'portfolio' and public.is_admin());
drop policy if exists "portfolio: admin update" on storage.objects;
create policy "portfolio: admin update" on storage.objects
  for update to authenticated using (bucket_id = 'portfolio' and public.is_admin());
drop policy if exists "portfolio: admin delete" on storage.objects;
create policy "portfolio: admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'portfolio' and public.is_admin());
