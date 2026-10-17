/** Text shown by the core part of the plugin. Keys start with "core.". */
const en = {
  'core.mediaOne': 'Media One',
} as const;

const zh: Partial<Record<keyof typeof en, string>> = {
  'core.mediaOne': 'Media One',
};

export default { en, zh };
