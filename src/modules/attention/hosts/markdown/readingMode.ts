import { App, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { Annotation } from '../../model';
import { Provider } from './decorations';
import { paintQuote } from '../paintQuote';
import { strip } from '../../anchor/plainText';
import { clearImageMark, paintImages } from '../paintImage';
import { asEl, asImg } from '../../dom';
import { resolveMarkdown } from '../../anchor/resolveAnchor';
import { Range, intersect, lineStarts, rangeOfLines } from '../../anchor/lines';

/**
 * Highlights for reading mode.
 *
 * Reading mode renders markdown to HTML, and a mark is not in the file, so
 * there is nothing for Obsidian to render — the words have to be wrapped after
 * the fact. What matters is how the right words are found.
 *
 * Not by looking for them. Searching the rendered text for a quote and taking
 * the nth match makes the answer depend on everything else Obsidian happens to
 * draw: the editor layer behind the reading layer, the properties table, the
 * frontmatter block, whichever paragraphs have been rendered so far. Each of
 * those has, at some point, made a mark land in the wrong place or nowhere.
 *
 * Instead Obsidian is asked directly. A post-processor is told which lines of
 * the file the block it is handed came from, which is the one fact that ties
 * the two together, and it does not change with scrolling or settings. A mark
 * knows its own range in the source; the block that holds it paints the part
 * that falls inside it. A mark spanning four paragraphs is simply four blocks
 * each painting their own slice, with nothing to coordinate.
 *
 * The line range is remembered on the element, because only the post-processor
 * is told it — everything that repaints later reads it back from there.
 */

const LINES = 'atLines';
const sections = new WeakMap<HTMLElement, { source: string; signature: string }>();

export function readingModeHighlighter(provider: Provider) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const info = ctx.getSectionInfo(el);
    if (info) el.dataset[LINES] = `${info.lineStart},${info.lineEnd}`;
    // Record empty and embedded sections too: their annotations may load later.
    el.dataset.atSource = ctx.sourcePath;
    sections.set(el, { source: info?.text ?? '', signature: '' });
    paintSection(el, readingMarks(info?.text ?? '', provider(ctx.sourcePath)));
  };
}

/**
 * Paint the blocks of every reading view on screen.
 *
 * For repaints that happen outside rendering — a mark added, the layout
 * settling, a section scrolled back into view — where there is no context to
 * ask, only what the post-processor left behind.
 */
export function repaintReadingViews(app: App, provider: Provider): void {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) continue;
    // The reading layer by name: the first `.markdown-preview-view` under
    // `contentEl` is a transclusion the editor layer has drawn, whenever the
    // note has one.
    const container = asEl(view.previewMode.containerEl.querySelector(':scope > .markdown-preview-view'));
    if (!container) continue;

    // Resolve each file once per view. Embedded sections retain their own source.
    const files = new Map<string, ReturnType<typeof readingMarks>>();
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-at-source]'))) {
      const section = sections.get(el);
      if (!section) continue;
      const path = el.dataset.atSource!;
      let marks = files.get(path);
      if (!marks) {
        marks = readingMarks(path === view.file.path ? view.data : section.source, provider(path));
        files.set(path, marks);
      }
      paintSection(el, marks);
    }
  }
}

/** Only drawing inputs matter; review history does not change the marks. */
function readingMarks(source: string, annotations: readonly Annotation[]) {
  return {
    source, annotations, starts: annotations.length ? lineStarts(source) : [], placed: place(source, annotations),
    signature: JSON.stringify(annotations.map(a => [a.id, a.anchor, a.body])),
  };
}

/** Clear stale marks, preserving selection during unchanged scroll repaints. */
function paintSection(el: HTMLElement, marks: ReturnType<typeof readingMarks>): void {
  const section = sections.get(el)!;
  if (section.signature !== marks.signature || section.source !== marks.source) {
    for (const mark of Array.from(el.querySelectorAll<HTMLElement>('.at-hl[data-at-id], img.at-img[data-at-id]'))) {
      if (mark.closest('[data-at-source]') !== el) continue;
      const image = asImg(mark);
      if (image) clearImageMark(image);
      else mark.replaceWith(...Array.from(mark.childNodes));
    }
    section.signature = marks.signature;
    section.source = marks.source;
  }
  paintImages(el, marks.annotations);
  paintPlaced(el, marks.source, marks.starts, marks.placed);
}

interface Placed {
  annotation: Annotation;
  at: Range;
}

/** Where each mark currently sits in the source, dropping the ones that don't. */
function place(source: string, annotations: readonly Annotation[]): Placed[] {
  const placed: Placed[] = [];
  for (const a of annotations) {
    if (a.anchor.kind !== 'markdown') continue;
    const at = resolveMarkdown(source, a.anchor);
    if (at) placed.push({ annotation: a, at });
  }
  return placed;
}

/**
 * Paint the part of each mark that falls inside this block.
 *
 * The text handed to the painter is cut from the source and stripped of
 * markup, so what it looks for is what the block actually shows.
 */
function paintPlaced(
  el: HTMLElement,
  source: string,
  starts: readonly number[],
  placed: readonly Placed[],
): void {
  const lines = el.dataset[LINES]?.split(',').map(Number);
  if (!lines || lines.length !== 2 || lines.some(n => !Number.isFinite(n))) return;

  const block = rangeOfLines(source, starts, lines[0], lines[1]);
  for (const { annotation, at } of placed) {
    const piece = intersect(at, block);
    if (!piece) continue;
    paintQuote(el, annotation, strip(source.slice(piece.from, piece.to)));
  }
}
