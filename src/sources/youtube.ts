/**
 * YouTube 영상 분석 (Gemini 네이티브)
 * Gemini API의 fileData를 사용하여 YouTube URL을 직접 분석
 */

import { GeminiClient } from "../api/gemini";

export interface YouTubeResult {
	videoId: string;
	url: string;
	title: string;
	summary: string;
	keyPoints: string[];
}

export class YouTubeExtractor {
	private gemini: GeminiClient;

	constructor(gemini: GeminiClient) {
		this.gemini = gemini;
	}

	/**
	 * URL에서 비디오 ID 추출
	 */
	extractVideoId(url: string): string | null {
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
			/^([a-zA-Z0-9_-]{11})$/,
		];

		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) {
				return match[1];
			}
		}

		return null;
	}

	/**
	 * YouTube URL 유효성 검사
	 */
	isValidYouTubeUrl(url: string): boolean {
		return this.extractVideoId(url) !== null;
	}

	/**
	 * 영상 처리 (Gemini 네이티브 분석)
	 */
	async processVideo(url: string): Promise<YouTubeResult> {
		const videoId = this.extractVideoId(url);
		if (!videoId) {
			throw new Error("유효한 YouTube URL이 아닙니다");
		}

		// 정규화된 URL 사용
		const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

		// Gemini 네이티브 비디오 분석
		console.log("Gemini 네이티브 YouTube 분석 시작:", normalizedUrl);
		const result = await this.gemini.analyzeYouTube(normalizedUrl);

		return {
			videoId,
			url: normalizedUrl,
			title: result.title,
			summary: result.summary,
			keyPoints: result.keyPoints,
		};
	}

	/**
	 * 마크다운 노트 생성
	 */
	generateMarkdownNote(result: YouTubeResult): string {
		const now = new Date().toISOString();

		return `---
type: youtube
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
`;
	}
}
