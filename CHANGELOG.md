# Changelog

이 파일은 MD Pretty Viewer의 모든 주요 변경 사항을 기록합니다.

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따르며,
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다.

## [1.0.24] - 2026-07-01

### Added

- **텍스트 선택 시 플로팅 서식 툴바** — 편집 중 텍스트를 드래그로 선택하면 위에 굵게(B) · 이탤릭(I) · 코드(</>) · 링크(🔗) 버튼이 뜹니다. 클릭 시 즉시 적용되고 저장할 때 markdown 문법으로 자동 변환됩니다. 링크는 URL 입력 프롬프트가 뜹니다.

## [1.0.23] - 2026-07-01

### Added

- **표 셀 편집 중 Enter로 아래 셀, Shift+Enter로 위 셀 이동** — 스프레드시트처럼 세로 방향으로 빠르게 데이터 입력. Tab / Shift+Tab은 그대로 좌우 이동.
- **✕ 취소 버튼** — 편집 중 ✓ 완료 버튼 옆에 표시. ESC를 몰라도 마우스로 취소 가능.
- **저장 중 상태 표시** — ✓ 완료 버튼 클릭 시 잠깐 옅어지면서 ⋯로 바뀌어 저장 진행을 알림.

### Changed

- **헤딩 · 셀 편집 진입 시 전체 텍스트 자동 선택** — 짧은 텍스트는 곧바로 타이핑하면 대체됨. 문단·리스트·인용처럼 긴 콘텐츠는 커서를 끝에 두는 기존 동작 유지.

## [1.0.22] - 2026-07-01

### Changed

- ✎ 수정 아이콘과 ✓ 완료 버튼에 마우스를 올렸을 때 브라우저가 띄우던 회색 툴팁("수정", "완료 (Cmd/Ctrl+Enter)")을 제거했습니다. 아이콘 자체로 의미가 충분해서 툴팁이 오히려 시각 노이즈였습니다. 스크린리더용 라벨(aria-label)은 그대로 유지됩니다.

## [1.0.21] - 2026-07-01

### Changed

- ✓ 완료 버튼이 아래쪽에서 ✎ 수정 아이콘과 같은 우측 상단 자리로 이동했습니다. 편집을 시작한 자리에서 시선·마우스를 그대로 유지한 채 저장할 수 있습니다.
- ✎ 수정 아이콘 스타일을 리뉴얼했습니다. 읽는 동안은 안 보이도록 유지하되(문서가 산만해지지 않도록), 마우스를 올린 블록·셀에서는 액센트 컬러로 채운 아이콘이 뚜렷하게 나타납니다.

## [1.0.20] - 2026-07-01

### Fixed

- 마크다운 표 셀을 편집한 뒤 ✓ 완료 버튼을 누르면 셀 값에 "✓ 완료"라는 글자가 함께 저장되던 문제를 고쳤습니다. 셀 내용을 캡처하기 전에 편집용 UI를 확실히 제거하도록 정리했습니다. 다른 편집 모드(문단·리스트 WYSIWYG, HTML 표 셀)에서도 같은 문제가 재발하지 않도록 한 번 더 확인했습니다.

## [1.0.19] - 2026-07-01

### Fixed

- HTML 표 안에 마크다운 헤딩·리스트가 들어 있는 구조(README의 Features 표 같은 것)에서 편집 후 저장하면 표 구조가 붕괴되고 내부 wrapper가 소스에 새어나가던 큰 버형 버그를 고쳤습니다. 이제 아직 닫히지 않은 HTML 구조 안에 있는 마크다운 토큰에는 편집용 wrapper를 씌우지 않아서, 원본 표 구조가 그대로 유지됩니다. 대신 그런 토큰은 개별 인-라인 편집 대상에서 제외되므로, 편집이 필요하면 Edit 모드로 전환해서 원문을 수정하시면 됩니다.

## [1.0.18] - 2026-07-01

### Changed

- 더블클릭으로 인-라인 편집이 열리던 동작을 뺐습니다. 이제 편집 진입은 오직 ✏ 수정 아이콘 클릭으로만 시작됩니다. 편집 저장은 ✓ 완료 버튼, Cmd/Ctrl+Enter, 또는 다른 곳 클릭으로 그대로 동작합니다.

## [1.0.17] - 2026-07-01

### Added

- 블록이나 표 셀 위에 마우스를 올리면 우측 상단에 작은 **✏ 수정** 아이콘이 뜹니다. 클릭하면 편집이 시작되고, 편집 중에는 **✓ 완료** 버튼이 뜹니다. 완료 버튼을 누르면 저장됩니다. 더블클릭이나 Cmd/Ctrl+Enter로 저장하던 기존 방식도 그대로 됩니다.

## [1.0.16] - 2026-07-01

### Fixed

- 셀이나 블록 편집 중에 커밋 없이 다른 셀·블록을 바로 더블클릭하면 두 번째부터는 편집기가 열리지 않던 버그를 고쳤습니다. 첫 번째 편집이 자동 저장되면서 화면이 다시 그려지는 사이 두 번째로 클릭한 요소의 참조가 사라져서 그랬는데, 이제 새로 그려진 화면에서 같은 자리 요소를 다시 찾아 편집을 이어갑니다. 여러 셀을 연속으로 편집할 때 안정적으로 동작합니다.

## [1.0.15] - 2026-07-01

### Fixed

- HTML로 쓴 표에서 셀 하나를 편집하면 저장 파일에 우리 extension이 렌더링용으로 붙이는 내부 wrapper(예: `<div class="md-block" data-block-idx>`)와 스크롤 wrapper가 그대로 새어나가 표 구조가 붕괴되던 큰 버그를 고쳤습니다. 이제 원본 소스를 시작점으로 잡고 편집한 셀만 정확히 갈아치우기 때문에, 표의 `<td width="50%" valign="top">` 같은 원본 속성과 다른 셀의 서식이 모두 그대로 유지됩니다.

## [1.0.14] - 2026-07-01

### Fixed

- 리스트를 WYSIWYG로 편집한 뒤 저장하면 원문 형식이 `-   항목` 처럼 인덴트가 넓어지고 항목 사이에 빈 줄이 끼던 문제를 고쳤습니다. 이제 원래 사용자가 쓴 스타일(`- 항목`)이 그대로 유지됩니다. 같은 파일을 여러 번 편집해도 원본 형식이 유지됩니다.

## [1.0.13] - 2026-07-01

### Added

-   마크다운으로 쓴 표뿐만 아니라 HTML 태그로 직접 쓴 표(예: README의 테마 표)에서도 셀 하나만 더블클릭해서 편집할 수 있습니다. 표의 구조·다른 셀·서식은 그대로 유지되고, 클릭한 셀의 텍스트만 바뀝니다.



## [1.0.12] - 2026-07-01

### Fixed

-   문단 안에 `<p>` `<b>` `<sub>` 같은 HTML 태그가 섞여 있는 블록도 더블클릭하면 태그가 안 보이고 렌더된 텍스트만 편집됩니다. 이전 버전에서는 이런 블록만 마크다운 원문 편집기로 넘어가서 태그가 그대로 보였습니다. 다만 표·details·iframe처럼 구조 자체가 HTML로 표현된 블록은 그대로 원문 편집기가 열립니다 — 구조를 무너뜨리지 않기 위함입니다.



## [1.0.11] - 2026-07-01

### Fixed

- 리스트나 문단에 인라인 코드가 섞여 있어도 이제 렌더된 모양 그대로 편집됩니다. 이전 버전에서는 인라인 코드가 하나라도 있으면 마크다운 원문 편집기로 넘어가면서 별표·백틱 같은 기호가 그대로 보였는데, 그 조건을 정리해서 진짜 위험한 코드 블록·수식·다이어그램일 때만 원문 편집기로 폴백하도록 좁혔습니다.

## [1.0.10] - 2026-07-01

### Added

- 표 안의 셀 하나를 더블클릭하면 그 셀만 바로 편집됩니다. 표의 나머지 구조와 다른 셀의 굵게·이탤릭·정렬은 손대지 않고 그대로 유지됩니다. 저장은 엔터 또는 Cmd/Ctrl+엔터, 취소는 ESC, 다음 셀로 이동은 탭 키로 하면 됩니다.

## [1.0.9] - 2026-07-01

### Added

- Preview에서 블록을 더블클릭하면 렌더된 그대로 편집할 수 있습니다. 제목은 큰 글자 그대로, 굵게·이탤릭·링크도 시각적으로 그대로 유지된 상태에서 글자만 고치면 되고, 저장하면 자동으로 마크다운으로 되돌아갑니다.
- 다만 코드 블록·표·수식·다이어그램·알림 상자처럼 구조가 복잡한 것은 안전을 위해 예전처럼 원문 편집기가 열립니다.

## [1.0.8] - 2026-07-01

### Changed

- 블록 위에 마우스를 올렸을 때 나오던 작은 보조 라벨을 뺐습니다. 대신 아주 옅은 배경색 변화와 커서 모양만으로 편집 가능하다는 걸 은근하게 알립니다. 노션·옵시디언·타이포라와 비슷한 방식입니다.

## [1.0.7] - 2026-07-01

### Fixed

-   배지나 작은 아이콘이 옆으로 나란히 있어야 하는데 세로로 쌓이던 문제를 고쳤습니다. 큰 스크린샷 같은 단독 이미지는 예전처럼 가운데 정렬 + 여백 + 그림자가 붙지만, 배지처럼 한 줄에 여러 개 있는 인라인 이미지는 자연스럽게 옆으로 흐릅니



## [1.0.6] - 2026-07-01

### Added

-   Preview 모드에서 블록을 더블클릭하면 그 자리에서 바로 편집할 수 있습니다. Edit 모드로 전환하지 않아도 되고, 저장은 Cmd/Ctrl+엔터, 취소는 ESC 입니다.



### Changed

- 배포용 파일 목록을 정리해서 개발용 폴더와 문서 몇 개를 뺐습니다.

### Fixed

- 인라인 편집을 위해 블록 구조를 조금 바꾸면서 스크롤 동기화 계산이 어긋나던 부분을 다시 맞췄습니다.

## [1.0.5] - 2026-07-01

### Changed

- 이모지 스타일을 토스가 만든 Tossface로 바꿨습니다. 모든 운영체제에서 같은 모양으로 보이도록 폰트를 직접 함께 넣었고, 모던하고 한국적인 톤이 특징입니다.
- 폰트 지정 순서를 조정해서 숫자·영문의 자간이 어색해지던 문제도 함께 해결했습니다.

## [1.0.4] - 2026-07-01

### Added

- 이모지를 Twemoji로 통일했었습니다. (v1.0.5에서 Tossface로 다시 교체됩니다.)

### Changed

- 인용문 왼쪽 위에 크게 붙어 있던 장식 따옴표를 뺐습니다. 이제 왼쪽 색상 선과 은은한 배경만으로 인용문이 표시되어 훨씬 깔끔합니다.

## [1.0.3] - 2026-06-29

### Fixed

- **Webview is disposed 에러** — panel이 dispose된 후 `onDidDispose` 콜백에서 `panel.webview` getter를 호출하면 throw되는 race. webview 참조를 panel 생성 시점에 미리 캡처해서 dispose 시점에 안전하게 cleanup하도록 수정. 콘솔 에러 없어짐.

## [1.0.2] - 2026-06-24

### Added — 사용성 개선 5종

- **🖼 이미지 라이트박스** — 프리뷰의 이미지를 클릭하면 풀스크린으로 확대. 휠로 줌, 더블클릭 2.5×, 드래그 패닝, ESC/외부 클릭으로 닫기
- **🔍 프리뷰 인-페이지 검색** — Preview 모드에서 `Cmd/Ctrl+F`로 인-페이지 검색. 매치 하이라이트, Enter/Shift+Enter로 이동, 활성 매치는 강조색으로 표시
- **📌 아웃라인 스크롤 추적** — 스크롤 위치에 따라 현재 섹션이 아웃라인에서 강조 (좌측 색띠 + 굵게 + 자동 스크롤). IntersectionObserver 기반
- **🔗 스마트 URL 붙여넣기** — 텍스트 선택한 상태에서 URL 붙여넣기 → `[선택텍스트](url)` 자동 변환. 멀티라인 선택/non-URL은 자동으로 건드리지 않음
- **📄 PDF 옵션 다이얼로그** — PDF 추출 전 다이얼로그로 용지(A4/Letter), 방향(세로/가로), 여백(좁게/보통/넓게), 헤더 표시, 페이지 번호 표시를 선택. 선택값은 localStorage에 저장되어 다음 추출 시 재사용

### Improved

- **Split 스크롤 동기화** — 기존 % 기반 → 헤딩 앵커 기반 보간으로 정확도 향상. 표/이미지가 많은 문서에서 어긋남 감소. 헤딩 없는 구간은 % fallback
- **표 가로 스크롤** — 화면보다 넓은 표는 자동 wrapper로 가로 스크롤. 양쪽 그림자 힌트, 얇은 스크롤바, PDF에서는 wrapper 제거되어 100% 너비로 인쇄

### Fixed

- **PDF 다이얼로그 키 핸들러 누수** — 다이얼로그를 버튼 클릭으로 닫은 뒤 에디터에서 Enter 칠 때 phantom PDF 익스포트 트리거되던 버그 (수정 후 검증)
- **스크롤 sync 포맷 헤딩 매칭** — `# **굵게**`처럼 인라인 포맷이 있는 헤딩에서 source ↔ rendered 매칭 실패 → % fallback 떨어지던 정확도 손실. 인라인 마크업 stripping + loose match로 수정
- **라이트박스 리스너 누수** — `window` 객체에 mousemove/mouseup이 매 오픈마다 쌓이던 누수. close 시 명시적 removeEventListener로 해제

### Verified

- Playwright 헤드리스 검증 31/31 통과 (라이트박스 · 검색 · 아웃라인 · 스마트 paste · PDF 다이얼로그 · 스크롤 sync · 기존 기능 회귀)

## [1.0.1] - 2026-06-18

### Fixed
- **🔴 PDF 내보내기 안 되던 버그** — v0.9.5의 `_isExporting` 가드가 renderPreview의 첫 호출까지 막아 PDF가 빈 컨텐츠로 생성되던 회귀
  - 가드를 `debouncedRenderPreview`로 이동 (편집 중 실시간 재렌더만 차단)
  - PDF 시작 직전 명시적 `renderPreview()` 호출로 캡처 직전 컨텐츠 갱신

## [1.0.0] - 2026-06-18 — Stable 🎉

3개월간의 반복적 개선 끝에 **stable 릴리스**로 진입합니다.

### 안정성 검증
v0.9.5의 코드 리뷰 감사 발견사항 11개 패치 전수 검증 완료:
- ✅ Critical 3건 / High 4건 / Medium 4건 — 모두 정확히 적용 확인
- ✅ Syntax / build / CSP / 구조 무결성 통과
- ✅ 데드코드·잔재 호출 0건

### 누적 기능 정리
- **렌더링**: 마크다운(GFM) · LaTeX (KaTeX) · Mermaid · 코드 하이라이트 · TOC · Admonitions · Footnotes
- **편집**: Preview/Edit/Split + 더블클릭 토글 · Slash 명령어 · Find&Replace · 리스트 자동 이어쓰기 · 스마트 Tab · 클립보드 이미지 paste · 줄 번호 · 저장 상태
- **테마**: 13가지 컬러 테마 + 커스텀 컬러 팔레트
- **출력**: A4 PDF (lazy load · 페이지 분할 최적화) · HTML 복사
- **보안**: CSP + allowlist HTML sanitization (PR #4 외부 기여)
- **국제화**: 에이투지체 한글 폰트 번들 · 한/영 바이링구얼 문서

### v1.0 의의
신규 사용자에게 stable 신호. 이후 변경은 SemVer 엄격 준수 (breaking change → major).

## [0.9.5] - 2026-06-18 — Stability hardening

### Fixed
- **🔴 체크박스 토글 데이터 손상 방지** — 펜스 코드 블록 안에 있는 예제 `[ ]` 가 체크박스 인덱스에 잘못 카운트되어 엉뚱한 줄을 수정하던 silent corruption 버그
- **🔴 PDF 내보내기 도중 race 해결** — 빠른 더블 클릭, 진행 중 모드 전환, 실패 시 모드 미복원 문제 모두 해결
- **🟠 dispose된 webview에 postMessage 호출 시 unhandled rejection** 발생하던 문제 — safePost 헬퍼로 일괄 안전화
- **🟠 외부 편집 vs webview 편집 race** — 단순 boolean flag → content 비교 방식으로 변경, 빠른 양방향 동기화 시 변경사항 유실 방지
- **🟠 lazy load 실패 시 영구 캐시** — Mermaid/html2pdf 로드 실패 후 재시도 가능하도록 캐시 무효화
- **🟠 TOC 링크 깨짐** — `injectTOC`/`addHeadingIds` slug 함수 통합, 한글 헤딩 보존 + 중복 헤딩 자동 deduplication
- **🟠 Sanitizer foreign content** — `<svg>`, `<math>`, `<form>`, `<button>`, `<audio>`, `<video>` 등 dropWithContent에 명시적으로 추가 (defense-in-depth)
- **🟡 Mermaid 재초기화 + race** — `mermaid.initialize`는 1회만 호출, render 완료 시 wrapper가 detach됐는지 검증
- **🟡 renderPreview 재진입 방지** — `_isRendering` 가드로 중첩 호출 차단
- **🟡 localStorage 예외 처리** — `lsGet`/`lsSet`/`lsRemove` 헬퍼로 일괄 감싸 quota/private mode 안전
- **🟡 Code copy 버튼 closure 누수** — `currentTarget.closest()` 기반 lookup으로 변경

## [0.9.4] - 2026-06-18

### Added
- **코드 블록 헤더 + 복사 버튼** — 모든 코드 블록 상단에 언어 라벨 + Copy 버튼. 클릭 시 클립보드 복사 + "Copied!" 피드백
- **외부 링크 ↗ 인디케이터** — `http(s)://` 링크 끝에 자동 ↗ 표시 (호버 시 살짝 이동 애니메이션)

### Changed
- **인용문(Blockquote) 디자인 리프레시** — 좌측 accent 라인 + 좌상단 옅은 따옴표 마크. 둥근 모서리·옅은 그림자. 인용문 안 굵은 글씨는 강조 색으로
- **체크박스 디자인** — 기본 OS 체크박스 → 커스텀. accent 색 사용, 호버 확대, 체크 시 텍스트 line-through 효과
- 중첩 인용문도 별도 라인 색으로 시각 구분

### PDF
- 코드 블록 헤더는 PDF에서 자동 숨김 (인쇄에서 불필요)
- 외부 링크 ↗ 표시는 PDF에서 자동 제거 (URL은 이미 텍스트로 추가됨)

## [0.9.3] - 2026-06-18

### Changed
- **표(Table) 디자인 리프레시** — 모든 테마에서 동일한 회색이던 표가 이제 선택한 테마 컬러를 반영
  - 헤더 아래 그라데이션 accent 라인 (테마 색상 자동)
  - 첫 컬럼 살짝 강조 (label 컬럼 강조 효과)
  - 둥근 모서리·세로 구분선·옅은 그림자로 모던한 룩
  - 헤더 텍스트 미세하게 대문자 처리 + 자간 조정
  - 셀 안 코드 더 부드럽게

## [0.9.2] - 2026-06-18

### Fixed
- **Edit 모드 더블클릭 → Preview 전환이 안 되던 문제** — textarea 위에서 더블클릭해도 모드 전환되도록 수정. 이전엔 마진/줄번호 영역에서만 동작했음 (대부분 영역이 textarea라 사실상 안 됨). 대칭 UX 회복.

## [0.9.1] - 2026-06-18

### Fixed
- **Split 모드 버벅임 해결** — 키 입력마다 무거운 렌더링이 즉시 실행되던 문제. 120ms debounce + requestAnimationFrame 적용
- **PDF 표 페이지 분할 개선** — 표·코드·인용·이미지·다이어그램이 페이지 경계에서 어색하게 잘리던 문제. `pagebreak.avoid` 셀렉터 명시
- **홈페이지 반응형 보강** — 480px / 700px / 900px 단계별 breakpoint, 모바일에서 카드·버튼·네비 짤림 방지

### Changed
- 빌드 minify 제거 — 디버깅·유지보수성 우선 (총 사이즈 영향 미미)

## [0.9.0] - 2026-06-02

### Added — 4 major productivity features
- **Find & Replace 패널** (`Cmd/Ctrl + H`) — 찾기·바꾸기·전체 바꾸기 + 매치 카운트 + 이전/다음 네비게이션
- **Slash 명령어 메뉴** — 줄 시작에서 `/` 입력 시 17개 명령어 팝업 (h1/h2/h3, code, table, link, quote, list, hr, check, admonition note/warning, math, mermaid, toc 등). 화살표·Enter 키보드 탐색
- **각주 (Footnotes)** — `[^1]` 참조 + `[^1]: 정의` 형식 자동 처리, 하단 자동 섹션 생성, 양방향 백링크
- **Admonitions / 알림 박스** — `:::note`, `:::warning`, `:::tip`, `:::danger` 등 8가지 타입. 아이콘 + 컬러 강조 + 다크모드 대응

### Notes
- 모든 신기능은 기존 마크다운 표준과 호환 (사용 안 하면 영향 없음)
- 다크/라이트 테마 자동 대응

## [0.8.1] - 2026-06-02

### Added
- **Edit 모드에서 더블클릭으로 Preview 돌아가기** — Preview에서 더블클릭으로 Edit 전환에 대응하는 대칭 동작
  - 텍스트 영역의 단어 선택은 유지 (마진/줄번호 영역 더블클릭으로만 모드 전환)

## [0.8.0] - 2026-06-02

### Added
- **Mermaid 다이어그램 지원** — \`\`\`mermaid 코드 블록을 자동으로 다이어그램으로 렌더링
  - 시퀀스, 플로우차트, 클래스, ER, 간트 등 모든 mermaid 타입 지원
  - **Lazy load** — `\`\`\`mermaid` 블록이 있을 때만 라이브러리 로드 (초기 시작 속도 영향 없음)
  - 다크/라이트 테마 자동 감지
  - `securityLevel: strict`로 안전한 렌더링
- **html2pdf 라이브러리 lazy load** — PDF 버튼 첫 클릭 시에만 로드 (초기 시작 빨라짐)
- **CI/CD 자동 배포** — `.github/workflows/release.yml`
  - 태그 push 시 자동 VSIX 빌드 + GitHub Release 생성
  - `VSCE_PAT` secret 설정 시 자동 Marketplace publish

### Changed
- **번들 사이즈 최적화** — esbuild로 editor.js/css minify (35% 축소, 49KB 절감)
- AtoZ 폰트 subset (한글 일반 + ASCII만) — 879KB → 856KB

## [0.7.2] - 2026-05-28

### Added
- **안전한 HTML 렌더링** — README 상단의 `<p align="center">`, 배지, 이미지, 앵커 등 GitHub 스타일 raw HTML이 프리뷰에서 정상 렌더링됨 (allowlist 기반 sanitizer)
  - 허용 태그: `<p>`, `<div>`, `<a>`, `<img>`, `<details>`, `<summary>`, `<kbd>`, 표 태그 등
  - 차단: `<script>`, `<iframe>`, `<style>`, on* 이벤트 핸들러, inline style, `javascript:` / `vbscript:` / `data:` / `file:` URL
  - Credit: PR #4 by [@FIN443](https://github.com/FIN443) (jihoon)

### Security
- raw HTML 전체 escape → allowlist 기반 sanitization으로 변경 (안전성 유지하면서 GitHub-flavored HTML 지원)

## [0.7.1] - 2026-05-28

### Removed
- **Sticky H1/H2 헤딩 제거** — 스크롤 시 헤딩이 상단에 고정되던 동작이 어색하다는 피드백 반영. 자연스럽게 위로 스크롤되도록 변경.

## [0.7.0] - 2026-05-28

### Added — Major productivity features

- **LaTeX 수식 렌더링 (KaTeX)** — `$E=mc^2$` (인라인), `$$\int x\,dx$$` (블록) 지원
  - KaTeX 14개 폰트 번들 (오프라인 작동)
  - throwOnError: false, 오류 시 빨간 텍스트로 표시
- **이미지 클립보드 붙여넣기** — 스크린샷 캡처 후 Edit 모드에서 `Cmd/Ctrl+V`
  - base64 인라인 이미지로 자동 변환·삽입
  - 토스트 알림 표시
- **TOC 자동 생성** — 마크다운에 `<div class="md-toc"><div class="md-toc-title">목차 / Table of Contents</div><ul><li class="md-toc-level-1"><a href="#heading-changelog">Changelog</a></li><li class="md-toc-level-2"><a href="#heading-1013---2026-07-01">[1.0.13] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added">Added</a></li><li class="md-toc-level-2"><a href="#heading-1012---2026-07-01">[1.0.12] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-1011---2026-07-01">[1.0.11] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed-2">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-1010---2026-07-01">[1.0.10] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-2">Added</a></li><li class="md-toc-level-2"><a href="#heading-109---2026-07-01">[1.0.9] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-3">Added</a></li><li class="md-toc-level-2"><a href="#heading-108---2026-07-01">[1.0.8] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-changed">Changed</a></li><li class="md-toc-level-2"><a href="#heading-107---2026-07-01">[1.0.7] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed-3">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-106---2026-07-01">[1.0.6] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-4">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-2">Changed</a></li><li class="md-toc-level-3"><a href="#heading-fixed-4">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-105---2026-07-01">[1.0.5] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-changed-3">Changed</a></li><li class="md-toc-level-2"><a href="#heading-104---2026-07-01">[1.0.4] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-5">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-4">Changed</a></li><li class="md-toc-level-2"><a href="#heading-103---2026-06-29">[1.0.3] - 2026-06-29</a></li><li class="md-toc-level-3"><a href="#heading-fixed-5">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-102---2026-06-24">[1.0.2] - 2026-06-24</a></li><li class="md-toc-level-3"><a href="#heading-added-사용성-개선-5종">Added — 사용성 개선 5종</a></li><li class="md-toc-level-3"><a href="#heading-improved">Improved</a></li><li class="md-toc-level-3"><a href="#heading-fixed-6">Fixed</a></li><li class="md-toc-level-3"><a href="#heading-verified">Verified</a></li><li class="md-toc-level-2"><a href="#heading-101---2026-06-18">[1.0.1] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-7">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-100---2026-06-18-stable-">[1.0.0] - 2026-06-18 — Stable 🎉</a></li><li class="md-toc-level-3"><a href="#heading-안정성-검증">안정성 검증</a></li><li class="md-toc-level-3"><a href="#heading-누적-기능-정리">누적 기능 정리</a></li><li class="md-toc-level-3"><a href="#heading-v10-의의">v1.0 의의</a></li><li class="md-toc-level-2"><a href="#heading-095---2026-06-18-stability-hardening">[0.9.5] - 2026-06-18 — Stability hardening</a></li><li class="md-toc-level-3"><a href="#heading-fixed-8">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-094---2026-06-18">[0.9.4] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-added-6">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-5">Changed</a></li><li class="md-toc-level-3"><a href="#heading-pdf">PDF</a></li><li class="md-toc-level-2"><a href="#heading-093---2026-06-18">[0.9.3] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-changed-6">Changed</a></li><li class="md-toc-level-2"><a href="#heading-092---2026-06-18">[0.9.2] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-9">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-091---2026-06-18">[0.9.1] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-10">Fixed</a></li><li class="md-toc-level-3"><a href="#heading-changed-7">Changed</a></li><li class="md-toc-level-2"><a href="#heading-090---2026-06-02">[0.9.0] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-4-major-productivity-features">Added — 4 major productivity features</a></li><li class="md-toc-level-3"><a href="#heading-notes">Notes</a></li><li class="md-toc-level-2"><a href="#heading-081---2026-06-02">[0.8.1] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-7">Added</a></li><li class="md-toc-level-2"><a href="#heading-080---2026-06-02">[0.8.0] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-8">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-8">Changed</a></li><li class="md-toc-level-2"><a href="#heading-072---2026-05-28">[0.7.2] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-added-9">Added</a></li><li class="md-toc-level-3"><a href="#heading-security">Security</a></li><li class="md-toc-level-2"><a href="#heading-071---2026-05-28">[0.7.1] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-removed">Removed</a></li><li class="md-toc-level-2"><a href="#heading-070---2026-05-28">[0.7.0] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-added-major-productivity-features">Added — Major productivity features</a></li><li class="md-toc-level-3"><a href="#heading-changed-9">Changed</a></li><li class="md-toc-level-2"><a href="#heading-061---2026-05-06">[0.6.1] - 2026-05-06</a></li><li class="md-toc-level-3"><a href="#heading-changed-10">Changed</a></li><li class="md-toc-level-3"><a href="#heading-removed-cleanup">Removed (Cleanup)</a></li><li class="md-toc-level-2"><a href="#heading-060---2026-04-27">[0.6.0] - 2026-04-27</a></li><li class="md-toc-level-3"><a href="#heading-added-10">Added</a></li><li class="md-toc-level-2"><a href="#heading-054---2026-04-21">[0.5.4] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-fixed-11">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-053---2026-04-21">[0.5.3] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-11">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-11">Changed</a></li><li class="md-toc-level-3"><a href="#heading-documentation">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-052---2026-04-21">[0.5.2] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-12">Added</a></li><li class="md-toc-level-2"><a href="#heading-051---2026-04-21">[0.5.1] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-13">Added</a></li><li class="md-toc-level-2"><a href="#heading-050---2026-04-21">[0.5.0] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-14">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-12">Changed</a></li><li class="md-toc-level-3"><a href="#heading-fixed-12">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-040---2026-04-14">[0.4.0] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-15">Added</a></li><li class="md-toc-level-3"><a href="#heading-documentation-2">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-031---2026-04-14">[0.3.1] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-16">Added</a></li><li class="md-toc-level-3"><a href="#heading-security-2">Security</a></li><li class="md-toc-level-3"><a href="#heading-documentation-3">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-030---2026-04-14">[0.3.0] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-17">Added</a></li><li class="md-toc-level-3"><a href="#heading-security-3">Security</a></li><li class="md-toc-level-3"><a href="#heading-documentation-4">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-021---2026-04-14">[0.2.1] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-18">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-13">Changed</a></li><li class="md-toc-level-2"><a href="#heading-020---2026-04-02">[0.2.0] - 2026-04-02</a></li><li class="md-toc-level-3"><a href="#heading-added-19">Added</a></li><li class="md-toc-level-2"><a href="#heading-010---2026-03-26">[0.1.0] - 2026-03-26</a></li><li class="md-toc-level-3"><a href="#heading-added-20">Added</a></li></ul></div>` 또는 `<div class="md-toc"><div class="md-toc-title">목차 / Table of Contents</div><ul><li class="md-toc-level-1"><a href="#heading-changelog">Changelog</a></li><li class="md-toc-level-2"><a href="#heading-1013---2026-07-01">[1.0.13] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added">Added</a></li><li class="md-toc-level-2"><a href="#heading-1012---2026-07-01">[1.0.12] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-1011---2026-07-01">[1.0.11] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed-2">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-1010---2026-07-01">[1.0.10] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-2">Added</a></li><li class="md-toc-level-2"><a href="#heading-109---2026-07-01">[1.0.9] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-3">Added</a></li><li class="md-toc-level-2"><a href="#heading-108---2026-07-01">[1.0.8] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-changed">Changed</a></li><li class="md-toc-level-2"><a href="#heading-107---2026-07-01">[1.0.7] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-fixed-3">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-106---2026-07-01">[1.0.6] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-4">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-2">Changed</a></li><li class="md-toc-level-3"><a href="#heading-fixed-4">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-105---2026-07-01">[1.0.5] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-changed-3">Changed</a></li><li class="md-toc-level-2"><a href="#heading-104---2026-07-01">[1.0.4] - 2026-07-01</a></li><li class="md-toc-level-3"><a href="#heading-added-5">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-4">Changed</a></li><li class="md-toc-level-2"><a href="#heading-103---2026-06-29">[1.0.3] - 2026-06-29</a></li><li class="md-toc-level-3"><a href="#heading-fixed-5">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-102---2026-06-24">[1.0.2] - 2026-06-24</a></li><li class="md-toc-level-3"><a href="#heading-added-사용성-개선-5종">Added — 사용성 개선 5종</a></li><li class="md-toc-level-3"><a href="#heading-improved">Improved</a></li><li class="md-toc-level-3"><a href="#heading-fixed-6">Fixed</a></li><li class="md-toc-level-3"><a href="#heading-verified">Verified</a></li><li class="md-toc-level-2"><a href="#heading-101---2026-06-18">[1.0.1] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-7">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-100---2026-06-18-stable-">[1.0.0] - 2026-06-18 — Stable 🎉</a></li><li class="md-toc-level-3"><a href="#heading-안정성-검증">안정성 검증</a></li><li class="md-toc-level-3"><a href="#heading-누적-기능-정리">누적 기능 정리</a></li><li class="md-toc-level-3"><a href="#heading-v10-의의">v1.0 의의</a></li><li class="md-toc-level-2"><a href="#heading-095---2026-06-18-stability-hardening">[0.9.5] - 2026-06-18 — Stability hardening</a></li><li class="md-toc-level-3"><a href="#heading-fixed-8">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-094---2026-06-18">[0.9.4] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-added-6">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-5">Changed</a></li><li class="md-toc-level-3"><a href="#heading-pdf">PDF</a></li><li class="md-toc-level-2"><a href="#heading-093---2026-06-18">[0.9.3] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-changed-6">Changed</a></li><li class="md-toc-level-2"><a href="#heading-092---2026-06-18">[0.9.2] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-9">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-091---2026-06-18">[0.9.1] - 2026-06-18</a></li><li class="md-toc-level-3"><a href="#heading-fixed-10">Fixed</a></li><li class="md-toc-level-3"><a href="#heading-changed-7">Changed</a></li><li class="md-toc-level-2"><a href="#heading-090---2026-06-02">[0.9.0] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-4-major-productivity-features">Added — 4 major productivity features</a></li><li class="md-toc-level-3"><a href="#heading-notes">Notes</a></li><li class="md-toc-level-2"><a href="#heading-081---2026-06-02">[0.8.1] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-7">Added</a></li><li class="md-toc-level-2"><a href="#heading-080---2026-06-02">[0.8.0] - 2026-06-02</a></li><li class="md-toc-level-3"><a href="#heading-added-8">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-8">Changed</a></li><li class="md-toc-level-2"><a href="#heading-072---2026-05-28">[0.7.2] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-added-9">Added</a></li><li class="md-toc-level-3"><a href="#heading-security">Security</a></li><li class="md-toc-level-2"><a href="#heading-071---2026-05-28">[0.7.1] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-removed">Removed</a></li><li class="md-toc-level-2"><a href="#heading-070---2026-05-28">[0.7.0] - 2026-05-28</a></li><li class="md-toc-level-3"><a href="#heading-added-major-productivity-features">Added — Major productivity features</a></li><li class="md-toc-level-3"><a href="#heading-changed-9">Changed</a></li><li class="md-toc-level-2"><a href="#heading-061---2026-05-06">[0.6.1] - 2026-05-06</a></li><li class="md-toc-level-3"><a href="#heading-changed-10">Changed</a></li><li class="md-toc-level-3"><a href="#heading-removed-cleanup">Removed (Cleanup)</a></li><li class="md-toc-level-2"><a href="#heading-060---2026-04-27">[0.6.0] - 2026-04-27</a></li><li class="md-toc-level-3"><a href="#heading-added-10">Added</a></li><li class="md-toc-level-2"><a href="#heading-054---2026-04-21">[0.5.4] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-fixed-11">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-053---2026-04-21">[0.5.3] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-11">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-11">Changed</a></li><li class="md-toc-level-3"><a href="#heading-documentation">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-052---2026-04-21">[0.5.2] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-12">Added</a></li><li class="md-toc-level-2"><a href="#heading-051---2026-04-21">[0.5.1] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-13">Added</a></li><li class="md-toc-level-2"><a href="#heading-050---2026-04-21">[0.5.0] - 2026-04-21</a></li><li class="md-toc-level-3"><a href="#heading-added-14">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-12">Changed</a></li><li class="md-toc-level-3"><a href="#heading-fixed-12">Fixed</a></li><li class="md-toc-level-2"><a href="#heading-040---2026-04-14">[0.4.0] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-15">Added</a></li><li class="md-toc-level-3"><a href="#heading-documentation-2">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-031---2026-04-14">[0.3.1] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-16">Added</a></li><li class="md-toc-level-3"><a href="#heading-security-2">Security</a></li><li class="md-toc-level-3"><a href="#heading-documentation-3">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-030---2026-04-14">[0.3.0] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-17">Added</a></li><li class="md-toc-level-3"><a href="#heading-security-3">Security</a></li><li class="md-toc-level-3"><a href="#heading-documentation-4">Documentation</a></li><li class="md-toc-level-2"><a href="#heading-021---2026-04-14">[0.2.1] - 2026-04-14</a></li><li class="md-toc-level-3"><a href="#heading-added-18">Added</a></li><li class="md-toc-level-3"><a href="#heading-changed-13">Changed</a></li><li class="md-toc-level-2"><a href="#heading-020---2026-04-02">[0.2.0] - 2026-04-02</a></li><li class="md-toc-level-3"><a href="#heading-added-19">Added</a></li><li class="md-toc-level-2"><a href="#heading-010---2026-03-26">[0.1.0] - 2026-03-26</a></li><li class="md-toc-level-3"><a href="#heading-added-20">Added</a></li></ul></div>` 마커 사용
  - H1~H4 자동 추출
  - 클릭 가능한 앵커 링크
  - 들여쓰기 레벨별 시각 구분
- **Sticky 헤딩** — 긴 문서 스크롤 시 H1/H2가 상단에 고정
  - Preview 모드에서만 적용 (Split 모드는 제외)
  - PDF 출력 시 자동 비활성화
- **저장 상태 인디케이터** — 상태바 중앙에 `● 수정됨` / `◐ 저장 중` / `✓ 저장됨` 실시간 표시

### Changed
- README 헤더 재디자인 (rating 배지 추가, 더 정돈된 레이아웃)

## [0.6.1] - 2026-05-06

### Changed
- **Windows 호환성 개선**
  - 툴바 툴팁이 OS 감지로 `Cmd`/`Ctrl` 동적 표시 (Windows 사용자 혼란 해소)
  - `Ctrl+Shift+M` → `Ctrl+Alt+M` (Windows VS Code 기본 "Problems 패널" 단축키 충돌 회피)
  - Mac은 `Cmd+Alt+M`으로 동일 변경

### Removed (Cleanup)
- Dead CSS: `body.exporting-pdf` 룰셋 177줄 제거 (PDF는 onclone 방식 사용)
- Dead code: `case 'pdf':` toolbar action, `pdf:` icon SVG 제거 (PDF 버튼은 topbar로 이동됨)

## [0.6.0] - 2026-04-27

### Added
- **PDF로 내보내기** — 툴바에 PDF 버튼 추가
  - 클릭하면 시스템 인쇄 다이얼로그 → "PDF로 저장" 선택
  - A4 페이지 기준 최적화된 인쇄 스타일
  - 헤딩/코드블록/이미지 페이지 분할 방지
  - 외부 링크 URL 자동 표시 (인쇄 시)
  - 모든 UI(툴바·아웃라인·줄번호) 자동 숨김

## [0.5.4] - 2026-04-21

### Fixed
- **Claude Code/외부 링크 클릭 시 변환 안 되던 문제 수정**
  - `onDidOpenTextDocument`만 듣던 것을 `onDidChangeActiveTextEditor` + `onDidChangeVisibleTextEditors`도 함께 감지하도록 확장
  - 이미 열려있던 마크다운 파일이 활성화될 때도 자동 변환
  - 중복 변환 방지를 위한 in-progress 가드 추가
  - `onStartupFinished` 활성화 이벤트 추가로 시작 시 즉시 동작

## [0.5.3] - 2026-04-21

### Added
- **업데이트 알림** — 확장이 새 버전으로 업데이트되면 "🎉 v0.5.x 업데이트됨!" 알림과 함께 GitHub Releases 변경사항 바로가기 버튼 제공
- **큐레이팅 컬러 팔레트** — "+" 버튼 클릭 시 Warm/Cool/Rich/Muted 4개 카테고리에 32개 예쁜 색상 제공
- Hex 직접 입력 + 네이티브 컬러 피커도 팔레트 내에서 사용 가능

### Changed
- 테마 드롭다운을 기본 6개 원 + "+" 버튼으로 간소화 (나머지 테마는 settings.json에서 선택)
- 취약점 보고를 GitHub Issues로 일원화 (Private Security Advisory 제거)

### Documentation
- SECURITY.md 바이링구얼 (English + 한국어)

## [0.5.2] - 2026-04-21

### Added
- **눈 피로도 낮은 테마 3가지** 추가 (총 13가지)
  - **Sage** 🌿 — 은은한 세이지 그린, 자연의 차분함
  - **Sepia** 📜 — 세피아/종이 톤, 장시간 독서 최적화
  - **Mist** 🌫 — 부드러운 슬레이트 블루그레이, 저채도

모든 새 테마는 저채도(Low saturation) 설계로 장시간 작업 시 눈의 피로를 줄입니다.

## [0.5.1] - 2026-04-21

### Added
- **2026 Pantone 트렌드 3가지 테마** 추가 (총 10가지)
  - **Peach** 🍑 — Peach Dust 기반, 따뜻하고 포근한 톤
  - **Aqua** 🌊 — Almost Aqua 기반, 상쾌한 민트/씨폼
  - **Orchid** 💜 — Orchid Tint 기반, 우아한 라벤더
- 홈페이지·데모 페이지 테마 피커에도 반영

## [0.5.0] - 2026-04-21

### Added
- **리스트 자동 이어쓰기** — 리스트 항목에서 Enter 치면 자동으로 다음 리스트 마커 생성
  - `-`, `*`, `+` 불릿 리스트
  - `1.`, `2.` 번호 리스트 (자동 증가)
  - `>` 인용 블록
  - 빈 리스트 아이템에서 Enter → 리스트 종료
- **스마트 Tab 키** — 리스트 안에서 Tab/Shift+Tab으로 들여쓰기/내어쓰기
- **줄 번호(Line Numbers)** — Edit/Split 모드에서 왼쪽에 표시
- **Cmd+F 찾기 위젯** — VS Code 내장 찾기 기능 활성화
- **Copy as HTML** — 툴바에 HTML 클립보드 복사 버튼
- **Focus Mode** — 툴바/상태바/아웃라인 숨겨 글쓰기에 집중 (툴바 버튼)
- **체크박스 클릭 토글** — Preview에서 체크박스 직접 클릭하여 소스 업데이트
- **Toast 알림** — 복사 등 주요 작업 완료 시 하단에 확인 메시지

### Changed
- 커스텀 에디터 대신 수동 Webview Panel 방식으로 전환 (현재 활성 에디터 그룹에서 열리도록 개선)
- 줄 번호 가시성 "있는 듯 없는듯" (opacity 0.28)
- 보안 이메일 → GitHub Security Advisory 링크로 변경

### Fixed
- 다른 에디터 그룹에 새 탭이 생성되는 문제 해결 (사용자가 있던 그룹에서 열림)
- 같은 파일의 텍스트 에디터와 프리뷰 동시 오픈 문제 해결

## [0.4.0] - 2026-04-14

### Added
- **에이투지체 (AtoZ) 폰트 번들링** — 오토노머스에이투지 X 이주임 제작, OFL 라이선스
  - 6가지 웨이트 (300 Light ~ 800 ExtraBold) 번들
  - 전체 UI에 자동 적용, 시스템 폰트보다 우선 사용
  - 한글 가독성 대폭 향상

### Documentation
- NOTICE.md에 에이투지체 OFL 라이선스 전문 추가

## [0.3.1] - 2026-04-14

### Added
- `.markdown`, `.mdown`, `.mkd` 확장자 파일도 지원
- 설정 enum에 한글 설명 추가 (`enumDescriptions`)
- `extensionKind` 선언 (ui/workspace 모두 지원, SSH 원격 작업 호환)

### Security
- **추가 XSS 방어**: `rel="noopener noreferrer"` 자동 주입, 모든 스키마 필터링 강화
- CSP 및 보안 설계 명시적으로 문서화 (SECURITY.md)

### Documentation
- 전문적인 README 재작성 (배지, 링크, 목차)
- CHANGELOG.md 추가 (Keep a Changelog 형식)
- SECURITY.md 추가 (취약점 보고 절차)
- NOTICE.md 추가 (번들 오픈소스 전체 라이선스)
- CONTRIBUTING.md 추가 (기여 가이드)

## [0.3.0] - 2026-04-14

### Added
- VS Code Command Palette 명령어 지원
  - `MD Pretty Viewer: Toggle Preview/Edit Mode`
  - `MD Pretty Viewer: Bold` / `Italic` / `Code`
- 공식 키보드 단축키 등록
  - `Cmd/Ctrl + E` — 모드 전환
  - `Cmd/Ctrl + B` / `I` — 볼드 / 이탤릭
  - `Cmd/Ctrl + Shift + C` — 코드
- 사용자 설정 (`settings.json`):
  - `mdPrettyViewer.defaultTheme` — 기본 컬러 테마
  - `mdPrettyViewer.defaultFontSize` — 기본 폰트 크기 (12-24px)
  - `mdPrettyViewer.defaultMode` — 파일을 열 때 기본 모드
  - `mdPrettyViewer.showOutline` — 아웃라인 기본 표시 여부
- 설정 변경 시 실시간 반영

### Security
- **XSS 방어 강화**: marked.js 렌더러에 추가 보안 레이어
  - 원시 HTML 태그 자동 escape (marked의 html 렌더러 오버라이드)
  - `javascript:` / `vbscript:` / `data:` 스키마 URL 차단 (링크 및 이미지)
  - 외부 링크에 `rel="noopener noreferrer"` 자동 추가

### Documentation
- 전문적인 README 재작성
- CHANGELOG.md 추가
- SECURITY.md 추가 (보안 정책 및 취약점 보고 절차)
- NOTICE.md 추가 (번들 오픈소스 라이선스 전문)
- CONTRIBUTING.md 추가 (기여 가이드)

## [0.2.1] - 2026-04-14

### Added
- VS Code Marketplace 공식 등록
- 새 로고 (헤딩 계층 형상화)
- MIT LICENSE 파일

### Changed
- package.json 메타데이터 보강
  - keywords, categories 추가
  - gallery banner 설정
  - homepage, bugs URL 명시

## [0.2.0] - 2026-04-02

### Added
- **7가지 컬러 테마**: Blue, Green, Rose, Purple, Amber, Neutral, Mono
- 상단바 테마 피커 UI
- 테마 선택 `localStorage` 저장
- VS Code 라이트/다크/하이콘트라스트 모드별 테마 최적화

## [0.1.0] - 2026-03-26

### Added
- 초기 릴리스
- `.md` 파일용 Custom Editor Provider
- Preview / Edit / Split 세 가지 뷰 모드
- 실시간 프리뷰 (marked.js 기반)
- 코드 하이라이팅 (highlight.js 기반)
- 서식 도구 모음 (헤딩, 볼드, 이탤릭, 코드, 링크, 리스트, 인용, 수평선)
- 아웃라인 사이드바 (H1-H4 자동 추출)
- 폰트 크기 조절 (12-24px)
- GitHub Flavored Markdown 지원
- Split 모드 스크롤 동기화
- 더블클릭으로 Edit 모드 전환
- Cmd+B / Cmd+I / Cmd+Shift+C 단축키

