# Security Policy

<p align="center">
  <a href="#english">English</a> · <a href="#한국어">한국어</a>
</p>

---

<a name="english"></a>

## Supported Versions

Security updates are provided only for the latest minor version.

| Version | Supported |
| --- | --- |
| 0.5.x | ✅ |
| < 0.5 | ❌✓ 완료 |

## Security Design

### Content Security Policy (CSP)

The webview enforces a strict CSP:

```
default-src 'none';
style-src <webview-source> 'unsafe-inline';
script-src 'nonce-<random>' <webview-source>;
img-src <webview-source> https: http: data: file:;
font-src <webview-source> https:;
```

- **default-src 'none'**: Blocks all resource loads by default
- **Nonce-based script-src**: All scripts are verified via nonce token
- **No external scripts**: Neither marked.js nor highlight.js are loaded from CDN — both are bundled

### XSS Prevention

Multi-layer defense during markdown rendering:

1. **Raw HTML escaped**: The `html` renderer in marked.js is overridden to escape all raw HTML (`<script>`, `<iframe>`, `<img onerror>`, etc.)
2. **URL scheme filtering**: Links and images block the following schemes:
   - `javascript:`
   - `vbscript:`
   - `data:`
3. **External link protection**: All external links receive `rel="noopener noreferrer"` to prevent referrer leakage and tabnabbing
4. **Attribute encoding**: `src`, `alt`, `title` attributes are HTML-encoded

### Local Resource Restrictions

The webview's `localResourceRoots` is limited to:
- The extension's `media/` directory
- The directory of the currently open markdown file
- Workspace folders

This means the webview **cannot access arbitrary system files**.

### Data Collection

This extension **does not collect or transmit any user data**.

The only data persisted locally (in webview `localStorage`):
- Selected theme (`md-viewer-theme`)
- Font size (`md-viewer-font-size`)
- Custom color (`md-viewer-custom-color`)

**No network requests are made.**

### External Dependencies

All third-party libraries are **bundled** with the extension — nothing is loaded dynamically at runtime:

| Library | Version | License |
|---------|---------|---------|
| marked | 15.x | MIT |
| highlight.js | 11.x | BSD-3-Clause |
| AtoZ font | 1.001 | OFL-1.1 |

Each library is sourced from its official distribution and verified before bundling.

## Reporting a Vulnerability

If you discover a security vulnerability, please [open an issue on GitHub](https://github.com/INNO-HI-Inc/md-viewer/issues/new).

### What to Include

- Description of the vulnerability
- Reproduction steps (with PoC code if available)
- Scope of impact
- Suggested mitigation (optional)

### Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial analysis**: within 5 business days
- **Patch release**: depends on severity — critical issues within 7 days

### Disclosure Policy

We follow responsible disclosure:
1. Report received and acknowledged
2. Patch developed and tested
3. Patch released
4. Full disclosure 90 days after patch release (with credit to reporter, if consented)

## Security Updates

Security patches are announced via:
- [GitHub Releases](https://github.com/INNO-HI-Inc/md-viewer/releases)
- [CHANGELOG.md](CHANGELOG.md) `### Security` section

---

<a name="한국어"></a>

## 🇰🇷 한국어

### 지원 버전

보안 업데이트는 최신 마이너 버전에만 제공됩니다.

| 버전 | 지원 여부 |
|------|-----------|
| 0.5.x | ✅ |
| < 0.5 | ❌ |

### 보안 설계

**CSP (Content Security Policy)** — 웹뷰에 엄격한 CSP 적용:
- `default-src 'none'`으로 모든 리소스 기본 차단
- nonce 기반 script-src로 스크립트 검증
- 외부 CDN 로드 없음 (marked.js, highlight.js, 에이투지체 모두 번들)

**XSS 방어** — 마크다운 렌더링 시 다단계 방어:
- 원시 HTML 자동 escape (marked의 html 렌더러 오버라이드)
- `javascript:` / `vbscript:` / `data:` URL 스키마 차단
- 외부 링크 `rel="noopener noreferrer"` 자동 주입
- 이미지 속성 (`src`, `alt`, `title`) HTML-encode

**로컬 리소스 제한** — 웹뷰의 `localResourceRoots`는 확장의 `media/`, 현재 마크다운 파일 디렉토리, 워크스페이스 폴더만 허용. 임의 시스템 파일 접근 불가.

**데이터 수집 없음** — 어떠한 사용자 데이터도 수집하거나 외부로 전송하지 않습니다.

로컬 저장 데이터 (`localStorage`):
- 선택한 테마
- 폰트 크기
- 커스텀 색상

네트워크 요청 발생하지 않습니다.

### 취약점 보고

[GitHub Issues](https://github.com/INNO-HI-Inc/md-viewer/issues/new)에 등록해주세요.

**포함할 정보**:
- 취약점 설명
- 재현 단계 (가능한 경우 PoC 코드)
- 영향 범위
- 제안하는 완화 방안 (선택)

**응답 시간**:
- 접수 확인: 48시간 이내
- 초기 분석: 5 영업일 이내
- 패치 릴리스: 심각도에 따라 (중대 취약점은 7일 이내)

**공개 일정**: 책임 있는 공개 원칙에 따라 패치 릴리스 90일 뒤 세부 공개 (보고자 동의 시 크레딧 포함)

### 보안 업데이트 알림

- [GitHub Releases](https://github.com/INNO-HI-Inc/md-viewer/releases)
- [CHANGELOG.md](CHANGELOG.md)의 `### Security` 섹션
