import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWechatVideoUrls, findRule, pickFreshWechatUrl, wechatVideoKey } from "../../src/modules/hotlink/rules.ts";

const stale = "https://mpvideo.qpic.cn/0bc3uyaakaaao4aozvv5abvfbjwdawtaabia.f10002.mp4?dis_k=old&dis_t=1&auth_key=x";

test("只接管规则里的地址，别的不碰", () => {
	assert.equal(findRule(stale)?.id, "wechat-video");
	assert.equal(findRule("https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png"), null);
	assert.equal(findRule("https://example.com/a.mp4"), null);
});

test("视频编号和清晰度", () => {
	assert.deepEqual(wechatVideoKey(stale), { file: "0bc3uyaakaaao4aozvv5abvfbjwdawtaabia", format: "f10002" });
	assert.equal(wechatVideoKey("https://example.com/a.mp4"), null);
});

test("从原文 HTML 里取视频地址：&amp; 和 \\x26amp; 两种转义都还原成 &", () => {
	const html = `
		<video src="https://mpvideo.qpic.cn/0bc3aaa.f10002.mp4?dis_k=1&amp;dis_t=2&amp;auth_key=3">
		url: 'http://mpvideo.qpic.cn/0bc3aaa.f10004.mp4?dis_k=4\\x26amp;dis_t=5\\x26amp;auth_key=6',
	`;
	assert.deepEqual(extractWechatVideoUrls(html), [
		"https://mpvideo.qpic.cn/0bc3aaa.f10002.mp4?dis_k=1&dis_t=2&auth_key=3",
		"https://mpvideo.qpic.cn/0bc3aaa.f10004.mp4?dis_k=4&dis_t=5&auth_key=6",
	]);
});

test("换新地址：同一个视频、尽量同一清晰度；找不到就返回 null", () => {
	const fresh = [
		"https://mpvideo.qpic.cn/0bc3other.f10002.mp4?new",
		"https://mpvideo.qpic.cn/0bc3uyaakaaao4aozvv5abvfbjwdawtaabia.f10004.mp4?new",
		"https://mpvideo.qpic.cn/0bc3uyaakaaao4aozvv5abvfbjwdawtaabia.f10002.mp4?new",
	];
	assert.equal(pickFreshWechatUrl(stale, fresh), fresh[2]);
	assert.equal(pickFreshWechatUrl(stale, fresh.slice(0, 2)), fresh[1]);
	assert.equal(pickFreshWechatUrl(stale, fresh.slice(0, 1)), null);
});
