// 页面这一侧：在模拟的页面里放进笔记渲染出来的媒体，看插件怎么接管。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { FAILED_CLASS, MediaController, ORIGINAL, STATE, type MediaDeps } from "../../src/modules/hotlink/media.ts";

const noteUrls = readFileSync(new URL("./fixtures/wechat-note-videos.txt", import.meta.url), "utf8")
	.split("\n")
	.filter((l) => l && !l.startsWith("#"));
const PAGE = "https://mp.weixin.qq.com/s/6BEA0iks8HPWA5-Buk64uQ";
const OTHER_IMG = "https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png";

/** Obsidian 给 DOM 加的两个帮手：全局 createDiv，以及元素上的 createEl。测试里照着补上。 */
function installObsidianDomHelpers(dom: JSDOM) {
	type Opts = { cls?: string; text?: string; href?: string };
	const make = (tag: string, o: Opts = {}) => {
		const el = dom.window.document.createElement(tag);
		if (o.cls) el.className = o.cls;
		if (o.text) el.textContent = o.text;
		if (o.href) el.setAttribute("href", o.href);
		return el;
	};
	(globalThis as Record<string, unknown>).createDiv = (o?: Opts) => make("div", o);
	(dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).createEl = function (this: HTMLElement, tag: string, o?: Opts) {
		return this.appendChild(make(tag, o));
	};
}

function setup(over: Partial<MediaDeps> = {}) {
	const dom = new JSDOM(`<!DOCTYPE html><body><div id="note">
		<p>正文</p>
		<video src="${noteUrls[0].replace(/&/g, "&amp;")}" controls></video>
		<img src="${OTHER_IMG}">
		<video controls><source src="${noteUrls[1].replace(/&/g, "&amp;")}" type="video/mp4"></video>
	</div></body>`);
	const doc = dom.window.document;
	installObsidianDomHelpers(dom);
	const observed: Element[] = [];
	const fetched: { url: string; pageUrl?: string }[] = [];
	const deps: MediaDeps = {
		fetch: async (url, _rule, pageUrl) => (fetched.push({ url, pageUrl }), { body: new Uint8Array([1, 2, 3]), contentType: "video/mp4" }),
		toObjectUrl: () => `blob:fake/${fetched.length}`,
		revokeObjectUrl: () => {},
		observe: (el) => observed.push(el),
		pageUrlOf: (p) => (p === "note.md" ? PAGE : undefined),
		...over,
	};
	return { doc, root: doc.getElementById("note")!, media: new MediaController(deps), observed, fetched };
}

test("只接管规则里的媒体：摘掉 src、记下原地址、等滚到附近；别的图片不碰", () => {
	const { doc, root, media, observed } = setup();
	assert.equal(media.scan(root, "note.md"), 2);
	const [v1, v2] = Array.from(doc.querySelectorAll("video"));
	assert.equal(v1.getAttribute("src"), null);
	assert.equal(v1.getAttribute(ORIGINAL), noteUrls[0]);
	assert.equal(v1.getAttribute(STATE), "pending");
	assert.equal(doc.querySelector("img")!.getAttribute("src"), OTHER_IMG);
	assert.equal(doc.querySelector("img")!.hasAttribute(STATE), false);
	// <source> 观察的是外面的 <video>
	assert.deepEqual(observed, [v1, v2]);
});

test("扫第二遍不重复接管（实时预览每次编辑都会扫）", () => {
	const { root, media, observed } = setup();
	media.scan(root, "note.md");
	assert.equal(media.scan(root, "note.md"), 0);
	assert.equal(observed.length, 2);
});

test("滚到附近才去要：拿到后换成 blob 地址，带上笔记的原文地址", async () => {
	const { doc, root, media, observed, fetched } = setup();
	media.scan(root, "note.md");
	assert.equal(fetched.length, 0, "扫描时不该下载");
	await media.onVisible(observed[0]);
	const v1 = doc.querySelector("video")!;
	assert.equal(v1.getAttribute("src"), "blob:fake/1");
	assert.equal(v1.getAttribute(STATE), "done");
	assert.deepEqual(fetched, [{ url: noteUrls[0], pageUrl: PAGE }]);
	// <video><source> 的情况
	await media.onVisible(observed[1]);
	assert.equal(doc.querySelector("source")!.getAttribute("src"), "blob:fake/2");
});

test("同一个视频出现两次（阅读视图 + 实时预览）只下载一次", async () => {
	const { doc, media, fetched } = setup();
	const a = doc.createElement("div");
	a.innerHTML = `<video src="${noteUrls[0].replace(/&/g, "&amp;")}"></video>`;
	const b = a.cloneNode(true) as HTMLElement;
	media.scan(a, "note.md");
	media.scan(b, "note.md");
	await Promise.all([media.onVisible(a.firstElementChild!), media.onVisible(b.firstElementChild!)]);
	assert.equal(fetched.length, 1);
	assert.equal(b.firstElementChild!.getAttribute("src"), a.firstElementChild!.getAttribute("src"));
});

test("拿不到：视频下方说明原因，附「到原文观看」链接；只说一次；下次还能重试", async () => {
	let fail = true;
	const { doc, root, media, observed } = setup({
		fetch: async () => {
			if (fail) throw new Error("试了 4 次都被拒绝（最后一次 HTTP 403）");
			return { body: new Uint8Array([1]), contentType: "video/mp4" };
		},
		warn: () => {},
	});
	media.scan(root, "note.md");
	await media.onVisible(observed[0]);
	const v1 = doc.querySelector("video")!;
	assert.equal(v1.getAttribute(STATE), "failed");
	const note = v1.nextElementSibling!;
	assert.ok(note.classList.contains(FAILED_CLASS));
	assert.match(note.textContent!, /加载失败（试了 4 次都被拒绝（最后一次 HTTP 403））/);
	assert.equal(note.querySelector("a")!.getAttribute("href"), PAGE);

	// 同一个视频重新渲染后再试：这次成功，说明失败没有被缓存
	fail = false;
	const again = doc.createElement("div");
	again.innerHTML = `<video src="${noteUrls[0].replace(/&/g, "&amp;")}"></video>`;
	media.scan(again, "note.md");
	await media.onVisible(again.firstElementChild!);
	assert.equal(again.firstElementChild!.getAttribute(STATE), "done");
});

test("笔记没记原文地址：照样去要，只是失败提示里没有链接", async () => {
	const { doc, root, media, observed, fetched } = setup({ warn: () => {} });
	media.scan(root, "no-source.md");
	await media.onVisible(observed[0]);
	assert.equal(fetched[0].pageUrl, undefined);
	assert.equal(doc.querySelector("video")!.getAttribute(STATE), "done");
});
