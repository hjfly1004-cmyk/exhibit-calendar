// PC에서 하루 한 번 실행한다. 네오룩이 해외 서버 접속을 막아서 GitHub에서는 읽을 수 없다.
// 공개 등록 목록 한 페이지만 읽고(상세 경로는 robots.txt 금지), 끝나지 않은 전시를 data/neolook.json에 쌓는다.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/neolook.json', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; exhibition-calendar/1.0)';
const text = (s) => s.replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const res = await fetch('https://neolook.com/upload-list', {
  headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
});
if (!res.ok) throw new Error(`네오룩 응답 ${res.status}`);
const html = await res.text();

const found = [];
for (const m of html.matchAll(/<a class="h-15[^"]*" href="\/archives\/(\w+)">([\s\S]*?)<\/a>/g)) {
  const rows = [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
  const period = rows.find((r) => r.includes('▶')) || '';
  const d = period.match(/(20\d\d)_(\d\d)(\d\d)\s*▶\s*(20\d\d)_(\d\d)(\d\d)/);
  const placeRow = rows.find((r) => r.startsWith('@')) || '';
  if (!d || !rows[0]) continue;
  const name = rows[0].split(' / ')[0].trim();
  const sub = rows[1] && rows[1] !== period && !rows[1].startsWith('@') ? rows[1].split(' / ')[0].trim() : '';
  found.push({
    code: m[1],
    title: sub ? `${name} · ${sub}` : name,
    start: `${d[1]}-${d[2]}-${d[3]}`,
    end: `${d[4]}-${d[5]}-${d[6]}`,
    place: placeRow.replace(/^@\s*/, '').split('|')[0].trim(),
  });
}
if (found.length < 20) throw new Error(`목록이 너무 적어 저장하지 않습니다: ${found.length}건`);

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const merged = new Map();
try {
  for (const e of JSON.parse(await readFile(OUT, 'utf8'))) merged.set(e.code, e);
} catch { /* 첫 실행 */ }
for (const e of found) merged.set(e.code, e);
const live = [...merged.values()].filter((e) => e.end >= today).sort((a, b) => a.code.localeCompare(b.code));
await writeFile(OUT, `${JSON.stringify(live)}\n`);
console.log(`네오룩 목록 ${found.length}건, 저장 ${live.length}건`);
