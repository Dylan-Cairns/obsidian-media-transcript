import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { sha1Hex } from "../../src/modules/archive/sha1.ts";

const node = (s: string) => createHash("sha1").update(s).digest("hex");

describe("sha1Hex matches Node's crypto", () => {
	const cases = [
		"",
		"abc",
		"https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&from=appmsg",
		"https://pbs.twimg.com/media/HUpcs1hbAAAU3n-.jpg?name=orig",
		"https://example.com/路径/图片 ☄️🪐.png", // non-ASCII: hashed as UTF-8
		"x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(1000), // padding edges
	];
	for (const s of cases) {
		test(JSON.stringify(s.length > 40 ? s.slice(0, 40) + "…" : s), () => assert.equal(sha1Hex(s), node(s)));
	}
});
