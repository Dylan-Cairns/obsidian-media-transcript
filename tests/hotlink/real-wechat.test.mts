// 用真实公众号文章的数据测：原文页面里的视频地址格式、笔记里存下的旧地址，都是 2026-10-04 实际抓到的。
// 微信改页面格式时，这里会先失败。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractWechatVideoUrls, findRule, pickFreshWechatUrl, wechatVideoKey } from "../../src/modules/hotlink/rules.ts";

const lines = (f: string) =>
	readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")
		.split("\n")
		.filter((l) => l && !l.startsWith("#"));
const articleHtml = lines("wechat-article-videos.txt").join("\n");
const noteUrls = lines("wechat-note-videos.txt");

test("原文里 6 个视频都认得出来，地址里不残留 &amp; 或 \\x26 转义", () => {
	const urls = extractWechatVideoUrls(articleHtml);
	const files = new Set(urls.map((u) => wechatVideoKey(u)?.file));
	assert.equal(files.size, 6);
	for (const u of urls) {
		assert.match(u, /^https:\/\/mpvideo\.qpic\.cn\/[0-9a-z]+\.f\d+\.mp4\?/);
		assert.ok(!/&amp;|\\x26/.test(u), u);
		assert.match(u, /[?&]auth_key=[0-9a-f]+/);
	}
});

test("笔记里存的 6 个旧地址都归「微信公众号视频」规则管", () => {
	assert.equal(noteUrls.length, 6);
	for (const u of noteUrls) assert.equal(findRule(u)?.id, "wechat-video", u);
});

test("每个旧地址都能在原文里找到同一个视频、同一清晰度的新地址", () => {
	const fresh = extractWechatVideoUrls(articleHtml);
	for (const stale of noteUrls) {
		const picked = pickFreshWechatUrl(stale, fresh);
		assert.ok(picked, `找不到新地址：${stale}`);
		assert.deepEqual(wechatVideoKey(picked), wechatVideoKey(stale));
		assert.notEqual(picked, stale);
	}
});
