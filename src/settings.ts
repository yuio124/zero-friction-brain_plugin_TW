/**
 * 설정 탭 UI
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ZeroFrictionBrainPlugin from "./main";

export class ZeroFrictionSettingTab extends PluginSettingTab {
	plugin: ZeroFrictionBrainPlugin;

	constructor(app: App, plugin: ZeroFrictionBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 헤더
		containerEl.createEl("h2", { text: "Zero Friction Brain 설정" });

		// API 키 섹션
		containerEl.createEl("h3", { text: "API 설정" });

		new Setting(containerEl)
			.setName("Gemini API 키")
			.setDesc(
				createFragment((frag) => {
					frag.appendText("Gemini API 키를 입력하세요. ");
					frag.createEl("a", {
						text: "API 키 발급받기",
						href: "https://aistudio.google.com/apikey",
					});
				})
			)
			.addText((text) =>
				text
					.setPlaceholder("AIzaSy...")
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// 폴더 설정 섹션
		containerEl.createEl("h3", { text: "폴더 설정" });

		new Setting(containerEl)
			.setName("Inbox 폴더")
			.setDesc("새 노트가 저장되는 폴더")
			.addText((text) =>
				text
					.setPlaceholder("00 _Inbox")
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Projects 폴더")
			.setDesc("프로젝트별 하위 폴더가 생성됩니다")
			.addText((text) =>
				text
					.setPlaceholder("01 Projects")
					.setValue(this.plugin.settings.projectsFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Library 폴더")
			.setDesc("프로젝트에 속하지 않는 참고 자료")
			.addText((text) =>
				text
					.setPlaceholder("02 Library")
					.setValue(this.plugin.settings.libraryFolder)
					.onChange(async (value) => {
						this.plugin.settings.libraryFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Archives 폴더")
			.setDesc("완료된 프로젝트 (통째로 이동)")
			.addText((text) =>
				text
					.setPlaceholder("03 Archives")
					.setValue(this.plugin.settings.archivesFolder)
					.onChange(async (value) => {
						this.plugin.settings.archivesFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Zettelkasten 폴더")
			.setDesc("ZK 영구 노트 저장 위치")
			.addText((text) =>
				text
					.setPlaceholder("10 Zettelkasten")
					.setValue(this.plugin.settings.zettelFolder)
					.onChange(async (value) => {
						this.plugin.settings.zettelFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// 폴더 생성 버튼
		new Setting(containerEl)
			.setName("폴더 구조 생성")
			.setDesc("위에 설정된 폴더들을 자동으로 생성합니다")
			.addButton((button) =>
				button
					.setButtonText("폴더 생성")
					.setCta()
					.onClick(async () => {
						await this.createFolderStructure();
					})
			);

		// 옵션 섹션
		containerEl.createEl("h3", { text: "옵션" });

		new Setting(containerEl)
			.setName("Inbox 자동 감시")
			.setDesc("Inbox 폴더의 파일을 자동으로 감시하여 분류")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoWatch)
					.onChange(async (value) => {
						this.plugin.settings.autoWatch = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.startWatcher();
						} else {
							this.plugin.stopWatcher();
						}
					})
			);

		new Setting(containerEl)
			.setName("트리거 태그")
			.setDesc("이 태그가 있는 노트만 자동 분류 (예: #완료)")
			.addText((text) =>
				text
					.setPlaceholder("#완료")
					.setValue(this.plugin.settings.triggerTag)
					.onChange(async (value) => {
						this.plugin.settings.triggerTag = value;
						await this.plugin.saveSettings();
					})
			);

		// OCR 설정 섹션
		containerEl.createEl("h3", { text: "OCR 설정" });

		new Setting(containerEl)
			.setName("OCR 기능 활성화")
			.setDesc("이미지 및 PDF에서 텍스트 추출")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ocrEnabled)
					.onChange(async (value) => {
						this.plugin.settings.ocrEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OCR 후 원본 이동")
			.setDesc("OCR 처리 후 원본 파일을 지정 폴더로 이동")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ocrMoveOriginal)
					.onChange(async (value) => {
						this.plugin.settings.ocrMoveOriginal = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("원본 파일 이동 폴더")
			.setDesc("OCR 처리 후 원본 파일이 이동될 폴더")
			.addText((text) =>
				text
					.setPlaceholder("03 Archives/OCR_원본")
					.setValue(this.plugin.settings.ocrOriginalFolder)
					.onChange(async (value) => {
						this.plugin.settings.ocrOriginalFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// OCR 제한 설정 섹션
		containerEl.createEl("h3", { text: "OCR 제한 (API 요금 보호)" });

		new Setting(containerEl)
			.setName("최대 페이지 수")
			.setDesc("한 번에 처리할 수 있는 최대 PDF 페이지 수")
			.addSlider((slider) =>
				slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.settings.ocrMaxPages)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.ocrMaxPages = value;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("reset")
					.setTooltip("기본값 (20)")
					.onClick(async () => {
						this.plugin.settings.ocrMaxPages = 20;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("최대 파일 크기 (MB)")
			.setDesc("처리할 수 있는 최대 파일 크기")
			.addSlider((slider) =>
				slider
					.setLimits(1, 50, 1)
					.setValue(this.plugin.settings.ocrMaxFileSizeMB)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.ocrMaxFileSizeMB = value;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("reset")
					.setTooltip("기본값 (10)")
					.onClick(async () => {
						this.plugin.settings.ocrMaxFileSizeMB = 10;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("일일 처리 한도 (페이지)")
			.setDesc("하루에 OCR 처리할 수 있는 최대 페이지 수")
			.addSlider((slider) =>
				slider
					.setLimits(10, 500, 10)
					.setValue(this.plugin.settings.ocrDailyLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.ocrDailyLimit = value;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("reset")
					.setTooltip("기본값 (50)")
					.onClick(async () => {
						this.plugin.settings.ocrDailyLimit = 50;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// 사용량 표시
		const usageEl = containerEl.createDiv({ cls: "ocr-usage-info" });
		usageEl.createEl("p", {
			text: `오늘 사용량: ${this.plugin.getOCRDailyUsage().pagesProcessed}/${this.plugin.settings.ocrDailyLimit} 페이지`,
			cls: "setting-item-description",
		});

		// Zettelkasten 설정 섹션
		containerEl.createEl("h3", { text: "Zettelkasten 설정" });

		new Setting(containerEl)
			.setName("ZK 노트 ID 형식")
			.setDesc("ZK 노트 파일명에 사용할 ID 형식")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("timestamp", "타임스탬프 (1735789200000)")
					.addOption("date-sequence", "날짜+순번 (20260102-001)")
					.addOption("luhmann", "루만 스타일 (1a1b)")
					.setValue(this.plugin.settings.zkIdType)
					.onChange(async (value) => {
						this.plugin.settings.zkIdType = value as "timestamp" | "date-sequence" | "luhmann";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("유사 노트 병합 임계값")
			.setDesc("이 값 이상의 유사도를 가진 노트가 있으면 병합 제안 (0.5~1.0)")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 1.0, 0.05)
					.setValue(this.plugin.settings.zkMergeThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.zkMergeThreshold = value;
						await this.plugin.saveSettings();
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon("reset")
					.setTooltip("기본값 (0.8)")
					.onClick(async () => {
						this.plugin.settings.zkMergeThreshold = 0.8;
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}

	/**
	 * 폴더 구조 생성
	 */
	private async createFolderStructure(): Promise<void> {
		const folders = [
			this.plugin.settings.inboxFolder,
			this.plugin.settings.projectsFolder,
			this.plugin.settings.libraryFolder,
			this.plugin.settings.archivesFolder,
			this.plugin.settings.zettelFolder,
		];

		let created = 0;
		let existing = 0;

		for (const folderPath of folders) {
			if (!folderPath) continue;

			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder) {
				existing++;
			} else {
				try {
					await this.app.vault.createFolder(folderPath);
					created++;
				} catch (error) {
					console.error(`폴더 생성 실패: ${folderPath}`, error);
				}
			}
		}

		if (created > 0) {
			new Notice(`${created}개 폴더 생성됨, ${existing}개 이미 존재`);
		} else {
			new Notice(`모든 폴더가 이미 존재합니다 (${existing}개)`);
		}
	}
}
