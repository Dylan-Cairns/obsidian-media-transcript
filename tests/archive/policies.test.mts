import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { isVideoUrl, matchPolicy } from "../../src/modules/archive/policies.ts";

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
	test("Twitter video → only when asked", () => {
		const p = matchPolicy("https://video.twimg.com/movie.mp4");
		assert.equal(p.archive, false);
		assert.equal(p.onDemand, true);
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
	});
});

describe("policies — videos", () => {
	test("a video is archived when asked, not on a scan", () => {
		for (const url of ["https://example.com/video.mp4", "https://example.com/video.MP4?x=1", "https://e.com/a.webm", "https://e.com/a.mov"]) {
			const p = matchPolicy(url);
			assert.equal(p.archive, false, url);
			assert.equal(p.onDemand, true, url);
		}
	});
	test("stream-only sites are never archived", () => {
		assert.ok(!matchPolicy("https://youtube.com/watch?v=x").onDemand);
	});
	test("isVideoUrl: remote video files only", () => {
		assert.equal(isVideoUrl("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1162x720/E1.mp4"), true);
		assert.equal(isVideoUrl("https://video.twimg.com/a/b.mp4?tag=12"), true);
		assert.equal(isVideoUrl("https://example.com/x.jpg"), false);
		assert.equal(isVideoUrl("app://local/x.mp4"), false);
		assert.equal(isVideoUrl("https://example.com/watch"), false);
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
