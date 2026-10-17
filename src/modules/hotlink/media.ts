// 页面这一侧：在笔记渲染出来的 DOM 里找到归规则管的媒体，摘掉原地址，等滚到附近再去要，
// 拿到后换成 blob: 地址；拿不到就在下方说一声。
//
// 不依赖 Obsidian：用到的环境能力（去要文件、生成 blob 地址、观察是否滚到附近、查笔记的原文
// 地址）都从外面传进来，测试里换成假的。

import { findRule, type Rule } from "./rules.ts";

/** 已接管的元素打上这个标记；值是 pending / loading / done / failed。 */
export const STATE = "data-hotlink-media";
/** 原地址挪到这里（src 先去掉，免得 Obsidian 自己去要、被拒、显示成坏掉的播放器）。 */
export const ORIGINAL = "data-hotlink-src";
export const FAILED_CLASS = "hotlink-media-failed";

export interface MediaDeps {
	/** 按规则去要文件。 */
	fetch: (url: string, rule: Rule, pageUrl?: string) => Promise<{ body: Uint8Array; contentType: string }>;
	/** 把文件变成页面能用的地址（Obsidian 里是 URL.createObjectURL）。 */
	toObjectUrl: (body: Uint8Array, contentType: string) => string;
	revokeObjectUrl: (url: string) => void;
	/** 元素滚到附近时调用 onVisible(el)。 */
	observe: (el: Element) => void;
	/** 笔记 frontmatter 里的 source（原文地址）。 */
	pageUrlOf: (sourcePath: string) => string | undefined;
	warn?: (...args: unknown[]) => void;
}

export class MediaController {
	/** 原地址 → blob 地址。同一个视频在阅读视图和实时预览里只要一次。 */
	private cache = new Map<string, Promise<string>>();
	/** 元素 → 所在笔记，加载时要用笔记的原文地址去换新地址。 */
	private sourceOf = new WeakMap<Element, string>();

	private deps: MediaDeps;

	// 不用 constructor(private deps) 的简写：测试用 node 的 --experimental-strip-types 跑，它不支持
	constructor(deps: MediaDeps) {
		this.deps = deps;
	}

	/** 找出归某条规则管的媒体，先摘掉 src，等滚到附近再去要。返回接管了几个。 */
	scan(root: ParentNode, sourcePath: string): number {
		let n = 0;
		root.querySelectorAll<HTMLElement>("video, audio, img, source").forEach((el) => {
			if (el.hasAttribute(STATE)) return;
			const src = el.getAttribute("src");
			if (!src || !findRule(src)) return;
			el.setAttribute(STATE, "pending");
			el.setAttribute(ORIGINAL, src);
			el.removeAttribute("src");
			this.sourceOf.set(el, sourcePath);
			// <source> 不占位置，观察它所在的 <video>/<audio>
			this.deps.observe(el.tagName === "SOURCE" && el.parentElement ? el.parentElement : el);
			n++;
		});
		return n;
	}

	/** 元素滚到附近了：去要它（或它里面的 <source>）。 */
	async onVisible(target: Element): Promise<void> {
		const els = target.hasAttribute(ORIGINAL)
			? [target as HTMLElement]
			: Array.from(target.querySelectorAll<HTMLElement>(`source[${ORIGINAL}]`));
		await Promise.all(els.map((el) => this.loadOne(el)));
	}

	private async loadOne(el: HTMLElement): Promise<void> {
		const original = el.getAttribute(ORIGINAL)!;
		const rule = findRule(original);
		if (!rule || el.getAttribute(STATE) !== "pending") return;
		el.setAttribute(STATE, "loading");
		const sourcePath = this.sourceOf.get(el);
		const pageUrl = sourcePath ? this.deps.pageUrlOf(sourcePath) : undefined;
		try {
			let objectUrl = this.cache.get(original);
			if (!objectUrl) {
				objectUrl = this.deps
					.fetch(original, rule, pageUrl)
					.then((m) => this.deps.toObjectUrl(m.body, m.contentType));
				this.cache.set(original, objectUrl);
				objectUrl.catch(() => this.cache.delete(original)); // 失败了下次还能再试
			}
			el.setAttribute("src", await objectUrl);
			el.setAttribute(STATE, "done");
			if (el.tagName === "SOURCE") (el.parentElement as HTMLMediaElement | null)?.load?.();
		} catch (e) {
			el.setAttribute(STATE, "failed");
			this.showFailure(el, (e as Error).message, pageUrl);
		}
	}

	private showFailure(el: HTMLElement, message: string, pageUrl?: string) {
		const media = el.tagName === "SOURCE" && el.parentElement ? el.parentElement : el;
		if (media.nextElementSibling?.classList.contains(FAILED_CLASS)) return;
		const note = createDiv({ cls: FAILED_CLASS, text: `加载失败（${message}）` });
		if (pageUrl) {
			note.append("，");
			note.createEl("a", { text: "到原文观看", href: pageUrl });
		}
		media.insertAdjacentElement("afterend", note);
		this.deps.warn?.("[hotlink-media]", message, el.getAttribute(ORIGINAL));
	}

	/** 插件卸载时释放所有 blob 地址。 */
	dispose() {
		for (const p of this.cache.values()) p.then((u) => this.deps.revokeObjectUrl(u), () => {});
		this.cache.clear();
	}
}
