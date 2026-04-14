<p align="center">
  <img src="https://raw.githubusercontent.com/INNO-HI-Inc/md-viewer/main/icon.png" width="100" alt="MD Pretty Viewer">
</p>

<h1 align="center">MD Pretty Viewer</h1>

<p align="center">
  <strong>마크다운을 예쁘게. VS Code에서.</strong>
</p>

<p align="center">
  실시간 프리뷰 · 7가지 컬러 테마 · 아웃라인 사이드바 · 서식 도구 · 코드 하이라이팅
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer">
    <img src="https://img.shields.io/visual-studio-marketplace/v/innohi.md-pretty-viewer?color=448CFF&label=VS%20Code%20Marketplace" alt="Marketplace">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer">
    <img src="https://img.shields.io/visual-studio-marketplace/d/innohi.md-pretty-viewer?color=448CFF&label=installs" alt="Installs">
  </a>
  <a href="https://github.com/INNO-HI-Inc/md-viewer/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/INNO-HI-Inc/md-viewer?color=448CFF" alt="License">
  </a>
</p>

<p align="center">
  <a href="https://inno-hi-inc.github.io/md-viewer/">🏠 홈페이지</a> ·
  <a href="https://inno-hi-inc.github.io/md-viewer/demo.html">▶ 라이브 데모</a> ·
  <a href="https://github.com/INNO-HI-Inc/md-viewer/issues">🐛 이슈 신고</a>
</p>

---

## 스크린샷

![MD Pretty Viewer 스크린샷](https://raw.githubusercontent.com/INNO-HI-Inc/md-viewer/main/docs/screenshot.png)

---

## 주요 기능

### 🎯 세 가지 뷰 모드
- **Preview**: 렌더링된 마크다운을 깔끔하게 읽기
- **Edit**: 원문 마크다운 직접 편집 (모노스페이스 에디터)
- **Split**: 좌우 분할 — 실시간 동기화 + 스크롤 동기화

Preview 모드에서 **더블클릭**하면 바로 Edit 모드로 전환됩니다.

### 🎨 7가지 컬러 테마
Blue · Green · Rose · Purple · Amber · Neutral · Mono
VS Code의 라이트 / 다크 / 하이콘트라스트 모드에 맞춰 자동 최적화.

### 🛠 서식 도구 모음
헤딩(H1-H3), 볼드, 이탤릭, 코드, 링크, 리스트(불릿/번호), 인용, 수평선 — 텍스트 선택 후 버튼 한 번으로 적용.

### 📑 아웃라인 사이드바
H1-H4 헤딩을 자동 추출해 트리 구조로 표시. 클릭 시 해당 위치로 스무스 스크롤.

### 💻 코드 하이라이팅
[highlight.js](https://highlightjs.org/) 기반. 선택한 테마 색상에 맞춰 코드 색상도 자동 변경.

### 📝 GitHub Flavored Markdown 완벽 지원
테이블 · 체크박스 · 취소선 · 펜스드 코드 블록 · 자동 링크 · 이모지.

### 🔤 폰트 크기 조절
12px ~ 24px 범위. 설정 자동 저장.

---

## 설치

### VS Code Marketplace (권장)
1. VS Code Extensions 탭 열기 (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. `md pretty viewer` 검색
3. **Install** 클릭

### 명령어
```bash
code --install-extension innohi.md-pretty-viewer
```

### VSIX 직접 설치
[Releases 페이지](https://github.com/INNO-HI-Inc/md-viewer/releases/latest)에서 `.vsix` 다운로드 후:
```bash
code --install-extension md-pretty-viewer-0.3.0.vsix
```

---

## 키보드 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl/Cmd + E` | Preview ↔ Edit 모드 전환 |
| `Ctrl/Cmd + B` | 볼드 |
| `Ctrl/Cmd + I` | 이탤릭 |
| `Ctrl/Cmd + Shift + C` | 코드 |
| `Tab` | 들여쓰기 (4칸) |
| 더블클릭 | Preview → Edit 전환 |

---

## 설정 (Settings)

`settings.json`에서 다음 설정을 조정할 수 있습니다:

```jsonc
{
  // 기본 컬러 테마 (blue / green / rose / purple / amber / neutral / mono)
  "mdPrettyViewer.defaultTheme": "blue",

  // 기본 프리뷰 폰트 크기 (12-24px)
  "mdPrettyViewer.defaultFontSize": 16,

  // 파일을 열 때 기본 모드 (preview / edit / split)
  "mdPrettyViewer.defaultMode": "preview",

  // 아웃라인 사이드바 기본 표시 여부
  "mdPrettyViewer.showOutline": false
}
```

---

## 명령어 (Commands)

`Ctrl/Cmd + Shift + P`로 Command Palette 열고 `MD Pretty Viewer` 검색:

- `MD Pretty Viewer: Toggle Preview/Edit Mode`
- `MD Pretty Viewer: Bold`
- `MD Pretty Viewer: Italic`
- `MD Pretty Viewer: Code`

---

## 요구 사항

- **VS Code**: 1.74.0 이상
- **플랫폼**: Windows / macOS / Linux 모두 지원
- **외부 의존성**: 없음 (marked.js, highlight.js 번들링)

---

## 알려진 제한 사항

- 단일 파일 편집용으로 설계 (다중 탭 동시 편집 시 각 탭은 독립적으로 작동)
- 매우 큰 마크다운 파일 (>10,000 줄) 렌더링 시 성능 저하 가능
- Mermaid, PlantUML 같은 다이어그램 렌더링은 지원하지 않음

---

## 보안

이 확장은 VS Code 웹뷰의 엄격한 CSP (Content Security Policy)를 사용하며, 마크다운 내 원시 HTML과 `javascript:`/`vbscript:`/`data:` 스키마 URL을 차단합니다. 자세한 내용은 [SECURITY.md](SECURITY.md) 참조.

취약점을 발견하셨다면 **GitHub Issues를 통하지 말고** 직접 연락해주세요:
📧 `security@innohi.ai.kr`

---

## 기여

이슈, 기능 요청, PR 모두 환영합니다.

- [버그 신고](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=bug)
- [기능 요청](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=enhancement)
- [기여 가이드](CONTRIBUTING.md)

---

## 변경 이력

[CHANGELOG.md](CHANGELOG.md) 참조.

---

## 번들된 오픈소스

이 확장은 다음 오픈소스 라이브러리를 번들합니다:

| 라이브러리 | 버전 | 라이선스 | 용도 |
|-----------|------|---------|------|
| [marked](https://github.com/markedjs/marked) | 15.x | MIT | 마크다운 파서 |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.x | BSD-3-Clause | 코드 하이라이팅 |

자세한 라이선스 전문은 [NOTICE.md](NOTICE.md) 참조.

---

## 라이선스

[MIT License](LICENSE) © 2026 [INNO-HI Inc.](https://www.innohi.ai.kr)

---

<p align="center">
  <sub>Made with ♥ by <a href="https://www.innohi.ai.kr">INNO-HI Inc.</a></sub>
</p>
