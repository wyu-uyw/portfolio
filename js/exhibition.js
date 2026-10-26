// 전시 페이지: 캔버스 전시(누구나) + 편집·작업물 관리·꾸미기(관리자)
// 데이터는 Supabase에 저장하고, 쓰기 권한은 supabase/schema.sql의 RLS 정책이 막는다.
(() => {
  'use strict';

  // ---------- 설정값 ----------
  const BUCKET = 'portfolio';
  const MB = 1024 * 1024;
  const MAX_IMAGE_SIDE = 2400;
  const THUMB_SIDE = 600;
  const MAX_IMAGE_BYTES = 20 * MB;
  const MAX_VIDEO_BYTES = 50 * MB;
  const MAX_FONT_BYTES = 10 * MB;
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
  const FONT_TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
  const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace'];
  const SYSTEM_FONTS = ['Pretendard', ...GENERIC_FONTS].map((family) => ({ type: 'system', family }));
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 3;
  const DEFAULT_SETTINGS = {
    title: 'wyw 전시관',
    subtitle: '작업물을 자유롭게 둘러보세요.',
    themeColor: '#fafafa',
    backgroundPath: null,
    titleFont: 'Pretendard',
    subtitleFont: 'Pretendard',
    fonts: [], // { type: 'google' | 'custom', family, path? }
  };

  const cfg = window.SUPABASE_CONFIG || {};
  const db = cfg.url && cfg.anonKey && window.supabase
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  const state = {
    isAdmin: false,
    tab: 'view',
    works: [],
    categories: [],
    settings: { ...DEFAULT_SETTINGS },
    saved: emptyLayout(), // DB에 저장된 배치
    view: emptyLayout(),  // 전시 탭: 방문자가 잠시 옮겨 볼 수 있는 사본
    edit: emptyLayout(),  // 편집 탭: 저장 전 작업본
    dirty: false,
    selected: null,
    editingText: null,
    filter: 'all',
    yearFilter: 'all',
    scale: 1,
    panX: 0,
    panY: 0,
  };

  // ---------- 공용 도구 ----------
  class UserError extends Error {}

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const publicUrl = (path) => (path && db ? db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '');
  const workById = (id) => state.works.find((w) => w.id === id);
  const currentLayout = () => (state.tab === 'edit' ? state.edit : state.view);

  function emptyLayout() {
    return { items: [], texts: [] };
  }

  function must({ data, error }) {
    if (error) throw error;
    return data;
  }

  // RLS에 막히면 오류 없이 0행이 바뀌므로 직접 확인한다
  function mustChange(rows) {
    if (!rows || rows.length === 0) throw new UserError('권한이 없거나 대상을 찾을 수 없습니다. 다시 로그인해 주세요.');
    return rows;
  }

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  async function attempt(fn, failMessage) {
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      toast(err instanceof UserError ? err.message : failMessage);
      return undefined;
    }
  }

  function showNotice(message) {
    const el = $('#notice');
    el.textContent = message;
    el.hidden = false;
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleDateString('ko-KR') : '';
  }

  // 1900~2100 사이 정수만 연도로 인정한다 (schema.sql의 check와 같은 범위)
  function parseYear(value) {
    const year = Number(value);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
  }

  // ---------- 데이터 불러오기 ----------
  async function loadAll() {
    const [works, categories, site] = await Promise.all([
      db.from('works').select('*').order('created_at', { ascending: false }),
      db.from('categories').select('name').order('created_at'),
      db.from('site_settings').select('settings, layout').eq('id', 1).single(),
    ]);
    state.works = must(works);
    state.categories = must(categories).map((c) => c.name);
    const row = must(site);
    state.settings = { ...DEFAULT_SETTINGS, ...row.settings };
    state.saved = { ...emptyLayout(), ...row.layout };
    state.view = clone(state.saved);
    state.edit = clone(state.saved);
  }

  // ---------- 글꼴 ----------
  const loadedFonts = new Set();

  function loadFont(font) {
    if (font.type === 'system' || loadedFonts.has(font.family)) return;
    loadedFonts.add(font.family);
    if (font.type === 'google') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}&display=swap`;
      document.head.append(link);
    } else if (font.type === 'custom') {
      const face = new FontFace(font.family, `url("${publicUrl(font.path)}")`);
      face.load().then((f) => document.fonts.add(f)).catch((err) => console.error(err));
    }
  }

  function fontStack(family) {
    return GENERIC_FONTS.includes(family) ? family : `"${family}", Pretendard, sans-serif`;
  }

  const allFonts = () => [...SYSTEM_FONTS, ...state.settings.fonts];

  function fillFontSelect(select, value) {
    const options = allFonts().map((f) => new Option(f.family, f.family));
    if (value && !allFonts().some((f) => f.family === value)) options.push(new Option(value, value));
    select.replaceChildren(...options);
    select.value = value || 'Pretendard';
  }

  // ---------- 설정 반영 ----------
  function applySettings() {
    const s = state.settings;
    s.fonts.forEach(loadFont);
    const title = $('#siteTitle');
    const subtitle = $('#siteSubtitle');
    title.textContent = s.title;
    subtitle.textContent = s.subtitle;
    title.style.fontFamily = fontStack(s.titleFont);
    subtitle.style.fontFamily = fontStack(s.subtitleFont);
    const canvas = $('#canvas');
    canvas.style.backgroundColor = s.themeColor;
    canvas.style.backgroundImage = s.backgroundPath ? `url("${publicUrl(s.backgroundPath)}")` : 'none';
  }

  // ---------- 캔버스 그리기 ----------
  function place(el, obj) {
    el.style.left = `${obj.x}px`;
    el.style.top = `${obj.y}px`;
    el.style.width = `${obj.w}px`;
    el.style.height = `${obj.h}px`;
    el.style.zIndex = obj.z;
  }

  function editControls() {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'item-del';
    del.dataset.action = 'delete';
    del.textContent = '×';
    del.setAttribute('aria-label', '캔버스에서 빼기');
    const handle = document.createElement('div');
    handle.className = 'item-resize';
    handle.dataset.action = 'resize';
    return [del, handle];
  }

  function mediaElement(work, { full = false, sizes } = {}) {
    if (work.media_type === 'video') {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = full;
      video.preload = 'metadata';
      video.src = publicUrl(work.path);
      return video;
    }
    const img = document.createElement('img');
    img.alt = work.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    if (full && work.thumb_path && sizes) {
      // 캔버스에 놓인 크기에 맞춰 썸네일/원본 중 브라우저가 고르게 한다
      img.srcset = `${publicUrl(work.thumb_path)} ${THUMB_SIDE}w, ${publicUrl(work.path)} ${work.width || MAX_IMAGE_SIDE}w`;
      img.sizes = sizes;
      img.src = publicUrl(work.path);
    } else {
      img.src = publicUrl(full ? work.path : work.thumb_path || work.path);
    }
    return img;
  }

  function renderItem(item, work, editable) {
    const el = document.createElement('div');
    el.className = 'item';
    el.classList.toggle('selected', state.selected === item.uid);
    el.dataset.uid = item.uid;
    el.dataset.kind = 'item';
    place(el, item);
    el.append(mediaElement(work, { full: true, sizes: `${Math.round(item.w)}px` }));
    if (editable) el.append(...editControls());
    return el;
  }

  function renderText(t, editable) {
    const el = document.createElement('div');
    el.className = 'text-box';
    el.classList.toggle('selected', state.selected === t.uid);
    el.dataset.uid = t.uid;
    el.dataset.kind = 'text';
    place(el, t);
    el.style.fontFamily = fontStack(t.fontFamily);
    el.style.color = t.color;
    el.style.textAlign = t.align;

    if (editable && state.editingText === t.uid) {
      el.classList.add('editing');
      const title = document.createElement('input');
      title.type = 'text';
      title.value = t.title;
      title.placeholder = '제목 (비워도 됩니다)';
      title.maxLength = 100;
      title.style.fontSize = `${Math.round(t.fontSize * 1.25)}px`;
      title.addEventListener('input', () => { t.title = title.value; markDirty(); });
      const body = document.createElement('textarea');
      body.value = t.text;
      body.maxLength = 2000;
      body.style.fontSize = `${t.fontSize}px`;
      body.addEventListener('input', () => { t.text = body.value; markDirty(); });
      el.append(title, body);
    } else {
      // 사용자가 쓴 글은 textContent로만 넣는다 (HTML로 해석되지 않게)
      const title = document.createElement('div');
      title.className = 'tb-title';
      title.textContent = t.title;
      title.style.fontSize = `${Math.round(t.fontSize * 1.25)}px`;
      const body = document.createElement('div');
      body.className = 'tb-body';
      body.textContent = t.text;
      body.style.fontSize = `${t.fontSize}px`;
      el.append(title, body);
    }
    if (editable) el.append(...editControls());
    return el;
  }

  function renderStage() {
    const layout = currentLayout();
    const editable = state.tab === 'edit';
    const nodes = [];
    for (const item of layout.items) {
      const work = workById(item.workId);
      if (work) nodes.push(renderItem(item, work, editable));
    }
    for (const t of layout.texts) nodes.push(renderText(t, editable));
    $('#stage').replaceChildren(...nodes);

    const hint = $('#emptyHint');
    hint.hidden = nodes.length > 0;
    hint.textContent = editable
      ? '아래 작업물을 캔버스로 끌어다 놓거나 눌러서 추가해 주세요.'
      : '아직 전시된 작업물이 없습니다.';
    applyTransform();
    renderTextToolbar();
  }

  const findEl = (id) => $('#stage').querySelector(`[data-uid="${id}"]`);
  const findObj = (layout, id) => layout.items.find((i) => i.uid === id) || layout.texts.find((t) => t.uid === id);
  const nextZ = (layout) => Math.max(0, ...layout.items.map((i) => i.z), ...layout.texts.map((t) => t.z)) + 1;

  function select(id) {
    state.selected = id;
    $$('#stage [data-uid]').forEach((n) => n.classList.toggle('selected', n.dataset.uid === id));
    renderTextToolbar();
  }

  function markDirty() {
    if (state.tab !== 'edit') return;
    state.dirty = true;
    $('#dirtyMark').hidden = false;
  }

  function clearDirty() {
    state.dirty = false;
    $('#dirtyMark').hidden = true;
  }

  // ---------- 확대·이동 ----------
  function applyTransform() {
    $('#stage').style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    $('#zoomLabel').textContent = `${Math.round(state.scale * 100)}%`;
  }

  function zoomAt(nextScale, cx, cy) {
    const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    state.panX = cx - (cx - state.panX) * (s / state.scale);
    state.panY = cy - (cy - state.panY) * (s / state.scale);
    state.scale = s;
    applyTransform();
  }

  function zoomCenter(factor) {
    const rect = $('#canvas').getBoundingClientRect();
    zoomAt(state.scale * factor, rect.width / 2, rect.height / 2);
  }

  function resetView() {
    state.scale = 1;
    state.panX = 0;
    state.panY = 0;
    if (state.tab === 'view') {
      state.view = clone(state.saved);
      renderStage();
    } else {
      applyTransform();
    }
  }

  // 화면(캔버스 영역) 좌표 → 스테이지 좌표
  function toStage(clientX, clientY) {
    const rect = $('#canvas').getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.scale,
      y: (clientY - rect.top - state.panY) / state.scale,
    };
  }

  function canvasCenter() {
    const rect = $('#canvas').getBoundingClientRect();
    return toStage(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // ---------- 포인터(마우스·터치) 조작 ----------
  const pointers = new Map();
  let gesture = null;

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      gesture = { type: 'pinch', dist: pinchInfo().dist, scale: state.scale };
      return;
    }
    if (pointers.size > 2) return;

    let el = e.target.closest('[data-uid]');
    const id = el ? el.dataset.uid : null;
    if (state.editingText && id !== state.editingText) {
      state.editingText = null;
      renderStage();
      el = id ? findEl(id) : null;
    }
    if (!el) {
      if (state.selected) select(null);
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY, moved: false };
      return;
    }

    const layout = currentLayout();
    const obj = findObj(layout, id);
    if (!obj) return;
    obj.z = nextZ(layout);
    el.style.zIndex = obj.z;
    if (state.tab === 'edit') select(id);
    const resizing = state.tab === 'edit' && e.target.dataset.action === 'resize';
    gesture = {
      type: resizing ? 'resize' : 'move',
      el, obj, kind: el.dataset.kind,
      sx: e.clientX, sy: e.clientY,
      ox: obj.x, oy: obj.y, ow: obj.w, oh: obj.h,
      moved: false,
    };
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;

    if (gesture.type === 'pinch') {
      if (pointers.size < 2) return;
      const p = pinchInfo();
      const rect = $('#canvas').getBoundingClientRect();
      zoomAt(gesture.scale * (p.dist / gesture.dist), p.cx - rect.left, p.cy - rect.top);
      return;
    }

    const dx = e.clientX - gesture.sx;
    const dy = e.clientY - gesture.sy;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;

    if (gesture.type === 'pan') {
      $('#canvas').classList.add('panning');
      state.panX = gesture.px + dx;
      state.panY = gesture.py + dy;
      applyTransform();
      return;
    }

    const { obj, el } = gesture;
    const s = state.scale;
    if (gesture.type === 'move') {
      obj.x = Math.round(gesture.ox + dx / s);
      obj.y = Math.round(gesture.oy + dy / s);
    } else {
      obj.w = Math.round(Math.max(60, gesture.ow + dx / s));
      // 작업물은 비율 유지, 텍스트 상자는 자유롭게
      obj.h = gesture.kind === 'item'
        ? Math.round(obj.w * (gesture.oh / gesture.ow))
        : Math.round(Math.max(60, gesture.oh + dy / s));
    }
    place(el, obj);
    markDirty();
  }

  function onPointerUp(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    const g = gesture;
    gesture = null;
    $('#canvas').classList.remove('panning');
    const tapped = e.type === 'pointerup' && !g.moved;
    if (tapped && g.type === 'move' && g.kind === 'item' && state.tab === 'view') openViewer(g.obj.workId);
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = $('#canvas').getBoundingClientRect();
    zoomAt(state.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
  }

  // ---------- 편집 ----------
  function addWorkToCanvas(work, at) {
    const pos = at || canvasCenter();
    const w = 300;
    const ratio = work.width && work.height ? work.height / work.width : 0.75;
    const h = Math.round(w * ratio);
    const item = {
      uid: uid(),
      workId: work.id,
      x: Math.round(pos.x - w / 2),
      y: Math.round(pos.y - h / 2),
      w, h,
      z: nextZ(state.edit),
    };
    state.edit.items.push(item);
    state.selected = item.uid;
    markDirty();
    renderStage();
  }

  function addTextBox() {
    const pos = canvasCenter();
    const w = 280;
    const h = 160;
    const t = {
      uid: uid(),
      title: '제목',
      text: '내용을 입력해 주세요.',
      x: Math.round(pos.x - w / 2),
      y: Math.round(pos.y - h / 2),
      w, h,
      z: nextZ(state.edit),
      fontSize: 16,
      fontFamily: 'Pretendard',
      color: '#141414',
      align: 'left',
    };
    state.edit.texts.push(t);
    state.selected = t.uid;
    state.editingText = t.uid;
    markDirty();
    renderStage();
    findEl(t.uid)?.querySelector('textarea')?.focus();
  }

  function removeObject(id) {
    state.edit.items = state.edit.items.filter((i) => i.uid !== id);
    state.edit.texts = state.edit.texts.filter((t) => t.uid !== id);
    if (state.selected === id) state.selected = null;
    if (state.editingText === id) state.editingText = null;
    markDirty();
    renderStage();
  }

  function toggleTextEditing(id) {
    state.editingText = state.editingText === id ? null : id;
    renderStage();
    if (state.editingText) findEl(id)?.querySelector('textarea')?.focus();
  }

  const selectedText = () => (state.tab === 'edit' ? state.edit.texts.find((t) => t.uid === state.selected) : null);

  function renderTextToolbar() {
    const t = selectedText();
    $('#textToolbar').hidden = !t;
    if (!t) return;
    fillFontSelect($('#tbFont'), t.fontFamily);
    $('#tbSize').value = t.fontSize;
    $('#tbColor').value = t.color;
    $('#tbAlign').value = t.align;
    $('#tbEdit').textContent = state.editingText === t.uid ? '편집 마치기' : '글 편집';
  }

  function updateSelectedText(changes) {
    const t = selectedText();
    if (!t) return;
    Object.assign(t, changes);
    markDirty();
    renderStage();
  }

  async function saveLayout() {
    const layout = clone(state.edit);
    const btn = $('#saveLayoutBtn');
    btn.disabled = true;
    await attempt(async () => {
      mustChange(must(await db.from('site_settings').update({ layout }).eq('id', 1).select('id')));
      state.saved = layout;
      clearDirty();
      toast('배치를 저장했습니다.');
    }, '배치를 저장하지 못했습니다. 다시 시도해 주세요.');
    btn.disabled = false;
  }

  function clearCanvas() {
    if (!confirm('캔버스의 작업물과 텍스트를 모두 비우시겠습니까?\n\'배치 저장\'을 누르기 전까지는 실제로 반영되지 않습니다.')) return;
    state.edit = emptyLayout();
    state.selected = null;
    state.editingText = null;
    markDirty();
    renderStage();
  }

  // ---------- 탭 ----------
  function setTab(tab) {
    if (tab === 'edit' && !state.isAdmin) return;
    state.tab = tab;
    state.selected = null;
    state.editingText = null;
    if (tab === 'view') state.view = clone(state.saved);
    document.body.dataset.mode = tab;
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    $('#canvasHelp').textContent = tab === 'edit'
      ? '작업물과 텍스트를 끌어서 옮기고, 오른쪽 아래 동그라미로 크기를 바꿀 수 있습니다. 텍스트는 두 번 눌러 수정합니다.'
      : '빈 곳을 끌면 화면이 이동하고, 마우스 휠이나 두 손가락으로 확대·축소할 수 있습니다. 작업물을 누르면 크게 볼 수 있습니다.';
    renderStage();
    if (tab === 'edit') renderThumbs();
  }

  // ---------- 썸네일 목록 (편집) ----------
  function categoryOptions(includeAll) {
    const opts = state.categories.map((c) => new Option(c, c));
    return includeAll
      ? [new Option('전체', 'all'), ...opts, new Option('미분류', 'none')]
      : [new Option('미분류', ''), ...opts];
  }

  function renderThumbs() {
    const filter = $('#thumbFilter');
    filter.replaceChildren(...categoryOptions(true));
    if (state.filter !== 'all' && state.filter !== 'none' && !state.categories.includes(state.filter)) state.filter = 'all';
    filter.value = state.filter;

    const years = [...new Set(state.works.map((w) => w.year).filter(Boolean))].sort((a, b) => b - a);
    const yearOptions = [new Option('전체', 'all'), ...years.map((y) => new Option(String(y), String(y)))];
    if (state.works.some((w) => !w.year)) yearOptions.push(new Option('연도 없음', 'none'));
    const yearFilter = $('#thumbYearFilter');
    yearFilter.replaceChildren(...yearOptions);
    if (!yearOptions.some((o) => o.value === state.yearFilter)) state.yearFilter = 'all';
    yearFilter.value = state.yearFilter;

    const list = state.works.filter((w) => {
      if (state.filter === 'none' ? w.category : state.filter !== 'all' && w.category !== state.filter) return false;
      if (state.yearFilter === 'none') return !w.year;
      return state.yearFilter === 'all' || String(w.year) === state.yearFilter;
    });
    $('#thumbList').replaceChildren(...list.map(thumbElement));
    $('#thumbEmpty').hidden = list.length > 0;
  }

  function thumbElement(work) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = `${work.title} — 끌어다 놓거나 눌러서 추가`;
    const caption = document.createElement('span');
    caption.textContent = work.title;
    el.append(mediaElement(work), caption);
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(work.id));
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => addWorkToCanvas(work));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addWorkToCanvas(work);
      }
    });
    return el;
  }

  // ---------- 크게 보기 ----------
  function openViewer(workId) {
    const work = workById(workId);
    if (!work) return;
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
    $('#viewerMedia').replaceChildren(media);
    $('#viewerTitle').textContent = work.title;
    $('#viewerMeta').textContent = [work.year, work.category || '미분류', work.description].filter(Boolean).join(' · ');
    $('#viewerModal').showModal();
  }

  // ---------- 로그인 ----------
  async function isAdminUser(userId) {
    const res = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
    return !res.error && !!res.data;
  }

  async function refreshAuth(session) {
    const admin = session ? await isAdminUser(session.user.id) : false;
    state.isAdmin = admin;
    $('#loginBtn').hidden = admin;
    $('#logoutBtn').hidden = !admin;
    $('#tabs').hidden = !admin;
    if (!admin && state.tab === 'edit') {
      clearDirty();
      setTab('view');
    }
  }

  function openLogin() {
    if (!db) {
      toast('Supabase 설정이 필요합니다. README.md를 확인해 주세요.');
      return;
    }
    $('#loginMsg').textContent = '';
    $('#loginModal').showModal();
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = $('#loginMsg');
    msg.textContent = '확인하고 있습니다…';
    const { data, error } = await db.auth.signInWithPassword({
      email: $('#loginEmail').value.trim(),
      password: $('#loginPassword').value,
    });
    if (error) {
      msg.textContent = '이메일 또는 비밀번호가 올바르지 않습니다.';
      return;
    }
    if (!(await isAdminUser(data.user.id))) {
      await db.auth.signOut();
      msg.textContent = '관리자 권한이 없는 계정입니다.';
      return;
    }
    form.reset();
    $('#loginModal').close();
    toast('로그인했습니다.');
  }

  async function logout() {
    if (state.dirty && !confirm('저장하지 않은 배치가 있습니다. 그래도 로그아웃하시겠습니까?')) return;
    clearDirty();
    await db.auth.signOut();
    toast('로그아웃했습니다.');
  }

  // ---------- 파일 올리기 ----------
  async function resizeImage(bitmap, maxSide, quality) {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * ratio);
    const height = Math.round(bitmap.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await toBlob('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
    if (!blob) throw new UserError('이미지를 변환하지 못했습니다.');
    return { blob, type: blob.type, ext: blob.type === 'image/webp' ? 'webp' : 'jpg', width, height };
  }

  function videoSize(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (size) => { URL.revokeObjectURL(url); resolve(size); };
      video.preload = 'metadata';
      video.onloadedmetadata = () => done({ width: video.videoWidth || null, height: video.videoHeight || null });
      video.onerror = () => done({ width: null, height: null });
      video.src = url;
    });
  }

  async function prepareWorkFile(file) {
    if (IMAGE_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) throw new UserError(`${file.name}: 이미지는 20MB 이하만 올릴 수 있습니다.`);
      const bitmap = await createImageBitmap(file).catch(() => {
        throw new UserError(`${file.name}: 이미지를 읽지 못했습니다.`);
      });
      if (file.type === 'image/gif') {
        // 움직이는 GIF는 변환하면 멈추므로 그대로 올린다
        return { mediaType: 'image', main: { blob: file, type: file.type, ext: 'gif' }, thumb: null, width: bitmap.width, height: bitmap.height };
      }
      const main = await resizeImage(bitmap, MAX_IMAGE_SIDE, 0.9);
      const thumb = await resizeImage(bitmap, THUMB_SIDE, 0.8);
      return { mediaType: 'image', main, thumb, width: main.width, height: main.height };
    }
    if (VIDEO_TYPES[file.type]) {
      if (file.size > MAX_VIDEO_BYTES) throw new UserError(`${file.name}: 영상은 50MB 이하만 올릴 수 있습니다.`);
      const size = await videoSize(file);
      return { mediaType: 'video', main: { blob: file, type: file.type, ext: VIDEO_TYPES[file.type] }, thumb: null, ...size };
    }
    throw new UserError(`${file.name}: 지원하지 않는 형식입니다. (JPG, PNG, WEBP, GIF, MP4, WEBM)`);
  }

  async function uploadBlob(path, part) {
    must(await db.storage.from(BUCKET).upload(path, part.blob, {
      contentType: part.type,
      cacheControl: '31536000',
      upsert: false,
    }));
  }

  async function removeFiles(paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    const { error } = await db.storage.from(BUCKET).remove(list);
    if (error) console.error(error);
  }

  async function uploadWork(file, { title, category, year, description }) {
    const prepared = await prepareWorkFile(file);
    const id = uid();
    const path = `works/${id}.${prepared.main.ext}`;
    const thumbPath = prepared.thumb ? `works/thumbs/${id}.${prepared.thumb.ext}` : null;
    const uploaded = [];
    try {
      await uploadBlob(path, prepared.main);
      uploaded.push(path);
      if (prepared.thumb) {
        await uploadBlob(thumbPath, prepared.thumb);
        uploaded.push(thumbPath);
      }
      return must(await db.from('works').insert({
        title,
        category: category || null,
        year,
        description: description || null,
        media_type: prepared.mediaType,
        path,
        thumb_path: thumbPath,
        width: prepared.width,
        height: prepared.height,
      }).select().single());
    } catch (err) {
      await removeFiles(uploaded); // 기록이 실패하면 올린 파일도 지운다
      throw err;
    }
  }

  async function onUploadSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const files = [...$('#uploadFiles').files];
    if (!files.length) return;
    const baseTitle = $('#uploadTitle').value.trim();
    const category = $('#uploadCategory').value;
    const year = parseYear($('#uploadYear').value);
    const description = $('#uploadDescription').value.trim().slice(0, 300);
    const msg = $('#uploadMsg');
    const btn = $('#uploadBtn');
    if (!year) {
      msg.textContent = '제작 연도를 1900~2100 사이 숫자로 입력해 주세요.';
      return;
    }
    btn.disabled = true;

    let ok = 0;
    const errors = [];
    for (const [i, file] of files.entries()) {
      msg.textContent = `${i + 1} / ${files.length} 올리는 중입니다…`;
      let title = baseTitle
        ? (files.length > 1 ? `${baseTitle} ${i + 1}` : baseTitle)
        : file.name.replace(/\.[^.]+$/, '').trim();
      title = title.slice(0, 100) || '제목 없음';
      try {
        state.works.unshift(await uploadWork(file, { title, category, year, description }));
        ok += 1;
      } catch (err) {
        console.error(err);
        errors.push(err instanceof UserError ? err.message : `${file.name}: 올리지 못했습니다.`);
      }
    }

    btn.disabled = false;
    msg.textContent = [ok ? `${ok}개를 올렸습니다.` : '', ...errors].filter(Boolean).join('\n');
    if (ok) {
      form.reset();
      $('#uploadYear').value = year; // 같은 해 작업을 이어서 올리기 쉽게 연도는 남겨 둔다
    }
    renderWorkList();
    renderThumbs();
  }

  // ---------- 작업물 관리 ----------
  function openGallery() {
    renderCategories();
    renderWorkList();
    $('#uploadMsg').textContent = '';
    if (!$('#uploadYear').value) $('#uploadYear').value = new Date().getFullYear();
    $('#galleryModal').showModal();
  }

  function renderWorkList() {
    $('#workCount').textContent = `(${state.works.length}개)`;
    const rows = state.works.map(workRow);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'work-empty';
      empty.textContent = '아직 올린 작업물이 없습니다.';
      rows.push(empty);
    }
    $('#workList').replaceChildren(...rows);
  }

  function workRow(work) {
    const row = document.createElement('div');
    row.className = 'work-row';

    const media = mediaElement(work);
    media.classList.add('media');

    const fields = document.createElement('div');
    fields.className = 'work-fields';
    const title = document.createElement('input');
    title.type = 'text';
    title.value = work.title;
    title.maxLength = 100;
    title.setAttribute('aria-label', '제목');
    const category = document.createElement('select');
    category.setAttribute('aria-label', '카테고리');
    category.replaceChildren(...categoryOptions(false));
    category.value = work.category || '';
    const year = document.createElement('input');
    year.type = 'number';
    year.min = '1900';
    year.max = '2100';
    year.value = work.year || '';
    year.setAttribute('aria-label', '제작 연도');
    const description = document.createElement('textarea');
    description.rows = 2;
    description.maxLength = 300;
    description.value = work.description || '';
    description.placeholder = '설명 (선택)';
    description.setAttribute('aria-label', '설명');
    fields.append(title, category, year, description);

    const actions = document.createElement('div');
    actions.className = 'btn-row';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-sm';
    save.textContent = '저장';
    save.addEventListener('click', () => updateWork(work, {
      title: title.value.trim(),
      category: category.value || null,
      year: parseYear(year.value),
      description: description.value.trim() || null,
    }));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-sm';
    del.textContent = '삭제';
    del.addEventListener('click', () => deleteWork(work));
    actions.append(save, del);

    row.append(media, fields, actions);
    return row;
  }

  async function updateWork(work, changes) {
    if (!changes.title) {
      toast('제목을 입력해 주세요.');
      return;
    }
    if (!changes.year) {
      toast('제작 연도를 1900~2100 사이 숫자로 입력해 주세요.');
      return;
    }
    await attempt(async () => {
      const rows = mustChange(must(await db.from('works')
        .update(changes)
        .eq('id', work.id)
        .select()));
      Object.assign(work, rows[0]);
      renderThumbs();
      renderStage();
      toast('저장했습니다.');
    }, '저장하지 못했습니다. 다시 시도해 주세요.');
  }

  async function deleteWork(work) {
    if (!confirm(`"${work.title}" 작업물을 삭제하시겠습니까?\n캔버스에 놓인 것도 함께 사라지며, 되돌릴 수 없습니다.`)) return;
    await attempt(async () => {
      mustChange(must(await db.from('works').delete().eq('id', work.id).select('id')));
      await removeFiles([work.path, work.thumb_path]);
      state.works = state.works.filter((w) => w.id !== work.id);
      state.edit.items = state.edit.items.filter((i) => i.workId !== work.id);
      state.view.items = state.view.items.filter((i) => i.workId !== work.id);
      if (state.saved.items.some((i) => i.workId === work.id)) {
        const layout = { ...state.saved, items: state.saved.items.filter((i) => i.workId !== work.id) };
        must(await db.from('site_settings').update({ layout }).eq('id', 1));
        state.saved = layout;
      }
      renderWorkList();
      renderThumbs();
      renderStage();
      toast('삭제했습니다.');
    }, '삭제하지 못했습니다. 다시 시도해 주세요.');
  }

  // ---------- 카테고리 ----------
  function renderCategories() {
    const chips = state.categories.map((name) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(name);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-xs';
      del.textContent = '×';
      del.setAttribute('aria-label', `${name} 카테고리 삭제`);
      del.addEventListener('click', () => deleteCategory(name));
      chip.append(del);
      return chip;
    });
    $('#categoryChips').replaceChildren(...chips);
    const upload = $('#uploadCategory');
    const current = upload.value;
    upload.replaceChildren(...categoryOptions(false));
    upload.value = state.categories.includes(current) ? current : '';
  }

  async function onCategorySubmit(e) {
    e.preventDefault();
    const input = $('#newCategory');
    const name = input.value.trim();
    if (!name || name.length > 30) {
      toast('카테고리 이름은 1~30자로 입력해 주세요.');
      return;
    }
    if (state.categories.includes(name)) {
      toast('이미 있는 카테고리입니다.');
      return;
    }
    await attempt(async () => {
      must(await db.from('categories').insert({ name }).select());
      state.categories.push(name);
      input.value = '';
      renderCategories();
      renderWorkList();
      renderThumbs();
      toast('카테고리를 추가했습니다.');
    }, '카테고리를 추가하지 못했습니다.');
  }

  async function deleteCategory(name) {
    if (!confirm(`"${name}" 카테고리를 삭제하시겠습니까?\n이 카테고리의 작업물은 '미분류'로 바뀝니다.`)) return;
    await attempt(async () => {
      mustChange(must(await db.from('categories').delete().eq('name', name).select('name')));
      state.categories = state.categories.filter((c) => c !== name);
      state.works.forEach((w) => { if (w.category === name) w.category = null; });
      renderCategories();
      renderWorkList();
      renderThumbs();
      toast('카테고리를 삭제했습니다.');
    }, '카테고리를 삭제하지 못했습니다.');
  }

  // ---------- 꾸미기 ----------
  let removeBackground = false;

  async function saveSettings(next) {
    mustChange(must(await db.from('site_settings').update({ settings: next }).eq('id', 1).select('id')));
    state.settings = next;
    applySettings();
  }

  function updateBgStatus() {
    const has = !!state.settings.backgroundPath;
    $('#cBgStatus').textContent = removeBackground
      ? '설정을 저장하면 배경 이미지가 제거됩니다.'
      : has ? '배경 이미지가 설정되어 있습니다.' : '배경 이미지가 없습니다.';
    $('#cBgRemove').hidden = !has || removeBackground;
  }

  function refreshFontSelects() {
    fillFontSelect($('#cTitleFont'), $('#cTitleFont').value || state.settings.titleFont);
    fillFontSelect($('#cSubtitleFont'), $('#cSubtitleFont').value || state.settings.subtitleFont);
    renderTextToolbar();
  }

  function renderFontList() {
    const chips = state.settings.fonts.map((font) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.fontFamily = fontStack(font.family);
      chip.append(`${font.family} (${font.type === 'google' ? '구글' : '파일'})`);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-xs';
      del.textContent = '×';
      del.setAttribute('aria-label', `${font.family} 글꼴 삭제`);
      del.addEventListener('click', () => removeFont(font));
      chip.append(del);
      return chip;
    });
    if (!chips.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '추가한 글꼴이 없습니다. 기본 글꼴은 Pretendard입니다.';
      chips.push(empty);
    }
    $('#fontList').replaceChildren(...chips);
  }

  function openCustomize() {
    const s = state.settings;
    $('#cTitle').value = s.title;
    $('#cSubtitle').value = s.subtitle;
    $('#cColor').value = s.themeColor;
    fillFontSelect($('#cTitleFont'), s.titleFont);
    fillFontSelect($('#cSubtitleFont'), s.subtitleFont);
    $('#cBgFile').value = '';
    removeBackground = false;
    updateBgStatus();
    renderFontList();
    $('#passwordForm').reset();
    $('#passwordMsg').textContent = '';
    $('#customizeModal').showModal();
  }

  async function onCustomizeSubmit(e) {
    e.preventDefault();
    const btn = $('#customizeSaveBtn');
    btn.disabled = true;
    await attempt(async () => {
      const prev = state.settings;
      const next = {
        ...prev,
        title: $('#cTitle').value.trim() || DEFAULT_SETTINGS.title,
        subtitle: $('#cSubtitle').value.trim(),
        themeColor: $('#cColor').value,
        titleFont: $('#cTitleFont').value,
        subtitleFont: $('#cSubtitleFont').value,
      };
      const file = $('#cBgFile').files[0];
      let newPath = null;
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new UserError('배경 이미지는 JPG, PNG, WEBP만 올릴 수 있습니다.');
        if (file.size > MAX_IMAGE_BYTES) throw new UserError('배경 이미지는 20MB 이하만 올릴 수 있습니다.');
        const part = await resizeImage(await createImageBitmap(file), MAX_IMAGE_SIDE, 0.85);
        newPath = `backgrounds/${uid()}.${part.ext}`;
        await uploadBlob(newPath, part);
        next.backgroundPath = newPath;
      } else if (removeBackground) {
        next.backgroundPath = null;
      }
      try {
        await saveSettings(next);
      } catch (err) {
        await removeFiles([newPath]);
        throw err;
      }
      if (prev.backgroundPath && prev.backgroundPath !== next.backgroundPath) await removeFiles([prev.backgroundPath]);
      $('#customizeModal').close();
      toast('꾸미기 설정을 저장했습니다.');
    }, '설정을 저장하지 못했습니다. 다시 시도해 주세요.');
    btn.disabled = false;
  }

  function fontExists(family) {
    return allFonts().some((f) => f.family.toLowerCase() === family.toLowerCase());
  }

  async function onGoogleFontSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const family = $('#gFontName').value.trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-z0-9 ]{1,60}$/.test(family)) {
      toast('구글 폰트 이름은 영문, 숫자, 공백만 입력해 주세요.');
      return;
    }
    if (fontExists(family)) {
      toast('이미 추가된 글꼴입니다.');
      return;
    }
    await attempt(async () => {
      await saveSettings({ ...state.settings, fonts: [...state.settings.fonts, { type: 'google', family }] });
      form.reset();
      refreshFontSelects();
      renderFontList();
      toast(`${family} 글꼴을 추가했습니다.`);
    }, '글꼴을 추가하지 못했습니다.');
  }

  async function onCustomFontSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const family = $('#cfName').value.trim().replace(/\s+/g, ' ');
    const file = $('#cfFile').files[0];
    if (!/^[A-Za-z0-9가-힣 _-]{1,40}$/.test(family)) {
      toast('글꼴 이름은 한글, 영문, 숫자, 공백, -, _ 만 사용해 주세요.');
      return;
    }
    if (fontExists(family)) {
      toast('이미 있는 글꼴 이름입니다.');
      return;
    }
    const ext = (file?.name.split('.').pop() || '').toLowerCase();
    if (!file || !FONT_TYPES[ext]) {
      toast('woff2, woff, ttf, otf 파일만 올릴 수 있습니다.');
      return;
    }
    if (file.size > MAX_FONT_BYTES) {
      toast('글꼴 파일은 10MB 이하만 올릴 수 있습니다.');
      return;
    }
    await attempt(async () => {
      const path = `fonts/${uid()}.${ext}`;
      await uploadBlob(path, { blob: file, type: FONT_TYPES[ext] });
      try {
        await saveSettings({ ...state.settings, fonts: [...state.settings.fonts, { type: 'custom', family, path }] });
      } catch (err) {
        await removeFiles([path]);
        throw err;
      }
      form.reset();
      refreshFontSelects();
      renderFontList();
      toast(`${family} 글꼴을 올렸습니다.`);
    }, '글꼴을 올리지 못했습니다.');
  }

  async function removeFont(font) {
    if (!confirm(`"${font.family}" 글꼴을 삭제하시겠습니까?\n이 글꼴을 쓰던 곳은 기본 글꼴로 보입니다.`)) return;
    await attempt(async () => {
      const s = state.settings;
      const next = {
        ...s,
        fonts: s.fonts.filter((f) => f.family !== font.family),
        titleFont: s.titleFont === font.family ? 'Pretendard' : s.titleFont,
        subtitleFont: s.subtitleFont === font.family ? 'Pretendard' : s.subtitleFont,
      };
      await saveSettings(next);
      if (font.type === 'custom') await removeFiles([font.path]);
      fillFontSelect($('#cTitleFont'), next.titleFont);
      fillFontSelect($('#cSubtitleFont'), next.subtitleFont);
      renderFontList();
      renderTextToolbar();
      toast('글꼴을 삭제했습니다.');
    }, '글꼴을 삭제하지 못했습니다.');
  }

  async function onPasswordSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = $('#passwordMsg');
    const pw = $('#pwNew').value;
    if (pw.length < 8) {
      msg.textContent = '비밀번호는 8자 이상으로 입력해 주세요.';
      return;
    }
    if (pw !== $('#pwConfirm').value) {
      msg.textContent = '두 비밀번호가 서로 다릅니다.';
      return;
    }
    const { error } = await db.auth.updateUser({ password: pw });
    if (error) {
      console.error(error);
      msg.textContent = '비밀번호를 바꾸지 못했습니다. 다시 로그인한 뒤 시도해 주세요.';
      return;
    }
    form.reset();
    msg.textContent = '비밀번호를 변경했습니다.';
  }

  // ---------- 이벤트 연결 ----------
  function requireAdmin(fn) {
    return (...args) => {
      if (!state.isAdmin) {
        toast('관리자로 로그인해 주세요.');
        return undefined;
      }
      return fn(...args);
    };
  }

  function bindUI() {
    const canvas = $('#canvas');
    const stage = $('#stage');

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    canvas.addEventListener('dragover', (e) => {
      if (state.tab !== 'edit') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    canvas.addEventListener('drop', (e) => {
      if (state.tab !== 'edit') return;
      e.preventDefault();
      const work = workById(Number(e.dataTransfer.getData('text/plain')));
      if (work) addWorkToCanvas(work, toStage(e.clientX, e.clientY));
    });

    stage.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="delete"]');
      if (btn && state.tab === 'edit') removeObject(btn.closest('[data-uid]').dataset.uid);
    });
    stage.addEventListener('dblclick', (e) => {
      if (state.tab !== 'edit') return;
      const box = e.target.closest('[data-kind="text"]');
      if (box && state.editingText !== box.dataset.uid) toggleTextEditing(box.dataset.uid);
    });

    $('#zoomInBtn').addEventListener('click', () => zoomCenter(1.2));
    $('#zoomOutBtn').addEventListener('click', () => zoomCenter(1 / 1.2));
    $('#resetViewBtn').addEventListener('click', resetView);
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    $('#loginBtn').addEventListener('click', openLogin);
    $('#logoutBtn').addEventListener('click', logout);
    $('#loginForm').addEventListener('submit', onLoginSubmit);

    $('#openGalleryBtn').addEventListener('click', requireAdmin(openGallery));
    $('#addTextBtn').addEventListener('click', requireAdmin(addTextBox));
    $('#openCustomizeBtn').addEventListener('click', requireAdmin(openCustomize));
    $('#saveLayoutBtn').addEventListener('click', requireAdmin(saveLayout));
    $('#clearCanvasBtn').addEventListener('click', requireAdmin(clearCanvas));

    $('#tbFont').addEventListener('change', (e) => updateSelectedText({ fontFamily: e.target.value }));
    $('#tbSize').addEventListener('change', (e) => updateSelectedText({ fontSize: clamp(parseInt(e.target.value, 10) || 16, 10, 120) }));
    $('#tbColor').addEventListener('change', (e) => updateSelectedText({ color: e.target.value }));
    $('#tbAlign').addEventListener('change', (e) => updateSelectedText({ align: e.target.value }));
    $('#tbEdit').addEventListener('click', () => { if (state.selected) toggleTextEditing(state.selected); });

    $('#thumbFilter').addEventListener('change', (e) => { state.filter = e.target.value; renderThumbs(); });
    $('#thumbYearFilter').addEventListener('change', (e) => { state.yearFilter = e.target.value; renderThumbs(); });

    $('#uploadForm').addEventListener('submit', requireAdmin(onUploadSubmit));
    $('#categoryForm').addEventListener('submit', requireAdmin(onCategorySubmit));
    $('#customizeForm').addEventListener('submit', requireAdmin(onCustomizeSubmit));
    $('#googleFontForm').addEventListener('submit', requireAdmin(onGoogleFontSubmit));
    $('#customFontForm').addEventListener('submit', requireAdmin(onCustomFontSubmit));
    $('#passwordForm').addEventListener('submit', requireAdmin(onPasswordSubmit));
    $('#cBgRemove').addEventListener('click', () => { removeBackground = true; $('#cBgFile').value = ''; updateBgStatus(); });

    // 대화상자: 바깥(배경)을 누르거나 닫기 버튼으로 닫기
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $('#viewerModal').addEventListener('close', () => $('#viewerMedia').replaceChildren());

    document.addEventListener('keydown', (e) => {
      if (state.tab !== 'edit' || !state.selected) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      removeObject(state.selected);
    });

    window.addEventListener('beforeunload', (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  // ---------- 시작 ----------
  async function init() {
    bindUI();
    applySettings();
    renderStage();
    if (!db) {
      showNotice('Supabase 연결 설정이 아직 없습니다. README.md의 "Supabase 설정" 순서대로 js/config.js를 채워 주세요.');
      return;
    }
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      showNotice('전시 데이터를 불러오지 못했습니다. js/config.js 값과 supabase/schema.sql 실행 여부를 확인해 주세요.');
    }
    applySettings();
    renderStage();

    const { data } = await db.auth.getSession();
    await refreshAuth(data.session);
    // 콜백 안에서 바로 Supabase를 호출하면 멈출 수 있어 다음 차례로 미룬다
    db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => refreshAuth(session), 0);
    });
  }

  init();
})();
