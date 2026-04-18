# Security Policy

## 지원 버전 (Supported Versions)

보안 업데이트는 최신 마이너 버전에만 제공됩니다.

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅        |
| < 0.3   | ❌        |

## 보안 설계

### Content Security Policy (CSP)

이 확장은 VS Code 웹뷰에 다음 CSP를 적용합니다:

```
default-src 'none';
style-src <webview-source> 'unsafe-inline';
script-src 'nonce-<random>' <webview-source>;
img-src <webview-source> https: http: data: file:;
font-src <webview-source> https:;
```

- **default-src 'none'**: 기본적으로 모든 리소스 로드 차단
- **nonce 기반 script-src**: 모든 스크립트는 nonce 토큰으로 검증
- **외부 스크립트 차단**: CDN에서 스크립트를 로드하지 않음 (marked.js, highlight.js, KaTeX 모두 번들)

### XSS 방어 (XSS Prevention)

마크다운 렌더링 단계에서 다단계 방어:

1. **원시 HTML allowlist sanitization**: GitHub 스타일 `<p>`, `<img>`, `<a>`, `<details>`, `<kbd>` 등 안전한 태그만 허용하고 `<script>`, `<iframe>`, 이벤트 핸들러, inline style 등은 제거
2. **URL 스키마 필터링**: 링크 및 이미지에서 다음 스키마 차단:
   - `javascript:`
   - `vbscript:`
   - `data:`
3. **외부 링크 보호**: 모든 외부 링크에 `rel="noopener noreferrer"` 추가 (referrer 유출 및 tabnabbing 방지)
4. **이미지 속성 제한**: `src`, `alt`, `title`, `width`, `height` 등 안전한 속성만 허용하고 URL 스키마를 검증
5. **수식 렌더링 제한**: KaTeX `trust: false` 설정으로 신뢰되지 않은 LaTeX 명령의 HTML/URL 기능 제한

### 로컬 리소스 제한

웹뷰의 `localResourceRoots`는 다음으로 제한됩니다:
- 확장의 `media/` 디렉토리
- 현재 마크다운 파일이 위치한 디렉토리
- 워크스페이스 폴더

즉, 웹뷰는 **임의의 시스템 파일에 접근할 수 없습니다**.

### 데이터 수집

이 확장은 **어떤 사용자 데이터도 수집하거나 외부로 전송하지 않습니다.**

다음만 로컬에 저장됩니다 (웹뷰 `localStorage`):
- 선택한 테마 (`md-viewer-theme`)
- 폰트 크기 (`md-viewer-font-size`)

네트워크 요청은 발생하지 않습니다.

### 외부 의존성

모든 외부 라이브러리는 **번들되어 배포**되며, 런타임에 CDN 등에서 동적으로 로드하지 않습니다:

| 라이브러리 | 버전 | 라이선스 |
|-----------|------|---------|
| marked | 15.x | MIT |
| highlight.js | 11.x | BSD-3-Clause |
| KaTeX | 0.16.28 | MIT |

각 라이브러리는 공식 저장소에서 정식 배포된 버전을 사용하며, 출처 검증 후 번들됩니다.

## 취약점 보고 (Reporting a Vulnerability)

보안 취약점을 발견하셨다면 **공개 GitHub Issues에 게시하지 마시고** 아래 절차를 따라주세요:

### 연락처

📧 **security@innohi.ai.kr**

### 보고 시 포함할 정보

- 취약점 설명
- 재현 단계 (가능한 경우 PoC 코드)
- 영향 범위
- 제안하는 완화 방안 (선택)

### 응답 시간

- **접수 확인**: 48시간 이내
- **초기 분석 결과**: 5 영업일 이내
- **패치 릴리스**: 심각도에 따라 다르며, 중대한 취약점은 7일 이내

### 공개 일정 (Disclosure Policy)

책임 있는 공개 (Responsible Disclosure) 원칙을 따릅니다:
1. 보고 접수 및 확인
2. 패치 개발 및 테스트
3. 패치 릴리스
4. 릴리스 후 90일 뒤 취약점 세부 공개 (보고자 동의 시 크레딧 포함)

## 보안 업데이트 알림

보안 업데이트는 다음 채널로 공지됩니다:
- [GitHub Releases](https://github.com/INNO-HI-Inc/md-viewer/releases)
- [CHANGELOG.md](CHANGELOG.md) `### Security` 섹션
