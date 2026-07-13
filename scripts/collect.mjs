/**
 * UX의 언어들 — 서점 순위 수집기
 *
 * 예스24  : 일반 HTTP fetch (서버 렌더링)
 * 교보문고 : Playwright (Next.js 클라이언트 렌더링이라 브라우저 필수)
 *
 * 결과를 data/history.json 에 누적한다.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// ────────────────────────────────────────────────────────────
const BOOK = {
  yes24Id: "193444437",
  kyoboCode: "S000220493173",
  isbn: "9791171521470",
};

const Y = {
  product: `https://www.yes24.com/product/goods/${BOOK.yes24Id}`,
  // categoryNumber, pageNumber 를 채워 쓴다
  best: (cat, page) =>
    `https://www.yes24.com/product/category/bestseller?categoryNumber=${cat}&pageNumber=${page}&pageSize=100`,
  CAT_MKT: "001001025009", // 경제경영 > 마케팅/세일즈
  CAT_ECON: "001001025", // 경제경영 종합
};

const K = {
  product: `https://product.kyobobook.co.kr/detail/${BOOK.kyoboCode}`,
  onlineWeeklyEcon: (p) =>
    `https://store.kyobobook.co.kr/bestseller/online/weekly/domestic/13?page=${p}`,
  catWebsite: "https://store.kyobobook.co.kr/category/domestic/3319/best",
  catUxui: "https://store.kyobobook.co.kr/category/domestic/331902/best",
  totalEcon: "https://store.kyobobook.co.kr/bestseller/total/weekly/economics",
  totalTech: "https://store.kyobobook.co.kr/bestseller/total/weekly/tech",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const HISTORY_PATH = "data/history.json";

// ────────────────────────────────────────────────────────────
// 유틸

const log = (...a) => console.log("·", ...a);

function kstNowISO() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().replace("Z", "+09:00");
}

async function getHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

/** HTML → 텍스트. script/style을 걷어내고 태그를 공백으로 바꾼다. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/**
 * 예스24 베스트셀러 목록 HTML에서 상품번호를 등장 순서대로 뽑는다.
 * 한 항목이 같은 링크를 여러 번 갖고 있으므로 연속 중복을 제거하면 곧 항목 순서가 된다.
 */
function yes24RankInList(html, targetId) {
  // 베스트셀러 목록 영역으로 범위를 좁힌다 (광고·최근본상품 등 오염 방지)
  const start = html.indexOf("yesBestList");
  const region = start === -1 ? html : html.slice(start);

  const ids = [];
  const re = /\/product\/goods\/(\d+)/g;
  let m;
  while ((m = re.exec(region)) !== null) {
    const id = m[1];
    if (ids[ids.length - 1] !== id) ids.push(id); // 연속 중복 제거
  }
  const idx = ids.indexOf(targetId);
  return idx === -1 ? null : idx + 1;
}

// ────────────────────────────────────────────────────────────
// 예스24

async function collectYes24() {
  const out = {
    econ_rank: null,
    mkt_rank: null,
    sales_index: null,
    reviews: 0,
    rating: null,
  };

  // (1) 마케팅/세일즈 — 1~200위
  for (let page = 1; page <= 2; page++) {
    const html = await getHtml(Y.best(Y.CAT_MKT, page));
    const pos = yes24RankInList(html, BOOK.yes24Id);
    if (pos) {
      out.mkt_rank = (page - 1) * 100 + pos;
      break;
    }
  }
  log("예스24 마케팅/세일즈:", out.mkt_rank ?? "권외");

  // (2) 경제경영 종합 — 1~300위
  for (let page = 1; page <= 3; page++) {
    const html = await getHtml(Y.best(Y.CAT_ECON, page));
    const pos = yes24RankInList(html, BOOK.yes24Id);
    if (pos) {
      out.econ_rank = (page - 1) * 100 + pos;
      break;
    }
  }
  log("예스24 경제경영 종합:", out.econ_rank ?? "권외");

  // (3) 판매지수 · 리뷰 · 평점
  // 태그가 값 사이에 끼어 있으므로(<em>1,830</em> 등) 먼저 텍스트로 평탄화한다.
  const text = htmlToText(await getHtml(Y.product));

  const si = text.match(/판매지수\s*([\d,]+)/);
  if (si) out.sales_index = Number(si[1].replace(/,/g, ""));

  const rv = text.match(/회원리뷰\s*\(\s*(\d+)\s*건\s*\)/);
  if (rv) out.reviews = Number(rv[1]);

  const rt = text.match(/리뷰\s*총점\s*([\d.]+)/);
  if (rt) out.rating = Number(rt[1]);

  log("예스24 판매지수:", out.sales_index, "· 리뷰:", out.reviews);
  return out;
}

// ────────────────────────────────────────────────────────────
// 교보문고 (Playwright)

/** 상품 링크가 실제로 그려질 때까지 기다린다 (고정 대기는 오탐을 만든다) */
async function waitForProducts(page) {
  try {
    await page.waitForSelector('a[href*="/detail/S"]', { timeout: 25000 });
  } catch {
    /* 목록이 정말 비어 있을 수도 있다 */
  }
}

/** 목록 페이지에서 대상 도서의 위치(1-based)를 찾는다 */
async function kyoboPosInList(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForProducts(page);

  return page.evaluate((code) => {
    const anchors = [...document.querySelectorAll('a[href*="/detail/S"]')];
    const ids = [];
    for (const a of anchors) {
      const m = a.getAttribute("href").match(/detail\/(S\d+)/);
      if (!m) continue;
      if (ids[ids.length - 1] !== m[1]) ids.push(m[1]);
    }
    const i = ids.indexOf(code);
    return i === -1 ? null : i + 1;
  }, BOOK.kyoboCode);
}

async function collectKyobo() {
  const online = {
    econ_weekly: null,
    econ_daily: null,
    it_daily: null,
    website_cat: null,
    uxui_cat: null,
  };
  const total = { econ_weekly: null, tech_weekly: null };
  const meta = { badge_rank: null, reviews: 0, rating: null };

  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: UA, locale: "ko-KR" });

  try {
    // (1) 상품 상세 — 뱃지 순위 + 리뷰. 이 뱃지는 '온라인 주간' 순위다.
    await page.goto(K.product, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("main", { timeout: 25000 });
    const text = await page.evaluate(() => document.body.innerText);

    const badge = text.match(/주간베스트[\s\S]{0,30}?경제\/경영\s*([\d,]+)\s*위/);
    if (badge) meta.badge_rank = Number(badge[1].replace(/,/g, ""));

    const rv = text.match(/\((\d+)개의 리뷰\)/);
    if (rv) meta.reviews = Number(rv[1]);

    log("교보 뱃지(온라인 주간 경제/경영):", meta.badge_rank ?? "표시 없음");

    // (2) 온라인 주간 경제/경영 — 뱃지로 페이지를 추정해 그 주변만 확인 (20개/페이지, per 금지)
    if (meta.badge_rank) {
      const guess = Math.ceil(meta.badge_rank / 20);
      for (const p of [guess, guess - 1, guess + 1].filter((n) => n >= 1)) {
        const pos = await kyoboPosInList(page, K.onlineWeeklyEcon(p));
        if (pos) {
          online.econ_weekly = (p - 1) * 20 + pos;
          break;
        }
      }
    }
    // 목록에서 못 찾으면 뱃지 값으로 대체 (약간 지연된 스냅샷)
    if (online.econ_weekly == null) online.econ_weekly = meta.badge_rank;
    log("교보 온라인 주간 경제/경영:", online.econ_weekly ?? "권외");

    // (3) 카테고리 베스트 — 목록이 짧아 저렴하다
    online.website_cat = await kyoboPosInList(page, K.catWebsite);
    online.uxui_cat = await kyoboPosInList(page, K.catUxui);
    log("교보 웹사이트 카테고리:", online.website_cat ?? "권외");
    log("교보 UX/UI 카테고리:", online.uxui_cat ?? "권외");

    // (4) 종합 주간 — 카테고리별 TOP 20만 공개된다
    total.econ_weekly = await kyoboPosInList(page, K.totalEcon);
    total.tech_weekly = await kyoboPosInList(page, K.totalTech);
    log("교보 종합주간 경제경영:", total.econ_weekly ?? "권외(TOP20 밖)");
    log("교보 종합주간 기술/컴퓨터:", total.tech_weekly ?? "권외(TOP20 밖)");
  } finally {
    await browser.close();
  }

  return { online, total, meta };
}

// ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== UX의 언어들 순위 수집 ===");

  let yes24;
  try {
    yes24 = await collectYes24();
  } catch (e) {
    console.error("!! 예스24 수집 실패:", e.message);
    yes24 = { econ_rank: null, mkt_rank: null, sales_index: null, reviews: 0, rating: null };
  }

  let kyobo;
  try {
    kyobo = await collectKyobo();
  } catch (e) {
    console.error("!! 교보 수집 실패:", e.message);
    kyobo = {
      online: { econ_weekly: null, econ_daily: null, it_daily: null, website_cat: null, uxui_cat: null },
      total: { econ_weekly: null, tech_weekly: null },
      meta: { badge_rank: null, reviews: 0, rating: null },
    };
  }

  const record = {
    ts: kstNowISO(),
    yes24,
    kyobo_online: kyobo.online,
    kyobo_total: kyobo.total,
    kyobo_meta: kyobo.meta,
  };

  await mkdir("data", { recursive: true });

  let history = [];
  try {
    history = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
  } catch {
    log("history.json 없음 — 새로 만든다");
  }

  // 같은 날짜 레코드가 이미 있으면 덮어쓴다 (재실행 대비)
  const day = record.ts.slice(0, 10);
  const i = history.findIndex((h) => h.ts.slice(0, 10) === day);
  if (i >= 0) history[i] = record;
  else history.push(record);

  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf8");
  console.log(`\n저장 완료 — 총 ${history.length}개 레코드`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
