# Changelog

이 파일은 MD Pretty Viewer의 모든 주요 변경 사항을 기록합니다.

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따르며,
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다.

## [Unreleased]

### Added
- KaTeX 기반 LaTeX 수식 프리뷰 지원
  - 인라인 `$...$`, `\(...\)` 수식 렌더링
  - 블록 `$$...$$`, `\[...\]` 수식 렌더링
  - 외부 네트워크 요청 없이 로컬 번들 사용

### Fixed
- README 상단 배지/정렬처럼 안전한 raw HTML이 프리뷰에서 렌더링되지 않던 문제 수정

### Security
- raw HTML 전체 escape 대신 allowlist 기반 sanitizer 적용
  - unsafe tag, event handler, inline style, 위험 URL 스키마 제거

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
