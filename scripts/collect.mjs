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
const key = (t) => t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
let official = [];
try { official = await mmca(); } catch (e) { console.warn('국립현대미술관 수집 실패', e.message); }
official = official.filter((e) => e.end >= today);
const taken = new Set(official.map((e) => key(e.title)));
const all = [...items.filter((e) => !taken.has(key(e.title))), ...official]
  .sort((a, b) => a.end.localeCompare(b.end));

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
