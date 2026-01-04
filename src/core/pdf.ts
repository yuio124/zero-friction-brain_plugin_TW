/**
 * PDF 처리 모듈
 */

import * as pdfjsLib from "pdfjs-dist";

// PDF.js 워커 설정 (CDN에서 로드)
pdfjsLib.GlobalWorkerOptions.workerSrc =
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

export interface PDFTextResult {
	text: string;
	isScanned: boolean;
	numPages: number;
}

export interface PDFPageImage {
	base64: string;
	mimeType: string;
	pageNum: number;
}

export class PDFProcessor {
	private minTextThreshold: number;

	constructor(minTextThreshold: number = 50) {
		this.minTextThreshold = minTextThreshold;
	}

	/**
	 * PDF에서 텍스트 레이어 추출
	 */
	async extractText(pdfBuffer: ArrayBuffer): Promise<PDFTextResult> {
		const pdf = await pdfjsLib.getDocument({
			data: pdfBuffer,
			useWorkerFetch: false,
			isEvalSupported: false,
			useSystemFonts: true,
		}).promise;
		let fullText = "";

		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const textContent = await page.getTextContent();
			const pageText = textContent.items
				.map((item: { str?: string }) => item.str || "")
				.join(" ");
			fullText += `\n## 페이지 ${i}\n\n${pageText}\n`;
		}

		// 페이지당 평균 글자 수로 스캔 PDF 판별
		const avgCharsPerPage = fullText.replace(/\s/g, "").length / pdf.numPages;
		const isScanned = avgCharsPerPage < this.minTextThreshold;

		return {
			text: fullText,
			isScanned,
			numPages: pdf.numPages,
		};
	}

	/**
	 * PDF 페이지들을 이미지로 변환
	 */
	async renderPagesToImages(
		pdfBuffer: ArrayBuffer,
		maxPages?: number
	): Promise<PDFPageImage[]> {
		const pdf = await pdfjsLib.getDocument({
			data: pdfBuffer,
			useWorkerFetch: false,
			isEvalSupported: false,
			useSystemFonts: true,
		}).promise;
		const images: PDFPageImage[] = [];
		const pagesToRender = maxPages
			? Math.min(pdf.numPages, maxPages)
			: pdf.numPages;

		for (let i = 1; i <= pagesToRender; i++) {
			const page = await pdf.getPage(i);
			const viewport = page.getViewport({ scale: 2.0 }); // 고해상도

			const canvas = document.createElement("canvas");
			canvas.width = viewport.width;
			canvas.height = viewport.height;

			const context = canvas.getContext("2d")!;
			await page.render({ canvasContext: context, viewport }).promise;

			const base64 = canvas.toDataURL("image/png").split(",")[1];
			images.push({
				base64,
				mimeType: "image/png",
				pageNum: i,
			});
		}

		return images;
	}

	/**
	 * PDF 페이지 수 확인
	 */
	async getPageCount(pdfBuffer: ArrayBuffer): Promise<number> {
		const pdf = await pdfjsLib.getDocument({
			data: pdfBuffer,
			useWorkerFetch: false,
			isEvalSupported: false,
			useSystemFonts: true,
		}).promise;
		return pdf.numPages;
	}
}
