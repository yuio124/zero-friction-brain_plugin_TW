/**
 * Zero Friction Brain - Obsidian Plugin
 * PARA 분류 + Zettelkasten 자동화
 */

import {
	App,
	Plugin,
	TFile,
	TFolder,
	Notice,
	Modal,
	debounce,
} from "obsidian";
import { ZeroFrictionSettings, DEFAULT_SETTINGS, ClassifyResult, ZKCandidate, FocusItem, TargetType, DailyUsage, RelatedNote, SplitSection } from "./types";
import { ZeroFrictionSettingTab } from "./settings";
import { GeminiClient } from "./api/gemini";
import { OCRProcessor } from "./core/ocr";
import { RelatedNoteFinder } from "./core/related";
import { MOCManager } from "./core/moc";
import { ZKIndexManager } from "./core/zk-index";
import { YouTubeExtractor } from "./sources/youtube";
import { WebPageExtractor } from "./sources/webpage";

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

export default class ZeroFrictionBrainPlugin extends Plugin {
	settings: ZeroFrictionSettings;
	private gemini: GeminiClient | null = null;
	private ocrProcessor: OCRProcessor | null = null;
	private relatedNoteFinder: RelatedNoteFinder | null = null;
	private mocManager: MOCManager | null = null;
	private zkIndexManager: ZKIndexManager | null = null;
	private youtubeExtractor: YouTubeExtractor | null = null;
	private webPageExtractor: WebPageExtractor | null = null;
	private watcherRegistered = false;
	private pendingFiles: Map<string, number> = new Map();
	private processDebounced: ReturnType<typeof debounce>;
	private zkDailyCounter: Map<string, number> = new Map(); // 날짜별 ZK 순번
	private zkLuhmannCounter: number = 0; // 루만 스타일 카운터

	async onload() {
		await this.loadSettings();

		// 설정 탭 추가
		this.addSettingTab(new ZeroFrictionSettingTab(this.app, this));

		// 디바운스된 처리 함수
		this.processDebounced = debounce(
			() => this.processPendingFiles(),
			3000,
			true
		);

		// 명령어 등록
		this.registerCommands();

		// 자동 감시 시작
		if (this.settings.autoWatch) {
			this.startWatcher();
		}

		// 메타데이터 캐시 준비 후 초기화 (인덱스 빌드)
		this.app.workspace.onLayoutReady(() => {
			this.initGemini();
		});

		console.log("Zero Friction Brain 플러그인 로드됨");
	}

	onunload() {
		this.stopWatcher();
		console.log("Zero Friction Brain 플러그인 언로드됨");
	}

	/**
	 * 설정 로드
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * 설정 저장
	 */
	async saveSettings() {
		await this.saveData(this.settings);
		this.initGemini();
	}

	/**
	 * Gemini 클라이언트 초기화
	 */
	private async initGemini() {
		if (this.settings.geminiApiKey) {
			this.gemini = new GeminiClient(this.settings.geminiApiKey);
			this.ocrProcessor = new OCRProcessor(
				this.gemini,
				this.settings,
				this.app.vault
			);
			this.relatedNoteFinder = new RelatedNoteFinder(this.app, this.gemini);
			this.mocManager = new MOCManager(this.app, this.gemini);
			this.zkIndexManager = new ZKIndexManager(
				this.app,
				this.relatedNoteFinder,
				this.settings.zettelFolder,
				this.gemini
			);
			this.youtubeExtractor = new YouTubeExtractor(this.gemini);
			this.webPageExtractor = new WebPageExtractor(this.gemini);

			// 백그라운드에서 인덱스 구축
			Promise.all([
				this.relatedNoteFinder.buildIndex(),
				this.mocManager.scanProjectMOCs(),
			]).then(() => {
				console.log(`노트 인덱스: ${this.relatedNoteFinder?.getIndexSize()}개, MOC: ${this.mocManager?.getMOCCount()}개, ZK: ${this.relatedNoteFinder?.getZettelCount()}개`);
				// ZK ID 카운터 초기화
				this.initializeZKCounters();
			});
		} else {
			this.gemini = null;
			this.ocrProcessor = null;
			this.relatedNoteFinder = null;
			this.mocManager = null;
			this.youtubeExtractor = null;
			this.webPageExtractor = null;
		}
	}

	/**
	 * API 키 확인
	 */
	private checkApiKey(): boolean {
		if (!this.gemini) {
			new Notice("Gemini API 키를 설정해주세요");
			return false;
		}
		return true;
	}

	/**
	 * 콘텐츠 정리 (API 전송 전)
	 * - Base64 이미지 제거
	 * - 길이 제한
	 */
	private truncateContent(content: string, maxChars: number = 500000): string {
		// 1. Base64 이미지 제거 (data:image/...;base64,xxxx 형식)
		let cleaned = content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[이미지]");

		// 2. 마크다운 이미지의 base64도 제거 ![alt](data:image...)
		cleaned = cleaned.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "[이미지]");

		// 3. 길이 제한
		if (cleaned.length <= maxChars) return cleaned;

		const truncated = cleaned.slice(0, maxChars);
		return truncated + "\n\n[... 내용이 너무 길어 일부만 분석됨 ...]";
	}

	/**
	 * 명령어 등록
	 */
	private registerCommands() {
		// PARA 분류
		this.addCommand({
			id: "para-classify",
			name: "PARA 분류",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "g" }],
			callback: () => this.classifyCurrentFile(),
		});

		// ZK 추출
		this.addCommand({
			id: "zk-extract",
			name: "ZK 추출",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "z" }],
			callback: () => this.extractZKFromCurrentFile(),
		});

		// Focus Top 3
		this.addCommand({
			id: "focus-top3",
			name: "Focus Top 3",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: ";" }],
			callback: () => this.showFocusTop3(),
		});

		// Inbox 전체 처리
		this.addCommand({
			id: "process-inbox",
			name: "Inbox 전체 처리",
			callback: () => this.processInbox(),
		});

		// Watch 토글
		this.addCommand({
			id: "toggle-watch",
			name: "Watch 토글",
			callback: () => this.toggleWatch(),
		});

		// OCR 추출
		this.addCommand({
			id: "ocr-extract",
			name: "OCR 추출",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "o" }],
			callback: () => this.ocrCurrentFile(),
		});

		// Inbox OCR 처리
		this.addCommand({
			id: "ocr-inbox",
			name: "Inbox OCR 처리",
			callback: () => this.processInboxOCR(),
		});

		// 스마트 처리 (OCR → PARA 자동 연결)
		this.addCommand({
			id: "smart-process",
			name: "스마트 처리 (OCR+PARA)",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "s" }],
			callback: () => this.smartProcessCurrentFile(),
		});

		// 프로젝트 MOC 생성
		this.addCommand({
			id: "create-moc",
			name: "프로젝트 MOC 생성",
			callback: () => this.showCreateMOCModal(),
		});

		// URL 가져오기 (유튜브/웹페이지 자동 감지)
		this.addCommand({
			id: "url-import",
			name: "URL 가져오기",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "u" }],
			callback: () => this.showURLImportModal(),
		});

		// ZK Index 재구축
		this.addCommand({
			id: "rebuild-zk-index",
			name: "ZK Index 재구축",
			callback: () => this.rebuildZKIndex(),
		});

		// 스마트 분리 (프로젝트/주제별로 메모 분리)
		this.addCommand({
			id: "smart-split",
			name: "스마트 분리",
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "d" }],
			callback: () => this.smartSplitCurrentFile(),
		});
	}

	/**
	 * ZK Index 재구축
	 */
	private async rebuildZKIndex() {
		if (!this.zkIndexManager) {
			new Notice("API 키가 설정되지 않았습니다.");
			return;
		}

		new Notice("ZK Index 재구축 중...");

		try {
			await this.zkIndexManager.rebuildIndex();
			const count = this.relatedNoteFinder?.getZettelCount() || 0;
			new Notice(`ZK Index 재구축 완료: ${count}개 노트`);
		} catch (error) {
			console.error("ZK Index 재구축 실패:", error);
			new Notice(`재구축 실패: ${error}`);
		}
	}

	/**
	 * 스마트 분리: 메모를 프로젝트/주제별로 분리
	 */
	private async smartSplitCurrentFile() {
		if (!this.checkApiKey()) return;

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("열린 파일이 없습니다");
			return;
		}

		if (file.extension !== "md") {
			new Notice("마크다운 파일만 분리할 수 있습니다");
			return;
		}

		new Notice("메모 분석 중...");

		try {
			const content = await this.app.vault.read(file);

			// 기존 프로젝트 목록 가져오기
			const projects = this.mocManager?.getProjectList() || [];

			// AI로 메모 분리
			const sections = await this.gemini!.splitContent(content, projects);

			if (sections.length === 0) {
				new Notice("분리할 내용이 없습니다");
				return;
			}

			if (sections.length === 1) {
				// 분리할 필요 없음 - 단일 내용
				new Notice("단일 주제로 판단됨. 일반 PARA 분류를 사용하세요.");
				return;
			}

			// 분리 결과 모달 표시
			new SmartSplitModal(
				this.app,
				sections,
				file,
				this
			).open();
		} catch (error) {
			console.error("스마트 분리 실패:", error);
			new Notice(`분리 실패: ${error}`);
		}
	}

	/**
	 * 분리된 섹션들을 개별 노트로 생성
	 */
	async createSplitNotes(sections: SplitSection[], sourceFile: TFile): Promise<void> {
		const createdNotes: string[] = [];

		for (const section of sections) {
			// 1. 대상 폴더 결정
			let targetFolder = this.getTargetFolder(section.targetType, section.project);

			// 프로젝트가 지정된 경우 프로젝트 폴더 하위에 생성
			if (section.project && !section.project.startsWith("NEW:")) {
				// 기존 프로젝트 폴더 확인
				const projectFolder = `${this.settings.projectsFolder}/${section.project}`;
				const folder = this.app.vault.getAbstractFileByPath(projectFolder);
				if (folder instanceof TFolder) {
					targetFolder = projectFolder;
				}
			}

			// 2. 노트 내용 생성
			const sanitizedTitle = sanitizeFileName(section.title);
			const fileName = `${targetFolder}/${sanitizedTitle}.md`;

			const noteContent = `---
targetType: ${section.targetType}
keywords: [${section.keywords.join(", ")}]
source: "[[${sourceFile.basename}]]"
created: ${new Date().toISOString()}
${section.project ? `project: "${section.project}"` : ""}
---

# ${section.title}

${section.content}
`;

			// 3. 폴더 존재 확인
			const folder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!folder) {
				await this.app.vault.createFolder(targetFolder);
			}

			// 4. 파일 생성
			try {
				const newFile = await this.app.vault.create(fileName, noteContent);
				createdNotes.push(section.title);

				// 5. 인덱스 업데이트
				if (this.relatedNoteFinder) {
					await this.relatedNoteFinder.updateIndex(newFile);
				}

				// 6. 프로젝트 MOC 연결
				if (section.project && this.mocManager) {
					if (section.project.startsWith("NEW:")) {
						// 새 프로젝트 MOC 생성
						const newProjectName = section.project.slice(4).trim();
						const mocFile = await this.mocManager.createProjectMOC(
							newProjectName,
							this.settings.projectsFolder
						);
						if (mocFile) {
							await this.mocManager.addNoteToMOC(
								newProjectName,
								section.title,
								newFile.path
							);
						}
					} else {
						// 기존 프로젝트 MOC에 연결
						await this.mocManager.addNoteToMOC(
							section.project,
							section.title,
							newFile.path
						);
					}
				}
			} catch (error) {
				console.error(`노트 생성 실패: ${section.title}`, error);
			}
		}

		// 7. 원본 파일을 Archives로 이동
		const archivePath = `${this.settings.archivesFolder}/${sourceFile.name}`;
		try {
			// Archives 폴더 확인
			const archiveFolder = this.app.vault.getAbstractFileByPath(this.settings.archivesFolder);
			if (!archiveFolder) {
				await this.app.vault.createFolder(this.settings.archivesFolder);
			}
			await this.app.fileManager.renameFile(sourceFile, archivePath);
		} catch (error) {
			console.error("원본 파일 이동 실패:", error);
		}

		new Notice(`${createdNotes.length}개 노트 생성됨, 원본은 Archives로 이동`);
	}

	/**
	 * MOC 생성 모달 표시
	 */
	private showCreateMOCModal() {
		new CreateMOCModal(
			this.app,
			this.mocManager,
			this.settings.projectsFolder
		).open();
	}

	/**
	 * URL 가져오기 모달 표시 (유튜브/웹페이지 자동 감지)
	 */
	private showURLImportModal() {
		if (!this.checkApiKey()) return;

		new URLInputModal(
			this.app,
			"URL 가져오기",
			"유튜브 또는 웹페이지 URL을 입력하세요 (자동 감지)",
			"https://...",
			async (url) => {
				await this.processURL(url);
			}
		).open();
	}

	/**
	 * URL 자동 감지 및 처리
	 */
	private async processURL(url: string) {
		// 유튜브 URL 감지
		const isYouTube = /(?:youtube\.com|youtu\.be)/.test(url);

		if (isYouTube) {
			await this.processYouTube(url);
		} else {
			await this.processWebPage(url);
		}
	}

	/**
	 * 유튜브 처리
	 */
	private async processYouTube(url: string) {
		if (!this.youtubeExtractor || !this.gemini) return;

		new Notice("유튜브 영상 분석 중...");

		try {
			const result = await this.youtubeExtractor.processVideo(url);
			const noteContent = this.youtubeExtractor.generateMarkdownNote(result);

			// 노트 생성 (파일명 sanitize)
			const sanitizedTitle = sanitizeFileName(result.title);
			const fileName = `${sanitizedTitle}.md`;
			const notePath = `${this.settings.inboxFolder}/${fileName}`;
			let newFile = await this.app.vault.create(notePath, noteContent);

			new Notice(`유튜브 노트 생성: ${sanitizedTitle}`);

			// 프로젝트 분류 및 파일 이동
			const projects = this.mocManager?.getProjectList() || [];
			const classifyResult = await this.gemini.classifyProject(noteContent, projects);
			newFile = await this.applyClassifyResult(newFile, classifyResult);

			new Notice(`${classifyResult.targetType}${classifyResult.projectName ? ` (${classifyResult.projectName})` : ""}로 분류됨`);

			// 노트 열기
			this.app.workspace.getLeaf().openFile(newFile);

			// 관련 노트 검색 (선택적)
			if (this.relatedNoteFinder) {
				await this.findAndShowRelatedNotes(newFile, noteContent, classifyResult.title);
			}
		} catch (error) {
			console.error("유튜브 처리 오류:", error);
			new Notice(`유튜브 처리 실패: ${error}`);
		}
	}

	/**
	 * 웹페이지 처리
	 */
	private async processWebPage(url: string) {
		if (!this.webPageExtractor || !this.gemini) return;

		new Notice("웹페이지 본문 추출 중...");

		try {
			const result = await this.webPageExtractor.processUrl(url);
			const noteContent = this.webPageExtractor.generateMarkdownNote(result);

			// 노트 생성 (파일명 sanitize)
			const sanitizedTitle = sanitizeFileName(result.title);
			const fileName = `${sanitizedTitle}.md`;
			const notePath = `${this.settings.inboxFolder}/${fileName}`;
			let newFile = await this.app.vault.create(notePath, noteContent);

			new Notice(`웹페이지 노트 생성: ${sanitizedTitle}`);

			// 프로젝트 분류 및 파일 이동
			const projects = this.mocManager?.getProjectList() || [];
			const classifyResult = await this.gemini.classifyProject(noteContent, projects);
			newFile = await this.applyClassifyResult(newFile, classifyResult);

			new Notice(`${classifyResult.targetType}${classifyResult.projectName ? ` (${classifyResult.projectName})` : ""}로 분류됨`);

			// 노트 열기
			this.app.workspace.getLeaf().openFile(newFile);

			// 관련 노트 검색 (선택적)
			if (this.relatedNoteFinder) {
				await this.findAndShowRelatedNotes(newFile, noteContent, classifyResult.title);
			}
		} catch (error) {
			console.error("웹페이지 처리 오류:", error);
			new Notice(`웹페이지 처리 실패: ${error}`);
		}
	}

	/**
	 * 현재 파일 프로젝트 분류 (PDF/이미지면 자동 OCR)
	 */
	async classifyCurrentFile() {
		if (!this.checkApiKey()) return;

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("열린 파일이 없습니다");
			return;
		}

		const ext = file.extension.toLowerCase();
		const ocrFormats = ["pdf", "png", "jpg", "jpeg", "webp", "gif"];

		// PDF/이미지인 경우: 자동으로 OCR → PARA
		if (ocrFormats.includes(ext)) {
			if (!this.settings.ocrEnabled) {
				new Notice("OCR 기능이 비활성화되어 있습니다");
				return;
			}
			if (!this.ocrProcessor) {
				new Notice("OCR 프로세서를 초기화할 수 없습니다");
				return;
			}

			// 제한 확인
			const limitCheck = await this.ocrProcessor.checkLimits(file);
			if (!limitCheck.allowed) {
				new OCRLimitModal(this.app, limitCheck.reason!, file, this).open();
				return;
			}

			new Notice("처리 중: OCR → 프로젝트 분류...");

			try {
				// 1. OCR 수행
				const result = await this.ocrProcessor.processFile(file);
				const noteContent = this.ocrProcessor.generateMarkdownNote(result);

				// 2. 마크다운 노트 생성
				const noteName = file.basename + "_OCR.md";
				const notePath = `${this.settings.inboxFolder}/${noteName}`;
				const newFile = await this.app.vault.create(notePath, noteContent);

				// 3. 원본 파일 이동 (설정에 따라)
				if (this.settings.ocrMoveOriginal) {
					const originalFolder = this.settings.ocrOriginalFolder;
					const folder = this.app.vault.getAbstractFileByPath(originalFolder);
					if (!folder) {
						await this.app.vault.createFolder(originalFolder);
					}
					const newPath = `${originalFolder}/${file.name}`;
					await this.app.fileManager.renameFile(file, newPath);
				}

				// 4. 프로젝트 분류 수행
				const projects = this.mocManager?.getProjectList() || [];
				const classifyResult = await this.gemini!.classifyProject(noteContent, projects);
				await this.applyClassifyResult(newFile, classifyResult);

				new Notice(`완료: OCR(${result.pages}p) → ${classifyResult.targetType}${classifyResult.projectName ? ` (${classifyResult.projectName})` : ""}`);

				// 5. 관련 노트 검색
				await this.findAndShowRelatedNotes(newFile, noteContent, classifyResult.title);
			} catch (error) {
				console.error("처리 오류:", error);
				new Notice(`처리 실패: ${error}`);
			}
			return;
		}

		// 마크다운 파일
		if (ext === "md") {
			new Notice("분류 중...");

			try {
				const rawContent = await this.app.vault.read(file);
				const content = this.truncateContent(rawContent);
				const projects = this.mocManager?.getProjectList() || [];
				const classifyResult = await this.gemini!.classifyProject(content, projects);
				await this.applyClassifyResult(file, classifyResult);
				new Notice(`${classifyResult.targetType}${classifyResult.projectName ? ` (${classifyResult.projectName})` : ""}로 분류됨`);

				// 관련 노트 검색
				await this.findAndShowRelatedNotes(file, rawContent, classifyResult.title);
			} catch (error) {
				console.error("프로젝트 분류 오류:", error);
				new Notice(`분류 실패: ${error}`);
			}
			return;
		}

		// 지원하지 않는 형식
		new Notice(`지원하지 않는 파일 형식입니다: ${ext}`);
	}

	/**
	 * 프로젝트 분류 결과 적용
	 * @returns 이동된 파일 (새 경로)
	 */
	private async applyClassifyResult(file: TFile, result: ClassifyResult): Promise<TFile> {
		// Frontmatter 업데이트
		const content = await this.app.vault.read(file);
		const newContent = this.updateFrontmatter(content, {
			targetType: result.targetType,
			project: result.projectName || undefined,
			title: result.title,
			summary: result.summary,
			next_action: result.nextAction || undefined,
			processed_at: new Date().toISOString(),
		});

		await this.app.vault.modify(file, newContent);

		// 대상 폴더로 이동
		const targetFolder = this.getTargetFolder(result.targetType, result.projectName);
		if (targetFolder) {
			// 폴더 존재 확인 및 생성
			const folder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!folder) {
				await this.app.vault.createFolder(targetFolder);
			}

			const newPath = `${targetFolder}/${file.name}`;
			await this.app.fileManager.renameFile(file, newPath);
			// 이동된 파일 참조 반환
			const movedFile = this.app.vault.getAbstractFileByPath(newPath);
			if (movedFile instanceof TFile) {
				return movedFile;
			}
		}
		return file;
	}

	/**
	 * 관련 노트 검색 및 MOC 연결
	 */
	private async findAndShowRelatedNotes(file: TFile, content: string, title: string) {
		if (!this.relatedNoteFinder || !this.gemini) return;

		// 토큰 한도 초과 방지
		const truncatedContent = this.truncateContent(content);

		try {
			// 1. 키워드 추출 (공통으로 사용)
			const keywords = await this.gemini.extractKeywords(truncatedContent);

			// 2. 키워드 저장
			if (keywords.length > 0 && this.relatedNoteFinder) {
				await this.relatedNoteFinder.saveKeywordsToNote(file, keywords);
			}

			// 3. 프로젝트 MOC 연결
			if (this.mocManager && this.mocManager.getMOCCount() > 0) {
				await this.handleProjectMOC(file, title, keywords);
			}

			// 4. 관련 노트 검색
			new Notice("관련 노트 검색 중...");
			const relatedNotes = await this.relatedNoteFinder.findRelated(
				truncatedContent,
				title,
				file.path
			);

			if (relatedNotes.length > 0) {
				// 관련 노트 모달 표시
				new RelatedNotesModal(
					this.app,
					relatedNotes,
					file,
					this.relatedNoteFinder
				).open();
			} else if (keywords.length > 0) {
				new Notice(`키워드 ${keywords.length}개 저장됨`);
			}
		} catch (error) {
			console.error("관련 노트 검색 오류:", error);
			// 실패해도 분류는 완료되었으므로 에러 무시
		}
	}

	/**
	 * 프로젝트 MOC 연결 처리
	 */
	private async handleProjectMOC(file: TFile, title: string, keywords: string[]) {
		if (!this.mocManager || !this.gemini) return;

		try {
			const detectedProject = await this.mocManager.detectProject(title, keywords);

			if (!detectedProject) return;

			// 새 프로젝트 감지
			if (detectedProject.startsWith("NEW:")) {
				const newProjectName = detectedProject.slice(4).trim();
				new NewProjectMOCModal(
					this.app,
					newProjectName,
					file,
					title,
					this.mocManager,
					this.settings.projectsFolder
				).open();
				return;
			}

			// 기존 프로젝트에 연결
			const added = await this.mocManager.addNoteToMOC(detectedProject, title, file.path);
			if (added) {
				new Notice(`📁 ${detectedProject} MOC에 연결됨`);
			}
		} catch (error) {
			console.error("MOC 연결 오류:", error);
		}
	}

	/**
	 * 분류 타입별 대상 폴더 반환
	 */
	private getTargetFolder(targetType: TargetType, projectName?: string): string {
		switch (targetType) {
			case "project":
				if (projectName) {
					// 프로젝트 폴더 하위에 프로젝트명 폴더 생성
					return `${this.settings.projectsFolder}/${projectName}`;
				}
				return this.settings.projectsFolder;
			case "library":
				return this.settings.libraryFolder;
			case "archive":
				return this.settings.archivesFolder;
			default:
				return this.settings.libraryFolder;
		}
	}

	/**
	 * Frontmatter 업데이트
	 */
	private updateFrontmatter(
		content: string,
		data: Record<string, string | undefined>
	): string {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
		const match = content.match(frontmatterRegex);

		let yamlContent = "";
		let bodyContent = content;

		if (match) {
			yamlContent = match[1];
			bodyContent = content.slice(match[0].length);
		}

		// YAML 파싱 및 업데이트
		const yamlLines = yamlContent.split("\n").filter((l) => l.trim());
		const yamlMap = new Map<string, string>();

		for (const line of yamlLines) {
			const colonIdx = line.indexOf(":");
			if (colonIdx !== -1) {
				const key = line.slice(0, colonIdx).trim();
				const value = line.slice(colonIdx + 1).trim();
				yamlMap.set(key, value);
			}
		}

		// 새 데이터 추가 (특수문자가 있으면 따옴표로 감싸기)
		for (const [key, value] of Object.entries(data)) {
			if (value !== undefined) {
				// 특수문자 포함 시 따옴표로 감싸기
				const needsQuotes = /[:\[\]{}#&*!|>'"%@`]/.test(value) && !value.startsWith('"');
				const quotedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
				yamlMap.set(key, quotedValue);
			}
		}

		// YAML 재구성
		const newYaml = Array.from(yamlMap.entries())
			.map(([k, v]) => `${k}: ${v}`)
			.join("\n");

		return `---\n${newYaml}\n---\n${bodyContent}`;
	}

	/**
	 * 현재 파일에서 ZK 추출
	 */
	async extractZKFromCurrentFile() {
		if (!this.checkApiKey()) return;

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("열린 파일이 없습니다");
			return;
		}

		new Notice("ZK 아이디어 추출 중...");

		try {
			const content = await this.app.vault.read(file);
			const candidates = await this.gemini!.extractZK(content);

			if (candidates.length === 0) {
				new Notice("추출할 아이디어가 없습니다");
				return;
			}

			// 선택 모달 표시
			new ZKSelectModal(this.app, candidates, file, this).open();
		} catch (error) {
			console.error("ZK 추출 오류:", error);
			new Notice(`추출 실패: ${error}`);
		}
	}

	/**
	 * 기존 ZK 노트에서 카운터 초기화
	 */
	private initializeZKCounters(): void {
		if (!this.relatedNoteFinder) return;

		const zettelIndex = this.relatedNoteFinder.getZettelIndex();

		for (const [path] of zettelIndex) {
			const fileName = path.split("/").pop() || "";

			// date-sequence 형식 (20260102-001)
			const dateSeqMatch = fileName.match(/^(\d{8})-(\d{3})/);
			if (dateSeqMatch) {
				const date = dateSeqMatch[1];
				const seq = parseInt(dateSeqMatch[2], 10);
				const current = this.zkDailyCounter.get(date) || 0;
				if (seq > current) {
					this.zkDailyCounter.set(date, seq);
				}
			}

			// luhmann 형식 - 단순히 전체 개수로 추적
			this.zkLuhmannCounter = Math.max(this.zkLuhmannCounter, zettelIndex.size);
		}

		console.log(`ZK 카운터 초기화: 루만=${this.zkLuhmannCounter}, 일별=${this.zkDailyCounter.size}개 날짜`);
	}

	/**
	 * ZK 노트 ID 생성 (설정에 따라 다른 형식)
	 */
	private generateZKId(): string {
		const idType = this.settings.zkIdType;

		switch (idType) {
			case "timestamp":
				return Date.now().toString();

			case "date-sequence": {
				const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
				const count = (this.zkDailyCounter.get(today) || 0) + 1;
				this.zkDailyCounter.set(today, count);
				return `${today}-${count.toString().padStart(3, "0")}`;
			}

			case "luhmann": {
				this.zkLuhmannCounter++;
				return this.toLuhmannId(this.zkLuhmannCounter);
			}

			default:
				return Date.now().toString();
		}
	}

	/**
	 * 숫자를 루만 스타일 ID로 변환 (1 -> 1, 2 -> 1a, 3 -> 1b, ...)
	 */
	private toLuhmannId(num: number): string {
		if (num <= 0) return "1";

		const result: string[] = [];
		let remaining = num;
		let level = 0;

		while (remaining > 0) {
			if (level % 2 === 0) {
				// 숫자 레벨 (1-9)
				const digit = ((remaining - 1) % 9) + 1;
				result.push(digit.toString());
				remaining = Math.floor((remaining - 1) / 9);
			} else {
				// 문자 레벨 (a-z)
				const charIndex = (remaining - 1) % 26;
				result.push(String.fromCharCode(97 + charIndex));
				remaining = Math.floor((remaining - 1) / 26);
			}
			level++;
		}

		return result.reverse().join("");
	}

	/**
	 * ZK 노트 생성
	 */
	async createZKNotes(candidates: ZKCandidate[], sourceFile: TFile) {
		const zettelFolder = this.settings.zettelFolder;

		// 폴더 존재 확인
		const folder = this.app.vault.getAbstractFileByPath(zettelFolder);
		if (!folder) {
			await this.app.vault.createFolder(zettelFolder);
		}

		const createdNotes: string[] = [];
		const mergedNotes: string[] = [];
		let linkedCount = 0;

		for (const candidate of candidates) {
			// 0. 유사 노트 검색 (병합 제안용)
			const similarNotes = await this.relatedNoteFinder.findRelatedZettels(
				candidate.keywords
			);

			// 임계값 이상의 유사 노트가 있는지 확인
			const highSimilarNote = similarNotes.find(
				(n) => n.relevance >= this.settings.zkMergeThreshold
			);

			if (highSimilarNote) {
				// 병합 여부 물어보기
				const shouldMerge = await this.showMergeConfirmModal(
					candidate,
					highSimilarNote
				);

				if (shouldMerge) {
					// 기존 노트에 내용 추가
					await this.mergeToExistingZK(
						highSimilarNote.note.path,
						candidate,
						sourceFile
					);
					mergedNotes.push(candidate.title);
					continue;
				}
			}

			// 1. ZK 노트 생성
			const zkId = this.generateZKId();
			const sanitizedTitle = sanitizeFileName(candidate.title);
			const fileName = `${zettelFolder}/${zkId} ${sanitizedTitle}.md`;

			const content = `---
type: zettel
source: "[[${sourceFile.basename}]]"
keywords: [${candidate.keywords.join(", ")}]
created: ${new Date().toISOString()}
---

# ${candidate.title}

## 핵심 아이디어
${candidate.body}

## 왜 중요한가?
${candidate.importance || ""}

## 맥락
- **원본**: [[${sourceFile.basename}]]
- **관련 개념**: ${candidate.relatedConcepts?.join(", ") || ""}

---
## 연결된 노트
- [[${sourceFile.basename}]] (원본)
`;

			await this.app.vault.create(fileName, content);
			createdNotes.push(candidate.title);

			// 2. 인덱스 업데이트 (새 노트 추가)
			const newFile = this.app.vault.getAbstractFileByPath(fileName);
			if (newFile instanceof TFile) {
				await this.relatedNoteFinder.updateIndex(newFile);

				// 3. 관련 ZK 노트 검색
				const relatedZettels = await this.relatedNoteFinder.findRelatedZettels(
					candidate.keywords,
					fileName
				);

				// 4. 새 노트에 관련 ZK 링크 추가 + 기존 노트에 백링크 추가
				if (relatedZettels.length > 0) {
					await this.addZKRelatedLinks(newFile, relatedZettels);
					await this.addBacklinksToZettels(newFile, relatedZettels);
					linkedCount += relatedZettels.length;
				}

				// 5. ZK Index 업데이트
				if (this.zkIndexManager) {
					await this.zkIndexManager.updateIndex(newFile, candidate.keywords);
				}
			}

			// 중복 방지를 위한 딜레이
			await new Promise((r) => setTimeout(r, 10));
		}

		// 결과 알림
		const messages: string[] = [];
		if (createdNotes.length > 0) {
			messages.push(`${createdNotes.length}개 생성`);
		}
		if (mergedNotes.length > 0) {
			messages.push(`${mergedNotes.length}개 병합`);
		}
		if (linkedCount > 0) {
			messages.push(`${linkedCount}개 연결`);
		}
		new Notice(`ZK 노트: ${messages.join(", ")}`);
	}

	/**
	 * 병합 확인 모달 표시
	 */
	private showMergeConfirmModal(
		candidate: ZKCandidate,
		similarNote: RelatedNote
	): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ZKMergeConfirmModal(
				this.app,
				candidate,
				similarNote,
				(result) => resolve(result)
			);
			modal.open();
		});
	}

	/**
	 * 기존 ZK 노트에 새 내용 병합
	 */
	private async mergeToExistingZK(
		existingPath: string,
		candidate: ZKCandidate,
		sourceFile: TFile
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(existingPath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);

		// 새 내용을 기존 노트에 추가
		const addition = `

---
## 추가된 내용 (${new Date().toLocaleDateString()})
*원본: [[${sourceFile.basename}]]*

${candidate.body}
`;

		// "## 연결된 노트" 섹션 앞에 추가
		const linkedSectionRegex = /(\n---\n## 연결된 노트)/;
		let newContent: string;

		if (linkedSectionRegex.test(content)) {
			newContent = content.replace(linkedSectionRegex, `${addition}$1`);
		} else {
			newContent = content + addition;
		}

		// 새 키워드 병합 (frontmatter)
		const existingKeywords = this.extractKeywordsFromFrontmatter(content);
		const mergedKeywords = [...new Set([...existingKeywords, ...candidate.keywords])];
		newContent = this.updateFrontmatterKeywordsInContent(newContent, mergedKeywords);

		await this.app.vault.modify(file, newContent);

		// 인덱스 업데이트
		await this.relatedNoteFinder.updateIndex(file);
	}

	/**
	 * frontmatter에서 키워드 추출
	 */
	private extractKeywordsFromFrontmatter(content: string): string[] {
		const match = content.match(/^---\n[\s\S]*?keywords:\s*\[(.*?)\][\s\S]*?---/);
		if (!match) return [];

		return match[1]
			.split(",")
			.map((k) => k.trim().replace(/^["']|["']$/g, ""))
			.filter((k) => k.length > 0);
	}

	/**
	 * frontmatter의 keywords 필드 업데이트
	 */
	private updateFrontmatterKeywordsInContent(content: string, keywords: string[]): string {
		const keywordsYaml = `keywords: [${keywords.join(", ")}]`;
		return content.replace(
			/^(---\n[\s\S]*?)(keywords:\s*\[.*?\])([\s\S]*?---)/,
			`$1${keywordsYaml}$3`
		);
	}

	/**
	 * ZK 노트에 관련 ZK 노트 링크 추가
	 */
	private async addZKRelatedLinks(file: TFile, relatedNotes: RelatedNote[]): Promise<void> {
		if (relatedNotes.length === 0) return;

		const content = await this.app.vault.read(file);

		// 관련 ZK 노트 링크 생성 (이유 포함)
		const links = relatedNotes
			.map((r) => {
				const pathParts = r.note.path.split("/");
				const fileName = pathParts[pathParts.length - 1];
				const linkName = fileName.replace(/\.md$/, "");
				const reasonLine = r.reason ? `\n  → ${r.reason}` : "";
				return `- [[${linkName}]] (${Math.round(r.relevance * 100)}%)${reasonLine}`;
			})
			.join("\n");

		// "## 연결된 노트" 섹션에 추가
		const linkedSectionRegex = /(---\n## 연결된 노트\n[\s\S]*?)(\n---|\n*$)/;
		const match = content.match(linkedSectionRegex);

		let newContent: string;
		if (match) {
			// 기존 섹션에 추가
			newContent = content.replace(
				linkedSectionRegex,
				`$1\n${links}$2`
			);
		} else {
			// 섹션이 없으면 끝에 추가
			newContent = content + `\n---\n## 연결된 노트\n${links}\n`;
		}

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * 관련 ZK 노트에 백링크 추가 (양방향 연결)
	 */
	private async addBacklinksToZettels(
		newNote: TFile,
		relatedNotes: RelatedNote[]
	): Promise<void> {
		for (const related of relatedNotes) {
			const file = this.app.vault.getAbstractFileByPath(related.note.path);
			if (!(file instanceof TFile)) continue;

			const content = await this.app.vault.read(file);

			// 이미 링크가 있는지 확인
			if (content.includes(`[[${newNote.basename}]]`)) continue;

			// "## 연결된 노트" 섹션에 새 노트 링크 추가 (이유 포함)
			const reasonLine = related.reason ? `\n  → ${related.reason}` : "";
			const newLink = `- [[${newNote.basename}]] (${Math.round(related.relevance * 100)}%)${reasonLine}`;
			const linkedSectionRegex = /(---\n## 연결된 노트\n[\s\S]*?)(\n---|\n*$)/;
			const match = content.match(linkedSectionRegex);

			let newContent: string;
			if (match) {
				newContent = content.replace(
					linkedSectionRegex,
					`$1\n${newLink}$2`
				);
			} else {
				newContent = content + `\n---\n## 연결된 노트\n${newLink}\n`;
			}

			await this.app.vault.modify(file, newContent);
		}
	}

	/**
	 * Focus Top 3 표시
	 */
	async showFocusTop3() {
		if (!this.checkApiKey()) return;

		new Notice("프로젝트 분석 중...");

		try {
			const projectsFolder = this.app.vault.getAbstractFileByPath(
				this.settings.projectsFolder
			);

			if (!projectsFolder || !(projectsFolder instanceof TFolder)) {
				new Notice("Projects 폴더가 없습니다");
				return;
			}

			// 프로젝트 정보 수집
			const projectsSummary = await this.collectProjectsSummary(projectsFolder);

			if (!projectsSummary) {
				new Notice("진행 중인 프로젝트가 없습니다");
				return;
			}

			const focusItems = await this.gemini!.getFocus(projectsSummary);

			if (focusItems.length === 0) {
				new Notice("추천할 프로젝트가 없습니다");
				return;
			}

			// Focus 모달 표시
			new FocusModal(this.app, focusItems).open();
		} catch (error) {
			console.error("Focus 분석 오류:", error);
			new Notice(`분석 실패: ${error}`);
		}
	}

	/**
	 * 프로젝트 요약 수집
	 */
	private async collectProjectsSummary(folder: TFolder): Promise<string> {
		const summaries: string[] = [];

		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				const content = await this.app.vault.read(child);
				const frontmatter = this.extractFrontmatter(content);

				const title = frontmatter.title || child.basename;
				const summary = frontmatter.summary || "";
				const nextAction = frontmatter.next_action || "";

				summaries.push(`- ${title}: ${summary} (다음: ${nextAction})`);
			}
		}

		return summaries.join("\n");
	}

	/**
	 * Frontmatter 추출
	 */
	private extractFrontmatter(content: string): Record<string, string> {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
		const match = content.match(frontmatterRegex);

		if (!match) return {};

		const result: Record<string, string> = {};
		const lines = match[1].split("\n");

		for (const line of lines) {
			const colonIdx = line.indexOf(":");
			if (colonIdx !== -1) {
				const key = line.slice(0, colonIdx).trim();
				const value = line.slice(colonIdx + 1).trim();
				result[key] = value;
			}
		}

		return result;
	}

	/**
	 * Inbox 전체 처리
	 */
	async processInbox() {
		if (!this.checkApiKey()) return;

		const inboxFolder = this.app.vault.getAbstractFileByPath(
			this.settings.inboxFolder
		);

		if (!inboxFolder || !(inboxFolder instanceof TFolder)) {
			new Notice("Inbox 폴더가 없습니다");
			return;
		}

		let processed = 0;
		let failed = 0;
		const triggerTag = this.settings.triggerTag;

		// 처리할 파일 목록 수집
		const filesToProcess: TFile[] = [];
		for (const child of inboxFolder.children) {
			if (child instanceof TFile && child.extension === "md") {
				const content = await this.app.vault.read(child);
				if (content.includes(triggerTag)) {
					filesToProcess.push(child);
				}
			}
		}

		if (filesToProcess.length === 0) {
			new Notice("처리할 파일이 없습니다");
			return;
		}

		new Notice(`${filesToProcess.length}개 파일 처리 시작...`);

		// 순차적으로 처리 (rate limit 방지)
		const projects = this.mocManager?.getProjectList() || [];
		for (let i = 0; i < filesToProcess.length; i++) {
			const child = filesToProcess[i];
			try {
				new Notice(`처리 중: ${i + 1}/${filesToProcess.length} - ${child.name}`, 2000);

				const content = await this.app.vault.read(child);
				const result = await this.gemini!.classifyProject(content, projects);
				await this.applyClassifyResult(child, result);
				processed++;
			} catch (error) {
				console.error(`처리 실패: ${child.name}`, error);
				failed++;
			}
		}

		new Notice(`완료: ${processed}개 처리, ${failed}개 실패`);
	}

	/**
	 * Watch 토글
	 */
	toggleWatch() {
		if (this.watcherRegistered) {
			this.stopWatcher();
			new Notice("Watch 중지됨");
		} else {
			this.startWatcher();
			new Notice("Watch 시작됨");
		}
	}

	/**
	 * Watcher 시작
	 */
	startWatcher() {
		if (this.watcherRegistered) return;

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.onFileChange(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.onFileChange(file);
				}
			})
		);

		this.watcherRegistered = true;
		console.log("Inbox 감시 시작");
	}

	/**
	 * Watcher 중지
	 */
	stopWatcher() {
		// Obsidian은 registerEvent로 등록된 이벤트를 자동 정리하므로
		// 플래그만 업데이트
		this.watcherRegistered = false;
		this.pendingFiles.clear();
		console.log("Inbox 감시 중지");
	}

	/**
	 * 파일 변경 처리
	 */
	private onFileChange(file: TFile) {
		if (!this.watcherRegistered) return;
		if (!this.gemini) return;

		// Inbox 폴더 파일만 처리
		if (!file.path.startsWith(this.settings.inboxFolder)) return;
		if (file.extension !== "md") return;

		// 대기열에 추가
		this.pendingFiles.set(file.path, Date.now());
		this.processDebounced();
	}

	/**
	 * 대기 중인 파일 처리
	 */
	private async processPendingFiles() {
		if (!this.gemini) return;

		const now = Date.now();
		const triggerTag = this.settings.triggerTag;
		const projects = this.mocManager?.getProjectList() || [];

		for (const [path, timestamp] of this.pendingFiles.entries()) {
			// 3초 경과 확인
			if (now - timestamp < 3000) continue;

			this.pendingFiles.delete(path);

			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			try {
				const content = await this.app.vault.read(file);

				// 트리거 태그 확인
				if (!content.includes(triggerTag)) continue;

				const result = await this.gemini.classifyProject(content, projects);
				await this.applyClassifyResult(file, result);
				new Notice(`자동 분류: ${file.name} → ${result.targetType}${result.projectName ? ` (${result.projectName})` : ""}`);
			} catch (error) {
				console.error(`자동 분류 실패: ${path}`, error);
			}
		}
	}

	/**
	 * 현재 파일 OCR 처리
	 */
	async ocrCurrentFile() {
		if (!this.checkApiKey()) return;
		if (!this.settings.ocrEnabled) {
			new Notice("OCR 기능이 비활성화되어 있습니다");
			return;
		}
		if (!this.ocrProcessor) {
			new Notice("OCR 프로세서를 초기화할 수 없습니다");
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("열린 파일이 없습니다");
			return;
		}

		const ext = file.extension.toLowerCase();
		const supportedFormats = ["png", "jpg", "jpeg", "webp", "gif", "pdf"];
		if (!supportedFormats.includes(ext)) {
			new Notice(`지원하지 않는 파일 형식입니다: ${ext}`);
			return;
		}

		// 제한 확인
		const limitCheck = await this.ocrProcessor.checkLimits(file);
		if (!limitCheck.allowed) {
			new OCRLimitModal(this.app, limitCheck.reason!, file, this).open();
			return;
		}

		new Notice("OCR 처리 중...");

		try {
			const result = await this.ocrProcessor.processFile(file);
			const noteContent = this.ocrProcessor.generateMarkdownNote(result);

			// 새 노트 생성
			const noteName = file.basename + "_OCR.md";
			const notePath = `${this.settings.inboxFolder}/${noteName}`;
			await this.app.vault.create(notePath, noteContent);

			// 원본 파일 이동 (설정에 따라)
			if (this.settings.ocrMoveOriginal) {
				const originalFolder = this.settings.ocrOriginalFolder;
				const folder = this.app.vault.getAbstractFileByPath(originalFolder);
				if (!folder) {
					await this.app.vault.createFolder(originalFolder);
				}
				const newPath = `${originalFolder}/${file.name}`;
				await this.app.fileManager.renameFile(file, newPath);
			}

			new Notice(`OCR 완료: ${noteName} 생성됨 (${result.pages}페이지)`);
		} catch (error) {
			console.error("OCR 오류:", error);
			new Notice(`OCR 실패: ${error}`);
		}
	}

	/**
	 * Inbox의 이미지/PDF 일괄 OCR 처리
	 */
	async processInboxOCR() {
		if (!this.checkApiKey()) return;
		if (!this.settings.ocrEnabled) {
			new Notice("OCR 기능이 비활성화되어 있습니다");
			return;
		}
		if (!this.ocrProcessor) {
			new Notice("OCR 프로세서를 초기화할 수 없습니다");
			return;
		}

		const inboxFolder = this.app.vault.getAbstractFileByPath(
			this.settings.inboxFolder
		);

		if (!inboxFolder || !(inboxFolder instanceof TFolder)) {
			new Notice("Inbox 폴더가 없습니다");
			return;
		}

		const supportedFormats = ["png", "jpg", "jpeg", "webp", "gif", "pdf"];

		// 처리할 파일 목록 수집
		const filesToProcess: TFile[] = [];
		for (const child of inboxFolder.children) {
			if (!(child instanceof TFile)) continue;

			const ext = child.extension.toLowerCase();
			if (!supportedFormats.includes(ext)) continue;

			// 제한 확인
			const limitCheck = await this.ocrProcessor.checkLimits(child);
			if (limitCheck.allowed) {
				filesToProcess.push(child);
			}
		}

		if (filesToProcess.length === 0) {
			new Notice("처리할 파일이 없습니다");
			return;
		}

		new Notice(`${filesToProcess.length}개 파일 OCR 처리 시작...`);

		let processed = 0;
		let failed = 0;

		// 순차적으로 처리 (rate limit 방지)
		for (let i = 0; i < filesToProcess.length; i++) {
			const child = filesToProcess[i];

			try {
				new Notice(`OCR 중: ${i + 1}/${filesToProcess.length} - ${child.name}`, 3000);

				const result = await this.ocrProcessor.processFile(child);
				const noteContent = this.ocrProcessor.generateMarkdownNote(result);

				const noteName = child.basename + "_OCR.md";
				const notePath = `${this.settings.inboxFolder}/${noteName}`;
				await this.app.vault.create(notePath, noteContent);

				if (this.settings.ocrMoveOriginal) {
					const originalFolder = this.settings.ocrOriginalFolder;
					const folder = this.app.vault.getAbstractFileByPath(originalFolder);
					if (!folder) {
						await this.app.vault.createFolder(originalFolder);
					}
					const newPath = `${originalFolder}/${child.name}`;
					await this.app.fileManager.renameFile(child, newPath);
				}

				processed++;

				// 파일 간 딜레이 (rate limit 방지)
				if (i < filesToProcess.length - 1) {
					await new Promise(r => setTimeout(r, 1000));
				}
			} catch (error) {
				console.error(`OCR 처리 실패: ${child.name}`, error);
				failed++;
			}
		}

		new Notice(`OCR 완료: ${processed}개 처리, ${failed}개 실패`);
	}

	/**
	 * 스마트 처리: 파일 타입에 따라 자동으로 OCR → PARA 분류
	 */
	async smartProcessCurrentFile() {
		if (!this.checkApiKey()) return;

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("열린 파일이 없습니다");
			return;
		}

		const ext = file.extension.toLowerCase();
		const ocrFormats = ["pdf", "png", "jpg", "jpeg", "webp", "gif"];

		// PDF/이미지인 경우: OCR → PARA
		if (ocrFormats.includes(ext)) {
			if (!this.settings.ocrEnabled) {
				new Notice("OCR 기능이 비활성화되어 있습니다");
				return;
			}
			if (!this.ocrProcessor) {
				new Notice("OCR 프로세서를 초기화할 수 없습니다");
				return;
			}

			// 제한 확인
			const limitCheck = await this.ocrProcessor.checkLimits(file);
			if (!limitCheck.allowed) {
				new OCRLimitModal(this.app, limitCheck.reason!, file, this).open();
				return;
			}

			new Notice("스마트 처리 중: OCR → 프로젝트 분류...");

			try {
				// 1. OCR 수행
				const result = await this.ocrProcessor.processFile(file);
				const noteContent = this.ocrProcessor.generateMarkdownNote(result);

				// 2. 마크다운 노트 생성
				const noteName = file.basename + "_OCR.md";
				const notePath = `${this.settings.inboxFolder}/${noteName}`;
				const newFile = await this.app.vault.create(notePath, noteContent);

				// 3. 원본 파일 이동 (설정에 따라)
				if (this.settings.ocrMoveOriginal) {
					const originalFolder = this.settings.ocrOriginalFolder;
					const folder = this.app.vault.getAbstractFileByPath(originalFolder);
					if (!folder) {
						await this.app.vault.createFolder(originalFolder);
					}
					const newPath = `${originalFolder}/${file.name}`;
					await this.app.fileManager.renameFile(file, newPath);
				}

				// 4. 프로젝트 분류 수행
				const projects = this.mocManager?.getProjectList() || [];
				const classifyResult = await this.gemini!.classifyProject(noteContent, projects);
				await this.applyClassifyResult(newFile, classifyResult);

				new Notice(`완료: OCR(${result.pages}p) → ${classifyResult.targetType}${classifyResult.projectName ? ` (${classifyResult.projectName})` : ""}로 분류됨`);
			} catch (error) {
				console.error("스마트 처리 오류:", error);
				new Notice(`처리 실패: ${error}`);
			}
		}
		// 마크다운인 경우: 프로젝트 분류만
		else if (ext === "md") {
			new Notice("분류 중...");

			try {
				const content = await this.app.vault.read(file);
				const projects = this.mocManager?.getProjectList() || [];
				const result = await this.gemini!.classifyProject(content, projects);
				await this.applyClassifyResult(file, result);
				new Notice(`${result.targetType}${result.projectName ? ` (${result.projectName})` : ""}로 분류됨`);
			} catch (error) {
				console.error("프로젝트 분류 오류:", error);
				new Notice(`분류 실패: ${error}`);
			}
		}
		// 지원하지 않는 형식
		else {
			new Notice(`지원하지 않는 파일 형식입니다: ${ext}`);
		}
	}

	/**
	 * OCR 일일 사용량 반환
	 */
	getOCRDailyUsage(): DailyUsage {
		if (this.ocrProcessor) {
			return this.ocrProcessor.getDailyUsage();
		}
		return {
			date: new Date().toISOString().split("T")[0],
			pagesProcessed: 0,
			filesProcessed: 0,
		};
	}
}

/**
 * ZK 선택 모달
 */
class ZKSelectModal extends Modal {
	candidates: ZKCandidate[];
	selected: Set<number>;
	sourceFile: TFile;
	plugin: ZeroFrictionBrainPlugin;

	constructor(
		app: App,
		candidates: ZKCandidate[],
		sourceFile: TFile,
		plugin: ZeroFrictionBrainPlugin
	) {
		super(app);
		this.candidates = candidates;
		this.selected = new Set(candidates.map((_, i) => i));
		this.sourceFile = sourceFile;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "ZK 아이디어 선택" });
		contentEl.createEl("p", {
			text: "생성할 Zettelkasten 노트를 선택하세요",
			cls: "setting-item-description",
		});

		const listEl = contentEl.createDiv({ cls: "zk-candidate-list" });

		this.candidates.forEach((candidate, index) => {
			const itemEl = listEl.createDiv({ cls: "zk-candidate-item" });

			const checkbox = itemEl.createEl("input", {
				type: "checkbox",
				attr: { checked: true },
			});
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selected.add(index);
				} else {
					this.selected.delete(index);
				}
			});

			const labelEl = itemEl.createDiv({ cls: "zk-candidate-label" });
			labelEl.createEl("strong", { text: candidate.title });
			labelEl.createEl("p", { text: candidate.body, cls: "zk-candidate-body" });
			labelEl.createEl("small", {
				text: `키워드: ${candidate.keywords.join(", ")}`,
				cls: "zk-candidate-keywords",
			});
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelBtn = buttonContainer.createEl("button", { text: "취소" });
		cancelBtn.addEventListener("click", () => this.close());

		const createBtn = buttonContainer.createEl("button", {
			text: "생성",
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", async () => {
			const selectedCandidates = this.candidates.filter((_, i) =>
				this.selected.has(i)
			);
			if (selectedCandidates.length > 0) {
				await this.plugin.createZKNotes(selectedCandidates, this.sourceFile);
			}
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * ZK 병합 확인 모달
 */
class ZKMergeConfirmModal extends Modal {
	candidate: ZKCandidate;
	similarNote: RelatedNote;
	onResult: (merge: boolean) => void;

	constructor(
		app: App,
		candidate: ZKCandidate,
		similarNote: RelatedNote,
		onResult: (merge: boolean) => void
	) {
		super(app);
		this.candidate = candidate;
		this.similarNote = similarNote;
		this.onResult = onResult;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "유사한 노트 발견" });

		// 설명
		contentEl.createEl("p", {
			text: `새 아이디어와 ${Math.round(this.similarNote.relevance * 100)}% 유사한 노트가 있습니다.`,
			cls: "setting-item-description",
		});

		// 새 아이디어
		const newSection = contentEl.createDiv({ cls: "merge-section" });
		newSection.createEl("h4", { text: "새 아이디어" });
		newSection.createEl("p", { text: this.candidate.title, cls: "merge-title" });
		newSection.createEl("p", { text: this.candidate.body, cls: "merge-body" });

		// 기존 노트
		const existingSection = contentEl.createDiv({ cls: "merge-section" });
		existingSection.createEl("h4", { text: "기존 노트" });
		existingSection.createEl("p", {
			text: this.similarNote.note.title,
			cls: "merge-title",
		});
		existingSection.createEl("p", {
			text: `키워드: ${this.similarNote.note.keywords.join(", ")}`,
			cls: "merge-keywords",
		});

		// 버튼
		const buttonDiv = contentEl.createDiv({ cls: "merge-buttons" });

		const mergeBtn = buttonDiv.createEl("button", {
			text: "기존 노트에 추가",
			cls: "mod-cta",
		});
		mergeBtn.addEventListener("click", () => {
			this.onResult(true);
			this.close();
		});

		const createBtn = buttonDiv.createEl("button", {
			text: "새 노트 생성",
		});
		createBtn.addEventListener("click", () => {
			this.onResult(false);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Focus 결과 모달
 */
class FocusModal extends Modal {
	items: FocusItem[];

	constructor(app: App, items: FocusItem[]) {
		super(app);
		this.items = items;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "오늘 집중할 프로젝트 Top 3" });

		const listEl = contentEl.createDiv({ cls: "focus-list" });

		this.items.forEach((item, index) => {
			const itemEl = listEl.createDiv({ cls: "focus-item" });

			itemEl.createEl("h3", { text: `${index + 1}. ${item.title}` });
			itemEl.createEl("p", { text: item.why, cls: "focus-why" });
			itemEl.createEl("p", {
				text: `→ ${item.nextAction}`,
				cls: "focus-action",
			});
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const closeBtn = buttonContainer.createEl("button", {
			text: "닫기",
			cls: "mod-cta",
		});
		closeBtn.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * OCR 제한 경고 모달
 */
class OCRLimitModal extends Modal {
	reason: string;
	file: TFile;
	plugin: ZeroFrictionBrainPlugin;

	constructor(
		app: App,
		reason: string,
		file: TFile,
		plugin: ZeroFrictionBrainPlugin
	) {
		super(app);
		this.reason = reason;
		this.file = file;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "파일이 너무 큽니다" });
		contentEl.createEl("p", { text: this.reason });
		contentEl.createEl("p", {
			text: "설정에서 제한을 조정하거나, 파일을 분할해서 처리하세요.",
			cls: "setting-item-description",
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelBtn = buttonContainer.createEl("button", { text: "취소" });
		cancelBtn.addEventListener("click", () => this.close());

		const settingsBtn = buttonContainer.createEl("button", {
			text: "설정 열기",
			cls: "mod-cta",
		});
		settingsBtn.addEventListener("click", () => {
			this.close();
			// 설정 탭 열기
			(this.app as App & { setting: { open: () => void } }).setting.open();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 관련 노트 선택 모달
 */
class RelatedNotesModal extends Modal {
	relatedNotes: RelatedNote[];
	selected: Set<number>;
	currentFile: TFile;
	finder: RelatedNoteFinder;

	constructor(
		app: App,
		relatedNotes: RelatedNote[],
		currentFile: TFile,
		finder: RelatedNoteFinder
	) {
		super(app);
		this.relatedNotes = relatedNotes;
		this.selected = new Set(relatedNotes.map((_, i) => i));
		this.currentFile = currentFile;
		this.finder = finder;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "관련 노트 발견" });
		contentEl.createEl("p", {
			text: "연결할 노트를 선택하세요",
			cls: "setting-item-description",
		});

		const listEl = contentEl.createDiv({ cls: "related-notes-list" });

		this.relatedNotes.forEach((related, index) => {
			const itemEl = listEl.createDiv({ cls: "related-note-item" });

			const checkbox = itemEl.createEl("input", {
				type: "checkbox",
				attr: { checked: true },
			});
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selected.add(index);
				} else {
					this.selected.delete(index);
				}
			});

			const labelEl = itemEl.createDiv({ cls: "related-note-label" });
			labelEl.createEl("strong", { text: related.note.title });

			const relevancePercent = Math.round(related.relevance * 100);
			labelEl.createEl("span", {
				text: ` (${relevancePercent}%)`,
				cls: "related-note-relevance",
			});

			if (related.matchedKeywords.length > 0) {
				labelEl.createEl("small", {
					text: `키워드: ${related.matchedKeywords.join(", ")}`,
					cls: "related-note-keywords",
				});
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const skipBtn = buttonContainer.createEl("button", { text: "건너뛰기" });
		skipBtn.addEventListener("click", () => this.close());

		const addBtn = buttonContainer.createEl("button", {
			text: "링크 추가",
			cls: "mod-cta",
		});
		addBtn.addEventListener("click", async () => {
			const selectedNotes = this.relatedNotes.filter((_, i) =>
				this.selected.has(i)
			);
			if (selectedNotes.length > 0) {
				await this.finder.addRelatedLinks(this.currentFile, selectedNotes);
				new Notice(`${selectedNotes.length}개 관련 노트 링크 추가됨`);
			}
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 새 프로젝트 MOC 생성 모달
 */
class NewProjectMOCModal extends Modal {
	projectName: string;
	noteFile: TFile;
	noteTitle: string;
	mocManager: MOCManager;
	projectsFolder: string;

	constructor(
		app: App,
		projectName: string,
		noteFile: TFile,
		noteTitle: string,
		mocManager: MOCManager,
		projectsFolder: string
	) {
		super(app);
		this.projectName = projectName;
		this.noteFile = noteFile;
		this.noteTitle = noteTitle;
		this.mocManager = mocManager;
		this.projectsFolder = projectsFolder;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "새 프로젝트 감지" });
		contentEl.createEl("p", {
			text: `"${this.projectName}" 프로젝트가 새로 감지되었습니다.`,
		});
		contentEl.createEl("p", {
			text: "이 프로젝트의 MOC(Map of Content)를 생성할까요?",
			cls: "setting-item-description",
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const skipBtn = buttonContainer.createEl("button", { text: "건너뛰기" });
		skipBtn.addEventListener("click", () => this.close());

		const createBtn = buttonContainer.createEl("button", {
			text: "MOC 생성",
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", async () => {
			const mocFile = await this.mocManager.createProjectMOC(
				this.projectName,
				this.projectsFolder
			);

			if (mocFile) {
				// 현재 노트를 MOC에 연결
				await this.mocManager.addNoteToMOC(
					this.projectName,
					this.noteTitle,
					this.noteFile.path
				);
				new Notice(`📁 ${this.projectName} MOC 생성 및 연결 완료`);
			} else {
				new Notice("MOC가 이미 존재합니다");
			}

			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * MOC 생성 모달 (수동 생성용)
 */
class CreateMOCModal extends Modal {
	mocManager: MOCManager | null;
	projectsFolder: string;
	inputEl: HTMLInputElement;

	constructor(
		app: App,
		mocManager: MOCManager | null,
		projectsFolder: string
	) {
		super(app);
		this.mocManager = mocManager;
		this.projectsFolder = projectsFolder;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "프로젝트 MOC 생성" });
		contentEl.createEl("p", {
			text: "새 프로젝트 MOC를 생성합니다. 프로젝트 이름을 입력하세요.",
			cls: "setting-item-description",
		});

		// 입력 필드
		const inputContainer = contentEl.createDiv({ cls: "moc-input-container" });
		inputContainer.createEl("label", { text: "프로젝트 이름:" });
		this.inputEl = inputContainer.createEl("input", {
			type: "text",
			placeholder: "예: 스마트팜",
		});
		this.inputEl.style.width = "100%";
		this.inputEl.style.marginTop = "8px";
		this.inputEl.style.padding = "8px";

		// Enter 키 처리
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.createMOC();
			}
		});

		// 기존 MOC 목록 표시
		if (this.mocManager && this.mocManager.getMOCCount() > 0) {
			const existingEl = contentEl.createDiv({ cls: "existing-mocs" });
			existingEl.createEl("h4", { text: "기존 프로젝트 MOC:" });
			const list = existingEl.createEl("ul");
			for (const project of this.mocManager.getProjectList()) {
				list.createEl("li", { text: project });
			}
		}

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelBtn = buttonContainer.createEl("button", { text: "취소" });
		cancelBtn.addEventListener("click", () => this.close());

		const createBtn = buttonContainer.createEl("button", {
			text: "생성",
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", () => this.createMOC());

		// 포커스
		setTimeout(() => this.inputEl.focus(), 10);
	}

	private async createMOC() {
		const projectName = this.inputEl.value.trim();

		if (!projectName) {
			new Notice("프로젝트 이름을 입력하세요");
			return;
		}

		if (!this.mocManager) {
			new Notice("MOC 관리자가 초기화되지 않았습니다");
			this.close();
			return;
		}

		// 중복 체크
		const existingProjects = this.mocManager.getProjectList();
		if (existingProjects.includes(projectName)) {
			new Notice(`"${projectName}" MOC가 이미 존재합니다`);
			return;
		}

		const mocFile = await this.mocManager.createProjectMOC(
			projectName,
			this.projectsFolder
		);

		if (mocFile) {
			new Notice(`📁 ${projectName} MOC 생성 완료`);
			// 새로 생성된 MOC 파일 열기
			this.app.workspace.getLeaf().openFile(mocFile);
		} else {
			new Notice("MOC 생성에 실패했습니다");
		}

		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * URL 입력 모달 (유튜브/웹페이지 공용)
 */
class URLInputModal extends Modal {
	title: string;
	description: string;
	placeholder: string;
	onSubmit: (url: string) => Promise<void>;
	inputEl: HTMLInputElement;

	constructor(
		app: App,
		title: string,
		description: string,
		placeholder: string,
		onSubmit: (url: string) => Promise<void>
	) {
		super(app);
		this.title = title;
		this.description = description;
		this.placeholder = placeholder;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", {
			text: this.description,
			cls: "setting-item-description",
		});

		// 입력 필드
		const inputContainer = contentEl.createDiv({ cls: "url-input-container" });
		this.inputEl = inputContainer.createEl("input", {
			type: "text",
			placeholder: this.placeholder,
		});
		this.inputEl.style.width = "100%";
		this.inputEl.style.padding = "8px";

		// 클립보드에서 URL 자동 붙여넣기 시도
		navigator.clipboard.readText().then((text) => {
			if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
				this.inputEl.value = text;
			}
		}).catch(() => {
			// 클립보드 접근 실패 시 무시
		});

		// Enter 키 처리
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.submit();
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelBtn = buttonContainer.createEl("button", { text: "취소" });
		cancelBtn.addEventListener("click", () => this.close());

		const submitBtn = buttonContainer.createEl("button", {
			text: "가져오기",
			cls: "mod-cta",
		});
		submitBtn.addEventListener("click", () => this.submit());

		// 포커스
		setTimeout(() => this.inputEl.focus(), 10);
	}

	private async submit() {
		const url = this.inputEl.value.trim();

		if (!url) {
			new Notice("URL을 입력하세요");
			return;
		}

		this.close();
		await this.onSubmit(url);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 스마트 분리 결과 모달
 */
class SmartSplitModal extends Modal {
	sections: SplitSection[];
	selected: Set<number>;
	sourceFile: TFile;
	plugin: ZeroFrictionBrainPlugin;

	constructor(
		app: App,
		sections: SplitSection[],
		sourceFile: TFile,
		plugin: ZeroFrictionBrainPlugin
	) {
		super(app);
		this.sections = sections;
		this.selected = new Set(sections.map((_, i) => i));
		this.sourceFile = sourceFile;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "스마트 분리 결과" });
		contentEl.createEl("p", {
			text: `${this.sections.length}개의 섹션으로 분리됨. 생성할 노트를 선택하세요.`,
			cls: "setting-item-description",
		});

		const listEl = contentEl.createDiv({ cls: "split-section-list" });

		this.sections.forEach((section, index) => {
			const itemEl = listEl.createDiv({ cls: "split-section-item" });
			itemEl.style.marginBottom = "16px";
			itemEl.style.padding = "12px";
			itemEl.style.border = "1px solid var(--background-modifier-border)";
			itemEl.style.borderRadius = "8px";

			// 체크박스와 제목 행
			const headerEl = itemEl.createDiv({ cls: "split-section-header" });
			headerEl.style.display = "flex";
			headerEl.style.alignItems = "center";
			headerEl.style.gap = "8px";

			const checkbox = headerEl.createEl("input", {
				type: "checkbox",
				attr: { checked: true },
			});
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selected.add(index);
				} else {
					this.selected.delete(index);
				}
			});

			headerEl.createEl("strong", { text: section.title });

			// 카테고리 및 프로젝트 배지
			const badgeEl = headerEl.createDiv({ cls: "split-section-badges" });
			badgeEl.style.marginLeft = "auto";
			badgeEl.style.display = "flex";
			badgeEl.style.gap = "4px";

			const categoryBadge = badgeEl.createEl("span", {
				text: section.targetType,
				cls: "split-category-badge",
			});
			categoryBadge.style.padding = "2px 8px";
			categoryBadge.style.borderRadius = "4px";
			categoryBadge.style.fontSize = "12px";
			categoryBadge.style.backgroundColor = this.getTargetTypeColor(section.targetType);
			categoryBadge.style.color = "white";

			if (section.project) {
				const projectBadge = badgeEl.createEl("span", {
					text: section.project.startsWith("NEW:") ? `✨ ${section.project.slice(4)}` : `📁 ${section.project}`,
					cls: "split-project-badge",
				});
				projectBadge.style.padding = "2px 8px";
				projectBadge.style.borderRadius = "4px";
				projectBadge.style.fontSize = "12px";
				projectBadge.style.backgroundColor = "var(--interactive-accent)";
				projectBadge.style.color = "white";
			}

			// 내용 미리보기
			const previewEl = itemEl.createDiv({ cls: "split-section-preview" });
			previewEl.style.marginTop = "8px";
			previewEl.style.fontSize = "13px";
			previewEl.style.color = "var(--text-muted)";
			previewEl.style.maxHeight = "60px";
			previewEl.style.overflow = "hidden";
			previewEl.style.textOverflow = "ellipsis";

			const previewText = section.content.length > 150
				? section.content.slice(0, 150) + "..."
				: section.content;
			previewEl.setText(previewText);

			// 키워드
			if (section.keywords.length > 0) {
				const keywordsEl = itemEl.createDiv({ cls: "split-section-keywords" });
				keywordsEl.style.marginTop = "8px";
				keywordsEl.style.fontSize = "12px";
				keywordsEl.setText(`키워드: ${section.keywords.join(", ")}`);
			}
		});

		// 버튼
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		buttonContainer.style.marginTop = "16px";

		const cancelBtn = buttonContainer.createEl("button", { text: "취소" });
		cancelBtn.addEventListener("click", () => this.close());

		const createBtn = buttonContainer.createEl("button", {
			text: `${this.selected.size}개 노트 생성`,
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", async () => {
			const selectedSections = this.sections.filter((_, i) =>
				this.selected.has(i)
			);
			if (selectedSections.length > 0) {
				this.close();
				await this.plugin.createSplitNotes(selectedSections, this.sourceFile);
			}
		});
	}

	private getTargetTypeColor(targetType: TargetType): string {
		switch (targetType) {
			case "project": return "#e67e22";
			case "library": return "#27ae60";
			case "archive": return "#95a5a6";
			default: return "#7f8c8d";
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
