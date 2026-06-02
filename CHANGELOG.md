# Changelog

이 파일은 MD Pretty Viewer의 모든 주요 변경 사항을 기록합니다.

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따르며,
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다.

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
- **TOC 자동 생성** — 마크다운에 `[[TOC]]` 또는 `[[목차]]` 마커 사용
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

[0.3.0]: https://github.com/INNO-HI-Inc/md-viewer/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/INNO-HI-Inc/md-viewer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/INNO-HI-Inc/md-viewer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/INNO-HI-Inc/md-viewer/releases/tag/v0.1.0
