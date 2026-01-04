/**
 * AI 프롬프트 정의
 */

export const PROJECT_CLASSIFY_PROMPT = `너는 나의 개인 지식관리 시스템에서 노트를 프로젝트별로 분류하는 비서다.
아래 노트 내용을 읽고 어떤 프로젝트에 속하는지 판단해라.

## 기존 프로젝트 목록
{projects}

## 노트 내용
{content}

## 분류 규칙
1. 기존 프로젝트와 관련있으면 → 해당 프로젝트로 분류
2. 새로운 프로젝트로 보이면 → 새 프로젝트명 제안
3. 어떤 프로젝트에도 안 속하는 일반 참고자료 → library로 분류
4. 완료된 내용/더 이상 필요없는 것 → archive로 분류

## 출력 형식 (JSON으로 응답)
{
  "targetType": "project 또는 library 또는 archive",
  "projectName": "프로젝트명 (targetType이 project일 때만)",
  "isNewProject": true/false,
  "title": "노트 제목",
  "summary": "2-3문장 요약",
  "nextAction": "다음 행동 또는 null"
}
`;

// 하위 호환용
export const PARA_CLASSIFY_PROMPT = PROJECT_CLASSIFY_PROMPT;

export const ZK_EXTRACT_PROMPT = `너는 제텔카스텐(Zettelkasten) 방식의 영구 노트를 만드는 비서다.
아래 노트에서 제텔카스텐용 영구 노트 후보 아이디어들을 추출해라.

## 규칙
- 한 노트에는 하나의 아이디어만 담는다 (atomic note)
- 각 아이디어는 3-5문장으로 설명한다
- 왜 이 아이디어가 중요한지 한 줄로 설명해라
- 이 아이디어가 연결될 수 있는 개념 2-3개를 제안해라
- 아이디어마다 연관 키워드를 함께 적어라

## 노트 내용
{content}

## 출력 형식 (JSON 배열로 응답)
[
  {
    "title": "아이디어를 한 문장으로 설명하는 제목",
    "body": "3-5문장의 설명",
    "importance": "왜 이 아이디어가 중요한가? (1줄)",
    "relatedConcepts": ["개념1", "개념2", "개념3"],
    "keywords": ["키워드1", "키워드2", "키워드3"]
  }
]

아이디어가 없으면 빈 배열 []을 반환해라.
`;

export const FOCUS_PROMPT = `너는 나의 작업 우선순위 코치다.
아래 프로젝트 목록을 보고, 지금 내가 집중해야 할 상위 3개만 골라라.

## 프로젝트 목록
{projects}

## 각 프로젝트에 대해 다음을 제공해라
- title: 프로젝트 이름
- why: 왜 지금 중요한지 한 줄 설명
- next_action: 오늘 당장 할 수 있는 가장 작은 다음 행동

## 출력 형식 (JSON 배열로 응답)
[
  {
    "title": "프로젝트 이름",
    "why": "중요한 이유",
    "next_action": "다음 행동"
  }
]
`;

export const OCR_PROMPT = `이 이미지에서 텍스트를 추출해라.
손글씨, 인쇄물, 스캔 문서 등 모든 형태의 텍스트를 읽어라.

## 규칙
- 이미지에 보이는 모든 텍스트를 그대로 추출
- 원본의 줄바꿈과 구조를 최대한 유지
- 표가 있으면 마크다운 표로 변환
- 읽을 수 없는 부분은 [불명확] 으로 표시
- 텍스트만 출력하고 다른 설명은 하지 마라
`;

export const KEYWORD_EXTRACT_PROMPT = `노트 내용을 분석하여 핵심 키워드 5-10개를 추출해라.

## 규칙
- 기술 용어, 프로젝트명, 주요 개념 위주로 추출
- 너무 일반적인 단어 (예: 방법, 내용, 정보)는 제외
- 한글/영어 모두 가능
- 복합 명사는 분리하지 말고 그대로 (예: "스마트팜", "API키")

## 노트 내용
{content}

## 출력 형식 (JSON 배열로만 응답)
["키워드1", "키워드2", "키워드3", ...]
`;

export const RELATED_NOTES_PROMPT = `새 노트와 기존 노트 후보들의 관련성을 분석해라.

## 새 노트
제목: {newTitle}
키워드: {newKeywords}

## 기존 노트 후보들
{candidates}

## 규칙
- 각 후보 노트에 대해 관련도 점수(0.0~1.0)를 매겨라
- 0.5 이상인 노트만 반환
- 최대 5개까지만 반환
- 관련도 높은 순으로 정렬
- 각 연결의 "이유"를 한 줄로 설명해라 (왜 관련있는가?)
- 연결 유형 분류: 확장|반박|예시|전제|응용 중 하나

## 출력 형식 (JSON 배열로만 응답)
[
  {
    "index": 0,
    "relevance": 0.8,
    "reason": "이 노트와 관련있는 구체적 이유",
    "type": "확장"
  }
]
`;

export const PROJECT_DETECT_PROMPT = `새 노트가 어떤 프로젝트와 관련있는지 판단해라.

## 새 노트
제목: {noteTitle}
키워드: {noteKeywords}

## 기존 프로젝트 목록
{projects}

## 규칙
- 노트 제목과 키워드를 보고 가장 관련있는 프로젝트 하나를 선택
- 관련있는 프로젝트가 없으면 "None" 반환
- 확실하지 않으면 "None" 반환
- 새로운 프로젝트로 보이면 "NEW: 프로젝트명" 형식으로 반환

## 출력 형식 (프로젝트명만 응답)
프로젝트명 또는 None 또는 NEW: 새프로젝트명
`;

export const YOUTUBE_SUMMARY_PROMPT = `유튜브 영상의 자막을 분석하여 요약해라.

## 자막 내용
{content}

## 규칙
- 영상의 핵심 주제를 파악해라
- 주요 내용을 3-5문장으로 요약해라
- 핵심 포인트를 3-7개의 bullet point로 정리해라
- 전문 용어나 중요한 개념은 그대로 유지해라

## 출력 형식 (JSON으로 응답)
{
  "title": "영상 내용을 대표하는 제목",
  "summary": "3-5문장 요약",
  "keyPoints": ["핵심 포인트1", "핵심 포인트2", ...]
}
`;

export const WEBPAGE_SUMMARY_PROMPT = `웹페이지 본문을 분석하여 요약해라.

## 본문 내용
{content}

## 규칙
- 글의 핵심 주제를 파악해라
- 주요 내용을 3-5문장으로 요약해라
- 핵심 포인트를 3-7개의 bullet point로 정리해라
- 전문 용어나 중요한 개념은 그대로 유지해라
- 광고나 관련 없는 내용은 무시해라

## 출력 형식 (JSON으로 응답)
{
  "title": "내용을 대표하는 제목",
  "summary": "3-5문장 요약",
  "keyPoints": ["핵심 포인트1", "핵심 포인트2", ...]
}
`;

export const SMART_SPLIT_PROMPT = `너는 메모를 분석하여 프로젝트/주제별로 분리하는 비서다.
하나의 메모에 여러 주제나 프로젝트 관련 내용이 섞여 있을 수 있다.
각각을 독립적인 노트로 분리해라.

## 기존 프로젝트 목록 (참고용)
{projects}

## 메모 내용
{content}

## 규칙
- 서로 다른 프로젝트/주제는 반드시 분리해라
- 한 줄짜리 메모도 의미가 있으면 분리 대상이다
- 관련 내용은 하나로 묶어라 (과도한 분리 금지)
- 각 섹션에 적절한 제목을 붙여라
- targetType을 판단해라:
  - project: 특정 프로젝트와 관련된 내용
  - library: 프로젝트에 속하지 않는 일반 참고자료
  - archive: 완료된 내용, 더 이상 필요없는 것
- 기존 프로젝트와 관련있으면 projectName 필드에 프로젝트명 기입
- 새 프로젝트로 보이면 isNewProject: true와 함께 projectName에 새 프로젝트명 기입
- 키워드 3-5개 추출
- 단일 아이디어면 isAtomic: true, 복합 내용이면 false

## 출력 형식 (JSON 배열로 응답)
[
  {
    "title": "분리된 섹션의 제목",
    "content": "해당 섹션의 원본 내용 (정리하지 말고 그대로)",
    "targetType": "project",
    "projectName": "스마트팜",
    "isNewProject": false,
    "keywords": ["센서", "데이터", "IoT"],
    "isAtomic": false
  }
]

분리할 내용이 없으면 전체를 하나의 섹션으로 반환해라.
`;

export const ZK_INDEX_TOPIC_PROMPT = `주제에 속한 ZK 노트들을 분석하여 구조화된 설명을 생성해라.

## 주제
{topic}

## 노트 목록
{notes}

## 규칙
- 주제에 대한 1-2줄 설명 작성
- 각 노트의 역할/위치 설명 (기초, 심화, 응용, 예시 중 하나)
- 노트 간 관계 표시 (발전, 기반, 관련 중 하나)
- 관련 주제 2-3개 제안

## 출력 형식 (JSON으로 응답)
{
  "description": "주제에 대한 1-2줄 설명",
  "notes": [
    {
      "title": "노트 제목",
      "role": "기초",
      "relations": [{"target": "다른노트제목", "type": "발전"}]
    }
  ],
  "relatedTopics": ["관련주제1", "관련주제2"]
}
`;
