import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { MarkdownView, TFile } from "obsidian";
import type ArchiveRedirectPlugin from "./main";
import { redirectAllMedia } from "./intercept";

/**
 * Live Preview hook.
 * CM6 ViewPlugin runs on every editor update; we walk view.dom for remote <img>/<video>/<audio>
 * and swap their src to local archive when available. Mirrors the Reading-mode interceptor.
 */
export function createLivePreviewExtension(plugin: ArchiveRedirectPlugin) {
	return ViewPlugin.fromClass(
		class {
			constructor(view: EditorView) {
				// Obsidian's image widgets may render after this constructor; defer one tick.
				queueMicrotask(() => this.redirect(view));
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					queueMicrotask(() => this.redirect(update.view));
				}
			}

			redirect(view: EditorView) {
				const file = getFileFromView(view, plugin);
				if (!file) return;
				void redirectAllMedia(view.dom, file.path, plugin.settings, plugin.app, plugin.servers);
			}
		},
	);
}

/** Find the TFile whose MarkdownView wraps the given EditorView. */
function getFileFromView(view: EditorView, plugin: ArchiveRedirectPlugin): TFile | null {
	let result: TFile | null = null;
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (result) return;
		if (!(leaf.view instanceof MarkdownView)) return;
		// MarkdownView.editor.cm holds the CodeMirror EditorView; not in public types
		const cm = (leaf.view.editor as unknown as { cm?: EditorView })?.cm;
		if (cm === view && leaf.view.file) {
			result = leaf.view.file;
		}
	});
	return result;
}
