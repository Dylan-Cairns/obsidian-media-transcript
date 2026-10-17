import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { matchPolicy } from "../../src/modules/archive/policies.ts";

describe("policies — explicit domain rules", () => {
	test("WeChat mmbiz.qpic.cn → archive with Referer", () => {
		const p = matchPolicy("https://mmbiz.qpic.cn/foo.jpg");
		assert.equal(p.archive, true);
		assert.equal(p.referer, "https://mp.weixin.qq.com/");
	});
	test("Twitter image → archive without Referer", () => {
		const p = matchPolicy("https://pbs.twimg.com/media/x.png");
		assert.equal(p.archive, true);
		assert.equal(p.referer, undefined);
	});
	test("Twitter video → skip (CDN stable)", () => {
		const p = matchPolicy("https://video.twimg.com/movie.mp4");
		assert.equal(p.archive, false);
	});
	test("YouTube → skip (stream-only)", () => {
		assert.equal(matchPolicy("https://youtube.com/watch?v=x").archive, false);
		assert.equal(matchPolicy("https://youtu.be/x").archive, false);
	});
	test("Vimeo → skip (stream-only)", () => {
		assert.equal(matchPolicy("https://vimeo.com/123").archive, false);
	});
});

describe("policies — fallback for unknown domains", () => {
	test("media extension → archive", () => {
		assert.equal(matchPolicy("https://example.com/img.jpg").archive, true);
		assert.equal(matchPolicy("https://example.com/foo.png").archive, true);
		assert.equal(matchPolicy("https://example.com/video.mp4").archive, true);
		assert.equal(matchPolicy("https://example.com/song.mp3").archive, true);
		assert.equal(matchPolicy("https://example.com/doc.pdf").archive, true);
	});
	test("media extension with query string → archive", () => {
		assert.equal(matchPolicy("https://example.com/img.jpg?v=2").archive, true);
	});
	test("media extension with fragment → archive", () => {
		assert.equal(matchPolicy("https://example.com/img.png#filter").archive, true);
	});
	test("HTML page URL → skip", () => {
		assert.equal(matchPolicy("https://example.com/article").archive, false);
		assert.equal(matchPolicy("https://example.com/page.html").archive, false);
	});
	test("case-insensitive extension matching", () => {
		assert.equal(matchPolicy("https://example.com/IMG.PNG").archive, true);
		assert.equal(matchPolicy("https://example.com/video.MP4").archive, true);
	});
});

describe("policies — custom policy injection", () => {
	test("custom policy list overrides defaults", () => {
		const custom = [{ match: /example\.com/, archive: false }];
		const p = matchPolicy("https://example.com/x.jpg", custom);
		assert.equal(p.archive, false);
	});
	test("custom policy with empty list falls through to media-ext check", () => {
		const p = matchPolicy("https://anywhere.com/x.jpg", []);
		assert.equal(p.archive, true);
	});
});
