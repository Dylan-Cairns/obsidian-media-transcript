import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { isInScope, DEFAULT_SETTINGS, expandHome, isExternalPath, migrateSources } from "../../src/modules/archive/settings.ts";

describe("settings — isInScope", () => {
	test("empty includedPaths = whole vault", () => {
		assert.equal(isInScope("anything/at/all.md", []), true);
		assert.equal(isInScope("", []), true);
	});
	test("exact match", () => {
		assert.equal(isInScope("raw/wechat", ["raw/wechat"]), true);
	});
	test("descendant of an included path", () => {
		assert.equal(isInScope("raw/wechat/note.md", ["raw/wechat"]), true);
		assert.equal(isInScope("raw/wechat/sub/note.md", ["raw/wechat"]), true);
	});
	test("sibling of an included path is OUT", () => {
		// Prefix match must be path-aware: "raw/wechat-old/x" should NOT match "raw/wechat".
		assert.equal(isInScope("raw/wechat-old/x.md", ["raw/wechat"]), false);
	});
	test("any of multiple scopes matches", () => {
		const scopes = ["raw/wechat", "raw/twitter"];
		assert.equal(isInScope("raw/twitter/x.md", scopes), true);
		assert.equal(isInScope("raw/wechat/x.md", scopes), true);
		assert.equal(isInScope("raw/other/x.md", scopes), false);
	});
});

describe("settings — defaults", () => {
	test("default mode is sibling (backward-compatible)", () => {
		assert.equal(DEFAULT_SETTINGS.archiveMode, "sibling");
	});
	test("default archive dir name is _archive", () => {
		assert.equal(DEFAULT_SETTINGS.archiveDirName, "_archive");
		assert.equal(DEFAULT_SETTINGS.centralArchivePath, "_archive");
	});
	test("default auto-archive is on", () => {
		assert.equal(DEFAULT_SETTINGS.autoArchiveOnModify, true);
	});
});

describe("settings — archive outside the vault", () => {
	test("absolute and ~/ paths are external", () => {
		assert.equal(isExternalPath("/Users/me/Media/_archive"), true);
		assert.equal(isExternalPath("~/Media/_archive"), true);
		assert.equal(isExternalPath("raw/_archive"), false);
		assert.equal(isExternalPath("_archive"), false);
	});
	test("~/ expands to the home folder", () => {
		assert.equal(expandHome("~/Media/_archive/ab/x.png", "/Users/me"), "/Users/me/Media/_archive/ab/x.png");
		assert.equal(expandHome("/abs/x.png", "/Users/me"), "/abs/x.png");
	});
	test("by default only the local archive", () => {
		assert.deepEqual(DEFAULT_SETTINGS.sources, [{ kind: "local" }]);
	});
});

describe("settings — migrating 0.6.0's single server", () => {
	const url = "https://host.ts.net/library/_archive";
	test("server first", () => {
		assert.deepEqual(migrateSources({ serverUrl: url + "/", sourceOrder: "server-first" }), [{ kind: "server", url }, { kind: "local" }]);
	});
	test("local first", () => {
		assert.deepEqual(migrateSources({ serverUrl: url, sourceOrder: "local-first" }), [{ kind: "local" }, { kind: "server", url }]);
	});
	test("no server, or settings older than 0.6.0", () => {
		assert.deepEqual(migrateSources({ serverUrl: "" }), [{ kind: "local" }]);
		assert.deepEqual(migrateSources({}), [{ kind: "local" }]);
	});
	test("a source list already there is kept", () => {
		const sources = [{ kind: "local" as const }];
		assert.equal(migrateSources({ sources, serverUrl: url }), sources);
	});
});
