# Zero Friction Brain

Obsidian에서 **원클릭**으로 프로젝트 중심 자동 분류 + Zettelkasten 자동화 + OCR 처리

## 특징

- **단일 단축키**: `Ctrl+Shift+G` 하나로 모든 파일 타입 처리
- **자동 OCR**: PDF/이미지 자동 감지 → 텍스트 추출 → 프로젝트 분류
- **스마트 PDF 처리**: 텍스트 PDF는 API 호출 없이 추출, 스캔 PDF만 OCR
- **프로젝트 폴더 기반**: 같은 프로젝트 파일은 자동으로 같은 폴더에
- **API 보호**: Rate limiting, 자동 재시도, 일일 한도 설정

## 설치

### 수동 설치

1. [Releases](../../releases)에서 최신 버전 다운로드
2. `main.js`, `manifest.json`, `styles.css`를 복사
3. Vault의 `.obsidian/plugins/zero-friction-brain/` 폴더에 붙여넣기
4. Obsidian 재시작 → 설정 → Community Plugins → 활성화

### BRAT 설치

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. BRAT 설정 → Add Beta Plugin
3. `yuio124/zero-friction-brain_plugin_TW` 입력

## 사용법

### 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl+Shift+G` | **프로젝트 분류** (PDF/이미지 자동 OCR) |
| `Ctrl+Shift+D` | **스마트 분리** (메모를 프로젝트별로 분리) |
| `Ctrl+Shift+Z` | ZK 아이디어 추출 |
| `Ctrl+Shift+;` | Focus Top 3 추천 |

### 프로젝트 분류 흐름

```
PDF/이미지 → Ctrl+Shift+G → OCR → 마크다운 생성 → 프로젝트 분류 → 폴더 이동
마크다운   → Ctrl+Shift+G → 프로젝트 분류 → 폴더 이동
```

## 설정

### 필수
- **Gemini API 키**: [Google AI Studio](https://aistudio.google.com/apikey)에서 발급

### 폴더 구조 (기본값)
```
00 _Inbox/        # 새 파일 수집
01 Projects/      # 프로젝트별 하위 폴더
   ├── 스마트팜/
   └── 앱개발/
02 Library/       # 프로젝트에 속하지 않는 참고자료
03 Archives/      # 완료/비활성 항목
10 Zettelkasten/  # 원자적 노트
```

### OCR 안전 제한
- 최대 페이지 수: 20 (기본)
- 최대 파일 크기: 10MB (기본)
- 일일 한도: 50페이지 (기본)

## 기술 스택

- TypeScript + esbuild
- Google Generative AI (Gemini 3 Flash)
- pdfjs-dist (PDF 처리)

## 라이선스

MIT License
