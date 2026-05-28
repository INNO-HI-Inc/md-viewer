# 🎉 MD Pretty Viewer 클릭 테스트

> 이 파일을 클릭해서 열면 **Pretty Viewer**로 자동 전환되어야 합니다.

---

## ✨ 기능 체크리스트

- [x] 클릭하면 자동으로 Pretty Viewer로 변환
- [x] 같은 에디터 그룹에서 열림
- [x] 직접 체크박스 클릭해서 토글해보기
- [x] 테마 색상 점 눌러보기
- [x] **+** 버튼 누르면 컬러 팔레트 나오는지 확인

---

## 🎨 테마 미리보기

상단바 오른쪽 색상 점을 눌러보세요. 13가지 테마가 있습니다.

| 카테고리 | 테마 |
|---------|------|
| Classic | Blue · Green · Rose · Purple · Amber |
| Pantone 2026 | Peach 🍑 · Aqua 🌊 · Orchid 💜 |
| Eye-comfort | Sage 🌿 · Sepia 📜 · Mist 🌫 |

---

## 📝 마크다운 문법 테스트

### 강조

**굵게** · *기울임* · ~~취소선~~ · `inline code`

### 코드 블록

```javascript
// 자동 하이라이팅이 됩니다
function greet(name) {
    const message = `안녕하세요, ${name}님!`;
    console.log(message);
    return message;
}

greet("MD Pretty Viewer");
```

```python
# Python 예시
def fibonacci(n):
    """피보나치 수열 계산"""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print([fibonacci(i) for i in range(10)])
```

### 인용문

> "AI 시대에는 정책이 축적·관리되는 방식을 혁신하는 것 자체가 중요하다"
>
> — 임문영 상근 부위원장

### 링크

- [GitHub 레포](https://github.com/INNO-HI-Inc/md-viewer)
- [홈페이지](https://inno-hi-inc.github.io/md-viewer/)
- [라이브 데모](https://inno-hi-inc.github.io/md-viewer/demo.html)

### 리스트

1. 첫 번째 항목
2. 두 번째 항목
   - 중첩 항목 1
   - 중첩 항목 2
3. 세 번째 항목

### 수평선

---

## 🔥 v0.5.4 새 기능

이번 버전에서 **이 파일이 클릭으로 열릴 때 자동 변환**되는 기능이 추가되었습니다.

이전에는 새로 열릴 때만 작동했지만, 지금은 다음 모든 경우에 동작합니다:

1. 새로 파일 열기
2. Claude 링크 클릭
3. 다른 탭에서 활성화
4. VS Code 시작 시 이미 열려있던 파일

---

*이 줄까지 깔끔하게 렌더링되면 성공입니다!* ✅
