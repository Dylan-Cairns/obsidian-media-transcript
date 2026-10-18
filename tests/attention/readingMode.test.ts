// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView } from 'obsidian';
import { readingModeHighlighter, repaintReadingViews } from '../../src/modules/attention/hosts/markdown/readingMode';
import { Annotation } from '../../src/modules/attention/model';

vi.mock('obsidian', () => ({ MarkdownView: class {} }));

function annotation(id: string, quote: string, from = 0): Annotation {
  return {
    id, body: null, hits: [], reviewed: [],
    anchor: { kind: 'markdown', quote, from, to: from + quote.length, prefix: '', suffix: '' },
  };
}

// Obsidian's cross-window narrowing and DOM helpers are absent in jsdom.
function prepare(root: HTMLElement): void {
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    Object.assign(el, {
      instanceOf: (type: typeof HTMLElement) => el instanceof type,
      addClass: (name: string) => el.classList.add(name),
      toggleClass: (name: string, value: boolean) => el.classList.toggle(name, value),
    });
  }
}

function view(path: string, source: string, html: string) {
  const containerEl = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'markdown-preview-view';
  root.innerHTML = html;
  containerEl.append(root);
  document.body.append(containerEl);
  prepare(root);
  const markdownView = Object.assign(new MarkdownView(), {
    file: { path }, data: source, previewMode: { containerEl },
  });
  return { root, view: markdownView };
}

function appFor(...views: ReturnType<typeof view>[]): App {
  return { workspace: { getLeavesOfType: () => views.map(item => ({ view: item.view })) } } as unknown as App;
}

function processSection(
  el: HTMLElement, path: string, source: string, annotations: Record<string, Annotation[]>,
  lineStart = 0, lineEnd = lineStart,
): void {
  readingModeHighlighter(path => annotations[path] ?? [])(el, {
    sourcePath: path,
    getSectionInfo: () => ({ text: source, lineStart, lineEnd }),
  } as never);
}

beforeEach(() => {
  vi.stubGlobal('createSpan', ({ cls }: { cls: string }) => {
    const span = document.createElement('span');
    span.className = cls;
    return span;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('reading view repaint', () => {
  it('updates and deletes marks in both views without replacing blocks or formatting', () => {
    const a = annotation('a', 'alpha');
    const annotations = { 'host.md': [a] };
    const first = view('host.md', 'alpha beta', '<p>alpha <em>beta</em></p>');
    const second = view('host.md', 'alpha beta', '<p>alpha beta</p>');
    for (const item of [first, second]) {
      processSection(item.root.firstElementChild as HTMLElement, 'host.md', 'alpha beta', annotations);
      expect(item.root.querySelector('.at-hl')?.textContent).toBe('alpha');
    }
    const block = first.root.firstElementChild;
    const emphasis = first.root.querySelector('em');
    // The store mutates the existing annotation when it reattaches a mark.
    a.anchor = annotation('a', 'beta', 6).anchor;
    const app = appFor(first, second);
    repaintReadingViews(app, path => annotations[path] ?? []);
    for (const item of [first, second]) {
      expect(Array.from(item.root.querySelectorAll('.at-hl'), mark => mark.textContent)).toEqual(['beta']);
    }
    expect(first.root.firstElementChild).toBe(block);
    expect(first.root.querySelector('em')).toBe(emphasis);
    a.body = 'New comment';
    repaintReadingViews(app, path => annotations[path] ?? []);
    expect(first.root.querySelector('.at-hl-comment')?.textContent).toBe('beta');
    annotations['host.md'] = [];
    repaintReadingViews(app, path => annotations[path] ?? []);
    for (const item of [first, second]) expect(item.root.querySelector('.at-hl')).toBeNull();
    expect(first.root.firstElementChild).toBe(block);
    expect(first.root.querySelector('em')).toBe(emphasis);
    expect(first.root.textContent).toBe('alpha beta');
  });

  it('preserves text selection during an unchanged repaint', () => {
    const annotations = { 'host.md': [annotation('a', 'beta', 6)] };
    const host = view('host.md', 'alpha beta', '<p>alpha <em>beta</em></p>');
    processSection(host.root.firstElementChild as HTMLElement, 'host.md', 'alpha beta', annotations);
    const mark = host.root.querySelector('.at-hl');
    const range = document.createRange();
    range.selectNodeContents(mark!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    repaintReadingViews(appFor(host), path => annotations[path] ?? []);

    expect(host.root.querySelector('.at-hl')).toBe(mark);
    expect(document.getSelection()!.toString()).toBe('beta');
  });

  it('keeps nested marks scoped to their file and updates and deletes them there', () => {
    // IDs need only be unique within a file. Clearing must respect file ownership.
    const middle = annotation('shared-id', 'nested');
    const nested = annotation('shared-id', 'nested\n\npassage');
    const annotations: Record<string, Annotation[]> = { 'middle.md': [middle], 'nested.md': [nested] };
    const host = view('host.md', '![[middle]]',
      '<div class="internal-embed"><p>nested</p><div class="internal-embed"><p>nested</p><p>passage</p></div></div>');
    const [middleBlock, nestedFirst, nestedLast] = Array.from(host.root.querySelectorAll('p'));
    processSection(middleBlock, 'middle.md', 'nested\n\n![[nested]]', annotations);
    processSection(nestedFirst, 'nested.md', 'nested\n\npassage', annotations, 0);
    processSection(nestedLast, 'nested.md', 'nested\n\npassage', annotations, 2);
    const app = appFor(host);
    const provider = (path: string) => annotations[path] ?? [];
    repaintReadingViews(app, provider);
    expect(host.root.querySelectorAll('.at-hl')).toHaveLength(3);
    nested.body = 'Nested comment';
    repaintReadingViews(app, provider);
    expect(middleBlock.querySelector('.at-hl-comment')).toBeNull();
    expect(nestedFirst.querySelector('.at-hl-comment')).not.toBeNull();
    expect(nestedLast.querySelector('.at-hl-comment')).not.toBeNull();
    annotations['nested.md'] = [];
    repaintReadingViews(app, provider);
    expect(host.root.querySelectorAll('.at-hl')).toHaveLength(1);
    expect(middleBlock.querySelector('.at-hl')).not.toBeNull();
    expect(nestedFirst.textContent).toBe('nested');
    expect(nestedLast.textContent).toBe('passage');
  });

  it('paints nested sections whose annotations load after post-processing', () => {
    const annotations: Record<string, Annotation[]> = {};
    const host = view('host.md', '![[middle]]', '<div class="internal-embed"><div class="internal-embed"><p>nested</p><p>passage</p></div></div>');
    const [first, last] = Array.from(host.root.querySelectorAll('p'));
    processSection(first, 'nested.md', 'nested\n\npassage', annotations, 0);
    processSection(last, 'nested.md', 'nested\n\npassage', annotations, 2);
    annotations['nested.md'] = [annotation('nested', 'nested\n\npassage')];
    repaintReadingViews(appFor(host), path => annotations[path] ?? []);
    expect(first.querySelector('.at-hl')?.textContent).toBe('nested');
    expect(last.querySelector('.at-hl')?.textContent).toBe('passage');
  });

  it('does not paint a host annotation onto matching text in an embedded note', () => {
    const annotations: Record<string, Annotation[]> = {};
    const source = 'same\n\n![[middle]]';
    const host = view('host.md', source, '<p>same</p><div class="internal-embed"><p>same</p></div>');
    const [hostBlock, embeddedBlock] = Array.from(host.root.querySelectorAll('p'));
    processSection(hostBlock, 'host.md', source, annotations);
    processSection(embeddedBlock, 'middle.md', 'same', annotations);
    annotations['host.md'] = [annotation('host', 'same')];
    repaintReadingViews(appFor(host), path => annotations[path] ?? []);
    expect(hostBlock.querySelector('.at-hl')?.textContent).toBe('same');
    expect(embeddedBlock.querySelector('.at-hl')).toBeNull();
  });

  it('refreshes annotations changed while a section was detached', () => {
    const a = annotation('a', 'alpha');
    const annotations = { 'host.md': [a] };
    const host = view('host.md', 'alpha beta', '<p>alpha beta</p>');
    const block = host.root.querySelector('p')!;
    processSection(block, 'host.md', 'alpha beta', annotations);
    const app = appFor(host);
    block.remove();
    a.anchor = annotation('a', 'beta', 6).anchor;
    repaintReadingViews(app, path => annotations[path] ?? []);
    host.root.append(block);
    repaintReadingViews(app, path => annotations[path] ?? []);
    expect(Array.from(block.querySelectorAll('.at-hl'), mark => mark.textContent)).toEqual(['beta']);
  });

  it('moves an image mark and restores the old image tooltip', () => {
    const source = '![[old.png]]\n\n![[new.png]]';
    const a = annotation('image', '![[old.png]]');
    const annotations = { 'host.md': [a] };
    const host = view('host.md', source,
      '<p><img src="old.png" title="Old title"></p><p><img src="new.png" title="New title"></p>');
    const [oldBlock, newBlock] = Array.from(host.root.querySelectorAll('p'));
    const [oldImage, newImage] = Array.from(host.root.querySelectorAll('img'));
    processSection(oldBlock, 'host.md', source, annotations, 0);
    processSection(newBlock, 'host.md', source, annotations, 2);
    expect(oldImage.dataset.atId).toBe('image');
    a.body = 'Edited image comment';
    repaintReadingViews(appFor(host), path => annotations[path] ?? []);
    expect(oldImage.title).toBe('Edited image comment');
    a.anchor = annotation('image', '![[new.png]]', 14).anchor;
    repaintReadingViews(appFor(host), path => annotations[path] ?? []);
    expect(oldImage.dataset.atId).toBeUndefined();
    expect(oldImage.title).toBe('Old title');
    expect(newImage.dataset.atId).toBe('image');
    annotations['host.md'] = [];
    repaintReadingViews(appFor(host), path => annotations[path] ?? []);
    expect(newImage.title).toBe('New title');
    expect(newImage.dataset.atId).toBeUndefined();
  });

  it('keeps image annotations separate when a host and embed share an image and ID', () => {
    const source = '![[picture.png]]\n\n![[middle]]';
    const annotations: Record<string, Annotation[]> = {};
    const host = view('host.md', source,
      '<p><img src="picture.png" title="Host title"></p><div class="internal-embed"><p><img src="picture.png" title="Embedded title"></p></div>');
    const [hostBlock, embeddedBlock] = Array.from(host.root.querySelectorAll('p'));
    const [hostImage, embeddedImage] = Array.from(host.root.querySelectorAll('img'));
    processSection(hostBlock, 'host.md', source, annotations);
    processSection(embeddedBlock, 'middle.md', '![[picture.png]]', annotations);
    annotations['host.md'] = [{ ...annotation('same-id', '![[picture.png]]'), body: 'Host comment' }];
    annotations['middle.md'] = [{ ...annotation('same-id', '![[picture.png]]'), body: 'Embedded comment' }];
    const app = appFor(host);
    const provider = (path: string) => annotations[path] ?? [];
    repaintReadingViews(app, provider);
    expect(hostImage.title).toBe('Host comment');
    expect(embeddedImage.title).toBe('Embedded comment');
    annotations['host.md'] = [];
    repaintReadingViews(app, provider);
    expect(hostImage.title).toBe('Host title');
    expect(hostImage.dataset.atId).toBeUndefined();
    expect(embeddedImage.title).toBe('Embedded comment');
    expect(embeddedImage.dataset.atId).toBe('same-id');
  });
});
