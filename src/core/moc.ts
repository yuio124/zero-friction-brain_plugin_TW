/**
 * 프로젝트 MOC (Map of Content) 자동 관리
 */

import { App, TFile, TFolder } from "obsidian";
import { GeminiClient } from "../api/gemini";

/**
 * 파일명에 사용할 수 없는 문자 제거
 */
function sanitizeFileName(name: string, maxLength: number = 100): string {
	return name
		.replace(/[\\/:*?"<>|?#\[\]]/g, "_")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

export interface ProjectMOC {
	path: string;
	title: string;
	project: string; // 프로젝트 식별자
}

export class MOCManager {
	private app: App;
	private gemini: GeminiClient;
	private projectMOCs: Map<string, ProjectMOC> = new Map();

	constructor(app: App, gemini: GeminiClient) {
		this.app = app;
		this.gemini = gemini;
	}

	/**
	 * 프로젝트 MOC 스캔 (플러그인 로드 시)
	 */
	async scanProjectMOCs(): Promise<void> {
		this.projectMOCs.clear();

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const moc = await this.parseProjectMOC(file);
			if (moc) {
				this.projectMOCs.set(moc.project, moc);
			}
		}

		console.log(`프로젝트 MOC 스캔 완료: ${this.projectMOCs.size}개`);
	}

	/**
	 * 파일이 프로젝트 MOC인지 확인
	 */
	private async parseProjectMOC(file: TFile): Promise<ProjectMOC | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		if (!frontmatter) return null;

		// type: project-moc 확인
		if (frontmatter.type !== "project-moc") return null;

		const project = frontmatter.project || file.basename;
		const title = frontmatter.title || file.basename;

		return {
			path: file.path,
			title,
			project,
		};
	}

	/**
	 * 프로젝트 목록 반환 (AI 프롬프트용)
	 */
	getProjectList(): string[] {
		return Array.from(this.projectMOCs.values()).map((moc) => moc.project);
	}

	/**
	 * 프로젝트 MOC 개수 반환
	 */
	getMOCCount(): number {
		return this.projectMOCs.size;
	}

	/**
	 * 노트가 어떤 프로젝트에 속하는지 AI로 판단
	 */
	async detectProject(
		noteTitle: string,
		noteKeywords: string[]
	): Promise<string | null> {
		const projects = this.getProjectList();
		if (projects.length === 0) return null;

		const detectedProject = await this.gemini.detectProject(
			noteTitle,
			noteKeywords,
			projects
		);

		return detectedProject;
	}

	/**
	 * 프로젝트 MOC에 노트 링크 추가
	 */
	async addNoteToMOC(project: string, noteTitle: string, notePath: string): Promise<boolean> {
		const moc = this.projectMOCs.get(project);
		if (!moc) return false;

		const mocFile = this.app.vault.getAbstractFileByPath(moc.path);
		if (!(mocFile instanceof TFile)) return false;

		const content = await this.app.vault.read(mocFile);

		// 파일 경로에서 basename 추출 (실제 파일명 사용)
		const noteFile = this.app.vault.getAbstractFileByPath(notePath);
		const linkName = noteFile instanceof TFile ? noteFile.basename : sanitizeFileName(noteTitle);
		const link = `[[${linkName}]]`;

		// 이미 링크가 있는지 확인
		if (content.includes(link)) {
			return true; // 이미 있으면 성공으로 처리
		}

		// "## 관련 노트" 섹션 찾기 또는 생성
		const sectionRegex = /^## 관련 노트\s*$/m;
		let newContent: string;

		if (sectionRegex.test(content)) {
			// 섹션이 있으면 그 아래에 추가
			newContent = content.replace(
				/^(## 관련 노트\s*\n)/m,
				`$1- ${link}\n`
			);
		} else {
			// 섹션이 없으면 파일 끝에 추가
			newContent = content.trimEnd() + `\n\n## 관련 노트\n- ${link}\n`;
		}

		await this.app.vault.modify(mocFile, newContent);
		return true;
	}

	/**
	 * 새 프로젝트 MOC 생성
	 */
	async createProjectMOC(
		project: string,
		folder: string
	): Promise<TFile | null> {
		// 폴더 존재 확인
		const folderPath = this.app.vault.getAbstractFileByPath(folder);
		if (!folderPath) {
			await this.app.vault.createFolder(folder);
		}

		const sanitizedProject = sanitizeFileName(project);
		const fileName = `${folder}/${sanitizedProject} MOC.md`;

		// 이미 존재하는지 확인
		const existing = this.app.vault.getAbstractFileByPath(fileName);
		if (existing) return null;

		const content = `---
type: project-moc
project: "${project}"
title: "${project} 프로젝트"
created: ${new Date().toISOString()}
---

# ${project} 프로젝트

## 개요


## 진행 중


## 관련 노트

`;

		const file = await this.app.vault.create(fileName, content);

		// 캐시 업데이트
		this.projectMOCs.set(project, {
			path: file.path,
			title: `${project} 프로젝트`,
			project,
		});

		return file;
	}

	/**
	 * 프로젝트 MOC 존재 여부 확인
	 */
	hasProject(project: string): boolean {
		return this.projectMOCs.has(project);
	}

	/**
	 * 프로젝트 MOC 파일 경로 반환
	 */
	getProjectMOCPath(project: string): string | null {
		const moc = this.projectMOCs.get(project);
		return moc?.path || null;
	}
}
