// Supabase 연결 정보 (대시보드 → Project Settings → API 에서 복사)
// anon(public) 키는 브라우저에 공개되도록 만들어진 키라 여기에 넣어도 됩니다.
// 실제 권한은 supabase/schema.sql의 RLS 정책이 막습니다.
// service_role 키는 모든 권한을 가진 비밀 키이므로 절대 이 파일에 넣지 마세요.
window.SUPABASE_CONFIG = {
  url: 'https://siieikywihmxwzxpquwb.supabase.co',
  anonKey: 'sb_publishable_U9mwjY9HXTNY2NfkIkxeaw_OYvsp0Ri',
};
