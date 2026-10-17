import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import type { App } from "obsidian";
import { findStaleCentralArchives, reconcile } from "../../src/modules/archive/reconcile.ts";
import { MARKER_FILENAME } from "../../src/modules/archive/fs-util.ts";
import { MockVault, mockApp } from "./_helpers/vault-mock.mts";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function seedCentralArchive(v: MockVault, root: string) {
	v.seedFile(`${root}/${MARKER_FILENAME}`, "marker");
	v.seedFile(`${root}/aa/${SHA}.jpg`, "content");
}

describe("reconcile — findStaleCentralArchives", () => {
	test("finds folder containing marker that's not the current path", () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive"); // the old central
		const stale = findStaleCentralArchives(mockApp(v) as unknown as App, "cache/media");
		assert.equal(stale.length, 1);
		assert.equal(stale[0].folderPath, "_archive");
		assert.equal(stale[0].markerPath, `_archive/${MARKER_FILENAME}`);
	});

	test("ignores the current central path even if it has a marker", () => {
		const v = new MockVault();
		seedCentralArchive(v, "cache/media");
		const stale = findStaleCentralArchives(mockApp(v) as unknown as App, "cache/media");
		assert.equal(stale.length, 0);
	});

	test("finds multiple stale archives", () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive");
		seedCentralArchive(v, "old/cache");
		const stale = findStaleCentralArchives(mockApp(v) as unknown as App, "cache/media");
		const paths = stale.map((s) => s.folderPath).sort();
		assert.deepEqual(paths, ["_archive", "old/cache"]);
	});

	test("returns empty when no marker exists anywhere", () => {
		const v = new MockVault();
		v.seedFile("note.md", "no archive");
		v.seedFile("raw/_archive/abc.jpg", "no marker here");
		const stale = findStaleCentralArchives(mockApp(v) as unknown as App, "_archive");
		assert.equal(stale.length, 0);
	});

	test("scans nested folders, not just root", () => {
		const v = new MockVault();
		seedCentralArchive(v, "deeply/nested/_archive");
		const stale = findStaleCentralArchives(mockApp(v) as unknown as App, "cache");
		assert.equal(stale.length, 1);
		assert.equal(stale[0].folderPath, "deeply/nested/_archive");
	});
});

describe("reconcile — reconcile()", () => {
	test("moves a stale archive folder to the new central path", async () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive");

		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "_archive", "cache/media");

		assert.equal(r.ok, true);
		assert.equal(v.allFolderPaths().includes("_archive"), false);
		assert.ok(v.allFolderPaths().includes("cache/media"));
		assert.ok(v.allFilePaths().includes(`cache/media/${MARKER_FILENAME}`));
		assert.ok(v.allFilePaths().includes(`cache/media/aa/${SHA}.jpg`));
	});

	test("refuses when destination already exists", async () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive");
		v.seedFolder("cache/media");

		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "_archive", "cache/media");

		assert.equal(r.ok, false);
		if (!r.ok) assert.equal(r.reason, "dest-exists");
		// Source untouched.
		assert.ok(v.allFolderPaths().includes("_archive"));
	});

	test("refuses when source does not exist", async () => {
		const v = new MockVault();
		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "nope", "cache/media");

		assert.equal(r.ok, false);
		if (!r.ok) assert.equal(r.reason, "source-missing");
	});

	test("refuses when source and destination are the same", async () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive");
		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "_archive", "_archive");

		assert.equal(r.ok, false);
		if (!r.ok) assert.equal(r.reason, "same-path");
	});

	test("creates parent dir of destination (nested target path)", async () => {
		const v = new MockVault();
		seedCentralArchive(v, "_archive");
		// "deep/nested" does not exist yet.
		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "_archive", "deep/nested/cache");

		assert.equal(r.ok, true);
		assert.ok(v.allFolderPaths().includes("deep"));
		assert.ok(v.allFolderPaths().includes("deep/nested"));
		assert.ok(v.allFolderPaths().includes("deep/nested/cache"));
	});

	test("preserves bucket structure end-to-end", async () => {
		const v = new MockVault();
		v.seedFile(`_archive/${MARKER_FILENAME}`, "marker");
		v.seedFile(`_archive/aa/${SHA}.jpg`, "x");
		v.seedFile(`_archive/bb/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png`, "y");

		const app = mockApp(v) as unknown as App;
		const r = await reconcile(app, "_archive", "static/cache");

		assert.equal(r.ok, true);
		assert.ok(v.allFilePaths().includes(`static/cache/aa/${SHA}.jpg`));
		assert.ok(
			v.allFilePaths().includes(`static/cache/bb/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png`),
		);
	});
});
