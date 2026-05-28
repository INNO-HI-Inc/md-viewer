<div align="center">

<a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer">
  <img src="https://raw.githubusercontent.com/INNO-HI-Inc/md-viewer/main/icon.png" width="96" height="96" alt="MD Pretty Viewer">
</a>

<h1>
  MD Pretty Viewer
</h1>

<p>
  <b>Where your markdown becomes a masterpiece.</b><br/>
  <sub>내가 쓴 마크다운이 작품이 되는 순간.</sub>
</p>

<p>
  <sub>
    Live preview that doesn't suck. 13 themes for every mood. PDF export that actually looks good.<br/>
    LaTeX math, clipboard image paste, auto TOC, Korean-first typography — all bundled, all offline.
  </sub>
</p>

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer"><img src="https://img.shields.io/visual-studio-marketplace/v/innohi.md-pretty-viewer?style=flat-square&color=448CFF&labelColor=24292e&logo=visualstudiocode&logoColor=white&label=VS%20Code" alt="VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer"><img src="https://img.shields.io/visual-studio-marketplace/d/innohi.md-pretty-viewer?style=flat-square&color=448CFF&labelColor=24292e&label=installs" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer&ssr=false#review-details"><img src="https://img.shields.io/visual-studio-marketplace/r/innohi.md-pretty-viewer?style=flat-square&color=448CFF&labelColor=24292e&label=rating" alt="Rating"></a>
  <a href="https://github.com/INNO-HI-Inc/md-viewer/blob/main/LICENSE"><img src="https://img.shields.io/github/license/INNO-HI-Inc/md-viewer?style=flat-square&color=448CFF&labelColor=24292e" alt="License"></a>
</p>

<p>
  Live preview &nbsp;·&nbsp; 13 themes &nbsp;·&nbsp; Outline &nbsp;·&nbsp; PDF export &nbsp;·&nbsp; Korean-first typography
</p>

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=innohi.md-pretty-viewer"><b>Install →</b></a>
  &nbsp;·&nbsp;
  <a href="https://inno-hi-inc.github.io/md-viewer/">Homepage</a>
  &nbsp;·&nbsp;
  <a href="https://inno-hi-inc.github.io/md-viewer/demo.html">Live Demo</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/INNO-HI-Inc/md-viewer/issues">Report Bug</a>
</p>

<p>
  <sub><a href="#english">English</a> &nbsp;·&nbsp; <a href="#한국어">한국어</a></sub>
</p>

<br/>

<a href="https://inno-hi-inc.github.io/md-viewer/demo.html">
  <img src="https://raw.githubusercontent.com/INNO-HI-Inc/md-viewer/main/docs/screenshot.png" alt="MD Pretty Viewer screenshot" width="100%">
</a>

</div>

---

<a name="english"></a>

## ✨ Features

### 🎯 Three View Modes
- **Preview** — Read the rendered markdown beautifully
- **Edit** — Edit raw markdown in a clean monospace editor
- **Split** — Side-by-side editor and preview with scroll sync

Double-click on preview mode to switch to edit instantly.

### 🎨 13 Color Themes
**Classic:** Blue · Green · Rose · Purple · Amber · Neutral · Mono
**2026 Pantone trend:** Peach · Aqua · Orchid
**Eye-friendly:** Sage · Sepia · Mist
Auto-optimized for VS Code's light / dark / high-contrast modes.

### 🛠 Formatting Toolbar
Headings (H1-H3), bold, italic, code, links, lists (bullet/numbered), blockquote, horizontal rule — apply with a single click after selecting text.

### 📑 Outline Sidebar
Automatically extracts H1-H4 headings into a navigable tree. Click to smooth-scroll to any section.

### 💻 Code Highlighting
Based on [highlight.js](https://highlightjs.org/). Code block colors adapt to your selected theme.

### 📝 Full GitHub Flavored Markdown Support
Tables · checkboxes · strikethrough · fenced code blocks · autolinks · emoji.

### 🔤 Font Size Control
12px to 24px, adjustable from the toolbar. Settings persist automatically.

### 🇰🇷 Korean Typography
Bundles [에이투지체 (AtoZ font)](https://autoa2z.co.kr) for exceptional Korean text rendering (OFL licensed).

### # Line Numbers
Minimal, unobtrusive line numbers in Edit/Split mode — "barely there" by design.

### ↵ Smart List Continuation
Press Enter in a list item to auto-insert the next marker. Numbered lists auto-increment. Empty list item exits the list.

### ● Focus Mode
Hide toolbars, status bar, and outline to focus purely on writing. One click into Zen mode.

### 🔍 Find (Cmd+F)
Native VS Code find widget to search within the preview.

### ☐ Clickable Checkboxes
Click checkboxes directly in Preview — source markdown updates automatically.

### </> Copy as HTML
Copy the rendered HTML output to clipboard with one click.

### 📄 Export as PDF
Save the rendered preview as a PDF via the system print dialog. A4-optimized layout with smart page breaks.

### 🧮 LaTeX Math (KaTeX)
Render math: `$E = mc^2$` inline, `$$\int_0^\infty e^{-x^2}dx$$` block. KaTeX fonts bundled — works offline.

### 🖼 Clipboard Image Paste
Capture a screenshot, switch to Edit mode, press `Cmd/Ctrl+V` → image auto-inserted as base64 markdown.

### 📑 Auto Table of Contents
Insert `[[TOC]]` or `[[목차]]` anywhere in your markdown → auto-generated, clickable TOC with proper indentation.

### 📌 Sticky Headings
Current H1/H2 stays pinned at the top while scrolling long documents.

### 💾 Save Status Indicator
Status bar shows `● Modified` / `◐ Saving` / `✓ Saved` in real time.

---

## 📦 Installation

### From Marketplace (Recommended)
1. Open Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search `md pretty viewer`
3. Click **Install**

### Command Line
```bash
code --install-extension innohi.md-pretty-viewer
```

### Manual VSIX
Download `.vsix` from [Releases](https://github.com/INNO-HI-Inc/md-viewer/releases/latest), then:
```bash
code --install-extension md-pretty-viewer-0.7.0.vsix
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + E` | Toggle Preview/Edit mode |
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + Shift + C` | Code |
| `Ctrl/Cmd + Alt + M` | Open Pretty View (when on .md file) |
| `Tab` | Indent (4 spaces) |
| Double-click | Preview → Edit |

---

## ⚙️ Settings

Configure via `settings.json`:

```jsonc
{
  // Default color theme (blue | green | rose | purple | amber | neutral | mono)
  "mdPrettyViewer.defaultTheme": "blue",

  // Default preview font size (12-24px)
  "mdPrettyViewer.defaultFontSize": 16,

  // Default view mode when opening a .md file (preview | edit | split)
  "mdPrettyViewer.defaultMode": "preview",

  // Show outline sidebar by default
  "mdPrettyViewer.showOutline": false
}
```

---

## 🖥 Commands

Open Command Palette (`Ctrl/Cmd + Shift + P`) and search `MD Pretty Viewer`:

- `MD Pretty Viewer: Toggle Preview/Edit Mode`
- `MD Pretty Viewer: Bold`
- `MD Pretty Viewer: Italic`
- `MD Pretty Viewer: Code`

---

## 📋 Requirements

- **VS Code**: 1.74.0 or later
- **Platforms**: Windows, macOS, Linux
- **External dependencies**: None (marked.js and highlight.js are bundled)

---

## ⚠️ Known Limitations

- Designed for single-file editing (multiple tabs work independently)
- Very large markdown files (>10,000 lines) may show performance degradation
- Diagram rendering (Mermaid, PlantUML) is not supported

---

## 🔒 Security

This extension uses strict VS Code webview CSP and defensively blocks:
- Raw HTML in markdown (auto-escaped)
- `javascript:`, `vbscript:`, `data:` URL schemes in links and images
- Adds `rel="noopener noreferrer"` to all external links

No data is collected or sent over the network.

See [SECURITY.md](SECURITY.md) for full security design and vulnerability reporting.

To report a vulnerability, please [open a private GitHub Security Advisory](https://github.com/INNO-HI-Inc/md-viewer/security/advisories/new).

---

## 🤝 Contributing

Issues, feature requests, and PRs are welcome.

- [Report a bug](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=bug)
- [Request a feature](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=enhancement)
- [Contributing Guide](CONTRIBUTING.md)

---

## 📜 Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## 📦 Bundled Open Source

This extension bundles the following libraries:

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [marked](https://github.com/markedjs/marked) | 15.x | MIT | Markdown parser |
| [highlight.js](https://github.com/highlightjs/highlight.js) | 11.x | BSD-3-Clause | Syntax highlighting |
| [AtoZ font](https://autoa2z.co.kr) | 1.001 | OFL-1.1 | Korean typography |

Full license texts in [NOTICE.md](NOTICE.md).

---

## 📄 License

[MIT License](LICENSE) © 2026 [INNO-HI Inc.](https://www.innohi.ai.kr)

---

<a name="한국어"></a>

## 🇰🇷 한국어

### 주요 기능

- **3가지 뷰 모드** — Preview / Edit / Split. 더블클릭으로 즉시 편집
- **13가지 컬러 테마** — Blue/Green/Rose/Purple/Amber/Neutral/Mono + Pantone 2026 (Peach/Aqua/Orchid) + 눈 피로 낮은 테마 (Sage/Sepia/Mist)
- **서식 도구** — 헤딩, 볼드, 이탤릭, 코드, 링크, 리스트, 인용, 수평선
- **아웃라인 사이드바** — H1~H4 자동 추출, 클릭으로 이동
- **코드 하이라이팅** — highlight.js 기반, 테마 색상 자동 적용
- **한글 최적화** — 에이투지체(AtoZ font, OFL) 번들로 깔끔한 한글 표기
- **폰트 크기** — 12px ~ 24px 자유 조절
- **GFM 완벽 지원** — 테이블, 클릭 가능한 체크박스, 취소선
- **줄 번호 표시** — Edit/Split 모드에서 미니멀한 줄 번호
- **리스트 자동 이어쓰기** — 리스트에서 Enter 치면 다음 마커 자동 생성
- **포커스 모드** — 한 번 클릭으로 글쓰기에 집중하는 Zen 모드
- **찾기 기능** — Cmd+F로 프리뷰 내 텍스트 검색
- **HTML 복사** — 렌더링된 HTML을 클립보드에 복사
- **PDF로 저장** — 툴바 PDF 버튼 → 시스템 인쇄 다이얼로그에서 "PDF로 저장" (A4 최적화)

### 설치

VS Code Extensions에서 `md pretty viewer` 검색 후 Install. 또는:

```bash
code --install-extension innohi.md-pretty-viewer
```

### 설정

`settings.json`에서 조정:

```jsonc
{
  "mdPrettyViewer.defaultTheme": "blue",       // 기본 테마
  "mdPrettyViewer.defaultFontSize": 16,         // 기본 폰트 크기
  "mdPrettyViewer.defaultMode": "preview",      // 기본 모드
  "mdPrettyViewer.showOutline": false           // 아웃라인 기본 표시
}
```

### 단축키

| 단축키 | 기능 |
|--------|------|
| `Cmd/Ctrl + E` | Preview/Edit 모드 전환 |
| `Cmd/Ctrl + B` | 볼드 |
| `Cmd/Ctrl + I` | 이탤릭 |
| `Cmd/Ctrl + Shift + C` | 코드 |

---

<p align="center">
  <sub>Made with ♥ by <a href="https://www.innohi.ai.kr">INNO-HI Inc.</a></sub>
</p>
