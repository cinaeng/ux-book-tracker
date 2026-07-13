# UX의 언어들 — 서점 순위 트래커

도서 **「UX의 언어들」**(한성희·신행철 저, 파지트, 2026-07-07)의 예스24·교보문고 베스트셀러 순위를 매일 자동 수집해 대시보드로 보여줍니다.

GitHub Actions가 매일 **KST 04:00**에 순위를 수집하고, GitHub Pages가 대시보드를 서빙합니다. 내 컴퓨터가 꺼져 있어도 알아서 돕니다.

---

## 설치 (5분)

### 1. 저장소 만들기

GitHub에서 새 **public** 저장소를 만듭니다. (이름 예: `ux-book-tracker`)
Pages는 무료 계정에서 public 저장소만 지원합니다.

### 2. 파일 올리기

이 폴더의 내용을 그대로 push합니다.

```bash
cd ux-book-repo
git init
git add .
git commit -m "서점 순위 트래커"
git branch -M main
git remote add origin https://github.com/<본인계정>/ux-book-tracker.git
git push -u origin main
```

### 3. Pages 켜기

저장소 → **Settings → Pages** →
**Source** 를 `GitHub Actions` 로 선택합니다.
(`Deploy from a branch` 아님 — 반드시 `GitHub Actions`)

### 4. Actions 쓰기 권한 확인

저장소 → **Settings → Actions → General** → 맨 아래 **Workflow permissions** →
**Read and write permissions** 선택 후 저장.
(수집한 데이터를 커밋해야 하므로 필요합니다)

### 5. 첫 실행

저장소 → **Actions** 탭 → 좌측 `순위 수집 & 배포` → **Run workflow** 버튼.

2~3분 뒤 대시보드가 뜹니다:

```
https://<본인계정>.github.io/ux-book-tracker/
```

이 URL을 공저자에게 보내면 됩니다.

---

## 구조

```
index.html                    대시보드 (data/history.json 을 불러 렌더링)
data/history.json             수집 이력 — Actions가 매일 여기에 한 줄씩 추가
scripts/collect.mjs           수집 스크립트
.github/workflows/collect.yml 매일 새벽 4시 실행 + Pages 배포
```

## 수집 대상

**예스24** (일반 HTTP 요청)

| 항목 | 설명 |
| --- | --- |
| 마케팅/세일즈 순위 | 경제경영 > 마케팅/세일즈 종합 베스트 (1~200위 탐색) |
| 경제경영 종합 순위 | 경제경영 전체 베스트 (1~300위 탐색) |
| 판매지수 | 판매 선행지표 |
| 리뷰 수 · 평점 | |

**교보문고** (Playwright — 페이지가 JavaScript로 그려져 브라우저 필요)

| 항목 | 설명 |
| --- | --- |
| 온라인 주간 · 경제/경영 | 현재 유일하게 순위가 잡히는 목록 |
| 웹사이트 카테고리 베스트 | 24권짜리 짧은 목록 |
| UX/UI 카테고리 베스트 | 11권짜리 짧은 목록 |
| 종합 주간 · 경제경영 / 기술컴퓨터 | **TOP 20까지만 공개** — 진입 여부만 판별 가능 |

## 알아둘 점

- **예스24 순위는 판매지수가 아니라 "최근 7일간 판매량·주문 수" 기준**입니다. 매일 1회 집계되므로 하루 중에는 값이 변하지 않습니다.
- **수집 시각(새벽 4시)의 리스크** — 예스24는 갱신 시각을 공개하지 않습니다. 관측으로 확인된 건 "오전 9시에는 이미 전일(D-1)까지 반영돼 있었다"는 것뿐이라, 실제 갱신이 자정~9시 사이 **어디에서** 일어나는지는 모릅니다. **새벽 4시가 갱신 이전이라면 그날 수집값은 하루 지난 순위**가 됩니다. 대시보드 값이 하루씩 밀려 보이면 수집 시각을 10~11시로 되돌리세요 (`.github/workflows/collect.yml` 의 cron 을 `0 2 * * *` 로).
- **교보 상세페이지의 "주간베스트 경제/경영 NNN위" 뱃지는 온라인 주간 순위**입니다(종합 아님). 실제 목록보다 1~2계단 지연된 스냅샷이라, 스크립트는 목록에서 직접 확인하고 실패 시에만 뱃지 값을 씁니다.
- **교보 종합 베스트는 카테고리별 TOP 20까지만 공개**되고 페이지네이션이 없습니다. 21위 이하는 순위 숫자를 알 방법이 없습니다.
- **인터파크 도서**는 2024년 서비스 종료로 추적 대상에서 제외했습니다.
- 서점이 페이지 구조를 바꾸면 파싱이 깨질 수 있습니다. Actions 로그에 `권외`가 갑자기 연속으로 찍히면 셀렉터 점검이 필요합니다.

## 수동 실행

Actions 탭 → `순위 수집 & 배포` → **Run workflow**

## 로컬 테스트

```bash
npm install playwright
npx playwright install chromium
node scripts/collect.mjs
```
