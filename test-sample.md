# MD Pretty Viewer 테스트

이 문서는 **MD Pretty Viewer** 확장 프로그램의 렌더링을 테스트하기 위한 샘플입니다.

## 타이포그래피

일반 텍스트입니다. **굵은 글씨**와 _기울임 글씨_, ~~취소선~~도 잘 표시됩니다.
한글과 English가 혼합된 문장도 자연스럽게 렌더링됩니다.

### 인라인 코드

변수 `const greeting = "안녕하세요"` 를 선언합니다. `npm install` 명령어로 패키지를 설치하세요.

## LaTeX 수식

인라인 수식은 문장 안에서 $E = mc^2$ 처럼 자연스럽게 표시됩니다.

한 줄짜리 블록 수식은 다음처럼 표시됩니다.

$$E = mc^2$$

블록 수식도 지원합니다.

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

복잡한 수식 예시입니다.

$$
\nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0}
$$

## 코드 블록

```javascript
// JavaScript 예시
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 55
```

```python
# Python 예시
def greet(name: str) -> str:
    """인사말을 반환합니다."""
    return f"안녕하세요, {name}님!"

print(greet("세계"))
```

```css
/* CSS 예시 */
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border-radius: 12px;
  padding: 2rem;
}
```

## 인용문

> 좋은 디자인은 가능한 한 적게 디자인하는 것이다.
> — Dieter Rams

> 첫 번째 레벨 인용문
>
> > 중첩된 인용문도 지원합니다.
> >
> > > 세 번째 레벨까지도!

## 테이블

| 기능            | 상태 | 설명                    |
| --------------- | :--: | ----------------------- |
| 다크 모드       |  ✅  | VS Code 테마 자동 감지  |
| 라이트 모드     |  ✅  | VS Code 테마 자동 감지  |
| 코드 하이라이팅 |  ✅  | highlight.js 기반       |
| 한글 지원       |  ✅  | Pretendard 폰트 최적화  |
| 자동 프리뷰     |  ✅  | .md 파일 열면 자동 표시 |
| 프린트          |  ✅  | @media print 대응       |

## 리스트

### 순서 없는 리스트

- 첫 번째 항목
- 두 번째 항목
  - 중첩 항목 A
  - 중첩 항목 B
    - 더 깊은 중첩
- 세 번째 항목

### 순서 있는 리스트

1. 설치하기
2. 설정하기
   1. package.json 수정
   2. CSS 커스터마이징
3. 테스트하기

### 체크리스트

- [x] 프로젝트 생성
- [x] CSS 스타일링
- [x] 자동 프리뷰 기능
- [ ] 마켓플레이스 배포
- [ ] 사용자 피드백 반영

## 이미지

![placeholder](https://placehold.co/600x200/448CFF/ffffff?text=MD+Pretty+Viewer)

## 수평선

---

## 링크

[VS Code 공식 문서](https://code.visualstudio.com/docs)를 참고하세요.

## 키보드 단축키

<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> 로 프리뷰를 열 수 있습니다.

<kbd>Cmd</kbd> + <kbd>B</kbd> 로 사이드바를 토글하세요.

## 정의 리스트

<dl>
<dt>마크다운 (Markdown)</dt>
<dd>존 그루버(John Gruber)가 만든 텍스트 기반 마크업 언어입니다.</dd>

<dt>VS Code</dt>
<dd>Microsoft에서 만든 무료 코드 편집기입니다.</dd>
</dl>

## 접기/펼치기

<details>
<summary>클릭하여 자세한 내용 보기</summary>

이 부분은 접혀있다가 클릭하면 펼쳐집니다.

```json
{
  "name": "md-pretty-viewer",
  "version": "0.0.1",
  "description": "아름다운 마크다운 뷰어"
}
```

</details>

## 각주

마크다운은 매우 유용한 도구입니다[^1]. 다양한 플랫폼에서 지원됩니다[^2].

[^1]: John Gruber가 2004년에 만들었습니다.

[^2]: GitHub, GitLab, VS Code 등에서 널리 사용됩니다.

---

> **MD Pretty Viewer** 로 마크다운을 더 아름답게 경험하세요! ✨
