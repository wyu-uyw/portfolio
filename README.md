# portfolio

일러스트 작업물을 소개하는 wyw의 개인 포트폴리오 사이트입니다.

- `index.html` — 메인 페이지 (소개, 스킬, 작업물, 문의)
- `exhibition.html` — 캔버스 전시 페이지. 방문자는 전시를 둘러보고, 관리자는 로그인해서 작업물을 올리고 배치를 편집합니다.

## 파일 구성

| 경로 | 설명 |
| --- | --- |
| `index.html` | 메인 페이지 |
| `exhibition.html` | 전시 페이지 |
| `css/exhibition.css` | 전시 페이지 스타일 |
| `js/exhibition.js` | 전시 페이지 동작 (캔버스, 편집, 업로드, 로그인) |
| `js/config.js` | Supabase 연결 정보 |
| `js/works.js` | 메인 페이지 Work 섹션 (전시 페이지에서 올린 작업물을 연도순으로 표시) |
| `supabase/schema.sql` | 데이터베이스·저장소·권한 설정 SQL (새 프로젝트용, 전체) |
| `supabase/002_work_year_description.sql` | 작업물에 제작 연도·설명 추가 (기존 프로젝트용) |

## Supabase 설정

처음 한 번만 하면 됩니다.

1. [supabase.com](https://supabase.com)에 가입하고 **New project**를 만듭니다.
2. 왼쪽 메뉴 **SQL Editor**에서 `supabase/schema.sql` 내용 전체를 붙여 넣고 **Run**을 누릅니다.
3. **Authentication → Users → Add user → Create new user**에서 관리자 이메일과 비밀번호를 만듭니다. (**Auto Confirm User**를 켜 주세요.)
4. **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 끕니다. 다른 사람이 계정을 만들지 못하게 하기 위해서입니다.
5. 다시 **SQL Editor**에서 아래 문장의 이메일을 바꿔 실행해 관리자로 등록합니다.

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = '관리자이메일@example.com';
   ```

6. **Project Settings → API**에서 **Project URL**과 **anon public** 키를 복사해 `js/config.js`에 넣습니다.
   - `anon` 키는 공개되어도 되는 키입니다. 실제 권한은 데이터베이스 정책이 막습니다.
   - `service_role` 키는 절대 넣지 마세요.

## 실행

빌드 과정이 없습니다. `index.html`을 브라우저로 열면 됩니다.
로그인이 잘 안 되면 VS Code의 **Live Server** 확장으로 열어 주세요.
