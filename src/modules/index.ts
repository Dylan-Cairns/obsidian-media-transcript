import { Notice, Platform, Plugin, normalizePath } from 'obsidian';
import { ModuleHost, ModulePlugin } from './module';
import ArchiveRedirectPlugin from './archive/main';
import HotlinkMediaPlugin from './hotlink/main';
import AttentionPlugin from './attention/main';
import { t } from '../i18n';

/** A feature that was a plugin of its own before Media One took it in. */
export interface ModuleInfo {
  key: string;
  /** The id it had as a plugin: where its settings are migrated from. */
  oldId: string;
  name: string;
  desc: string;
  desktopOnly: boolean;
  /** On for a vault that never chose: annotating and playing are harmless, archiving writes files. */
  onByDefault: boolean;
  create(host: ModuleHost): ModulePlugin;
}

export const MODULES: ModuleInfo[] = [
  {
    key: 'attention',
    oldId: 'attention',
    get name() { return t('modules.annotationsName'); },
    get desc() { return t('modules.annotationsDesc'); },
    desktopOnly: false,
    onByDefault: true,
    create: host => new AttentionPlugin(host, 'attention'),
  },
  {
    key: 'archive',
    oldId: 'archive-redirect',
    get name() { return t('modules.archiveName'); },
    get desc() { return t('modules.archiveDesc'); },
    desktopOnly: false,
    onByDefault: false,
    create: host => new ArchiveRedirectPlugin(host, 'archive'),
  },
  {
    key: 'hotlink',
    oldId: 'hotlink-media',
    get name() { return t('modules.hotlinkName'); },
    get desc() { return t('modules.hotlinkDesc'); },
    desktopOnly: true,
    onByDefault: true,
    create: host => new HotlinkMediaPlugin(host, 'hotlink'),
  },
];

/** What Media One keeps for its modules in its data.json, beside its own settings. */
export interface ModuleState {
  modules: Record<string, unknown>;
  enabledModules: Record<string, boolean>;
}

interface PluginRegistry {
  enabledPlugins: Set<string>;
}

/**
 * Starts the modules that are switched on and keeps their settings.
 *
 * Switching a module on or off takes effect the next time the plugin loads:
 * what a module registers (commands, views, post processors) stays until then.
 */
export class Modules implements ModuleHost {
  readonly loaded = new Map<string, ModulePlugin>();
  /** Modules switched on that didn't start, and why. */
  readonly skipped = new Map<string, string>();

  constructor(
    readonly plugin: Plugin,
    private readonly state: ModuleState,
    private readonly persist: () => Promise<void>,
  ) {}

  async start(): Promise<void> {
    for (const info of MODULES) {
      if (!(await this.isEnabled(info))) continue;
      if (info.desktopOnly && !Platform.isDesktopApp) {
        this.skipped.set(info.key, t('modules.skipDesktopOnly'));
        continue;
      }
      if (this.oldPluginEnabled(info)) {
        // Both at once would handle every image or mark twice.
        const why = t('modules.skipOldPluginEnabled', { oldId: info.oldId });
        this.skipped.set(info.key, why);
        new Notice(t('modules.notRunningNotice', { name: info.name, why }), 15000);
        continue;
      }
      const module = info.create(this);
      this.loaded.set(info.key, module);
      this.plugin.addChild(module);
    }
  }

  async isEnabled(info: ModuleInfo): Promise<boolean> {
    const chosen = this.state.enabledModules[info.key];
    if (chosen !== undefined) return chosen;
    // Someone who used the old plugin gets the module, whatever its default.
    const on = info.onByDefault || (await this.oldDataPath(info)) !== null;
    this.state.enabledModules[info.key] = on;
    await this.persist();
    return on;
  }

  /**
   * A module's settings for another part of the plugin to change, with how to
   * keep the change: the running module's own copy, else what data.json holds.
   */
  settingsOf(key: string): { settings: Record<string, unknown> | null; save: () => Promise<void> } {
    const running: (ModulePlugin & { settings?: Record<string, unknown>; saveSettings?: () => Promise<void> }) | undefined =
      this.loaded.get(key);
    const save = running?.saveSettings?.bind(running);
    if (running?.settings && save) {
      return { settings: running.settings, save };
    }
    const stored = this.state.modules[key];
    const settings = stored && typeof stored === 'object' ? stored as Record<string, unknown> : null;
    return { settings, save: this.persist };
  }

  /** Whether the module is switched on, as last decided by `isEnabled`. */
  chosen(key: string): boolean {
    return this.state.enabledModules[key] ?? false;
  }

  async setEnabled(key: string, on: boolean): Promise<void> {
    this.state.enabledModules[key] = on;
    await this.persist();
  }

  oldPluginEnabled(info: ModuleInfo): boolean {
    const registry = (this.plugin.app as unknown as { plugins?: PluginRegistry }).plugins;
    return registry?.enabledPlugins?.has(info.oldId) ?? false;
  }

  async loadModuleData(key: string): Promise<unknown> {
    if (key in this.state.modules) return this.state.modules[key];
    // First run as a module: take over the old plugin's settings, and keep
    // them here at once so removing the old plugin loses nothing.
    const info = MODULES.find(m => m.key === key);
    const path = info ? await this.oldDataPath(info) : null;
    if (!path) return null;
    try {
      const data: unknown = JSON.parse(await this.plugin.app.vault.adapter.read(path));
      this.state.modules[key] = data;
      await this.persist();
      return data;
    } catch (e) {
      console.warn(`[media-one] could not read ${path}`, e);
      return null;
    }
  }

  async saveModuleData(key: string, data: unknown): Promise<void> {
    this.state.modules[key] = data;
    await this.persist();
  }

  private async oldDataPath(info: ModuleInfo): Promise<string | null> {
    const path = normalizePath(`${this.plugin.app.vault.configDir}/plugins/${info.oldId}/data.json`);
    return (await this.plugin.app.vault.adapter.exists(path)) ? path : null;
  }
}
