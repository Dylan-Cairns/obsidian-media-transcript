import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { archiveName, nameOf, resolve, sourceCandidates } from "../../src/modules/archive/resolver.ts";
import type { ArchiveSettings } from "../../src/modules/archive/settings.ts";

const sibling: ArchiveSettings = {
	archiveMode: "sibling",
	archiveDirName: "_archive",
	centralArchivePath: "_archive",
	autoArchiveOnModify: true,
	includedPaths: [],
	sources: [{ kind: "local" }],
	pendingUploads: {},
};
const central: ArchiveSettings = { ...sibling, archiveMode: "central" };

describe("resolver — sibling mode", () => {
	test("path lives next to the markdown", () => {
		const got = resolve("https://example.com/x.png", "raw/wechat/note.md", sibling);
		assert.ok(got.startsWith("raw/wechat/_archive/"), `got: ${got}`);
	});
	test("filename is <sha1>.<ext>", () => {
		const got = resolve("https://example.com/x.png", "n.md", sibling);
		assert.match(got, /\/[a-f0-9]{40}\.png$/);
	});
	test("different mdDir → different sibling path", () => {
		const a = resolve("https://example.com/x.png", "a/b.md", sibling);
		const b = resolve("https://example.com/x.png", "x/y.md", sibling);
		assert.notEqual(a, b);
		// But the hash filename must match (same URL = same content addressing).
		assert.equal(a.split("/").pop(), b.split("/").pop());
	});
	test("respects custom archiveDirName", () => {
		const got = resolve("https://example.com/x.png", "a/b.md", {
			...sibling,
			archiveDirName: "_cache",
		});
		assert.ok(got.startsWith("a/_cache/"), `got: ${got}`);
	});
});

describe("resolver — central mode", () => {
	test("path starts with centralArchivePath", () => {
		const got = resolve("https://example.com/x.png", "any/note.md", central);
		assert.ok(got.startsWith("_archive/"), `got: ${got}`);
	});
	test("uses 2-char hash bucket", () => {
		const got = resolve("https://example.com/x.png", "n.md", central);
		const m = got.match(/^_archive\/([a-f0-9]{2})\/([a-f0-9]{40})\.png$/);
		assert.ok(m, `bad shape: ${got}`);
		assert.equal(m![1], m![2].substring(0, 2), "bucket must be hash[:2]");
	});
	test("DEDUP INVARIANT: same URL → same path regardless of mdPath", () => {
		const url = "https://example.com/dedup.png";
		const a = resolve(url, "deep/nested/foo.md", central);
		const b = resolve(url, "another/place.md", central);
		assert.equal(a, b);
	});
	test("custom centralArchivePath honored", () => {
		const got = resolve("https://example.com/x.png", "n.md", {
			...central,
			centralArchivePath: "static/cache",
		});
		assert.ok(got.startsWith("static/cache/"), `got: ${got}`);
	});
});

describe("resolver — extension detection", () => {
	const cases: Array<[string, string]> = [
		["https://example.com/foo.PNG", "png"],
		["https://example.com/foo.jpg?x=1", "jpg"],
		["https://example.com/foo", "bin"],
		["https://mp.weixin.qq.com/abc?wx_fmt=gif", "gif"],
		["https://example.com/path/with.dots/in/middle.webp", "webp"],
		["not-a-url", "bin"],
	];
	for (const [url, want] of cases) {
		test(`${url} → .${want}`, () => {
			const got = resolve(url, "n.md", sibling);
			assert.equal(got.substring(got.lastIndexOf(".") + 1), want);
		});
	}
});

describe("resolver — sibling vs central same hash", () => {
	test("same URL produces same hash (filename) in both modes", () => {
		const url = "https://example.com/cross-mode.png";
		const s = resolve(url, "a/b.md", sibling);
		const c = resolve(url, "a/b.md", central);
		// Last segment is <sha1>.<ext> in both cases.
		assert.equal(s.split("/").pop(), c.split("/").pop());
	});
});

describe("resolver — server copies", () => {
	const url = "https://example.com/x.png";
	test("servers use the central layout", () => {
		const local = resolve(url, "a/b.md", { ...central, centralArchivePath: "raw/_archive" });
		assert.equal(local, "raw/_archive/" + archiveName(url));
	});
	test("nameOf maps any local archive path to the server name", () => {
		const name = archiveName(url);
		assert.equal(nameOf(resolve(url, "a/b.md", central)), name);
		assert.equal(nameOf(resolve(url, "a/b.md", sibling)), name); // sibling has no bucket folder
		assert.equal(nameOf("~/Media/_archive/" + name), name);
	});
});

describe("resolver — sourceCandidates", () => {
	const url = "https://example.com/x.png";
	const local = "app://local/x.png";
	const a = "https://a.ts.net/dav/archive";
	const b = "https://b.ts.net/dav/archive";
	const all = () => true;
	test("follows source order", () => {
		const got = sourceCandidates(url, [{ kind: "server", url: a }, { kind: "local" }, { kind: "server", url: b }], local, all);
		assert.deepEqual(got, [`${a}/${archiveName(url)}`, local, `${b}/${archiveName(url)}`]);
	});
	test("servers that are down and a missing local copy are left out", () => {
		const got = sourceCandidates(url, [{ kind: "server", url: a }, { kind: "local" }, { kind: "server", url: b }], null, (s) => s === b);
		assert.deepEqual(got, [`${b}/${archiveName(url)}`]);
	});
	test("nothing archived → nothing to try", () => {
		assert.deepEqual(sourceCandidates(url, [{ kind: "local" }], null, all), []);
	});
});
