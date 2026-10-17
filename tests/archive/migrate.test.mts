import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import type { App } from "obsidian";
import { execute, scan, formatBytes } from "../../src/modules/archive/migrate.ts";
import { MockVault, mockApp } from "./_helpers/vault-mock.mts";
import type { ArchiveSettings } from "../../src/modules/archive/settings.ts";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_C = "cccccccccccccccccccccccccccccccccccccccc";
const SHA_D = "dddddddddddddddddddddddddddddddddddddddd";

const baseSettings: ArchiveSettings = {
	archiveMode: "central",
	archiveDirName: "_archive",
	centralArchivePath: "_archive",
	autoArchiveOnModify: true,
	includedPaths: [],
	sources: [{ kind: "local" }],
	pendingUploads: {},
};

describe("migrate — scan", () => {
	test("finds files in sibling archive folders", async () => {
		const v = new MockVault();
		v.seedFile(`raw/wechat/_archive/${SHA_A}.jpg`, "a-bytes");
		v.seedFile(`raw/twitter/_archive/${SHA_B}.png`, "b-bytes");
		v.seedFile(`raw/wechat/note.md`, "...");

		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		const fromPaths = plan.moves.map((m) => m.from).sort();
		assert.deepEqual(fromPaths, [
			`raw/twitter/_archive/${SHA_B}.png`,
			`raw/wechat/_archive/${SHA_A}.jpg`,
		]);
	});

	test("targets are <central>/<bucket>/<hash>.<ext>", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves[0].to, `_archive/aa/${SHA_A}.jpg`);
	});

	test("skips files already inside the central path (idempotent)", async () => {
		const v = new MockVault();
		v.seedFile(`_archive/${SHA_A}.jpg`, "1"); // top-level
		v.seedFile(`_archive/aa/${SHA_A}.jpg`, "2"); // already migrated
		v.seedFile(`raw/_archive/${SHA_B}.png`, "3"); // legit sibling

		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		const fromPaths = plan.moves.map((m) => m.from);
		// Only the raw/_archive/B should appear. Central's own contents are skipped.
		assert.deepEqual(fromPaths, [`raw/_archive/${SHA_B}.png`]);
	});

	test("dedups by SHA1 across multiple sibling folders", async () => {
		const v = new MockVault();
		// Same hash appearing in two different sibling _archive folders.
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");
		v.seedFile(`b/_archive/${SHA_A}.jpg`, "x");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves.length, 1);
		assert.equal(plan.duplicates.length, 1);
	});

	test("skips dest that already exists in central", async () => {
		const v = new MockVault();
		v.seedFile(`_archive/aa/${SHA_A}.jpg`, "already-there");
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "candidate");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves.length, 0);
		assert.equal(plan.duplicates.length, 1);
		assert.equal(plan.duplicates[0].existingAt, `_archive/aa/${SHA_A}.jpg`);
	});

	test("collects .failed.jsonl files as separate group", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");
		v.seedFile(`a/_archive/.failed.jsonl`, "");
		v.seedFile(`b/_archive/.failed.jsonl`, "");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.failedLogs.length, 2);
	});

	test("flags non-SHA1-named files into skippedNonHashed (does not move)", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "ok");
		v.seedFile(`a/_archive/some-random-file.txt`, "alien");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves.length, 1);
		assert.equal(plan.skippedNonHashed.length, 1);
		assert.ok(plan.skippedNonHashed[0].endsWith("some-random-file.txt"));
	});

	test("respects custom archiveDirName", async () => {
		const v = new MockVault();
		v.seedFile(`a/_cache/${SHA_A}.jpg`, "x");
		v.seedFile(`a/_archive/${SHA_B}.png`, "wrong-name");
		const plan = await scan(mockApp(v) as unknown as App, {
			...baseSettings,
			archiveDirName: "_cache",
		});
		assert.equal(plan.moves.length, 1);
		assert.ok(plan.moves[0].from.includes("_cache"));
	});

	test("totalBytes sums file sizes", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "12345"); // 5 bytes
		v.seedFile(`b/_archive/${SHA_B}.jpg`, "abc"); // 3 bytes
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.totalBytes, 8);
	});
});

describe("migrate — execute Copy (non-destructive)", () => {
	test("copies file to central, leaves original in place", async () => {
		const v = new MockVault();
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "payload");
		v.seedFile(`raw/note.md`, "...");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const r = await execute(app, plan, baseSettings, {
			deleteSource: false,
			deleteEmptyDirs: false,
		});

		assert.equal(r.moved, 1);
		assert.equal(r.errors.length, 0);
		assert.ok(v.allFilePaths().includes(`raw/_archive/${SHA_A}.jpg`), "original kept");
		assert.ok(v.allFilePaths().includes(`_archive/aa/${SHA_A}.jpg`), "copied to central");
	});

	test("writes marker file in central path", async () => {
		const v = new MockVault();
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "x");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: false, deleteEmptyDirs: false });

		const markerPath = `_archive/.archive-redirect-managed`;
		assert.ok(v.allFilePaths().includes(markerPath), "marker exists");
		const markerContent = v.readText(markerPath);
		assert.ok(
			markerContent.includes("DO NOT clean this folder"),
			"marker content has warning",
		);
	});
});

describe("migrate — execute Move (destructive)", () => {
	test("moves file: original gone, dest present", async () => {
		const v = new MockVault();
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "payload");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const r = await execute(app, plan, baseSettings, {
			deleteSource: true,
			deleteEmptyDirs: false,
		});

		assert.equal(r.moved, 1);
		assert.equal(v.allFilePaths().includes(`raw/_archive/${SHA_A}.jpg`), false);
		assert.ok(v.allFilePaths().includes(`_archive/aa/${SHA_A}.jpg`));
	});

	test("deleteEmptyDirs trashes the now-empty sibling folder", async () => {
		const v = new MockVault();
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "x");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const r = await execute(app, plan, baseSettings, {
			deleteSource: true,
			deleteEmptyDirs: true,
		});

		assert.equal(r.emptyDirsRemoved, 1);
		assert.ok(v.wasTrashed(`raw/_archive`));
	});

	test("does NOT delete dir that still has other files", async () => {
		const v = new MockVault();
		v.seedFile(`raw/_archive/${SHA_A}.jpg`, "x");
		v.seedFile(`raw/_archive/leftover.txt`, "alien"); // non-SHA1, won't be moved

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const r = await execute(app, plan, baseSettings, {
			deleteSource: true,
			deleteEmptyDirs: true,
		});

		assert.equal(r.emptyDirsRemoved, 0);
		assert.equal(v.wasTrashed(`raw/_archive`), false);
	});
});

describe("migrate — .failed.jsonl merge", () => {
	test("concatenates entries from sibling logs into central log", async () => {
		const v = new MockVault();
		const e1 = JSON.stringify({ url: "https://a.com/1", error: "404", ts: "2025-01-01T00:00:00Z" });
		const e2 = JSON.stringify({ url: "https://b.com/2", error: "500", ts: "2025-01-02T00:00:00Z" });
		v.seedFile(`x/_archive/.failed.jsonl`, e1 + "\n");
		v.seedFile(`y/_archive/.failed.jsonl`, e2 + "\n");
		v.seedFile(`x/_archive/${SHA_A}.jpg`, "ok"); // give scan a move so execute runs

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: false, deleteEmptyDirs: false });

		const merged = v.readText(`_archive/.failed.jsonl`);
		assert.ok(merged.includes("https://a.com/1"));
		assert.ok(merged.includes("https://b.com/2"));
	});

	test("dedups by URL, keeps the entry with the latest ts", async () => {
		const v = new MockVault();
		const older = JSON.stringify({ url: "https://x.com/dupe", error: "old", ts: "2025-01-01T00:00:00Z" });
		const newer = JSON.stringify({ url: "https://x.com/dupe", error: "new", ts: "2025-06-01T00:00:00Z" });
		v.seedFile(`a/_archive/.failed.jsonl`, older + "\n");
		v.seedFile(`b/_archive/.failed.jsonl`, newer + "\n");
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "trigger execute");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: false, deleteEmptyDirs: false });

		const merged = v.readText(`_archive/.failed.jsonl`);
		const lines = merged.split("\n").filter(Boolean);
		assert.equal(lines.length, 1);
		assert.ok(merged.includes('"error":"new"'));
		assert.equal(merged.includes('"error":"old"'), false);
	});

	test("malformed lines are silently skipped", async () => {
		const v = new MockVault();
		v.seedFile(
			`a/_archive/.failed.jsonl`,
			"not-json\n" + JSON.stringify({ url: "https://ok.com", ts: "2025-01-01" }) + "\n{not json either}\n",
		);
		v.seedFile(`a/_archive/${SHA_C}.jpg`, "trigger");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: false, deleteEmptyDirs: false });

		const merged = v.readText(`_archive/.failed.jsonl`);
		assert.ok(merged.includes("https://ok.com"));
		assert.equal(merged.includes("not-json"), false);
	});
});

describe("migrate — formatBytes", () => {
	test("formats sizes across magnitudes", () => {
		assert.equal(formatBytes(512), "512 B");
		assert.equal(formatBytes(2048), "2.0 KB");
		assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");
		assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.00 GB");
	});
});

describe("migrate — progress + cancel", () => {
	test("onProgress fires once per planned move", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");
		v.seedFile(`b/_archive/${SHA_B}.png`, "y");
		v.seedFile(`c/_archive/${SHA_C}.gif`, "z");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const events: number[] = [];
		await execute(app, plan, baseSettings, {
			deleteSource: false,
			deleteEmptyDirs: false,
			onProgress: (e) => events.push(e.done),
		});
		assert.deepEqual(events, [1, 2, 3]);
	});

	test("onProgress reports total = plan.moves.length", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "12345"); // 5 bytes

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		let lastEvent: { done: number; total: number; bytesProcessed: number } | null = null;
		await execute(app, plan, baseSettings, {
			deleteSource: false,
			deleteEmptyDirs: false,
			onProgress: (e) => {
				lastEvent = e;
			},
		});
		assert.notEqual(lastEvent, null);
		assert.equal(lastEvent!.total, 1);
		assert.equal(lastEvent!.done, 1);
		assert.equal(lastEvent!.bytesProcessed, 5);
	});

	test("signal.aborted stops the loop, result.cancelled is true", async () => {
		const v = new MockVault();
		for (const sha of [SHA_A, SHA_B, SHA_C, SHA_D]) {
			v.seedFile(`a/_archive/${sha}.jpg`, "x");
		}

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const controller = new AbortController();
		const r = await execute(app, plan, baseSettings, {
			deleteSource: false,
			deleteEmptyDirs: false,
			signal: controller.signal,
			onProgress: (e) => {
				if (e.done === 2) controller.abort();
			},
		});

		assert.equal(r.cancelled, true);
		assert.equal(r.moved, 2);
	});

	test("non-cancelled run has result.cancelled === false", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		const r = await execute(app, plan, baseSettings, {
			deleteSource: false,
			deleteEmptyDirs: false,
		});
		assert.equal(r.cancelled, false);
	});
});

describe("migrate — Move uses vault.rename (not fileManager.renameFile)", () => {
	// fileManager.renameFile walks every md file in the vault to update
	// backlinks — O(notes × moves). Our archive files are never linked from
	// markdown, so we use vault.rename. This test pins the behaviour: if
	// someone reintroduces the slow API by mistake, this fails.
	test("Move calls app.vault.rename, not app.fileManager.renameFile", async () => {
		const v = new MockVault();
		v.seedFile(`a/_archive/${SHA_A}.jpg`, "x");

		let vaultRenameCalls = 0;
		let fileManagerRenameCalls = 0;
		const origVaultRename = v.rename.bind(v);
		v.rename = async (item, newPath) => {
			vaultRenameCalls++;
			return origVaultRename(item, newPath);
		};
		const origFileManagerRename = v.fileManager.renameFile;
		v.fileManager.renameFile = async (file, newPath) => {
			fileManagerRenameCalls++;
			return origFileManagerRename(file, newPath);
		};

		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: true, deleteEmptyDirs: false });

		assert.equal(vaultRenameCalls, 1, "vault.rename should be called once");
		assert.equal(fileManagerRenameCalls, 0, "fileManager.renameFile should NOT be called");
	});
});

describe("migrate — empty / no-op cases", () => {
	test("empty vault produces empty plan", async () => {
		const v = new MockVault();
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves.length, 0);
		assert.equal(plan.totalBytes, 0);
	});

	test("vault with only central files (already migrated) produces empty plan", async () => {
		const v = new MockVault();
		v.seedFile(`_archive/aa/${SHA_A}.jpg`, "x");
		v.seedFile(`_archive/.archive-redirect-managed`, "marker");
		const plan = await scan(mockApp(v) as unknown as App, baseSettings);
		assert.equal(plan.moves.length, 0);
	});

	test("execute with empty plan still writes marker", async () => {
		const v = new MockVault();
		const app = mockApp(v) as unknown as App;
		const plan = await scan(app, baseSettings);
		await execute(app, plan, baseSettings, { deleteSource: false, deleteEmptyDirs: false });
		assert.ok(v.allFilePaths().includes(`_archive/.archive-redirect-managed`));
	});
});
