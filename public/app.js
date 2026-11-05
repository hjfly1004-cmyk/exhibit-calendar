'use strict';

const $ = (id) => document.getElementById(id);
const PAGE = 30;
const REGIONS = ['전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

const pad = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = toYmd(new Date());
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);
const shortDate = (s) => { const [y, m, d] = s.split('-'); return `${y}.${+m}.${+d}`; };
const monthDay = (s) => { const [, m, d] = s.split('-'); return `${+m}월 ${+d}일`; };

const state = {
  items: [], region: '전국', query: '', free: false, ticket: false, museum: false,
  year: new Date().getFullYear(), month: new Date().getMonth(),
  selected: TODAY, tab: 'day', shown: PAGE,
};

const ticketLink = (e) => e.links.find((l) => l.label.includes('예매'));
const homeLink = (e) => e.links.find((l) => l.label.includes('홈페이지'));

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((e) => {
    if (state.region !== '전국' && e.region !== state.region) return false;
    if (state.free && !e.free) return false;
    if (state.ticket && !ticketLink(e)) return false;
    if (!state.museum && !e.art) return false;
    return !q || `${e.title} ${e.place}`.toLowerCase().includes(q);
  });
}

function badge(e) {
  if (e.start > TODAY) {
    const n = dayDiff(TODAY, e.start);
    return { cls: 'upcoming', text: `${n}일 뒤 시작` };
  }
  const n = dayDiff(TODAY, e.end);
  if (n === 0) return { cls: 'soon', text: '오늘 마감' };
  if (n <= 7) return { cls: 'soon', text: `마감 D-${n}` };
  return { cls: 'running', text: `${monthDay(e.end)}까지` };
}

function renderCalendar(items) {
  const { year, month } = state;
  $('monthLabel').textContent = `${year}년 ${month + 1}월`;
  const grid = $('grid');
  grid.replaceChildren();
  const first = new Date(year, month, 1).getDay();
  const last = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < first; i++) {
    const b = document.createElement('div');
    b.className = 'day blank';
    grid.append(b);
  }
  const days = [];
  for (let d = 1; d <= last; d++) {
    const ymd = `${year}-${pad(month + 1)}-${pad(d)}`;
    let run = 0, start = 0, end = 0;
    for (const e of items) {
      if (e.start <= ymd && e.end >= ymd) run++;
      if (e.start === ymd) start++;
      if (e.end === ymd) end++;
    }
    days.push({ d, ymd, run, start, end });
  }
  const max = Math.max(1, ...days.map((x) => x.run));
  for (const x of days) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    if (x.ymd === TODAY) btn.classList.add('today');
    if (x.ymd === state.selected) btn.classList.add('selected');
    if (x.ymd < TODAY) btn.classList.add('past');
    btn.style.setProperty('--heat', (x.run / max * 0.22).toFixed(3));
    btn.setAttribute('aria-label', `${month + 1}월 ${x.d}일, 전시 ${x.run}건, 시작 ${x.start}건, 마감 ${x.end}건`);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = x.d;
    btn.append(n);
    if (x.start) btn.append(mark('start', `시작${x.start}`));
    if (x.end) btn.append(mark('end', `마감${x.end}`));
    btn.addEventListener('click', () => {
      state.selected = x.ymd;
      state.tab = 'day';
      state.shown = PAGE;
      render();
    });
    grid.append(btn);
  }
}

function mark(cls, text) {
  const s = document.createElement('span');
  s.className = `mark ${cls}`;
  s.textContent = text;
  return s;
}

function listFor(items) {
  if (state.tab === 'ending') {
    return { rows: items.filter((e) => e.start <= TODAY).sort((a, b) => a.end.localeCompare(b.end)), title: '끝나는 날이 가까운 순서' };
  }
  if (state.tab === 'upcoming') {
    return { rows: items.filter((e) => e.start > TODAY).sort((a, b) => a.start.localeCompare(b.start)), title: '시작일이 가까운 순서' };
  }
  const day = state.selected;
  const rows = items.filter((e) => e.start <= day && e.end >= day).sort((a, b) => {
    const rank = (e) => (e.start === day ? 0 : e.end === day ? 1 : 2);
    return rank(a) - rank(b) || a.end.localeCompare(b.end);
  });
  return { rows, title: `${monthDay(day)}에 볼 수 있는 전시` };
}

function renderList(items) {
  const { rows, title } = listFor(items);
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  document.querySelector('[data-tab="day"]').textContent = monthDay(state.selected);
  $('listTitle').textContent = `${title} · ${rows.length}건`;
  const list = $('list');
  list.replaceChildren();
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '조건에 맞는 전시가 없어요. 필터를 바꿔 보세요.';
    list.append(li);
  }
  for (const e of rows.slice(0, state.shown)) list.append(listItem(e));
  $('more').hidden = rows.length <= state.shown;
}

function listItem(e) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'item';
  btn.append(poster(e));
  const body = document.createElement('div');
  const t = document.createElement('strong');
  t.textContent = e.title;
  const place = document.createElement('p');
  place.textContent = [e.region, e.place].filter(Boolean).join(' · ');
  const period = document.createElement('p');
  period.textContent = `${shortDate(e.start)} ~ ${shortDate(e.end)}`;
  const b = badge(e);
  const tag = document.createElement('span');
  tag.className = `badge ${b.cls}`;
  tag.textContent = b.text;
  body.append(t, place, period, tag);
  if (ticketLink(e)) {
    const p = document.createElement('span');
    p.className = 'badge plain';
    p.textContent = '예매';
    body.append(p);
  }
  if (e.free) {
    const p = document.createElement('span');
    p.className = 'badge plain';
    p.textContent = '무료';
    body.append(p);
  }
  btn.append(body);
  btn.addEventListener('click', () => openSheet(e));
  li.append(btn);
  return li;
}

function poster(e) {
  if (!e.image) {
    const d = document.createElement('span');
    d.className = 'thumb-empty';
    return d;
  }
  const img = document.createElement('img');
  img.src = e.image;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
  return img;
}

function action(text, url, cls = '') {
  const a = document.createElement('a');
  a.className = `action ${cls}`;
  a.textContent = text;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function openSheet(e) {
  const sheet = $('sheet');
  sheet.replaceChildren();
  const close = document.createElement('button');
  close.className = 'sheet-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '닫기');
  close.addEventListener('click', () => history.back());

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const info = document.createElement('div');
  const h = document.createElement('h3');
  h.id = 'sheetTitle';
  h.textContent = e.title;
  const b = badge(e);
  const tag = document.createElement('span');
  tag.className = `badge ${b.cls}`;
  tag.textContent = b.text;
  info.append(h, tag);
  head.append(poster(e), info);

  const facts = document.createElement('dl');
  facts.className = 'facts';
  const rows = [
    ['기간', `${shortDate(e.start)} ~ ${shortDate(e.end)}`],
    ['장소', [e.region, e.place].filter(Boolean).join(' · ')],
    ['시간', e.hours], ['요금', e.fee], ['문의', e.phone],
  ];
  for (const [k, v] of rows) {
    if (!v) continue;
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    row.append(dt, dd);
    facts.append(row);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const ticket = ticketLink(e), home = homeLink(e);
  if (ticket) actions.append(action('예매하기', ticket.url, 'primary'));
  if (home) actions.append(action('전시 안내 사이트', home.url, ticket ? 'dark' : 'primary'));
  if (e.place) actions.append(action('지도에서 찾기', `https://map.naver.com/p/search/${encodeURIComponent(e.mapQuery || e.place)}`));
  if (e.source !== home?.url) actions.append(action('문화포털 상세 정보', e.source));

  sheet.append(close, head, facts, actions);
  sheet.hidden = false;
  $('sheetBack').hidden = false;
  sheet.scrollTop = 0;
  history.pushState({ sheet: true }, '');
}

function hideSheet() {
  $('sheet').hidden = true;
  $('sheetBack').hidden = true;
}

function render() {
  const items = filtered();
  renderCalendar(items);
  renderList(items);
}

function moveMonth(step) {
  const d = new Date(state.year, state.month + step, 1);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  render();
}

function bindUi() {
  const regions = $('regions');
  for (const r of REGIONS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = r;
    c.setAttribute('aria-pressed', String(r === state.region));
    c.addEventListener('click', () => {
      state.region = r;
      state.shown = PAGE;
      regions.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      render();
    });
    regions.append(c);
  }
  document.querySelectorAll('.toggle').forEach((t) => t.addEventListener('click', () => {
    const k = t.dataset.toggle;
    state[k] = !state[k];
    state.shown = PAGE;
    t.setAttribute('aria-pressed', String(state[k]));
    render();
  }));
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    state.shown = PAGE;
    render();
  }));
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.shown = PAGE;
    render();
  });
  $('prevMonth').addEventListener('click', () => moveMonth(-1));
  $('nextMonth').addEventListener('click', () => moveMonth(1));
  $('todayBtn').addEventListener('click', () => {
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth();
    state.selected = TODAY;
    state.tab = 'day';
    state.shown = PAGE;
    render();
  });
  $('more').addEventListener('click', () => {
    state.shown += PAGE;
    render();
  });
  $('sheetBack').addEventListener('click', () => history.back());
  window.addEventListener('popstate', hideSheet);

  let x0 = null;
  const cal = document.querySelector('.calendar');
  cal.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  cal.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) moveMonth(dx < 0 ? 1 : -1);
  });
}

async function load() {
  try {
    const res = await fetch('data/exhibitions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.items = data.items.filter((e) => e.end >= TODAY);
    const when = new Date(data.updatedAt);
    const old = (Date.now() - when) / 864e5 > 3;
    $('updated').textContent = `${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())} 기준 · ${state.items.length}건${old ? ' · 오래된 정보일 수 있어요' : ''}`;
    render();
  } catch {
    $('updated').textContent = '전시 정보를 불러오지 못했어요';
    $('listTitle').textContent = '인터넷 연결을 확인한 뒤 다시 열어 주세요.';
  }
}

/* 카카오톡 등 앱 내부 브라우저에서는 설치가 안 되므로 크롬으로 넘긴다. */
function setupInAppGate() {
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua);
  if (!inApp) return false;
  const { host, pathname, search } = location;
  const fallback = encodeURIComponent(location.href);
  const intent = `intent://${host}${pathname}${search}#Intent;scheme=${location.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  $('gate').hidden = false;
  $('gateChrome').href = android ? intent : location.href;
  $('gateSkip').addEventListener('click', () => { $('gate').hidden = true; });
  if (android) location.href = intent;
  return true;
}

/* 크롬에서는 설치 안내를 띄운다. */
function setupInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  if (standalone || localStorage.getItem('installClosed')) return;
  let prompt = null;
  const box = $('install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    $('installBtn').hidden = false;
    $('installText').textContent = '홈 화면에서 바로 열 수 있어요.';
    box.hidden = false;
  });
  window.addEventListener('appinstalled', () => { box.hidden = true; });
  setTimeout(() => {
    if (prompt || !/Android/i.test(navigator.userAgent)) return;
    $('installBtn').hidden = true;
    $('installText').textContent = '오른쪽 위 ⋮ 메뉴 → 앱 설치 또는 홈 화면에 추가를 누르세요.';
    box.hidden = false;
  }, 3500);
  $('installBtn').addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    box.hidden = true;
  });
  $('installClose').addEventListener('click', () => {
    box.hidden = true;
    localStorage.setItem('installClosed', '1');
  });
}

bindUi();
load();
if (!setupInAppGate()) setupInstall();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
