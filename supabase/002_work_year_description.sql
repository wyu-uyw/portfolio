-- 작업물에 제작 연도와 설명 열을 추가합니다. (이미 schema.sql을 실행한 프로젝트용)
-- Supabase 대시보드 → SQL Editor에 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
alter table public.works add column if not exists year int check (year between 1900 and 2100);
alter table public.works add column if not exists description text check (char_length(description) <= 300);

-- 이미 올린 작업물은 올린 날짜의 연도로 채웁니다
update public.works set year = extract(year from created_at)::int where year is null;
