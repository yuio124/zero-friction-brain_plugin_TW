# Zero Friction Brain - Obsidian 플러그인 설계서

## 목표
Obsidian 내에서 원클릭으로 PARA 분류 + Zettelkasten 자동화

## 핵심 가치
- **설치**: Community Plugins에서 검색 → Install → Enable
- **설정**: API 키 한 번 입력하면 끝
- **사용**: 단축키로 현재 파일 즉시 처리

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 언어 | TypeScript |
| 빌드 | esbuild |
| AI API | Google Generative AI SDK (`@google/generative-ai`) |
| YAML 파싱 | `yaml` 라이브러리 |

---

## 프로젝트 구조

```
obsidian-zero-friction-brain/
├── manifest.json           # 플러그인 메타데이터
├── package.json            # 의존성
├── tsconfig.json           # TypeScript 설정
├── esbuild.config.mjs      # 빌드 설정
├── src/
│   ├── main.ts             # 플러그인 진입점
│   ├── settings.ts         # 설정 탭 UI
│   ├── api/
│   │   ├── gemini.ts       # Gemini API 클라이언트
│   │   └── prompts.ts      # AI 프롬프트 정의
│   ├── core/
│   │   ├── para.ts         # PARA 분류 로직
│   │   ├── zk.ts           # Zettelkasten 추출 로직
│   │   └── focus.ts        # Focus 추천 로직
│   ├── watcher.ts          # Inbox 자동 감시
│   └── types.ts            # TypeScript 인터페이스
└── styles.css              # 스타일 (옵션)
```

---

## 설정 (Settings)

```typescript
interface ZeroFrictionSettings {
  // 필수
  geminiApiKey: string;

  // 폴더 경로 (기본값 제공)
  inboxFolder: string;      // "00 _Inbox"
  projectsFolder: string;   // "01 Projects"
  areasFolder: string;      // "02 Areas"
  resourcesFolder: string;  // "03 Resources"
  archivesFolder: string;   // "04 Archives"
  zettelFolder: string;     // "10 Zettelkasten"

  // 옵션
  autoWatch: boolean;       // Inbox 자동 감시 (기본: true)
  triggerTag: string;       // 처리 트리거 태그 (기본: "#완료")
  language: "ko" | "en";    // 프롬프트 언어
}
```

### 설정 UI

```
┌─────────────────────────────────────────────────────┐
│  Zero Friction Brain 설정                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Gemini API 키                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │ ●●●●●●●●●●●●●●●●                             │   │
│  └─────────────────────────────────────────────┘   │
│  API 키 발급: https://aistudio.google.com/apikey   │
│                                                     │
│  폴더 설정                                          │
│  ┌─────────────────────────────────────────────┐   │
│  │ Inbox:      00 _Inbox                       │   │
│  │ Projects:   01 Projects                     │   │
│  │ Areas:      02 Areas                        │   │
│  │ Resources:  03 Resources                    │   │
│  │ Archives:   04 Archives                     │   │
│  │ Zettelkasten: 10 Zettelkasten              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  옵션                                               │
│  [x] Inbox 자동 감시                                │
│  트리거 태그: #완료                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 명령어 (Commands)

| ID | 이름 | 단축키 | 동작 |
|----|------|--------|------|
| `para-classify` | PARA 분류 | `Ctrl+Shift+P` | 현재 파일 → AI 분류 → 폴더 이동 |
| `zk-extract` | ZK 추출 | `Ctrl+Shift+Z` | 현재 파일 → 아이디어 추출 → ZK 노트 생성 |
| `focus-top3` | Focus Top 3 | `Ctrl+Shift+F` | Projects 분석 → 우선순위 모달 |
| `process-inbox` | Inbox 전체 처리 | - | Inbox 폴더 일괄 처리 |
| `toggle-watch` | Watch 토글 | - | Inbox 자동 감시 On/Off |

---

## 핵심 기능 상세

### 1. PARA 분류 (`para-classify`)

**흐름:**
```
현재 파일 선택 상태에서 단축키 입력
    ↓
파일 내용 읽기
    ↓
Gemini API 호출 (PARA 분류 프롬프트)
    ↓
응답 파싱: {category, title, summary, next_action}
    ↓
YAML frontmatter 추가/업데이트
    ↓
대상 폴더로 파일 이동
    ↓
Notice: "Projects로 분류됨"
```

**Frontmatter 형식:**
```yaml
---
category: Projects
title: 스마트팜 센서 최적화
summary: 온습도 센서 데이터 수집 주기 최적화 프로젝트
next_action: 센서 라이브러리 문서 확인
processed_at: 2026-01-01T18:30:00
---
```

### 2. ZK 추출 (`zk-extract`)

**흐름:**
```
현재 파일에서 단축키 입력
    ↓
파일 내용 읽기
    ↓
Gemini API 호출 (ZK 추출 프롬프트)
    ↓
응답 파싱: [{title, body, keywords}, ...]
    ↓
모달로 후보 표시 (체크박스 선택)
    ↓
선택된 아이디어로 ZK 노트 생성
    ↓
원본에 백링크 추가
    ↓
Notice: "3개 ZK 노트 생성됨"
```

**ZK 노트 형식:**
```yaml
---
type: zettel
source: "[[원본 노트]]"
keywords: [스마트팜, 센서, 최적화]
created: 2026-01-01T18:30:00
---

# 온도 변화율 기반 센서 수집 주기 동적 조절

온도 변화가 크면 수집 간격을 짧게, 안정적이면 길게 설정하여
배터리 효율과 데이터 정확성을 동시에 확보할 수 있다.

---
## 연결된 노트
- [[원본 노트]]
- [[관련 ZK 노트 1]]
```

### 3. Focus Top 3 (`focus-top3`)

**흐름:**
```
단축키 입력
    ↓
Projects 폴더의 모든 노트 스캔
    ↓
각 노트의 title, summary, next_action 수집
    ↓
Gemini API 호출 (Focus 프롬프트)
    ↓
응답 파싱: [{title, why, next_action}, ...]
    ↓
모달로 Top 3 표시
```

**Focus 모달:**
```
┌─────────────────────────────────────────────┐
│  오늘 집중할 프로젝트 Top 3                 │
├─────────────────────────────────────────────┤
│                                             │
│  1. 스마트팜 센서 최적화                    │
│     마감이 가장 임박하고 의존성이 있음      │
│     → 센서 라이브러리 문서 확인             │
│                                             │
│  2. 블로그 글 작성                          │
│     30분 내 완료 가능한 작은 작업           │
│     → 초안 작성 시작                        │
│                                             │
│  3. 독서 노트 정리                          │
│     에너지 낮을 때 할 수 있는 작업          │
│     → 3장 요약 정리                         │
│                                             │
│                    [ 닫기 ]                 │
└─────────────────────────────────────────────┘
```

### 4. Inbox 자동 감시 (Watch Mode)

**흐름:**
```
플러그인 로드 시 (autoWatch가 true면)
    ↓
vault.on('create') 이벤트 등록
vault.on('modify') 이벤트 등록
    ↓
Inbox 폴더 파일 생성/수정 감지
    ↓
3초 디바운스 대기
    ↓
#완료 태그 또는 frontmatter 확인
    ↓
조건 충족 시 자동 PARA 분류
    ↓
Notice: "자동 분류: 메모.md → Areas"
```

---

## API 모듈 설계

### gemini.ts

```typescript
class GeminiClient {
  private model: GenerativeModel;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp"
    });
  }

  async classifyPARA(content: string): Promise<PARAResult> {
    const prompt = PARA_CLASSIFY_PROMPT.replace("{content}", content);
    const result = await this.model.generateContent(prompt);
    return this.parsePARAResponse(result.response.text());
  }

  async extractZK(content: string): Promise<ZKCandidate[]> {
    const prompt = ZK_EXTRACT_PROMPT.replace("{content}", content);
    const result = await this.model.generateContent(prompt);
    return this.parseZKResponse(result.response.text());
  }

  async getFocus(projectsSummary: string): Promise<FocusItem[]> {
    const prompt = FOCUS_PROMPT.replace("{projects}", projectsSummary);
    const result = await this.model.generateContent(prompt);
    return this.parseFocusResponse(result.response.text());
  }
}
```

### prompts.ts

```typescript
export const PARA_CLASSIFY_PROMPT = `
당신은 PARA 시스템 전문가입니다.
다음 노트를 분석하여 적절한 카테고리로 분류해주세요.

카테고리:
- Projects: 명확한 목표와 마감이 있는 진행 중인 작업
- Areas: 지속적으로 관리해야 하는 책임 영역 (건강, 재정 등)
- Resources: 참고 자료, 관심사, 아이디어
- Archives: 완료되었거나 비활성화된 항목

노트 내용:
{content}

다음 형식으로 응답해주세요:
category: [카테고리명]
title: [적절한 제목]
summary: [2-3문장 요약]
next_action: [다음 행동 또는 None]
`;

export const ZK_EXTRACT_PROMPT = `...`;
export const FOCUS_PROMPT = `...`;
```

---

## UI 컴포넌트

### ZK 선택 모달

```typescript
class ZKSelectModal extends Modal {
  candidates: ZKCandidate[];
  selected: Set<number>;
  onSubmit: (selected: ZKCandidate[]) => void;

  onOpen() {
    // 체크박스 목록으로 후보 표시
    // "생성" 버튼 클릭 시 선택된 항목 반환
  }
}
```

### Focus 결과 모달

```typescript
class FocusModal extends Modal {
  items: FocusItem[];

  onOpen() {
    // Top 3 프로젝트를 카드 형태로 표시
    // 각 항목에 title, why, next_action 표시
  }
}
```

---

## 구현 순서

### Phase 1: 기본 구조
- [x] 프로젝트 초기화 (manifest.json, package.json)
- [x] 플러그인 클래스 뼈대 (main.ts)
- [x] 설정 UI (settings.ts)
- [x] Gemini API 클라이언트 (gemini.ts)

### Phase 2: PARA 분류
- [x] PARA 프롬프트 포팅 (prompts.ts)
- [x] 분류 로직 구현
- [x] 파일 이동 + frontmatter 처리
- [x] `para-classify` 명령어 등록

### Phase 3: ZK 추출
- [x] ZK 프롬프트 포팅
- [x] 추출 로직 구현
- [x] ZK 선택 모달 구현
- [x] 노트 생성 + 백링크 처리
- [x] `zk-extract` 명령어 등록

### Phase 4: Focus + Watch
- [x] Focus 프롬프트 포팅
- [x] Focus 로직 구현
- [x] Focus 모달 구현
- [x] Inbox 감시 로직
- [x] 자동 분류 연동

### Phase 5: 마무리
- [ ] 에러 처리 강화
- [ ] 사용자 피드백 (Notice)
- [ ] README 작성
- [ ] 테스트 및 버그 수정

### Phase 6: OCR 기능
- [ ] OCR 명령어 등록
- [ ] 이미지 OCR 구현 (Gemini Vision)
- [ ] PDF 텍스트 추출 구현
- [ ] PDF OCR 구현 (이미지 기반 PDF)
- [ ] 자동 감지 및 처리 로직

---

## 5. OCR 기능 설계

### 5.1 목표

Inbox에 드롭된 이미지/PDF 파일을 자동으로 텍스트 추출하여 마크다운 노트로 변환

### 5.2 지원 파일 형식

| 형식 | 처리 방식 |
|------|----------|
| 이미지 (PNG, JPG, JPEG, WEBP) | Gemini Vision API로 OCR |
| PDF (텍스트 레이어 있음) | 텍스트 직접 추출 (pdf.js) |
| PDF (스캔/이미지 기반) | 페이지를 이미지로 변환 → Gemini Vision OCR |

### 5.3 명령어

| ID | 이름 | 단축키 | 동작 |
|----|------|--------|------|
| `ocr-extract` | OCR 추출 | `Ctrl+Shift+O` | 현재 파일 → OCR → 마크다운 노트 생성 |
| `ocr-inbox` | Inbox OCR 처리 | - | Inbox의 모든 이미지/PDF 일괄 처리 |

### 5.4 처리 흐름

#### 5.4.1 이미지 OCR

```
이미지 파일 선택 (PNG/JPG)
    ↓
이미지를 Base64로 인코딩
    ↓
Gemini Vision API 호출 (OCR 프롬프트)
    ↓
추출된 텍스트 반환
    ↓
마크다운 노트 생성 (원본 이미지 임베드 포함)
    ↓
원본 이미지 → Archives/OCR_원본/ 으로 이동 (선택)
    ↓
Notice: "OCR 완료: 새 노트 생성됨"
```

#### 5.4.2 PDF 처리 (텍스트 레이어 있음)

```
PDF 파일 선택
    ↓
pdf.js로 텍스트 레이어 추출 시도
    ↓
텍스트 추출 성공? (글자 수 > 임계값)
    ↓ Yes
마크다운 노트 생성
    ↓
Notice: "PDF 텍스트 추출 완료"
```

#### 5.4.3 PDF 처리 (스캔/이미지 기반)

```
PDF 파일 선택
    ↓
pdf.js로 텍스트 레이어 추출 시도
    ↓
텍스트가 거의 없음? (글자 수 < 임계값)
    ↓ Yes (스캔 PDF로 판단)
각 페이지를 이미지로 렌더링
    ↓
각 이미지에 Gemini Vision OCR 적용
    ↓
모든 페이지 텍스트 병합
    ↓
마크다운 노트 생성
    ↓
Notice: "PDF OCR 완료: N페이지 처리됨"
```

### 5.5 안전 제한 (API 요금 보호)

#### 기본 제한값

| 항목 | 기본값 | 설정 가능 범위 |
|------|--------|---------------|
| 최대 페이지 수 | 20페이지 | 1 ~ 100 |
| 최대 파일 크기 | 10MB | 1MB ~ 50MB |
| 일일 OCR 처리 한도 | 50페이지 | 10 ~ 500 |

#### 제한 초과 시 동작

```
PDF 파일 선택 (150페이지, 25MB)
    ↓
페이지 수 확인: 150 > 20 (초과!)
    ↓
경고 모달 표시:
┌─────────────────────────────────────────────────┐
│  ⚠️ 파일이 너무 큽니다                           │
├─────────────────────────────────────────────────┤
│                                                 │
│  이 PDF는 150페이지입니다.                       │
│  현재 설정된 제한: 20페이지                      │
│                                                 │
│  전체 처리 시 예상 API 비용: ~$0.45              │
│                                                 │
│  옵션:                                          │
│  ○ 처음 20페이지만 처리                         │
│  ○ 전체 처리 (제한 무시)                        │
│  ○ 취소                                         │
│                                                 │
│              [ 취소 ]  [ 진행 ]                  │
└─────────────────────────────────────────────────┘
```

#### 일일 한도 추적

```typescript
interface DailyUsage {
  date: string;           // "2026-01-01"
  pagesProcessed: number; // 오늘 처리한 페이지 수
  filesProcessed: number; // 오늘 처리한 파일 수
}
```

일일 한도 도달 시:
```
Notice: "오늘 OCR 한도(50페이지)에 도달했습니다. 내일 다시 시도하세요."
```

#### 설정 UI 추가

```
┌─────────────────────────────────────────────────┐
│  OCR 제한 설정                                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  최대 페이지 수: [20______] 페이지              │
│  최대 파일 크기: [10______] MB                  │
│  일일 처리 한도: [50______] 페이지              │
│                                                 │
│  ⚠️ 제한을 높이면 API 비용이 증가할 수 있습니다  │
│                                                 │
│  오늘 사용량: 12/50 페이지                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 5.6 스캔 PDF 판별 로직

```typescript
async function isScannedPDF(pdfDoc: PDFDocumentProxy): Promise<boolean> {
  const page = await pdfDoc.getPage(1);
  const textContent = await page.getTextContent();

  // 첫 페이지 텍스트가 50자 미만이면 스캔 PDF로 판단
  const text = textContent.items.map(item => item.str).join('');
  return text.length < 50;
}
```

### 5.6 OCR 결과 노트 형식

```yaml
---
type: ocr
source_file: "원본파일명.pdf"
source_type: pdf_scanned | pdf_text | image
pages: 3
ocr_at: 2026-01-01T19:00:00
---

# OCR: 원본파일명

## 페이지 1

[추출된 텍스트...]

## 페이지 2

[추출된 텍스트...]

---
## 원본 파일
![[원본파일명.pdf]]
```

### 5.7 API 모듈 확장

#### gemini.ts 추가 메서드

```typescript
class GeminiClient {
  // ... 기존 메서드 ...

  /**
   * 이미지 OCR 수행
   */
  async extractTextFromImage(imageBase64: string, mimeType: string): Promise<string> {
    const prompt = OCR_PROMPT;
    const result = await this.model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: mimeType,
          data: imageBase64
        }
      }
    ]);
    return result.response.text();
  }

  /**
   * 여러 이미지 OCR (PDF 페이지들)
   */
  async extractTextFromImages(images: {base64: string, mimeType: string}[]): Promise<string[]> {
    const results: string[] = [];
    for (const image of images) {
      const text = await this.extractTextFromImage(image.base64, image.mimeType);
      results.push(text);
    }
    return results;
  }
}
```

#### prompts.ts 추가

```typescript
export const OCR_PROMPT = `이 이미지에서 텍스트를 추출해라.
손글씨, 인쇄물, 스캔 문서 등 모든 형태의 텍스트를 읽어라.

## 규칙
- 이미지에 보이는 모든 텍스트를 그대로 추출
- 원본의 줄바꿈과 구조를 최대한 유지
- 표가 있으면 마크다운 표로 변환
- 읽을 수 없는 부분은 [불명확] 으로 표시
- 텍스트만 출력하고 다른 설명은 하지 마라

## 출력
추출된 텍스트:
`;
```

### 5.8 PDF 처리 모듈

#### core/pdf.ts

```typescript
import { getDocument, PDFDocumentProxy } from 'pdfjs-dist';

export class PDFProcessor {
  /**
   * PDF에서 텍스트 레이어 추출
   */
  async extractText(pdfBuffer: ArrayBuffer): Promise<{text: string, isScanned: boolean}> {
    const pdf = await getDocument({ data: pdfBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n## 페이지 ${i}\n\n${pageText}\n`;
    }

    // 페이지당 평균 50자 미만이면 스캔 PDF로 판단
    const avgCharsPerPage = fullText.length / pdf.numPages;
    const isScanned = avgCharsPerPage < 50;

    return { text: fullText, isScanned };
  }

  /**
   * PDF 페이지들을 이미지로 변환
   */
  async renderPagesToImages(pdfBuffer: ArrayBuffer): Promise<{base64: string, mimeType: string}[]> {
    const pdf = await getDocument({ data: pdfBuffer }).promise;
    const images: {base64: string, mimeType: string}[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 고해상도

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext('2d')!;
      await page.render({ canvasContext: context, viewport }).promise;

      const base64 = canvas.toDataURL('image/png').split(',')[1];
      images.push({ base64, mimeType: 'image/png' });
    }

    return images;
  }
}
```

### 5.9 설정 확장

```typescript
interface ZeroFrictionSettings {
  // ... 기존 설정 ...

  // OCR 설정
  ocrEnabled: boolean;              // OCR 기능 활성화 (기본: true)
  ocrAutoProcess: boolean;          // Inbox 파일 자동 OCR (기본: false)
  ocrMoveOriginal: boolean;         // OCR 후 원본 파일 이동 (기본: true)
  ocrOriginalFolder: string;        // 원본 파일 이동 폴더 (기본: "04 Archives/OCR_원본")
  ocrMinTextThreshold: number;      // 스캔 PDF 판별 임계값 (기본: 50)

  // OCR 안전 제한 (API 요금 보호)
  ocrMaxPages: number;              // 최대 페이지 수 (기본: 20)
  ocrMaxFileSizeMB: number;         // 최대 파일 크기 MB (기본: 10)
  ocrDailyLimit: number;            // 일일 처리 한도 페이지 (기본: 50)
}
```

### 5.10 UI: OCR 결과 확인 모달

```
┌─────────────────────────────────────────────────────┐
│  OCR 결과 미리보기                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  원본: 스캔문서.pdf (3페이지)                        │
│  처리 방식: 스캔 PDF → Gemini Vision OCR            │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ## 페이지 1                                  │   │
│  │                                              │   │
│  │ 회의록                                       │   │
│  │ 날짜: 2026년 1월 1일                         │   │
│  │ 참석자: 홍길동, 김철수                        │   │
│  │ ...                                          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [x] 원본 파일 Archives로 이동                       │
│  [x] OCR 후 PARA 분류 자동 실행                      │
│                                                     │
│              [ 취소 ]  [ 노트 생성 ]                 │
└─────────────────────────────────────────────────────┘
```

### 5.11 자동 처리 흐름 (Watch Mode 확장)

```
Inbox에 새 파일 감지
    ↓
파일 확장자 확인
    ↓
├─ .md 파일 → 기존 PARA 처리
├─ .png/.jpg 파일 → OCR 처리 → 노트 생성 → PARA 분류
└─ .pdf 파일 → 텍스트 추출/OCR → 노트 생성 → PARA 분류
```

### 5.12 의존성 추가

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "pdfjs-dist": "^4.0.0"
  }
}
```

### 5.13 파일 구조 확장

```
src/
├── main.ts
├── settings.ts
├── types.ts
├── api/
│   ├── gemini.ts      # OCR 메서드 추가
│   └── prompts.ts     # OCR_PROMPT 추가
├── core/
│   ├── para.ts
│   ├── zk.ts
│   ├── focus.ts
│   ├── ocr.ts         # NEW: OCR 통합 로직
│   └── pdf.ts         # NEW: PDF 처리
└── watcher.ts         # 이미지/PDF 감지 추가
```

---

## 파일별 역할

| 파일 | 역할 | LoC 예상 |
|------|------|----------|
| `main.ts` | 플러그인 진입점, 명령어 등록 | ~150 |
| `settings.ts` | 설정 탭 UI | ~100 |
| `api/gemini.ts` | Gemini API 클라이언트 | ~100 |
| `api/prompts.ts` | AI 프롬프트 상수 | ~80 |
| `core/para.ts` | PARA 분류 로직 | ~150 |
| `core/zk.ts` | ZK 추출 로직 | ~200 |
| `core/focus.ts` | Focus 추천 로직 | ~80 |
| `watcher.ts` | Inbox 감시 | ~100 |
| `types.ts` | TypeScript 인터페이스 | ~50 |
| **합계** | | **~1000** |

---

## 배포

1. GitHub 저장소 생성
2. `main.js`, `manifest.json`, `styles.css` 릴리스
3. Obsidian Community Plugins PR 제출
4. 승인 후 검색 가능

---

## Python → TypeScript 매핑

| Python 모듈 | TypeScript 파일 | 변경점 |
|-------------|-----------------|--------|
| `gemini_client.py` | `api/gemini.ts` | `@google/generative-ai` SDK 사용 |
| `prompts.py` | `api/prompts.ts` | 템플릿 문자열로 변환 |
| `para_organizer.py` | `core/para.ts` | Obsidian Vault API 사용 |
| `zk_extractor.py` | `core/zk.ts` | Obsidian 링크 형식 사용 |
| `priority_coach.py` | `core/focus.ts` | 동일 로직 |
| `watcher.py` | `watcher.ts` | Obsidian 이벤트 시스템 사용 |
