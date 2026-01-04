/**
 * 웹페이지 본문 추출 및 요약
 */

import { requestUrl } from "obsidian";
import { GeminiClient } from "../api/gemini";

export interface WebPageResult {
	url: string;
	title: string;
	content: string;
	summary: string;
	keyPoints: string[];
}

export class WebPageExtractor {
	private gemini: GeminiClient;

	constructor(gemini: GeminiClient) {
		this.gemini = gemini;
	}

	/**
	 * URL 유효성 검사
	 */
	isValidUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}

	/**
	 * HTML에서 본문 추출 (간단한 Readability 구현)
	 */
	extractContent(html: string): { title: string; content: string } {
		// 1. 제목 추출
		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
		const title = ogTitleMatch?.[1] || titleMatch?.[1] || "Untitled";

		// 2. 스크립트, 스타일, 주석 제거
		let cleaned = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
			.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
			.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
			.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

		// 3. 본문 영역 추출 시도 (article, main, content 우선)
		let content = "";

		const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
		const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
		const contentMatch = cleaned.match(/<div[^>]*(?:class|id)=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

		if (articleMatch) {
			content = articleMatch[1];
		} else if (mainMatch) {
			content = mainMatch[1];
		} else if (contentMatch) {
			content = contentMatch[1];
		} else {
			// body 전체 사용
			const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
			content = bodyMatch?.[1] || cleaned;
		}

		// 4. HTML 태그 제거 및 텍스트 추출
		content = content
			// 줄바꿈 유지할 태그들
			.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n")
			// 나머지 태그 제거
			.replace(/<[^>]+>/g, "")
			// HTML 엔티티 디코딩
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&[a-z]+;/gi, " ")
			// 여러 줄바꿈 정리
			.replace(/\n{3,}/g, "\n\n")
			// 여러 공백 정리
			.replace(/[ \t]+/g, " ")
			.trim();

		// 5. 제목 정리
		const cleanTitle = title
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.trim();

		return { title: cleanTitle, content };
	}

	/**
	 * 웹페이지 처리 (본문 추출 + AI 요약)
	 */
	async processUrl(url: string): Promise<WebPageResult> {
		if (!this.isValidUrl(url)) {
			throw new Error("유효한 URL이 아닙니다");
		}

		// 1. 웹페이지 가져오기
		let html: string;
		try {
			const response = await requestUrl({
				url,
				method: "GET",
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
				},
			});
			html = response.text;
		} catch (error) {
			throw new Error(`웹페이지를 가져올 수 없습니다: ${error}`);
		}

		// 2. 본문 추출
		const { title, content } = this.extractContent(html);

		if (content.length < 100) {
			throw new Error("추출된 본문이 너무 짧습니다. JavaScript로 렌더링되는 페이지일 수 있습니다.");
		}

		// 3. 본문이 너무 길면 자르기
		const maxLength = 50000;
		const truncatedContent =
			content.length > maxLength
				? content.slice(0, maxLength) + "..."
				: content;

		// 4. AI 요약
		const summaryResult = await this.gemini.summarizeContent(
			truncatedContent,
			"webpage"
		);

		return {
			url,
			title: summaryResult.title || title,
			content: truncatedContent,
			summary: summaryResult.summary,
			keyPoints: summaryResult.keyPoints,
		};
	}

	/**
	 * 마크다운 노트 생성
	 */
	generateMarkdownNote(result: WebPageResult): string {
		const now = new Date().toISOString();

		return `---
type: webpage
source: "${result.url}"
title: "${result.title.replace(/"/g, '\\"')}"
created: ${now}
---

# ${result.title}

## 출처
${result.url}

## 요약
${result.summary}

## 핵심 포인트
${result.keyPoints.map((point) => `- ${point}`).join("\n")}

---
## 원문 내용
<details>
<summary>전체 내용 보기</summary>

${result.content}

</details>
`;
	}
}
