/**
 * Zero Friction Brain - TypeScript 인터페이스 정의
 */

// 플러그인 설정
export interface ZeroFrictionSettings {
	// 필수
	geminiApiKey: string;

	// 폴더 경로 (프로젝트 중심 구조)
	inboxFolder: string;
	projectsFolder: string;  // 01 Projects/ - 하위에 프로젝트별 폴더
	libraryFolder: string;   // 02 Library/ - 프로젝트에 안 속하는 참고자료
	archivesFolder: string;  // 03 Archives/ - 완료된 프로젝트
	zettelFolder: string;    // 10 Zettelkasten/ - 영구 노트

	// 옵션
	autoWatch: boolean;
	triggerTag: string;
	language: "ko" | "en";

	// OCR 설정
	ocrEnabled: boolean;
	ocrAutoProcess: boolean;
	ocrMoveOriginal: boolean;
	ocrOriginalFolder: string;
	ocrMinTextThreshold: number;

	// OCR 안전 제한
	ocrMaxPages: number;
	ocrMaxFileSizeMB: number;
	ocrDailyLimit: number;

	// Zettelkasten 설정
	zkIdType: "timestamp" | "date-sequence" | "luhmann";
	zkMergeThreshold: number; // 유사도 임계값 (0-1)
}

// 기본 설정값
export const DEFAULT_SETTINGS: ZeroFrictionSettings = {
	geminiApiKey: "",
	inboxFolder: "00 _Inbox",
	projectsFolder: "01 Projects",
	libraryFolder: "02 Library",
	archivesFolder: "03 Archives",
	zettelFolder: "10 Zettelkasten",
	autoWatch: true,
	triggerTag: "#완료",
	language: "ko",

	// OCR 기본값
	ocrEnabled: true,
	ocrAutoProcess: false,
	ocrMoveOriginal: true,
	ocrOriginalFolder: "03 Archives/OCR_원본",
	ocrMinTextThreshold: 50,

	// OCR 안전 제한 기본값
	ocrMaxPages: 20,
	ocrMaxFileSizeMB: 10,
	ocrDailyLimit: 50,

	// Zettelkasten 기본값
	zkIdType: "date-sequence",
	zkMergeThreshold: 0.8,
};

// 대상 폴더 타입 (프로젝트 중심)
export type TargetType = "project" | "library" | "archive";

// 분류 결과
export interface ClassifyResult {
	targetType: TargetType;      // 어디로 갈지
	projectName?: string;        // 프로젝트명 (targetType이 "project"일 때)
	title: string;               // 노트 제목
	summary: string;             // 요약
	nextAction: string | null;   // 다음 행동
	isNewProject?: boolean;      // 새 프로젝트인지
}

// 하위 호환용 (점진적 마이그레이션)
export type PARACategory = "Projects" | "Areas" | "Resources" | "Archives";
export type PARAResult = ClassifyResult;

// Zettelkasten 후보
export interface ZKCandidate {
	title: string;
	body: string;
	keywords: string[];
	importance?: string;        // 왜 중요한가 (신규)
	relatedConcepts?: string[]; // 관련 개념 (신규)
}

// Focus 추천 항목
export interface FocusItem {
	title: string;
	why: string;
	nextAction: string;
}

// 프로젝트 정보 (Focus 분석용)
export interface ProjectInfo {
	path: string;
	title: string;
	summary: string;
	nextAction: string | null;
}

// OCR 결과
export interface OCRResult {
	text: string;
	pages: number;
	sourceType: "image" | "pdf_text" | "pdf_scanned";
	sourceFile: string;
}

// 일일 사용량 추적
export interface DailyUsage {
	date: string;
	pagesProcessed: number;
	filesProcessed: number;
}

// 노트 인덱스 (관련 노트 검색용)
export interface NoteIndex {
	path: string;
	title: string;
	keywords: string[];
	targetType?: TargetType;
	project?: string; // 프로젝트명
	type?: string; // 'zettel' | 'zk-index' | undefined
}

// 관련 노트 검색 결과
export interface RelatedNote {
	note: NoteIndex;
	relevance: number; // 0-1 관련도 점수
	matchedKeywords: string[];
	reason?: string;        // 연결 이유 (신규)
	connectionType?: string; // 연결 유형: 확장|반박|예시|전제|응용 (신규)
}

// 스마트 분리 결과 (하나의 메모에서 여러 섹션 분리)
export interface SplitSection {
	title: string;           // 분리된 섹션의 제목
	content: string;         // 분리된 내용
	targetType: TargetType;  // project | library | archive
	project?: string;        // 프로젝트명 (targetType이 "project"일 때)
	keywords: string[];      // 키워드
	isAtomic: boolean;       // 단일 아이디어인지 여부
	isNewProject?: boolean;  // 새 프로젝트인지
}
