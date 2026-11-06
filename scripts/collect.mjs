// 문화포털 '한눈에 보는 문화정보'의 전시 목록을 모아 public/data/exhibitions.json 으로 저장한다.
// 상세 페이지는 처음 보는 전시만 읽어 원본 사이트 부담을 줄인다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://www.culture.go.kr';
const LIST = `${BASE}/portal/cltInfo/oneCltInfo/oneEyeDetailView.do?viewType=CONTBODY`;
const VIEW = `${BASE}/portal/cltInfo/oneCltInfo/oneCltInfoView.do?menuNo=200010&pblprfrSn=`;
const OUT = new URL('../public/data/exhibitions.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; exhibition-calendar/1.0)';
const DELAY = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s = '') => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;|&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&times;/g, '×').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function get(url, init) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init?.headers }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.text();
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === 2) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

const field = (html, label) => {
  const m = html.match(new RegExp(String.raw`<dt[^>]*>\s*${label}\s*</dt>\s*<dd[^>]*>([\s\S]*?)</dd>`));
  return m ? decode(m[1]) : '';
};

function parseDates(text) {
  const m = [...(text || '').matchAll(/(20\d{2})[-.\s]+(\d{1,2})[-.\s]+(\d{1,2})/g)];
  const iso = (x) => `${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`;
  return m.length ? [iso(m[0]), iso(m[m.length - 1])] : [null, null];
}

function parseCard(block) {
  const id = block.match(/name="subSeq" value="(\d+)"/)?.[1];
  if (!id) return null;
  const img = block.match(/<img src="([^"]+)"\s+alt="([^"]*)"/);
  const tags = [...block.matchAll(/<li class="tag[^"]*">\s*<span class="txt">\s*([^<]*?)\s*<\/span>/g)].map((m) => decode(m[1]));
  const title = decode(decode(block.match(/class="tit[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]));
  let [start, end] = parseDates(field(block, '기간'));
  if (!start) [start, end] = parseDates(decode(img?.[2]));
  return {
    id, title, start, end,
    place: field(block, '장소'),
    phone: field(block, '문의'),
    region: tags.at(-1) || '',
    free: tags.includes('무료'),
    image: img ? (img[1].startsWith('http') ? img[1] : BASE + img[1]) : '',
  };
}

const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const LONG = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남' };
function normRegion(text) {
  for (const [k, v] of Object.entries(LONG)) if (text.includes(k)) return v;
  return REGIONS.find((r) => text.startsWith(r)) || '';
}

async function listAll(extra = '') {
  const items = new Map();
  for (let page = 1; page < 200; page++) {
    const html = await get(LIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `pageIndex=${page}&menuNo=200010&sGubun=T&srvcSeCdTab=02${extra}`,
    });
    const cards = html.split('<li class="list">').slice(1).map(parseCard).filter(Boolean);
    if (!cards.length) break;
    cards.forEach((c) => items.set(c.id, c));
    await sleep(DELAY);
  }
  return [...items.values()];
}

async function detail(id) {
  const html = await get(VIEW + id);
  const links = [...html.matchAll(/<a class="btn-blank" href="([^"]+)"[^>]*>\s*<span class="txt">([^<]+)<\/span>/g)]
    .map((m) => ({ label: decode(m[2]), url: decode(m[1]) }))
    .filter((l) => /^https?:\/\//.test(l.url) && l.label !== '영상보기');
  return {
    links,
    hours: field(html, '공연시간'),
    fee: field(html, '가격'),
    detailPlace: field(html, '장소'),
  };
}

// 국립현대미술관: 예정 전시와 예매 링크를 공식 목록에서 직접 받는다.
const MMCA = 'https://www.mmca.go.kr';
const MMCA_BRANCH = {
  서울: ['서울', '국립현대미술관 서울'], 덕수궁: ['서울', '국립현대미술관 덕수궁'],
  과천: ['경기', '국립현대미술관 과천'], 어린이미술관: ['경기', '국립현대미술관 과천 어린이미술관'],
  청주: ['충북', '국립현대미술관 청주'], 레지던시: ['서울', '국립현대미술창작스튜디오'],
};
async function mmca() {
  const out = [];
  for (const flag of [1, 2]) {
    const text = await get(`${MMCA}/exhibitions/AjaxExhibitionList.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: `exhFlag=${flag}&searchExhPlaCd=&searchExhCd=&sort=&pageIndex=1&pageUnit=60`,
    });
    for (const e of JSON.parse(text).exhibitionsList || []) {
      const [region, name] = MMCA_BRANCH[e.exhPlaNm] || ['서울', `국립현대미술관 ${e.exhPlaNm}`];
      const page = `${MMCA}/exhibitions/exhibitionsDetail.do?exhFlag=${flag}&exhId=${e.exhId}`;
      const links = [{ label: '공식 홈페이지', url: page }];
      if (e.bookingUrl) links.push({ label: '예매 바로가기', url: e.bookingUrl });
      out.push({
        id: `mmca-${e.exhId}`, title: decode(e.exhTitle), start: e.exhStDt, end: e.exhEdDt,
        place: [name, e.exhPlaDtl].filter((x) => x && x !== '-').join(' '),
        phone: '', region, free: e.exhAdm === '0',
        image: e.exhDidImg ? MMCA + e.exhDidImg : '', links, hours: '', mapQuery: name,
        desc: decode(e.exhContentsSumm || ''), text: [e.exhContentsSumm, e.exhThemewd, e.exhArtist, e.exhTpCd].join(' '),
        fee: e.exhAdm === '0' ? '무료' : (e.exhAdm && e.exhAdm !== '-' ? e.exhAdm : ''), source: page,
      });
    }
    await sleep(DELAY);
  }
  return out;
}

const kst = new Date(Date.now() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const today = ymd(kst);
const future = ymd(new Date(kst.getTime() + 730 * 864e5)).replaceAll('-', '');
const tomorrow = ymd(new Date(kst.getTime() + 864e5)).replaceAll('-', '');

const prev = new Map();
try {
  for (const e of JSON.parse(await readFile(OUT, 'utf8')).items) prev.set(e.id, e);
} catch { /* 첫 실행 */ }

const merged = new Map();
for (const c of [...await listAll(), ...await listAll(`&sSdate=${tomorrow}&sEdate=${future}`)]) merged.set(c.id, c);
console.log(`문화포털 ${merged.size}건`);
if (merged.size < 50) throw new Error('목록이 너무 적어 기존 데이터를 유지합니다');

const live = [...merged.values()].filter((c) => c.start && c.end && c.end >= today && !/온라인/.test(c.title));
let fetched = 0, failed = 0;
const items = [];
for (const c of live) {
  const old = prev.get(c.id);
  let d = old?.links ? old : null;
  if (!d) {
    try { d = await detail(c.id); fetched++; await sleep(DELAY); }
    catch { d = { links: [], hours: '', fee: '', detailPlace: '' }; failed++; }
  }
  const [dr = '', dp = ''] = (d.detailPlace || '').split('|').map((x) => x.trim());
  items.push({
    ...c,
    place: c.place || dp || d.place || '',
    region: normRegion(c.region) || normRegion(dr) || d.region || '',
    links: d.links, hours: d.hours, fee: d.fee || (c.free ? '무료' : ''), detailPlace: d.detailPlace,
    source: VIEW + c.id,
  });
}

// 같은 전시가 양쪽에 있으면 예매 링크가 정확한 국립현대미술관 항목을 남긴다.
const key = (t) => t.replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
let official = [];
try { official = await mmca(); } catch (e) { console.warn('국립현대미술관 수집 실패', e.message); }
official = official.filter((e) => e.end >= today);
const taken = new Set(official.map((e) => key(e.title)));
let all = [...items.filter((e) => !taken.has(key(e.title))), ...official];

// 인증키가 있는 API로 목록에 없는 전시만 덧붙인다. 실패해도 기존 수집 결과는 유지한다.
const isoDate = (s = '') => {
  const m = String(s).match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const xmlTags = (xml) => Object.fromEntries([...xml.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)]
  .map((m) => [m[1], decode(decode(m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))]));

async function cultureApi(apiKey) {
  const k = apiKey.includes('%') ? apiKey : encodeURIComponent(apiKey);
  const api = 'https://apis.data.go.kr/B553457/cultureinfo';
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const q = `serviceKey=${k}&PageNo=${page}&numOfrows=100&serviceTp=A&realmCode=D000&from=${today.replaceAll('-', '')}&to=${future}`;
    const xml = await get(`${api}/realm2?${q}`);
    const rows = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => xmlTags(m[1]));
    if (page === 1) {
      console.log('한눈에 API 응답', xml.match(/<resultCode>[^<]*|<totalCount>[^<]*/g), '항목', Object.keys(rows[0] || {}).join(','));
    }
    if (!rows.length) break;
    for (const r of rows) {
      const start = isoDate(r.startDate), end = isoDate(r.endDate);
      if (!r.title || !start || !end) continue;
      out.push({
        id: `kcisa-${r.seq}`, title: r.title, start, end, place: r.place || '',
        region: normRegion(r.area || r.sido || ''), free: false, phone: '',
        image: (r.thumbnail || '').replace(/^http:/, 'https:'), links: [], hours: '', fee: '',
        seq: r.seq, source: VIEW + r.seq,
      });
    }
    await sleep(DELAY);
  }
  return out;
}

async function cultureDetail(apiKey, e) {
  const old = prev.get(e.id);
  if (old?.links?.length) return { ...e, links: old.links, phone: old.phone, fee: old.fee };
  const k = apiKey.includes('%') ? apiKey : encodeURIComponent(apiKey);
  const xml = await get(`https://apis.data.go.kr/B553457/cultureinfo/detail2?serviceKey=${k}&seq=${e.seq}`);
  const d = xmlTags(xml.match(/<item>([\s\S]*?)<\/item>/)?.[1] || '');
  await sleep(DELAY);
  const url = d.url || d.placeUrl || '';
  return {
    ...e, phone: d.phone || '', fee: d.price || '', free: /무료/.test(d.price || ''),
    links: /^https?:\/\//.test(url) ? [{ label: '공식 홈페이지', url }] : [],
  };
}

async function seoulApi(apiKey) {
  const out = [];
  for (let from = 1; from <= 5000; from += 1000) {
    const text = await get(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(apiKey)}/json/culturalEventInfo/${from}/${from + 999}/${encodeURIComponent('전시/미술')}/`);
    const body = JSON.parse(text).culturalEventInfo;
    if (from === 1) console.log('서울 API 응답', body?.RESULT?.CODE, body?.list_total_count);
    if (!body?.row?.length) break;
    for (const r of body.row) {
      const start = isoDate(r.STRTDATE), end = isoDate(r.END_DATE);
      if (!r.TITLE || !start || !end) continue;
      const links = /^https?:\/\//.test(r.ORG_LINK || '') ? [{ label: '공식 홈페이지', url: r.ORG_LINK }] : [];
      const detailUrl = /^https?:\/\//.test(r.HMPG_ADDR || '') ? r.HMPG_ADDR : '';
      if (!links.length && detailUrl) links.push({ label: '공식 홈페이지', url: detailUrl });
      out.push({
        id: `seoul-${key(r.TITLE).slice(0, 40)}-${start}`, title: decode(r.TITLE), start, end,
        place: decode(r.PLACE || ''), region: '서울', free: r.IS_FREE === '무료', phone: decode(r.INQUIRY || ''),
        image: (r.MAIN_IMG || '').replace(/^http:/, 'https:'), links, hours: decode(r.PRO_TIME || ''),
        fee: decode(r.USE_FEE || ''), source: detailUrl || links[0]?.url || '',
        desc: decode(r.ETC_DESC || r.PROGRAM || ''), text: [r.PROGRAM, r.ETC_DESC, r.PLAYER].join(' '),
      });
    }
    if (from + 999 >= body.list_total_count) break;
    await sleep(DELAY);
  }
  return out;
}

function addNew(list, label) {
  const titles = new Set(all.map((e) => key(e.title)));
  const fresh = list.filter((e) => {
    if (e.end < today || /온라인/.test(e.title)) return false;
    const k = key(e.title);
    if (!k || titles.has(k)) return false;
    const same = all.some((o) => o.start === e.start && o.end === e.end
      && (key(o.title).includes(k) || k.includes(key(o.title))
        || (key(e.place).length > 1 && key(o.place).includes(key(e.place)))));
    if (same) return false;
    titles.add(k);
    return true;
  });
  all.push(...fresh);
  console.log(`${label}: 받은 ${list.length}건, 새로 추가 ${fresh.length}건`);
  return fresh;
}

// 네오룩 공개 등록 목록: 사립 갤러리 전시와 오픈 예정 전시가 많다.
// 목록 페이지만 읽고(상세 경로는 robots.txt 금지), 이미 받은 전시는 끝날 때까지 유지한다.
const placeRegion = new Map(all.filter((e) => e.place && e.region).map((e) => [key(e.place), e.region]));
const MEDIA = [
  [/photo/i, '사진 작품'], [/sculpture|object/i, '조각'], [/installation/i, '설치 작품'],
  [/painting/i, '회화'], [/video|media|new media/i, '미디어 아트'], [/ceramic|craft/i, '공예'],
  [/drawing/i, '드로잉'], [/print/i, '판화'],
];

async function neolook() {
  const html = await get('https://neolook.com/upload-list');
  const out = [];
  for (const m of html.matchAll(/<a class="h-15[^"]*" href="\/archives\/(\w+)">([\s\S]*?)<\/a>/g)) {
    const rows = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => decode(x[1]));
    const line = rows.find((r) => /▶/.test(r)) || '';
    const d = line.match(/(20\d\d)_(\d\d)(\d\d)\s*▶\s*(20\d\d)_(\d\d)(\d\d)/);
    const placeRow = rows.find((r) => r.startsWith('@')) || '';
    if (!d || !rows[0]) continue;
    const parts = rows[0].split(' / ').map((x) => x.trim());
    const sub = rows[1] && rows[1] !== line && !rows[1].startsWith('@') ? rows[1].split(' / ')[0].trim() : '';
    const place = placeRow.replace(/^@\s*/, '').split('|')[0].trim();
    const medium = parts.at(-1);
    const url = 'https://neolook.com/archives/' + m[1];
    out.push({
      id: 'neolook-' + m[1],
      title: sub ? parts[0] + ' · ' + sub : parts[0],
      start: d[1] + '-' + d[2] + '-' + d[3], end: d[4] + '-' + d[5] + '-' + d[6],
      place, region: placeRegion.get(key(place)) || normRegion(place) || REGIONS.find((r) => place.includes(r)) || '',
      free: false, phone: '', image: '', hours: '', fee: '',
      links: [{ label: '공식 홈페이지', url }], source: url, desc: '',
      text: '동시대 ' + MEDIA.filter(([re]) => re.test(medium)).map(([, t]) => t).join(' '),
    });
  }
  console.log('네오룩 목록', out.length);
  const fresh = new Set(out.map((e) => e.id));
  const kept = [...prev.values()].filter((e) => e.id.startsWith('neolook-') && !fresh.has(e.id));
  return [...out, ...kept];
}

try { addNew(await neolook(), '네오룩'); }
catch (e) { console.warn('네오룩 수집 실패', e.message); }

if (process.env.SEOUL_API_KEY) {
  try { addNew(await seoulApi(process.env.SEOUL_API_KEY), '서울 API'); }
  catch (e) { console.warn('서울 API 실패', e.message.replaceAll(process.env.SEOUL_API_KEY, '***')); }
}
if (process.env.CULTURE_API_KEY) {
  const apiKey = process.env.CULTURE_API_KEY;
  try {
    const fresh = addNew(await cultureApi(apiKey), '한눈에 API');
    for (const e of fresh) {
      try { Object.assign(e, await cultureDetail(apiKey, e)); } catch { /* 목록 정보만 사용 */ }
      delete e.seq;
    }
  } catch (e) { console.warn('한눈에 API 실패', e.message.replaceAll(apiKey, '***')); }
}
// 전시 소개글을 모아 둔다. 한 번 받은 글은 저장해 두고 다시 요청하지 않는다.
const TEXT = new URL('../data/text-cache.json', import.meta.url);
let texts = {};
try { texts = JSON.parse(await readFile(TEXT, 'utf8')); } catch { /* 첫 실행 */ }
const textKey = process.env.CULTURE_API_KEY;
let textNew = 0, textFail = 0, textLogged = false;
for (const e of all) {
  if (e.text !== undefined) {
    texts[e.id] = { ...texts[e.id], d: (e.desc || '').slice(0, 400), t: decode(e.text).slice(0, 1500) };
    delete e.text;
    delete e.desc;
    continue;
  }
  const seq = /^\d+$/.test(e.id) ? e.id : e.id.startsWith('kcisa-') ? e.id.slice(6) : null;
  if (!seq || !textKey || texts[e.id]) continue;
  try {
    const k = textKey.includes('%') ? textKey : encodeURIComponent(textKey);
    const xml = await get('https://apis.data.go.kr/B553457/cultureinfo/detail2?serviceKey=' + k + '&seq=' + seq);
    const d = xmlTags(xml.match(/<item>([\s\S]*?)<\/item>/)?.[1] || '');
    const vals = Object.values(d).filter((v) => v && !/^https?:/.test(v)).sort((a, b) => b.length - a.length);
    if (!textLogged) {
      console.log('상세 항목', Object.entries(d).map(([n, v]) => n + ':' + v.length).join(','));
      textLogged = true;
    }
    texts[e.id] = { d: (vals[0] || '').length > 40 ? vals[0].slice(0, 400) : '', t: vals.join(' ').slice(0, 1500) };
    textNew++;
    await sleep(120);
  } catch { textFail++; }
}
// 소개글이 없는 전시는 공식 페이지에서 보충한다. robots.txt가 막은 곳은 읽지 않고, 한 번 읽은 곳은 다시 읽지 않는다.
const SKIP_HOST = /(^|\.)(neolook\.com|naver\.com|instagram\.com|facebook\.com|youtube\.com|youtu\.be|culture\.go\.kr|kakao\.com|interpark\.com|ticketlink\.co\.kr)$/;
const robotsCache = new Map();

async function quickFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  const buf = await res.arrayBuffer();
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
  const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]
    || head.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = new TextDecoder().decode(buf); }
  return { status: res.status, type: res.headers.get('content-type') || '', text };
}

function robotsAllows(txt, path) {
  let active = false, seenRule = false;
  const rules = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toLowerCase(), value = m[2].trim();
    if (name === 'user-agent') {
      if (seenRule) { active = false; seenRule = false; }
      if (value === '*') active = true;
    } else if (name === 'allow' || name === 'disallow') {
      seenRule = true;
      if (active && value) rules.push({ allow: name === 'allow', value });
    }
  }
  const matches = (v) => new RegExp('^' + v.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).test(path);
  const hit = rules.filter((r) => matches(r.value)).sort((a, b) => b.value.length - a.value.length)[0];
  return !hit || hit.allow;
}

async function mayRead(u) {
  if (!robotsCache.has(u.origin)) {
    let txt = '';
    try {
      const r = await quickFetch(u.origin + '/robots.txt');
      if (r.status >= 500 || r.status === 401 || r.status === 403) txt = 'User-agent: *\nDisallow: /';
      else if (r.status === 200 && !/html/i.test(r.type)) txt = r.text;
    } catch { txt = 'User-agent: *\nDisallow: /'; }
    robotsCache.set(u.origin, txt);
  }
  return robotsAllows(robotsCache.get(u.origin), u.pathname + u.search);
}

function pageText(html, title) {
  const meta = decode(html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']*)/i)?.[1] || '');
  const body = decode(html.replace(/<(script|style|nav|header|footer|noscript)\b[\s\S]*?<\/\1>/gi, ' '));
  const probe = title.replace(/^(\s*\[[^\]]*\]\s*)+/, '').slice(0, 10);
  const at = probe.length >= 4 ? body.indexOf(probe) : -1;
  return { meta, window: at >= 0 ? body.slice(at, at + 800) : '' };
}

const webStat = { read: 0, blocked: 0, failed: 0, found: 0 };
const metaSeen = new Map();
let webBudget = 260;
for (const e of all) {
  const info = texts[e.id] ||= {};
  if (info.wt || info.d || webBudget <= 0) continue;
  const link = e.links.find((l) => !/예매/.test(l.label)) || e.links[0];
  if (!link) continue;
  let u;
  try { u = new URL(link.url); } catch { continue; }
  if (SKIP_HOST.test(u.hostname)) { info.wt = 3; continue; }
  webBudget--;
  try {
    if (!await mayRead(u)) { info.wt = 2; webStat.blocked++; continue; }
    const r = await quickFetch(u.href);
    info.wt = 1;
    if (r.status !== 200 || !/html/i.test(r.type)) { webStat.failed++; continue; }
    webStat.read++;
    const p = pageText(r.text, e.title);
    info.w = p.window;
    if (p.window) webStat.found++;
    if (p.meta.length > 40) {
      const k = u.hostname + '|' + p.meta;
      if (!metaSeen.has(k)) metaSeen.set(k, { meta: p.meta, ids: [] });
      metaSeen.get(k).ids.push(e.id);
    }
  } catch { webStat.failed++; }
  await sleep(300);
}
// 같은 사이트의 여러 전시에 똑같이 붙은 설명은 사이트 소개문이므로 쓰지 않는다.
for (const { meta, ids } of metaSeen.values()) {
  if (ids.length > 1) continue;
  const info = texts[ids[0]];
  info.w = ((info.w || '') + ' ' + meta).trim();
  info.d = meta.slice(0, 200);
}
console.log('공식 페이지', JSON.stringify(webStat));

const liveIds = new Set(all.map((e) => e.id));
texts = Object.fromEntries(Object.entries(texts).filter(([id]) => liveIds.has(id)));
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(TEXT, JSON.stringify(texts));
console.log('소개글 신규 ' + textNew + '건, 실패 ' + textFail + '건, 보유 ' + Object.keys(texts).length + '건');

// 소개글과 제목의 단어로 분류한다. 한 전시에 여러 분류가 붙을 수 있다.
const TAGS = [
  ['현대미술', /현대미술(?!관)|동시대|컨템포러리|contemporary|신진\s?작가|레지던시|입주\s?작가|개념미술/i],
  ['동양·한국미술', /한국화|동양화|수묵|서예|문인화|민화|산수화|사군자|채색화|진경|서화/],
  ['서양미술', /서양\s?(미술|화|회화)|유럽\s?(미술|회화)|인상주의|르네상스|프랑스\s?(미술|작가|화가)|(미국|유럽)\s?모더니즘/],
  ['근대·고미술', /근대미술|근현대미술|고미술|고서화|조선\s?(시대|회화|백자)|고려청자/],
  ['회화', /회화|유화|아크릴|캔버스|수채|페인팅|painting/i],
  ['사진', /사진전|사진\s?작가|사진가|사진\s?작품|포토그래피|photograph/i],
  ['조각·설치', /조각|설치\s?(미술|작품|작업)|입체|sculpture|installation/i],
  ['미디어아트', /미디어\s?아트|뉴미디어|영상\s?(작품|설치|미술)|미디어\s?(작품|설치)|video art|디지털\s?아트/i],
  ['공예·도자', /공예|도자|도예|섬유|금속\s?(공예|작품)|옻칠|유리\s?작품/],
  ['판화·드로잉', /판화|드로잉|일러스트|drawing/i],
  ['디자인·건축', /디자인전|건축전|건축가|그래픽\s?디자인/],
  ['어린이·가족', /어린이|가족|그림책/],
];

// 원본 자료가 전남 전시를 '광주'로 묶어 두는 경우가 있어 지명으로 바로잡는다.
const JEONNAM = /전남|전라남도|목포|여수|순천|나주|광양|담양|곡성|구례|고흥|보성|화순|장흥|강진|해남|영암|무안|함평|영광|장성|완도|진도|신안/;
for (const e of all) if (e.region === '광주' && JEONNAM.test(`${e.place} ${e.title}`)) e.region = '전남';
all = all.sort((a, b) => a.end.localeCompare(b.end));

// 티켓 판매처로 연결되는 링크는 '예매'로 표시하고, 전시가 아닌 공고는 뺀다.
const TICKET = /interpark|nol.yanolja|nol.com|ticketlink|yes24|melon|booking.|booking.naver|timeticket|ticket/i;
const ART = /미술|예술|갤러리|gallery|아트|art|화랑|개인전|사진전|조각|회화|판화|도예|공예|비엔날레|레지던시|창작/i;
const OTHER = /박물관|유물|역사|기념관|문학관|과학|영화체험|발굴|사료|독립운동|향토/;
const NOTICE = /모집|공모|접수|강좌|수강생/;
const finished = all.filter((e) => !NOTICE.test(e.title)).map((e) => {
  const text = `${e.title} ${e.place}`;
  const links = e.links.map((l) => (TICKET.test(l.url) ? { ...l, label: '예매 바로가기' } : l));
  const { detailPlace, ...rest } = e;
  const info = texts[e.id] || {};
  const base = e.title + ' ' + (info.t || '');
  const body = base + ' ' + (info.w || '');
  // 사이트 메뉴의 '어린이' 같은 단어에 끌려가지 않도록 이 분류는 제목과 공식 자료만 본다.
  const tags = TAGS.filter(([n, re]) => re.test(n === '어린이·가족' ? base : body)).map(([n]) => n);
  return { ...rest, links, desc: info.d || '', tags, art: ART.test(text) || !OTHER.test(text) };
});
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items: finished, detailCache: undefined }));
const up = finished.filter((e) => e.start > today).length;
const tagCount = {};
finished.forEach((e) => e.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
console.log('분류', JSON.stringify(tagCount), '미분류', finished.filter((e) => !e.tags.length).length);
console.log(`저장 ${finished.length}건 (예정 ${up}, 국립현대미술관 ${official.length}, 상세 신규 ${fetched}, 실패 ${failed})`);
