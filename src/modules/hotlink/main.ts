import { MarkdownView, TFile } from "obsidian";
import { ModulePlugin } from "../module";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { fetchMedia } from "./fetch";
import { MediaController } from "./media";
import type { RequestOptions, Rule } from "./rules";
import { t } from "../../i18n";

// Loaded on first use: it needs Node's http/https, which only the desktop app
// has, and the bundle loads on phones too (this module is off there).
const nodeRequest = (options: RequestOptions) => import("./request").then(m => m.nodeRequest(options));

const ruleName = (rule: Rule) => (rule.id === "wechat-video" ? t("hotlink.ruleWechatVideo") : rule.name);
const refusedMessage = (rule: Rule, attempts: number, status: number) =>
	t("hotlink.fetchRefused", { rule: ruleName(rule), attempts, status });

export default class HotlinkMediaPlugin extends ModulePlugin {
	media!: MediaController;
	private observer!: IntersectionObserver;

	async start() {
		// 滚到快看见时才去要，打开一篇有 6 个视频的笔记不会一下子全下载
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					this.observer.unobserve(e.target);
					void this.media.onVisible(e.target);
				}
			},
			{ rootMargin: "400px" },
		);

		this.media = new MediaController({
			fetch: (url, rule, pageUrl) => fetchMedia(url, rule, { pageUrl, request: nodeRequest }, { refusedMessage }),
			toObjectUrl: (body, type) => URL.createObjectURL(new Blob([body as BlobPart], { type: type || undefined })),
			revokeObjectUrl: (u) => URL.revokeObjectURL(u),
			observe: (el) => this.observer.observe(el),
			pageUrlOf: (path) => {
				const source: unknown = this.app.metadataCache.getCache(path)?.frontmatter?.source;
				return typeof source === "string" ? source : undefined;
			},
			warn: (...a) => console.warn(...a),
			text: {
				failed: (message) => t("hotlink.failedNote", { message }),
				join: t("hotlink.failedNoteJoin"),
				watchOriginal: t("hotlink.watchOriginal"),
			},
		});

		// 阅读视图
		this.registerMarkdownPostProcessor((el, ctx) => {
			this.media.scan(el, ctx.sourcePath);
		});
		// 实时预览
		this.registerEditorExtension(livePreview(this));
	}

	onunload() {
		this.observer?.disconnect();
		this.media?.dispose();
	}
}

/** 实时预览：编辑器每次更新后，扫一遍里面新渲染出来的媒体。 */
function livePreview(plugin: HotlinkMediaPlugin) {
	return ViewPlugin.fromClass(
		class {
			constructor(view: EditorView) {
				// 媒体组件可能在构造之后才渲染出来，推迟一拍
				queueMicrotask(() => this.scan(view));
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged) queueMicrotask(() => this.scan(u.view));
			}
			scan(view: EditorView) {
				const file = fileOf(view, plugin);
				if (file) plugin.media.scan(view.dom, file.path);
			}
		},
	);
}

/** 找到包着这个编辑器的笔记文件。 */
function fileOf(view: EditorView, plugin: HotlinkMediaPlugin): TFile | null {
	let result: TFile | null = null;
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (result || !(leaf.view instanceof MarkdownView)) return;
		const cm = (leaf.view.editor as unknown as { cm?: EditorView })?.cm;
		if (cm === view && leaf.view.file) result = leaf.view.file;
	});
	return result;
}
