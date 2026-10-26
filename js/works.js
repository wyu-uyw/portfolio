// 메인 페이지 Work 섹션: 전시 페이지에서 올린 작업물을 Supabase에서 불러와 연도순 카드로 보여 준다
(() => {
  'use strict';

  const BUCKET = 'portfolio';
  const THUMB_SIDE = 600;

  const $ = (sel) => document.querySelector(sel);
  const cfg = window.SUPABASE_CONFIG || {};
  const db = cfg.url && cfg.anonKey && window.supabase
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;
  const publicUrl = (path) => (path ? db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '');

  function setStatus(message) {
    $('#workStatus').textContent = message;
  }

  function cardMedia(work) {
    if (work.media_type === 'video') {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = publicUrl(work.path);
      return video;
    }
    const img = document.createElement('img');
    img.alt = work.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (work.thumb_path) {
      img.srcset = `${publicUrl(work.thumb_path)} ${THUMB_SIDE}w, ${publicUrl(work.path)} ${work.width || 2400}w`;
      img.sizes = '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
    }
    img.src = publicUrl(work.thumb_path || work.path);
    return img;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // 사용자가 쓴 글은 textContent로만 넣는다
    return node;
  }

  function card(work) {
    // 링크로 만들어 두면 스크립트가 없어도 원본 이미지가 열린다
    const a = el('a', 'work');
    a.href = publicUrl(work.path);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openViewer(work);
    });

    const imgBox = el('div', 'work-img');
    imgBox.append(cardMedia(work));
    if (work.media_type === 'video') {
      a.addEventListener('mouseenter', () => imgBox.firstChild.play().catch(() => {}));
      a.addEventListener('mouseleave', () => imgBox.firstChild.pause());
    }

    const text = el('div');
    text.append(el('span', 'work-year', work.year ? String(work.year) : ''), el('h3', '', work.title));
    if (work.description) text.append(el('p', '', work.description));
    const meta = el('div', 'work-meta');
    meta.append(text, el('span', 'arrow', '→'));

    a.append(imgBox, meta);
    if (work.category) {
      const tags = el('div', 'tags');
      tags.append(el('span', 'tag', work.category));
      a.append(tags);
    }
    return a;
  }

  function openViewer(work) {
    let media;
    if (work.media_type === 'video') {
      media = document.createElement('video');
      media.controls = true;
      media.autoplay = true;
      media.playsInline = true;
    } else {
      media = document.createElement('img');
      media.alt = work.title;
    }
    media.src = publicUrl(work.path);
    $('#workViewerMedia').replaceChildren(media);
    $('#workViewerTitle').textContent = work.title;
    $('#workViewerMeta').textContent = [work.year, work.category, work.description].filter(Boolean).join(' · ');
    $('#workViewer').showModal();
  }

  async function load() {
    if (!db) {
      setStatus('작업물을 불러올 수 없습니다. (Supabase 설정이 필요합니다)');
      return;
    }
    // 최신 연도 먼저, 같은 연도 안에서는 최근에 올린 것 먼저
    const { data, error } = await db.from('works')
      .select('id, title, category, year, description, media_type, path, thumb_path, width')
      .order('year', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      setStatus('작업물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    $('#workGrid').replaceChildren(...data.map(card));
    setStatus(data.length ? '' : '아직 등록된 작업물이 없습니다.');
  }

  const viewer = $('#workViewer');
  $('#workViewerClose').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
  viewer.addEventListener('close', () => $('#workViewerMedia').replaceChildren());

  load();
})();
