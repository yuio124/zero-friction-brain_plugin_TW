/**
 * OCR 통합 로직
 */

import { TFile, Vault, Notice } from "obsidian";
import { GeminiClient } from "../api/gemini";
import { PDFProcessor } from "./pdf";
import { OCRResult, DailyUsage, ZeroFrictionSettings } from "../types";

export class OCRProcessor {
	private gemini: GeminiClient;
	private pdfProcessor: PDFProcessor;
	private settings: ZeroFrictionSettings;
	private vault: Vault;
	private dailyUsage: DailyUsage;

	constructor(
		gemini: GeminiClient,
		settings: ZeroFrictionSettings,
		vault: Vault
	) {
		this.gemini = gemini;
		this.settings = settings;
		this.vault = vault;
		this.pdfProcessor = new PDFProcessor(settings.ocrMinTextThreshold);
		this.dailyUsage = this.loadDailyUsage();
	}

	/**
	 * 일일 사용량 로드
	 */
	private loadDailyUsage(): DailyUsage {
		const today = new Date().toISOString().split("T")[0];
		// 실제 구현에서는 로컬 스토리지나 파일에서 로드
		return {
			date: today,
			pagesProcessed: 0,
			filesProcessed: 0,
		};
	}

	/**
	 * 일일 사용량 저장
	 */
	private saveDailyUsage(): void {
		// 실제 구현에서는 로컬 스토리지나 파일에 저장
	}

	/**
	 * 일일 한도 확인
	 */
	checkDailyLimit(pagesToProcess: number): {
		allowed: boolean;
		remaining: number;
	} {
		const today = new Date().toISOString().split("T")[0];

		// 날짜가 바뀌면 리셋
		if (this.dailyUsage.date !== today) {
			this.dailyUsage = {
				date: today,
				pagesProcessed: 0,
				filesProcessed: 0,
			};
		}

		const remaining =
			this.settings.ocrDailyLimit - this.dailyUsage.pagesProcessed;
		return {
			allowed: pagesToProcess <= remaining,
			remaining,
		};
	}

	/**
	 * 파일 크기 확인 (MB)
	 */
	getFileSizeMB(file: TFile): number {
		return file.stat.size / (1024 * 1024);
	}

	/**
	 * 제한 확인
	 */
	async checkLimits(
		file: TFile
	): Promise<{
		allowed: boolean;
		reason?: string;
		pageCount?: number;
		fileSize?: number;
	}> {
		const fileSize = this.getFileSizeMB(file);

		// 파일 크기 제한
		if (fileSize > this.settings.ocrMaxFileSizeMB) {
			return {
				allowed: false,
				reason: `파일 크기(${fileSize.toFixed(1)}MB)가 제한(${this.settings.ocrMaxFileSizeMB}MB)을 초과합니다.`,
				fileSize,
			};
		}

		// PDF인 경우 페이지 수 확인
		if (file.extension === "pdf") {
			const buffer = await this.vault.readBinary(file);
			const pageCount = await this.pdfProcessor.getPageCount(buffer);

			if (pageCount > this.settings.ocrMaxPages) {
				return {
					allowed: false,
					reason: `페이지 수(${pageCount})가 제한(${this.settings.ocrMaxPages})을 초과합니다.`,
					pageCount,
					fileSize,
				};
			}

			// 일일 한도 확인
			const dailyCheck = this.checkDailyLimit(pageCount);
			if (!dailyCheck.allowed) {
				return {
					allowed: false,
					reason: `일일 한도에 도달했습니다. (남은 페이지: ${dailyCheck.remaining})`,
					pageCount,
					fileSize,
				};
			}

			return { allowed: true, pageCount, fileSize };
		}

		// 이미지인 경우 1페이지로 계산
		const dailyCheck = this.checkDailyLimit(1);
		if (!dailyCheck.allowed) {
			return {
				allowed: false,
				reason: `일일 한도에 도달했습니다. (남은 페이지: ${dailyCheck.remaining})`,
				pageCount: 1,
				fileSize,
			};
		}

		return { allowed: true, pageCount: 1, fileSize };
	}

	/**
	 * 이미지 파일 OCR
	 */
	async processImage(file: TFile): Promise<OCRResult> {
		const buffer = await this.vault.readBinary(file);
		const base64 = this.arrayBufferToBase64(buffer);
		const mimeType = this.getMimeType(file.extension);

		const text = await this.gemini.extractTextFromImage(base64, mimeType);

		// 사용량 업데이트
		this.dailyUsage.pagesProcessed += 1;
		this.dailyUsage.filesProcessed += 1;
		this.saveDailyUsage();

		return {
			text,
			pages: 1,
			sourceType: "image",
			sourceFile: file.name,
		};
	}

	/**
	 * PDF 파일 처리
	 */
	async processPDF(
		file: TFile,
		forceOCR: boolean = false,
		maxPages?: number
	): Promise<OCRResult> {
		const buffer = await this.vault.readBinary(file);
		const pagesToProcess = maxPages || this.settings.ocrMaxPages;

		// 먼저 텍스트 레이어 추출 시도
		const textResult = await this.pdfProcessor.extractText(buffer);

		// 텍스트가 충분하면 그대로 반환 (스캔 PDF가 아닌 경우)
		if (!textResult.isScanned && !forceOCR) {
			return {
				text: textResult.text,
				pages: textResult.numPages,
				sourceType: "pdf_text",
				sourceFile: file.name,
			};
		}

		// 스캔 PDF인 경우 OCR 수행
		const totalPages = Math.min(textResult.numPages, pagesToProcess);
		new Notice(`스캔 PDF 감지됨. OCR 처리 중... (${totalPages}페이지)`);

		const images = await this.pdfProcessor.renderPagesToImages(
			buffer,
			pagesToProcess
		);

		// 진행 상황 표시와 함께 OCR 수행
		const texts = await this.gemini.extractTextFromImages(images, (current, total) => {
			new Notice(`OCR 진행 중: ${current}/${total} 페이지`, 1500);
		});

		// 페이지별 텍스트 병합
		let fullText = "";
		for (let i = 0; i < texts.length; i++) {
			fullText += `\n## 페이지 ${i + 1}\n\n${texts[i]}\n`;
		}

		// 사용량 업데이트
		this.dailyUsage.pagesProcessed += texts.length;
		this.dailyUsage.filesProcessed += 1;
		this.saveDailyUsage();

		return {
			text: fullText,
			pages: texts.length,
			sourceType: "pdf_scanned",
			sourceFile: file.name,
		};
	}

	/**
	 * 파일 자동 판별 및 처리
	 */
	async processFile(file: TFile, maxPages?: number): Promise<OCRResult> {
		const ext = file.extension.toLowerCase();

		if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
			return this.processImage(file);
		} else if (ext === "pdf") {
			return this.processPDF(file, false, maxPages);
		} else {
			throw new Error(`지원하지 않는 파일 형식: ${ext}`);
		}
	}

	/**
	 * OCR 결과로 마크다운 노트 생성
	 */
	generateMarkdownNote(result: OCRResult): string {
		const now = new Date().toISOString();
		const sourceTypeLabel = {
			image: "이미지",
			pdf_text: "PDF (텍스트)",
			pdf_scanned: "PDF (스캔/OCR)",
		}[result.sourceType];

		return `---
type: ocr
source_file: "${result.sourceFile}"
source_type: ${result.sourceType}
pages: ${result.pages}
ocr_at: ${now}
---

# OCR: ${result.sourceFile.replace(/\.[^.]+$/, "")}

> 원본: ${result.sourceFile} | 처리 방식: ${sourceTypeLabel} | ${result.pages}페이지

${result.text}

---
## 원본 파일
![[${result.sourceFile}]]
`;
	}

	/**
	 * ArrayBuffer를 Base64로 변환
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		let binary = "";
		const bytes = new Uint8Array(buffer);
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * 파일 확장자로 MIME 타입 반환
	 */
	private getMimeType(ext: string): string {
		const mimeTypes: Record<string, string> = {
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			webp: "image/webp",
			gif: "image/gif",
		};
		return mimeTypes[ext.toLowerCase()] || "image/png";
	}

	/**
	 * 현재 일일 사용량 반환
	 */
	getDailyUsage(): DailyUsage {
		return { ...this.dailyUsage };
	}
}
