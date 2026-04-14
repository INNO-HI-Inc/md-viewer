# Contributing to MD Pretty Viewer

기여해주셔서 감사합니다! 이 문서는 프로젝트에 기여하는 방법을 설명합니다.

## 행동 강령 (Code of Conduct)

모든 기여자는 서로를 존중하며 우호적으로 소통해야 합니다. 인신공격, 차별적 발언, 괴롭힘은 용납되지 않습니다.

## 기여 방법

### 🐛 버그 신고

버그를 발견하셨다면 [새 이슈를 생성](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=bug)해주세요.

**포함해주세요:**
- VS Code 버전 (`Help > About`)
- MD Pretty Viewer 버전
- OS (macOS / Windows / Linux + 버전)
- 재현 단계 (단계별로 명확히)
- 기대한 동작 vs 실제 동작
- 스크린샷 또는 스크린 녹화 (가능한 경우)
- 관련 마크다운 파일 내용 (최소 재현 예시)

### 💡 기능 요청

새 기능을 제안하고 싶으시다면 [이슈로 제안](https://github.com/INNO-HI-Inc/md-viewer/issues/new?labels=enhancement)해주세요.

**포함해주세요:**
- 해결하려는 문제나 상황
- 제안하는 해결 방법
- 대안 (고려했지만 채택하지 않은 방법)
- 스크린샷/목업 (UI 변경 시)

### 🔧 코드 기여 (Pull Request)

1. **이슈 먼저 생성**: 큰 변경은 먼저 이슈로 논의해주세요.
2. **Fork & Clone**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/md-viewer.git
   cd md-viewer
   ```
3. **브랜치 생성**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **개발**:
   - VS Code에서 레포 열기
   - `F5` 눌러 Extension Development Host 실행
   - 변경 사항 테스트
5. **커밋**:
   - 명확한 커밋 메시지 (영문 또는 한글)
   - 예: `Add mermaid diagram rendering support`
6. **PR 생성**:
   - [main 브랜치로 PR 생성](https://github.com/INNO-HI-Inc/md-viewer/compare)
   - 템플릿에 따라 설명 작성
   - 관련 이슈 링크 포함

## 프로젝트 구조

```
md-viewer/
├── extension.js          # VS Code 확장 진입점, CustomEditorProvider 등록
├── package.json          # 확장 메타데이터, contributions 선언
├── icon.png              # 확장 아이콘 (128x128)
├── media/
│   ├── editor.css        # 웹뷰 스타일 (테마 포함)
│   ├── editor.js         # 웹뷰 로직 (렌더링, UI, 이벤트)
│   ├── marked.min.js     # 마크다운 파서 (번들)
│   └── highlight.min.js  # 코드 하이라이팅 (번들)
├── styles/
│   └── markdown.css      # 추가 마크다운 스타일
└── docs/                 # GitHub Pages (홈페이지)
```

## 개발 가이드라인

### 코드 스타일
- **JavaScript**: 4-space 들여쓰기, 세미콜론 사용
- **CSS**: 4-space 들여쓰기, BEM 스타일 권장
- **변수명**: camelCase
- **상수**: UPPER_SNAKE_CASE

### 커밋 메시지
- 제목은 50자 이내, 동사로 시작
- 본문은 필요 시 왜(why) 변경했는지 설명
- 예:
  ```
  Add PlantUML diagram rendering

  Users requested inline diagram rendering for technical docs.
  Uses plantuml-encoder to generate server URLs without bundling
  the full PlantUML jar.
  ```

### 테스트
- 수동 테스트: `test-sample.md` 열고 모든 기능 동작 확인
- 테마 전환, 모드 전환, 서식 도구 모두 확인
- 대용량 문서 (1000+ 줄)에서도 성능 확인

### 보안
- 외부 네트워크 요청 추가 금지
- 마크다운 렌더링 시 XSS 방어 필수 (HTML escape, URL 스키마 필터링)
- 새 라이브러리 추가 시 [NOTICE.md](NOTICE.md) 업데이트

## 빌드 & 배포

유지보수자만 해당:

```bash
# 버전 업
npm version minor  # or patch, major

# VSIX 빌드
vsce package

# Marketplace 배포
vsce publish
```

## 질문이 있으신가요?

- 일반 질문: [GitHub Discussions](https://github.com/INNO-HI-Inc/md-viewer/discussions)
- 이메일: `hello@innohi.ai.kr`

## 라이선스

기여해주신 모든 코드는 프로젝트의 [MIT License](LICENSE) 하에 배포됩니다.
