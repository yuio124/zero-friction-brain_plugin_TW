/**
 * ZK Index (Structure Note) 관리
 * 제텔카스텐 노트들의 진입점 역할을 하는 인덱스 노트 자동 관리
 */

import { App, TFile } from "obsidian";
import { NoteIndex } from "../types";
import { RelatedNoteFinder } from "./related";
import { GeminiClient } from "../api/gemini";

export class ZKIndexManager {
	private app: App;
	private relatedNoteFinder: RelatedNoteFinder;
	private gemini: GeminiClient | null;
	private zettelFolder: string;

	constructor(
		app: App,
		relatedNoteFinder: RelatedNoteFinder,
		zettelFolder: string,
		gemini?: GeminiClient
	) {
		this.app = app;
		this.relatedNoteFinder = relatedNoteFinder;
		this.zettelFolder = zettelFolder;
		this.gemini = gemini || null;
	}

	/**
	 * ZK Index 파일 경로
	 */
	private get indexPath(): string {
		return `${this.zettelFolder}/ZK Index.md`;
	}

	/**
	 * ZK Index 노트 업데이트 (새 ZK 노트 추가 시 호출)
	 */
	async updateIndex(newNote: TFile, keywords: string[]): Promise<void> {
		const indexFile = this.app.vault.getAbstractFileByPath(this.indexPath);

		if (indexFile instanceof TFile) {
			// 기존 Index 업데이트
			await this.addNoteToIndex(indexFile, newNote, keywords);
		} else {
			// Index 없으면 새로 생성
			await this.createIndex(newNote, keywords);
		}
	}

	/**
	 * ZK Index 노트 생성
	 */
	private async createIndex(firstNote: TFile, keywords: string[]): Promise<void> {
		const now = new Date().toISOString();
		const mainKeyword = keywords[0] || "기타";

		const content = `---
type: zk-index
updated: ${now}
---

# Zettelkasten Index

## 최근 추가
- [[${firstNote.basename}]]

## 주제별
### ${mainKeyword}
- [[${firstNote.basename}]]
`;

		await this.app.vault.create(this.indexPath, content);
	}

	/**
	 * 기존 ZK Index에 노트 추가
	 */
	private async addNoteToIndex(
		indexFile: TFile,
		newNote: TFile,
		keywords: string[]
	): Promise<void> {
		let content = await this.app.vault.read(indexFile);

		// 1. 최근 추가 섹션 업데이트
		content = this.updateRecentSection(content, newNote);

		// 2. 주제별 섹션 업데이트
		const mainKeyword = keywords[0] || "기타";
		content = this.updateTopicSection(content, newNote, mainKeyword);

		// 3. frontmatter의 updated 시간 갱신
		content = this.updateTimestamp(content);

		await this.app.vault.modify(indexFile, content);
	}

	/**
	 * 최근 추가 섹션 업데이트 (최신 10개 유지)
	 */
	private updateRecentSection(content: string, newNote: TFile): string {
		const recentRegex = /(## 최근 추가\n)([\s\S]*?)(\n## |\n*$)/;
		const match = content.match(recentRegex);

		if (match) {
			let recentItems = match[2].trim().split("\n").filter(line => line.startsWith("- "));

			// 새 노트를 맨 앞에 추가
			const newLink = `- [[${newNote.basename}]]`;

			// 중복 제거
			recentItems = recentItems.filter(item => !item.includes(newNote.basename));

			// 맨 앞에 추가
			recentItems.unshift(newLink);

			// 최대 10개 유지
			recentItems = recentItems.slice(0, 10);

			return content.replace(
				recentRegex,
				`$1${recentItems.join("\n")}\n\n$3`
			);
		}

		return content;
	}

	/**
	 * 주제별 섹션 업데이트
	 */
	private updateTopicSection(content: string, newNote: TFile, topic: string): string {
		const topicHeader = `### ${topic}`;
		const newLink = `- [[${newNote.basename}]]`;

		// 해당 주제 섹션이 있는지 확인
		if (content.includes(topicHeader)) {
			// 기존 주제 섹션에 추가
			const topicRegex = new RegExp(`(### ${this.escapeRegex(topic)}\n)((?:- \\[\\[.*?\\]\\]\n?)*)`);
			const match = content.match(topicRegex);

			if (match) {
				// 중복 체크
				if (match[2].includes(newNote.basename)) {
					return content;
				}

				return content.replace(
					topicRegex,
					`$1$2${newLink}\n`
				);
			}
		} else {
			// 새 주제 섹션 추가 (## 주제별 아래에)
			const topicSectionRegex = /(## 주제별\n)/;
			if (topicSectionRegex.test(content)) {
				return content.replace(
					topicSectionRegex,
					`$1${topicHeader}\n${newLink}\n\n`
				);
			}
		}

		return content;
	}

	/**
	 * frontmatter의 updated 시간 갱신
	 */
	private updateTimestamp(content: string): string {
		const now = new Date().toISOString();
		return content.replace(
			/^(---\n[\s\S]*?updated: ).*?(\n[\s\S]*?---)/,
			`$1${now}$2`
		);
	}

	/**
	 * 정규식 특수문자 이스케이프
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	/**
	 * ZK Index 전체 재구성 (수동 명령어용)
	 */
	async rebuildIndex(): Promise<void> {
		const zettelIndex = this.relatedNoteFinder.getZettelIndex();

		if (zettelIndex.size === 0) {
			return;
		}

		// 주제별로 노트 그룹화
		const topicMap = new Map<string, NoteIndex[]>();
		const allNotes: { note: NoteIndex; created: Date }[] = [];

		for (const [, note] of zettelIndex) {
			const keyword = note.keywords[0] || "기타";

			if (!topicMap.has(keyword)) {
				topicMap.set(keyword, []);
			}
			topicMap.get(keyword)!.push(note);

			// 생성일 추출 (파일명에서 timestamp 또는 날짜)
			const timestampMatch = note.path.match(/(\d{13})/);
			const dateMatch = note.path.match(/(\d{8})-\d{3}/);
			let created: Date;
			if (timestampMatch) {
				created = new Date(parseInt(timestampMatch[1]));
			} else if (dateMatch) {
				const dateStr = dateMatch[1];
				created = new Date(
					parseInt(dateStr.slice(0, 4)),
					parseInt(dateStr.slice(4, 6)) - 1,
					parseInt(dateStr.slice(6, 8))
				);
			} else {
				created = new Date();
			}

			allNotes.push({ note, created });
		}

		// 최근순 정렬
		allNotes.sort((a, b) => b.created.getTime() - a.created.getTime());

		// Index 내용 생성
		const now = new Date().toISOString();
		let content = `---
type: zk-index
updated: ${now}
---

# Zettelkasten Index

## 최근 추가
${allNotes.slice(0, 10).map(({ note }) => {
	const pathParts = note.path.split("/");
	const fileName = pathParts[pathParts.length - 1].replace(/\.md$/, "");
	return `- [[${fileName}]]`;
}).join("\n")}

## 주제별
`;

		// 주제별 섹션 추가 (AI 설명 포함)
		for (const [topic, notes] of topicMap) {
			// AI로 주제 구조 생성 시도
			let topicStructure = null;
			if (this.gemini && notes.length >= 2) {
				try {
					const notesText = notes.map(n => `- ${n.title} (키워드: ${n.keywords.join(", ")})`).join("\n");
					topicStructure = await this.gemini.generateTopicStructure(topic, notesText);
				} catch (e) {
					console.error(`주제 구조 생성 실패: ${topic}`, e);
				}
			}

			content += `### ${topic}\n`;

			// AI 설명이 있으면 추가
			if (topicStructure?.description) {
				content += `${topicStructure.description}\n\n`;
			}

			content += `**핵심 노트:**\n`;
			for (const note of notes) {
				const pathParts = note.path.split("/");
				const fileName = pathParts[pathParts.length - 1].replace(/\.md$/, "");

				// AI 분석에서 역할 찾기
				const noteInfo = topicStructure?.notes.find(n => n.title === note.title);
				const roleText = noteInfo?.role ? ` - ${noteInfo.role}` : "";

				content += `- [[${fileName}]]${roleText}\n`;

				// 관계 정보 추가
				if (noteInfo?.relations && noteInfo.relations.length > 0) {
					for (const rel of noteInfo.relations) {
						const relSymbol = rel.type === "발전" ? "→" : rel.type === "기반" ? "←" : "↔";
						content += `  ${relSymbol} ${rel.target}\n`;
					}
				}
			}

			// 관련 주제
			if (topicStructure?.relatedTopics && topicStructure.relatedTopics.length > 0) {
				content += `\n**관련 주제:** ${topicStructure.relatedTopics.join(", ")}\n`;
			}

			content += "\n";
		}

		// 기존 Index 삭제 후 새로 생성
		const existingIndex = this.app.vault.getAbstractFileByPath(this.indexPath);
		if (existingIndex instanceof TFile) {
			await this.app.vault.delete(existingIndex);
		}

		await this.app.vault.create(this.indexPath, content);
	}
}
