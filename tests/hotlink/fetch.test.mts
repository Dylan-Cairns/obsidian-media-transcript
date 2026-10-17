import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMedia } from "../../src/modules/hotlink/fetch.ts";
import { findRule } from "../../src/modules/hotlink/rules.ts";

const stale = "https://mpvideo.qpic.cn/0bc3abc.f10002.mp4?old";
const freshUrl = "https://mpvideo.qpic.cn/0bc3abc.f10002.mp4?new";
const page = "https://mp.weixin.qq.com/s/xyz";
const rule = findRule(stale)!;
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
const noSleep = { sleep: async () => {} };
const res = (status: number, body = new Uint8Array(), contentType = "video/mp4") => ({ status, body, contentType });

test("一次就拿到：不换地址，带上规则的请求头", async () => {
	const seen: any[] = [];
	const m = await fetchMedia(stale, rule, { pageUrl: page, request: async (o) => (seen.push(o), res(200, mp4)) }, noSleep);
	assert.equal(m.url, stale);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].headers.Referer, "https://mp.weixin.qq.com/");
	assert.match(seen[0].headers["User-Agent"], /Chrome\//);
});

test("被拒：重新抓原文换新地址，再要就拿到了", async () => {
	const seen: string[] = [];
	const request = async (o: { url: string }) => {
		seen.push(o.url);
		if (o.url === page) return res(200, new TextEncoder().encode(`<video src="${freshUrl.replace("&", "&amp;")}">`), "text/html");
		return o.url === freshUrl ? res(200, mp4) : res(403);
	};
	const m = await fetchMedia(stale, rule, { pageUrl: page, request }, noSleep);
	assert.equal(m.url, freshUrl);
	assert.deepEqual(seen, [stale, page, freshUrl]);
});

test("新地址也时好时坏：继续重试", async () => {
	let n = 0;
	const request = async (o: { url: string }) =>
		o.url === page ? res(200, new TextEncoder().encode(freshUrl), "text/html") : ++n < 3 ? res(403) : res(206, mp4);
	const m = await fetchMedia(stale, rule, { pageUrl: page, request }, noSleep);
	assert.equal(m.body.length, mp4.length);
});

test("一直被拒：试完次数后报错，说清楚最后的状态码", async () => {
	const request = async (o: { url: string }) => (o.url === page ? res(200, new Uint8Array(), "text/html") : res(403));
	await assert.rejects(fetchMedia(stale, rule, { pageUrl: page, request }, { ...noSleep, attempts: 3 }), /试了 3 次.*HTTP 403/);
});

test("笔记里没记原文地址：不换地址，只重试", async () => {
	const seen: string[] = [];
	const request = async (o: { url: string }) => (seen.push(o.url), res(403));
	await assert.rejects(fetchMedia(stale, rule, { request }, { ...noSleep, attempts: 2 }));
	assert.deepEqual(seen, [stale, stale]);
});
