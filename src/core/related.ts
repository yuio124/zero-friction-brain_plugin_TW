/**
 * 관련 노트 검색 (하이브리드: 키워드 필터링 + AI 판단)
 */

import { App, TFile } from "obsidian";
import { NoteIndex, RelatedNote, PARACategory } from "../types";
import { GeminiClient } from "../api/gemini";

export class RelatedNoteFinder {
	private app: App;
	private gemini: GeminiClient;
	private index: Map<string, NoteIndex> = new Map();

	constructor(app: App, gemini: GeminiClient) {
		this.app = app;
		this.gemini = gemini;
	}

	/**
	 * 전체 노트 인덱싱 (플러그인 로드 시)
	 */
	async buildIndex(): Promise<void> {
		this.index.clear();

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			try {
				const noteIndex = await this.indexNote(file);
				if (noteIndex) {
					this.index.set(file.path, noteIndex);
				}
			} catch (e) {
				console.error(`인덱싱 실패: ${file.path}`, e);
			}
		}

		console.log(`인덱스 구축 완료: ${this.index.size}개 노트`);
	}

	/**
	 * 단일 노트 인덱싱 (frontmatter에서 키워드 추출)
	 */
	private async indexNote(file: TFile): Promise<NoteIndex | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		// 기존 키워드가 있으면 사용
		let keywords: string[] = [];
		if (frontmatter?.keywords) {
			keywords = Array.isArray(frontmatter.keywords)
				? frontmatter.keywords
				: [frontmatter.keywords];
		}

		// 카테고리 추출
		let category: PARACategory | undefined;
		if (frontmatter?.category) {
			const cat = frontmatter.category as string;
			if (["Projects", "Areas", "Resources", "Archives"].includes(cat)) {
				category = cat as PARACategory;
			}
		}

		// 제목 추출 (frontmatter > 파일명)
		const title = frontmatter?.title || file.basename;

		// 타입 추출 (zettel, zk-index 등)
		const type = frontmatter?.type as string | undefined;

		return {
			path: file.path,
			title,
			keywords,
			category,
			project: frontmatter?.project,
			type,
		};
	}

	/**
	 * 인덱스에 노트 추가/업데이트
	 */
	async updateIndex(file: TFile): Promise<void> {
		const noteIndex = await this.indexNote(file);
		if (noteIndex) {
			this.index.set(file.path, noteIndex);
		}
	}

	/**
	 * 인덱스에서 노트 삭제
	 */
	removeFromIndex(path: string): void {
		this.index.delete(path);
	}

	/**
	 * 관련 노트 찾기 (하이브리드 방식)
	 *
	 * 1단계: 키워드 추출 (AI)
	 * 2단계: 키워드로 후보 필터링 (로컬)
	 * 3단계: 후보 중 최종 관련 노트 선별 (AI)
	 */
	async findRelated(
		content: string,
		title: string,
		excludePath?: string
	): Promise<RelatedNote[]> {
		// 1단계: 새 노트에서 키워드 추출
		const keywords = await this.gemini.extractKeywords(content);
		if (keywords.length === 0) {
			return [];
		}

		// 2단계: 키워드로 후보 필터링 (로컬)
		const candidates = this.filterByKeywords(keywords, excludePath);
		if (candidates.length === 0) {
			return [];
		}

		// 3단계: AI로 최종 관련도 판단
		const candidatesText = candidates
			.map((c, i) => `${i}. ${c.note.title} (키워드: ${c.note.keywords.join(", ")})`)
			.join("\n");

		const aiResults = await this.gemini.findRelatedNotes(
			title,
			keywords,
			candidatesText
		);

		// AI 결과를 RelatedNote로 변환 (이유와 유형 포함)
		const results: RelatedNote[] = [];
		for (const result of aiResults) {
			if (result.index >= 0 && result.index < candidates.length) {
				const candidate = candidates[result.index];
				results.push({
					note: candidate.note,
					relevance: result.relevance,
					matchedKeywords: candidate.matchedKeywords,
					reason: result.reason || "",
					connectionType: result.type || "",
				});
			}
		}

		return results;
	}

	/**
	 * 키워드 기반 후보 필터링 (로컬)
	 */
	private filterByKeywords(
		keywords: string[],
		excludePath?: string
	): { note: NoteIndex; matchedKeywords: string[] }[] {
		const candidates: { note: NoteIndex; matchedKeywords: string[] }[] = [];
		const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

		for (const [path, note] of this.index) {
			// 자기 자신 제외
			if (excludePath && path === excludePath) continue;

			// 키워드가 없는 노트 제외
			if (note.keywords.length === 0) continue;

			// 매칭된 키워드 찾기
			const matchedKeywords: string[] = [];
			for (const noteKeyword of note.keywords) {
				const lowerKeyword = noteKeyword.toLowerCase();
				// 정확히 일치하거나 부분 일치
				for (const searchKeyword of keywordSet) {
					if (
						lowerKeyword === searchKeyword ||
						lowerKeyword.includes(searchKeyword) ||
						searchKeyword.includes(lowerKeyword)
					) {
						matchedKeywords.push(noteKeyword);
						break;
					}
				}
			}

			// 최소 1개 이상 매칭되면 후보로 추가
			if (matchedKeywords.length > 0) {
				candidates.push({
					note,
					matchedKeywords,
				});
			}
		}

		// 매칭 키워드 수로 정렬 (많은 순)
		candidates.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

		// 상위 10개만 AI에 전달
		return candidates.slice(0, 10);
	}

	/**
	 * 특정 노트에 키워드 저장 (frontmatter 업데이트)
	 */
	async saveKeywordsToNote(file: TFile, keywords: string[]): Promise<void> {
		const content = await this.app.vault.read(file);
		const newContent = this.updateFrontmatterKeywords(content, keywords);
		await this.app.vault.modify(file, newContent);

		// 인덱스 업데이트
		await this.updateIndex(file);
	}

	/**
	 * Frontmatter에 키워드 추가
	 */
	private updateFrontmatterKeywords(content: string, keywords: string[]): string {
		const keywordsYaml = `keywords: [${keywords.map((k) => `"${k}"`).join(", ")}]`;

		// 기존 frontmatter가 있는지 확인 (Windows/Unix 줄바꿈 모두 처리)
		const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];

			// 기존 keywords 필드가 있으면 교체
			if (/^keywords:/m.test(frontmatter)) {
				const updatedFrontmatter = frontmatter.replace(
					/^keywords:.*$/m,
					keywordsYaml
				);
				return content.replace(
					/^---\r?\n[\s\S]*?\r?\n---/,
					`---\n${updatedFrontmatter}\n---`
				);
			} else {
				// keywords 필드 추가
				return content.replace(
					/^---\r?\n([\s\S]*?)\r?\n---/,
					`---\n$1\n${keywordsYaml}\n---`
				);
			}
		} else {
			// frontmatter가 없으면 새로 생성
			return `---\n${keywordsYaml}\n---\n\n${content}`;
		}
	}

	/**
	 * 노트에 관련 노트 링크 추가
	 */
	async addRelatedLinks(file: TFile, relatedNotes: RelatedNote[]): Promise<void> {
		if (relatedNotes.length === 0) return;

		const content = await this.app.vault.read(file);

		// 관련 노트 섹션 생성 (파일 경로에서 basename 추출)
		const linksSection = `\n\n---\n## 관련 노트\n${relatedNotes
			.map((r) => {
				// path에서 파일명 추출 (.md 제외)
				const pathParts = r.note.path.split("/");
				const fileName = pathParts[pathParts.length - 1];
				const linkName = fileName.replace(/\.md$/, "");
				return `- [[${linkName}]] (관련도: ${Math.round(r.relevance * 100)}%)`;
			})
			.join("\n")}\n`;

		// 기존 관련 노트 섹션이 있으면 교체, 없으면 추가
		const relatedSectionRegex = /\n---\n## 관련 노트\n[\s\S]*?(?=\n---\n|$)/;

		let newContent: string;
		if (relatedSectionRegex.test(content)) {
			newContent = content.replace(relatedSectionRegex, linksSection);
		} else {
			newContent = content + linksSection;
		}

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * 인덱스 크기 반환
	 */
	getIndexSize(): number {
		return this.index.size;
	}

	/**
	 * ZK 노트만 필터링한 인덱스 반환
	 */
	getZettelIndex(): Map<string, NoteIndex> {
		const zettelIndex = new Map<string, NoteIndex>();
		for (const [path, note] of this.index) {
			if (note.type === "zettel") {
				zettelIndex.set(path, note);
			}
		}
		return zettelIndex;
	}

	/**
	 * ZK 노트 개수 반환
	 */
	getZettelCount(): number {
		return this.getZettelIndex().size;
	}

	/**
	 * 관련 ZK 노트 찾기 (ZK 노트 전용)
	 *
	 * 1단계: ZK 노트만 필터링
	 * 2단계: 키워드로 후보 필터링 (로컬)
	 * 3단계: 후보 중 최종 관련 노트 선별 (AI)
	 */
	async findRelatedZettels(
		keywords: string[],
		excludePath?: string
	): Promise<RelatedNote[]> {
		if (keywords.length === 0) {
			return [];
		}

		// 1단계: ZK 노트만 필터링한 인덱스에서 검색
		const zettelIndex = this.getZettelIndex();
		if (zettelIndex.size === 0) {
			return [];
		}

		// 2단계: 키워드로 후보 필터링 (로컬)
		const candidates = this.filterZettelsByKeywords(keywords, zettelIndex, excludePath);
		if (candidates.length === 0) {
			return [];
		}

		// 3단계: AI로 최종 관련도 판단
		const candidatesText = candidates
			.map((c, i) => `${i}. ${c.note.title} (키워드: ${c.note.keywords.join(", ")})`)
			.join("\n");

		const aiResults = await this.gemini.findRelatedNotes(
			"새 ZK 노트",
			keywords,
			candidatesText
		);

		// AI 결과를 RelatedNote로 변환 (이유와 유형 포함)
		const results: RelatedNote[] = [];
		for (const result of aiResults) {
			if (result.index >= 0 && result.index < candidates.length) {
				const candidate = candidates[result.index];
				results.push({
					note: candidate.note,
					relevance: result.relevance,
					matchedKeywords: candidate.matchedKeywords,
					reason: result.reason || "",
					connectionType: result.type || "",
				});
			}
		}

		return results;
	}

	/**
	 * ZK 노트 전용 키워드 기반 후보 필터링 (로컬)
	 */
	private filterZettelsByKeywords(
		keywords: string[],
		zettelIndex: Map<string, NoteIndex>,
		excludePath?: string
	): { note: NoteIndex; matchedKeywords: string[] }[] {
		const candidates: { note: NoteIndex; matchedKeywords: string[] }[] = [];
		const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

		for (const [path, note] of zettelIndex) {
			// 자기 자신 제외
			if (excludePath && path === excludePath) continue;

			// 키워드가 없는 노트 제외
			if (note.keywords.length === 0) continue;

			// 매칭된 키워드 찾기
			const matchedKeywords: string[] = [];
			for (const noteKeyword of note.keywords) {
				const lowerKeyword = noteKeyword.toLowerCase();
				// 정확히 일치하거나 부분 일치
				for (const searchKeyword of keywordSet) {
					if (
						lowerKeyword === searchKeyword ||
						lowerKeyword.includes(searchKeyword) ||
						searchKeyword.includes(lowerKeyword)
					) {
						matchedKeywords.push(noteKeyword);
						break;
					}
				}
			}

			// 최소 1개 이상 매칭되면 후보로 추가
			if (matchedKeywords.length > 0) {
				candidates.push({
					note,
					matchedKeywords,
				});
			}
		}

		// 매칭 키워드 수로 정렬 (많은 순)
		candidates.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

		// 상위 10개만 AI에 전달
		return candidates.slice(0, 10);
	}
}
