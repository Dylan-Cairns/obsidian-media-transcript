import { App, Command, Component, MarkdownPostProcessor, Plugin, PluginManifest, ViewCreator } from 'obsidian';
import type { Extension } from '@codemirror/state';

/**
 * What a module needs from the plugin that hosts it: its Obsidian plugin, and
 * a place in the plugin's data.json for the module's own settings.
 */
export interface ModuleHost {
  plugin: Plugin;
  loadModuleData(key: string): Promise<unknown>;
  saveModuleData(key: string, data: unknown): Promise<void>;
}

/**
 * A feature that used to be a plugin of its own (Archive Redirect, Hotlink
 * Media, Attention), now running inside Media One.
 *
 * It offers the part of `Plugin` those plugins used, so their code runs as it
 * did: registrations go to the host plugin and are undone when it unloads,
 * events and timers belong to the module (a child component of the host), and
 * settings are kept under the module's key in the host's data.json.
 */
export abstract class ModulePlugin extends Component {
  readonly app: App;
  readonly manifest: PluginManifest;
  /** Media One itself, for what a module shares with it (the server, transcripts). */
  readonly hostPlugin: Plugin;
  /** The module's settings, shown in a section of the host's settings tab. */
  settingTab: ModuleSettingTab | null = null;

  constructor(private readonly host: ModuleHost, readonly key: string) {
    super();
    this.hostPlugin = host.plugin;
    this.app = host.plugin.app;
    this.manifest = host.plugin.manifest;
  }

  /** What the old plugin did in its (async) `onload`. */
  abstract start(): Promise<void>;

  onload(): void {
    this.start().catch(e => console.error(`[media-one] ${this.key} failed to start`, e));
  }

  addCommand(command: Command): Command {
    return this.host.plugin.addCommand(command);
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
    return this.host.plugin.addRibbonIcon(icon, title, callback);
  }

  registerView(type: string, viewCreator: ViewCreator): void {
    this.host.plugin.registerView(type, viewCreator);
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.host.plugin.registerExtensions(extensions, viewType);
  }

  registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
    return this.host.plugin.registerMarkdownPostProcessor(postProcessor, sortOrder);
  }

  registerEditorExtension(extension: Extension): void {
    this.host.plugin.registerEditorExtension(extension);
  }

  addSettingTab(tab: ModuleSettingTab): void {
    this.settingTab = tab;
  }

  loadData(): Promise<unknown> {
    return this.host.loadModuleData(this.key);
  }

  saveData(data: unknown): Promise<void> {
    return this.host.saveModuleData(this.key, data);
  }
}

/**
 * A module's settings. Shaped like `PluginSettingTab` so the old tabs work
 * unchanged, but drawn into a section of the host's tab, which sets
 * `containerEl` before calling `display()`.
 */
export class ModuleSettingTab {
  containerEl: HTMLElement = createDiv();

  constructor(public app: App, _plugin: ModulePlugin) {}

  display(): void {}

  hide(): void {}
}
