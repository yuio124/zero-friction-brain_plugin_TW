/**
 * Gemini API 클라이언트
 */

import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { ClassifyResult, ZKCandidate, FocusItem, TargetType, SplitSection } from "../types";
import {
	PROJECT_CLASSIFY_PROMPT,
	ZK_EXTRACT_PROMPT,
	FOCUS_PROMPT,
	OCR_PROMPT,
	KEYWORD_EXTRACT_PROMPT,
	RELATED_NOTES_PROMPT,
	PROJECT_DETECT_PROMPT,
	YOUTUBE_SUMMARY_PROMPT,
	WEBPAGE_SUMMARY_PROMPT,
	ZK_INDEX_TOPIC_PROMPT,
	SMART_SPLIT_PROMPT,
} from "./prompts";

// Rate limiting 설정
const DEFAULT_DELAY_MS = 1000; // API 호출 사이 기본 딜레이 (1초)
const MAX_RETRIES = 3; // 최대 재시도 횟수
const INITIAL_BACKOFF_MS = 2000; // 첫 재시도 대기 시간 (2초)

export class GeminiClient {
	private model: GenerativeModel;
	private lastRequestTime: number = 0;
	private minDelayMs: number = DEFAULT_DELAY_MS;

	constructor(apiKey: string) {
		const genAI = new GoogleGenerativeAI(apiKey);
		this.model = genAI.getGenerativeModel({
			model: "gemini-3-flash-preview",
		});
	}

	/**
	 * Rate limiting을 위한 딜레이
	 */
	private async waitForRateLimit(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;

		if (timeSinceLastRequest < this.minDelayMs) {
			const waitTime = this.minDelayMs - timeSinceLastRequest;
			await this.delay(waitTime);
		}

		this.lastRequestTime = Date.now();
	}

	/**
	 * 지정된 시간만큼 대기
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * 재시도 로직이 포함된 API 호출
	 */
	private async callWithRetry<T>(
		apiCall: () => Promise<T>,
		retries: number = MAX_RETRIES
	): Promise<T> {
		await this.waitForRateLimit();

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				return await apiCall();
			} catch (error: unknown) {
				const isRateLimitError =
					error instanceof Error &&
					(error.message.includes("429") ||
					 error.message.includes("RESOURCE_EXHAUSTED") ||
					 error.message.includes("quota"));

				if (isRateLimitError && attempt < retries) {
					// Exponential backoff: 2초, 4초, 8초...
					const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
					console.log(`Rate limit hit, retrying in ${backoffMs / 1000}s... (attempt ${attempt + 1}/${retries})`);
					await this.delay(backoffMs);

					// 다음 요청을 위해 딜레이 증가
					this.minDelayMs = Math.min(this.minDelayMs * 1.5, 5000);
				} else {
					throw error;
				}
			}
		}

		throw new Error("Max retries exceeded");
	}

	/**
	 * 프로젝트 중심 분류 수행
	 */
	async classifyProject(content: string, projects: string[]): Promise<ClassifyResult> {
		const projectList = projects.length > 0
			? projects.map((p, i) => `${i + 1}. ${p}`).join("\n")
			: "(기존 프로젝트 없음)";

		const prompt = PROJECT_CLASSIFY_PROMPT
			.replace("{projects}", projectList)
			.replace("{content}", content);
		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseProjectResponse(text);
	}

	// 하위 호환용
	async classifyPARA(content: string): Promise<ClassifyResult> {
		return this.classifyProject(content, []);
	}

	/**
	 * Zettelkasten 아이디어 추출
	 */
	async extractZK(content: string): Promise<ZKCandidate[]> {
		const prompt = ZK_EXTRACT_PROMPT.replace("{content}", content);
		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseZKResponse(text);
	}

	/**
	 * Focus Top 3 추천
	 */
	async getFocus(projectsSummary: string): Promise<FocusItem[]> {
		const prompt = FOCUS_PROMPT.replace("{projects}", projectsSummary);
		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseFocusResponse(text);
	}

	/**
	 * 프로젝트 분류 응답 파싱 (JSON 형식)
	 */
	private parseProjectResponse(text: string): ClassifyResult {
		// JSON 블록 추출
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error("프로젝트 분류 응답 파싱 실패: JSON 없음");
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return {
				targetType: this.validateTargetType(parsed.targetType),
				projectName: parsed.projectName || undefined,
				isNewProject: parsed.isNewProject ?? false,
				title: parsed.title || "Untitled",
				summary: parsed.summary || "",
				nextAction: parsed.nextAction || null,
			};
		} catch {
			throw new Error("프로젝트 분류 응답 파싱 실패: " + text);
		}
	}

	/**
	 * ZK 응답 파싱
	 */
	private parseZKResponse(text: string): ZKCandidate[] {
		// JSON 블록 추출
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return parsed.map((item: {
				title: string;
				body: string;
				keywords: string[];
				importance?: string;
				relatedConcepts?: string[];
			}) => ({
				title: item.title,
				body: item.body,
				keywords: item.keywords || [],
				importance: item.importance || "",
				relatedConcepts: item.relatedConcepts || [],
			}));
		} catch {
			console.error("ZK 응답 파싱 실패:", text);
			return [];
		}
	}

	/**
	 * Focus 응답 파싱
	 */
	private parseFocusResponse(text: string): FocusItem[] {
		// JSON 블록 추출
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return parsed.map((item: { title: string; why: string; next_action: string }) => ({
				title: item.title,
				why: item.why,
				nextAction: item.next_action,
			}));
		} catch {
			console.error("Focus 응답 파싱 실패:", text);
			return [];
		}
	}

	/**
	 * 이미지 OCR 수행
	 */
	async extractTextFromImage(imageBase64: string, mimeType: string): Promise<string> {
		const result = await this.callWithRetry(() =>
			this.model.generateContent([
				OCR_PROMPT,
				{
					inlineData: {
						mimeType: mimeType,
						data: imageBase64,
					},
				},
			])
		);
		return result.response.text();
	}

	/**
	 * 여러 이미지 OCR (PDF 페이지들)
	 * 순차 처리 + 페이지 간 딜레이
	 */
	async extractTextFromImages(
		images: { base64: string; mimeType: string }[],
		onProgress?: (current: number, total: number) => void
	): Promise<string[]> {
		const results: string[] = [];
		for (let i = 0; i < images.length; i++) {
			const image = images[i];

			// 진행 상황 콜백
			if (onProgress) {
				onProgress(i + 1, images.length);
			}

			const text = await this.extractTextFromImage(image.base64, image.mimeType);
			results.push(text);

			// 페이지 간 추가 딜레이 (rate limit 방지)
			if (i < images.length - 1) {
				await this.delay(500);
			}
		}
		return results;
	}

	/**
	 * 노트에서 키워드 추출
	 */
	async extractKeywords(content: string): Promise<string[]> {
		const prompt = KEYWORD_EXTRACT_PROMPT.replace("{content}", content);
		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseKeywordsResponse(text);
	}

	/**
	 * 관련 노트 찾기 (AI 판단)
	 */
	async findRelatedNotes(
		newTitle: string,
		newKeywords: string[],
		candidates: string
	): Promise<{ index: number; relevance: number; reason?: string; type?: string }[]> {
		const prompt = RELATED_NOTES_PROMPT
			.replace("{newTitle}", newTitle)
			.replace("{newKeywords}", newKeywords.join(", "))
			.replace("{candidates}", candidates);

		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseRelatedNotesResponse(text);
	}

	/**
	 * 노트가 어떤 프로젝트에 속하는지 판단
	 */
	async detectProject(
		noteTitle: string,
		noteKeywords: string[],
		projects: string[]
	): Promise<string | null> {
		if (projects.length === 0) return null;

		const prompt = PROJECT_DETECT_PROMPT
			.replace("{noteTitle}", noteTitle)
			.replace("{noteKeywords}", noteKeywords.join(", "))
			.replace("{projects}", projects.map((p, i) => `${i + 1}. ${p}`).join("\n"));

		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text().trim();

		// "None" 응답 처리
		if (text.toLowerCase() === "none" || text === "") {
			return null;
		}

		// "NEW: 프로젝트명" 형식 처리
		if (text.startsWith("NEW:")) {
			return text; // 그대로 반환, 호출자가 처리
		}

		// 기존 프로젝트 목록에서 찾기
		const matchedProject = projects.find(
			(p) => text.toLowerCase().includes(p.toLowerCase())
		);

		return matchedProject || null;
	}

	/**
	 * 콘텐츠 요약 (유튜브/웹페이지)
	 */
	async summarizeContent(
		content: string,
		type: "youtube" | "webpage"
	): Promise<{ title: string; summary: string; keyPoints: string[] }> {
		const promptTemplate =
			type === "youtube" ? YOUTUBE_SUMMARY_PROMPT : WEBPAGE_SUMMARY_PROMPT;
		const prompt = promptTemplate.replace("{content}", content);

		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseSummaryResponse(text);
	}

	/**
	 * YouTube 영상 직접 분석 (Gemini 네이티브)
	 * fileData를 사용하여 YouTube URL을 직접 분석
	 */
	async analyzeYouTube(
		youtubeUrl: string
	): Promise<{ title: string; summary: string; keyPoints: string[] }> {
		const prompt = `이 YouTube 영상을 분석해주세요.

## 규칙
- 영상의 핵심 주제를 파악해라
- 주요 내용을 3-5문장으로 요약해라
- 핵심 포인트를 3-7개의 bullet point로 정리해라
- 전문 용어나 중요한 개념은 그대로 유지해라
- 화면에 보이는 텍스트, 슬라이드, 코드 등도 참고해라

## 출력 형식 (JSON으로 응답)
{
  "title": "영상 내용을 대표하는 제목",
  "summary": "3-5문장 요약",
  "keyPoints": ["핵심 포인트1", "핵심 포인트2", ...]
}`;

		const result = await this.callWithRetry(() =>
			this.model.generateContent([
				{
					fileData: {
						mimeType: "video/mp4",
						fileUri: youtubeUrl,
					},
				},
				prompt,
			])
		);
		const text = result.response.text();
		return this.parseSummaryResponse(text);
	}

	/**
	 * 요약 응답 파싱
	 */
	private parseSummaryResponse(text: string): {
		title: string;
		summary: string;
		keyPoints: string[];
	} {
		// JSON 블록 추출
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return {
				title: "Untitled",
				summary: text.trim(),
				keyPoints: [],
			};
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return {
				title: parsed.title || "Untitled",
				summary: parsed.summary || "",
				keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
			};
		} catch {
			console.error("요약 응답 파싱 실패:", text);
			return {
				title: "Untitled",
				summary: text.trim(),
				keyPoints: [],
			};
		}
	}

	/**
	 * 키워드 응답 파싱
	 */
	private parseKeywordsResponse(text: string): string[] {
		// JSON 배열 추출
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (Array.isArray(parsed)) {
				return parsed.filter((item): item is string => typeof item === "string");
			}
			return [];
		} catch {
			console.error("키워드 응답 파싱 실패:", text);
			return [];
		}
	}

	/**
	 * 관련 노트 응답 파싱
	 */
	private parseRelatedNotesResponse(text: string): {
		index: number;
		relevance: number;
		reason?: string;
		type?: string;
	}[] {
		// JSON 배열 추출
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (Array.isArray(parsed)) {
				return parsed
					.filter((item): item is {
						index: number;
						relevance: number;
						reason?: string;
						type?: string;
					} =>
						typeof item === "object" &&
						typeof item.index === "number" &&
						typeof item.relevance === "number"
					)
					.filter(item => item.relevance >= 0.5)
					.sort((a, b) => b.relevance - a.relevance)
					.slice(0, 5)
					.map(item => ({
						index: item.index,
						relevance: item.relevance,
						reason: item.reason || "",
						type: item.type || "",
					}));
			}
			return [];
		} catch {
			console.error("관련 노트 응답 파싱 실패:", text);
			return [];
		}
	}

	/**
	 * ZK Index 주제 구조 생성
	 */
	async generateTopicStructure(
		topic: string,
		notes: string
	): Promise<{
		description: string;
		notes: { title: string; role: string; relations: { target: string; type: string }[] }[];
		relatedTopics: string[];
	}> {
		const prompt = ZK_INDEX_TOPIC_PROMPT
			.replace("{topic}", topic)
			.replace("{notes}", notes);

		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseTopicStructureResponse(text);
	}

	/**
	 * 주제 구조 응답 파싱
	 */
	private parseTopicStructureResponse(text: string): {
		description: string;
		notes: { title: string; role: string; relations: { target: string; type: string }[] }[];
		relatedTopics: string[];
	} {
		// JSON 블록 추출
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return { description: "", notes: [], relatedTopics: [] };
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			return {
				description: parsed.description || "",
				notes: Array.isArray(parsed.notes) ? parsed.notes : [],
				relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
			};
		} catch {
			console.error("주제 구조 응답 파싱 실패:", text);
			return { description: "", notes: [], relatedTopics: [] };
		}
	}

	/**
	 * 스마트 분리: 메모를 프로젝트/주제별로 분리
	 */
	async splitContent(content: string, projects: string[]): Promise<SplitSection[]> {
		const projectList = projects.length > 0
			? projects.map((p, i) => `${i + 1}. ${p}`).join("\n")
			: "(기존 프로젝트 없음)";

		const prompt = SMART_SPLIT_PROMPT
			.replace("{projects}", projectList)
			.replace("{content}", content);

		const result = await this.callWithRetry(() =>
			this.model.generateContent(prompt)
		);
		const text = result.response.text();
		return this.parseSplitResponse(text);
	}

	/**
	 * 스마트 분리 응답 파싱
	 */
	private parseSplitResponse(text: string): SplitSection[] {
		// JSON 배열 추출
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]);
			if (Array.isArray(parsed)) {
				return parsed.map((item: {
					title: string;
					content: string;
					targetType: string;
					projectName?: string;
					isNewProject?: boolean;
					keywords: string[];
					isAtomic: boolean;
				}) => ({
					title: item.title || "Untitled",
					content: item.content || "",
					targetType: this.validateTargetType(item.targetType),
					project: item.projectName || undefined,
					isNewProject: item.isNewProject ?? false,
					keywords: Array.isArray(item.keywords) ? item.keywords : [],
					isAtomic: item.isAtomic ?? false,
				}));
			}
			return [];
		} catch {
			console.error("스마트 분리 응답 파싱 실패:", text);
			return [];
		}
	}

	/**
	 * TargetType 유효성 검사
	 */
	private validateTargetType(targetType: string): TargetType {
		const validTypes: TargetType[] = ["project", "library", "archive"];
		if (validTypes.includes(targetType as TargetType)) {
			return targetType as TargetType;
		}
		return "library"; // 기본값
	}
}
