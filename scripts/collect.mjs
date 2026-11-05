// 문화포털 '한눈에 보는 문화정보'의 전시 목록을 모아 public/data/exhibitions.json 으로 저장한다.
// 상세 페이지는 처음 보는 전시만 읽어 원본 사이트 부담을 줄인다.
import { readFile, writeFile } from 'node:fs/promises';

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
  .replace(/&#39;|&apos;|&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ')
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
  const title = decode(block.match(/class="tit[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
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
  .map((m) => [m[1], decode(m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))]));

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
      && (key(o.title).includes(k) || k.includes(key(o.title))));
    if (same) return false;
    titles.add(k);
    return true;
  });
  all.push(...fresh);
  console.log(`${label}: 받은 ${list.length}건, 새로 추가 ${fresh.length}건`);
  return fresh;
}

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
  return { ...rest, links, art: ART.test(text) || !OTHER.test(text) };
});
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items: finished, detailCache: undefined }));
const up = finished.filter((e) => e.start > today).length;
console.log(`저장 ${finished.length}건 (예정 ${up}, 국립현대미술관 ${official.length}, 상세 신규 ${fetched}, 실패 ${failed})`);
