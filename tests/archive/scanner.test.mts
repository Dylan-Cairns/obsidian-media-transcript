import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { extractUrls } from "../../src/modules/archive/scanner.ts";

describe("scanner — extractUrls", () => {
	test("captures markdown ![]() with empty alt", () => {
		const urls = extractUrls("![](https://example.com/a.png)");
		assert.deepEqual(urls, ["https://example.com/a.png"]);
	});
	test("captures markdown ![alt]()", () => {
		const urls = extractUrls("![my image](https://example.com/b.jpg)");
		assert.deepEqual(urls, ["https://example.com/b.jpg"]);
	});
	test("captures HTML <img> with double quotes", () => {
		const urls = extractUrls('<img src="https://example.com/c.png">');
		assert.deepEqual(urls, ["https://example.com/c.png"]);
	});
	test("captures HTML <img> with single quotes", () => {
		const urls = extractUrls("<img src='https://example.com/d.png'>");
		assert.deepEqual(urls, ["https://example.com/d.png"]);
	});
	test("captures HTML <img> with extra attrs before src", () => {
		const urls = extractUrls('<img alt="x" class="y" src="https://example.com/e.png" />');
		assert.deepEqual(urls, ["https://example.com/e.png"]);
	});
	test("ignores local markdown images", () => {
		const urls = extractUrls("![](attachments/local.png)");
		assert.deepEqual(urls, []);
	});
	test("ignores [link]() (not image)", () => {
		const urls = extractUrls("[a link](https://example.com/page.html)");
		assert.deepEqual(urls, []);
	});
	test("dedups same URL appearing multiple times", () => {
		const urls = extractUrls(
			'![](https://example.com/x.png) and again ![](https://example.com/x.png)',
		);
		assert.deepEqual(urls, ["https://example.com/x.png"]);
	});
	test("captures both markdown and HTML in one doc", () => {
		const md = `# Note
![](https://a.com/1.png)
<img src="https://b.com/2.png">
`;
		const urls = extractUrls(md).sort();
		assert.deepEqual(urls, ["https://a.com/1.png", "https://b.com/2.png"]);
	});
	test("known gap: does NOT capture <video src>", () => {
		// Baseline assertion — if a future change adds video support, this test
		// fails and reminds us to update the documented capabilities.
		const urls = extractUrls('<video src="https://video.example.com/m.mp4"></video>');
		assert.deepEqual(urls, []);
	});
	test("http:// counts (not just https)", () => {
		const urls = extractUrls("![](http://example.com/h.png)");
		assert.deepEqual(urls, ["http://example.com/h.png"]);
	});
	test("ignores ftp:// or other schemes", () => {
		const urls = extractUrls("![](ftp://example.com/x.png)");
		assert.deepEqual(urls, []);
	});
});
