# Zero Friction Brain - Obsidian Plugin 설계 요약서

## 개요

**목표**: Obsidian에서 원클릭으로 PARA 분류 + Zettelkasten 자동화 + OCR 처리

**핵심 가치**: 단축키 하나로 모든 파일 타입 처리 (Zero Friction)

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 언어 | TypeScript |
| 빌드 | esbuild |
| AI API | Google Generative AI (`@google/generative-ai`) |
| PDF 처리 | pdfjs-dist |
| 모델 | gemini-3-flash-preview |

---

## 핵심 기능

### 1. PARA 분류 (`Ctrl+Shift+G`)

**단일 단축키로 모든 파일 타입 처리:**

```
┌─────────────────────────────────────────────────────────┐
│  파일 열기 → Ctrl+Shift+G                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  PDF/이미지?  ──Yes──→  OCR 추출                        │
│      │                     ↓                            │
│      │               마크다운 생성                       │
│      │                     ↓                            │
│      No              PARA 분류                          │
│      │                     ↓                            │
│      └────────────→  폴더 이동                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**PARA 카테고리:**
- **Projects**: 명확한 목표와 마감이 있는 작업
- **Areas**: 지속적으로 관리하는 영역 (건강, 재정 등)
- **Resources**: 참고 자료, 관심사
- **Archives**: 완료/비활성 항목

### 2. ZK 추출 (`Ctrl+Shift+Z`)

노트에서 Zettelkasten 아이디어를 추출하여 원자적 노트 생성:

```
원본 노트 → AI 분석 → 아이디어 후보 추출 → 선택 모달 → ZK 노트 생성
```

### 3. Focus Top 3 (`Ctrl+Shift+;`)

Projects 폴더의 모든 프로젝트를 분석하여 오늘 집중할 Top 3 추천:

```
Projects 스캔 → AI 분석 → 우선순위 결정 → 모달로 표시
```

### 4. OCR 처리

**지원 형식:**
- 이미지: PNG, JPG, JPEG, WebP, GIF
- 문서: PDF (텍스트/스캔 자동 감지)

**PDF 처리 로직:**
```
PDF 로드
    ↓
텍스트 레이어 추출 (pdfjs-dist)
    ↓
페이지당 평균 50자 이상?
    ├── Yes → 텍스트 PDF → API 호출 없음
    └── No  → 스캔 PDF → 페이지별 이미지 변환 → Gemini Vision OCR
```

---

## API Rate Limiting

**429 에러 방지를 위한 보호 메커니즘:**

```typescript
// 호출 간 딜레이
const DEFAULT_DELAY_MS = 1000;

// 자동 재시도 (Exponential Backoff)
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;  // 2초 → 4초 → 8초
```

---

## 안전 제한 (설정 가능)

| 항목 | 기본값 | 설명 |
|------|--------|------|
| 최대 페이지 수 | 20 | 한 번에 처리할 PDF 최대 페이지 |
| 최대 파일 크기 | 10MB | 처리 가능한 최대 파일 크기 |
| 일일 한도 | 50페이지 | 하루 OCR 처리 최대 페이지 |

---

## 명령어 요약

| 단축키 | 명령어 | 동작 |
|--------|--------|------|
| `Ctrl+Shift+G` | PARA 분류 | 파일 타입 자동 감지 → OCR(필요시) → 분류 → 이동 |
| `Ctrl+Shift+Z` | ZK 추출 | 아이디어 추출 → 선택 → ZK 노트 생성 |
| `Ctrl+Shift+;` | Focus Top 3 | 프로젝트 분석 → 우선순위 추천 |
| `Ctrl+Shift+O` | OCR 추출 | OCR만 수행 (분류 없음) |
| - | Inbox 전체 처리 | Inbox 폴더 일괄 처리 |
| - | Inbox OCR 처리 | Inbox 이미지/PDF 일괄 OCR |
| - | Watch 토글 | 자동 감시 On/Off |

---

## 프로젝트 구조

```
obsidian-zero-friction-brain/
├── manifest.json           # 플러그인 메타데이터
├── package.json            # 의존성
├── esbuild.config.mjs      # 빌드 설정
├── src/
│   ├── main.ts             # 플러그인 진입점 + 명령어 등록
│   ├── settings.ts         # 설정 탭 UI
│   ├── types.ts            # TypeScript 인터페이스
│   ├── api/
│   │   ├── gemini.ts       # Gemini API 클라이언트 + Rate Limiting
│   │   └── prompts.ts      # AI 프롬프트 정의
│   └── core/
│       ├── ocr.ts          # OCR 통합 로직
│       └── pdf.ts          # PDF 처리 (pdfjs-dist)
└── styles.css              # 모달 스타일
```

---

## Frontmatter 형식

### PARA 분류 후:
```yaml
---
category: Projects
title: 스마트팜 센서 최적화
summary: 온습도 센서 데이터 수집 주기 최적화 프로젝트
next_action: 센서 라이브러리 문서 확인
processed_at: 2026-01-01T18:30:00
---
```

### OCR 처리 후:
```yaml
---
type: ocr
source_file: "document.pdf"
source_type: pdf_scanned
pages: 5
ocr_at: 2026-01-01T18:30:00
---
```

### ZK 노트:
```yaml
---
type: zettel
source: "[[원본 노트]]"
keywords: [키워드1, 키워드2]
created: 2026-01-01T18:30:00
---
```

---

## 설정 항목

### API 설정
- Gemini API 키

### 폴더 설정
- Inbox: `00 _Inbox`
- Projects: `01 Projects`
- Areas: `02 Areas`
- Resources: `03 Resources`
- Archives: `04 Archives`
- Zettelkasten: `10 Zettelkasten`

### 옵션
- Inbox 자동 감시 (기본: On)
- 트리거 태그 (기본: `#완료`)

### OCR 설정
- OCR 기능 활성화
- OCR 후 원본 이동
- 원본 파일 이동 폴더
- 최대 페이지 수 / 파일 크기 / 일일 한도

---

## 빌드 및 배포

```bash
# 개발 모드
npm run dev

# 프로덕션 빌드
npm run build

# 배포 (Obsidian 플러그인 폴더로 복사)
cp main.js manifest.json styles.css /path/to/.obsidian/plugins/zero-friction-brain/
```

---

## 버전 정보

- **버전**: 1.0.0
- **최종 업데이트**: 2026-01-01
- **빌드 크기**: ~850KB (pdfjs-dist 포함)
