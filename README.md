# Media One

Your vault's media in one place. Play audio and video with a **synchronized, clickable
transcript**, **highlight and comment** on notes, PDFs and transcripts, **keep the web images**
your notes link to, and **play hotlink-protected videos** clipped from WeChat articles.

Media One used to be four plugins: Media Transcript, Attention, Archive Redirect and Hotlink
Media. They are now modules of this one, and each can be switched off in
**Settings → Media One → Modules**.

| Module | What it does | Formerly | Default |
| --- | --- | --- | --- |
| [Transcripts](#transcripts) | Media player with a clickable transcript read from a subtitle file next to the media | Media Transcript | Always on |
| [Annotations](#annotations) | Highlights and comments kept in a `.anno.json` beside the file, and a review panel | Attention | On |
| [Web image archive](#web-image-archive) | Saves remote images a note embeds and shows the saved copy, from your servers or a local folder | Archive Redirect | Off (on if you used Archive Redirect) |
| [Hotlink-protected media](#hotlink-protected-media) | Plays media from sites that only serve their own pages, by sending the headers they expect (desktop only) | Hotlink Media | On |

Switching a module on or off takes effect when Media One reloads; the settings tab offers a
button for it.

## Coming from the separate plugins

1. Update Media Transcript to 2.0 (it keeps its id, `media-transcript`, so it updates in place).
2. Disable Attention, Archive Redirect and Hotlink Media. While one of them is still enabled,
   the matching module stays off and Media One says so, so nothing is handled twice.
3. Reload Media One. Each module takes over its old plugin's settings on first start; the old
   plugin's folder can then be removed.

Commands now appear under *Media One*. A hotkey bound to one of the old plugins' commands has
to be bound again.

## Network use

- **Transcripts** reads media from the servers you list under *Remote media URLs*, if any.
- **Web image archive** downloads the remote images (and video/audio) your notes embed, and
  uploads them to the WebDAV servers you list as sources, if any.
- **Hotlink-protected media** fetches media that matches one of its rules from the media's own
  host, and the original article when a rule needs a fresh URL.

Nothing else is requested. No data about you or your vault is sent anywhere, and there is no
telemetry.

## Transcripts

Play video/audio inside Obsidian with a **synchronized, clickable transcript** read from
a same-named subtitle file next to the media. Click any line to seek; the playing line
auto-highlights and scrolls into view.

> This is a **transcript player, not a transcriber** — it does not do speech-to-text.
> Transcripts are produced by external tools; drop a `.json` / `.srt` / `.vtt` next to
> your media and it just works.

### Features

- Opens `.mp4 / .m4a / .mp3 / …` and automatically loads a **same-named subtitle** in the
  same folder (`.json` / `.srt` / `.vtt`). If none exists, it shows a hint and does nothing else.
- **Video**: side-by-side layout — a large player on the left, transcript on the right, with a
  **draggable divider** (the ratio is remembered).
- **Audio**: a slim top control bar (title + player + speed) with a full-width transcript.
- **Playback speed** `0.75×–2×` (video and audio).
- **Click to seek, auto-highlight**: click a line to seek and play; the current line highlights.
- **Auto-scroll keeps the playing line centered** — not stuck at the bottom edge. Scrolling by
  hand pauses it for a few seconds so you can read ahead; click a line to resume immediately.
- **Adjustable transcript text size** — `A−` / `A+` in the transcript toolbar, or the slider in
  settings (10–32 px, remembered).
- **Search the transcript** — type in the search box to highlight every match; `n/m` counter with
  `↑` / `↓` (or `Enter` / `Shift+Enter`) to step through them, `Esc` to clear. Searching jumps
  forward from the line currently playing, and works for CJK text. The *Search transcript*
  command focuses the box, so you can bind a hotkey to it.
- **Listen to a video without the picture** — the `🎧 Audio only` button swaps the video for a slim
  audio bar and a full-width transcript, keeping playback position and speed; `🎬 Video` brings the
  picture back. Remembered across files and sessions.
- Right-click menu: play from here / copy timestamp / copy text; click a timestamp to copy it.
- **Per-speaker labels** (colored `S0` / `S1` …) when a JSON transcript has 2+ speakers.
- Export the current transcript to a Markdown note.

### Subtitle format

Place `<media-name>.<marker>.{json,srt,vtt}` next to the media, e.g. `lecture.mp4` →
`lecture.whisper.json`. JSON follows the Whisper `verbose_json` shape:

```json
{ "segments": [ { "start": 0.0, "end": 4.2, "text": "…", "speaker": 0 } ] }
```

### Settings

- **Subtitle folder** — leave empty to use each media file's own folder.
- **Subtitle priority** — order of filename `[marker]` tags when several subtitles exist.
- **Video pane width** — how much width the player takes in video mode (dragging the divider
  updates it too).
- **Transcript font size** — text size in px; the toolbar's `A−` / `A+` change the same value.
- **Auto-scroll transcript** — keep the playing line centered while playing (on by default).
- **Play videos as audio only** — same as the toolbar's `🎧` button, as a default for new views.

If a media extension is already handled by Obsidian core or another plugin, use the
**Open in Media One** file-menu item or the *Open current media file in transcript view*
command to open it in this view.

## Annotations

Record where your attention went — then run into it again.

Highlight and comment on **notes, PDFs, transcripts and subtitles**, and revisit what you
marked. Annotations live in a sidecar file next to the original; **the original file
is never modified**.

> Most annotation plugins write `==highlights==` into your notes. This one doesn't
> touch them. Most review plugins resurface whole notes, or highlights imported from
> a third-party service. This one resurfaces the passages *you* marked, wherever you
> marked them.

### Using it

Select text in a note and a small bar appears: **Mark** it, or 💬 to write a
comment. Click a picture for **Mark**, 💬 and 🔍 — zooming is still there, just no longer
the only thing a click can do. A marked picture gets a ring rather than an
underline, and behaves like any other mark from there. Turn that off in settings to capture only deliberately.

Either way, right-click a selection for the full menu:

- **Highlight** — in the default colour
- **Highlight in colour…** — pick from the palette
- **Comment…** — write a note against the passage (⌘/Ctrl+Enter saves)

Click a mark to read its comment and see every time that passage caught you;
right-click it to edit or remove.

Marking something already marked doesn't create a second mark — it records
another hit. A line that moves you three times over a year is the strongest
thing this plugin can know about you, and the panel shows it as `3×`. In editing modes these are appended to Obsidian's own context menu;
reading mode gets its own, raised only when there is something to offer.

The ribbon's highlighter icon opens the panel, which has two views of the same
annotations:

- **This note** — an outline, in document order, for finding your way around
  what you marked here
- **All** — across the vault, grouped by how long ago, with a **Resurface**
  button that brings back a handful you haven't revisited

Marks follow the note as you edit it — text inserted around them shifts them,
text typed inside them widens them. A passage deleted or replaced outright can't
be followed, so its mark is listed as **lost** rather than quietly discarded: it
keeps its words, its comment and every time it caught you, and can be re-attached
to a new selection without losing any of that.

Sort either view by document position, when it was last or first marked, or how
many times it caught you. Hovering an entry reveals buttons to mark it again, comment on it, or remove it
without going to find it first; right-click gives the full menu. The count
appears only once a passage has caught you more than once. Clicking an entry jumps to the passage and flashes it. The panel appears on its
own when you open a note that has annotations, and stays out of the way when you
open one that doesn't.

### Opening notes in reading mode

Off by default; turn it on under **How notes open**.

Marks live beside the note rather than in it, so reading mode costs nothing
here — you can highlight and comment without ever leaving it. That makes it the
natural way to hold material you collected in order to read it: the note stops
inviting stray keystrokes, and nothing you do to it can be a typo.

It is *not* read-only. Obsidian has no such thing, and this doesn't invent one:
Ctrl+E still switches to editing, and the file stays writable.

- **Everything else opens as** — the vault-wide default.
- **Exceptions by folder** — somewhere you write rather than read. The deepest
  matching folder wins, so `raw` can be reading while `raw/drafts` is not.
- **Frontmatter** overrules both, using the same keys as the *Force note view
  mode* plugin, so notes already carrying them keep working:

  ```yaml
  obsidianUIMode: preview     # or: source
  obsidianEditingMode: live   # or: source
  ```

The mode is chosen when a note is opened, and only then. Press Ctrl+E to fix a
typo, glance at another tab, come back — you are still editing. Plugins that
force the mode on every activation need an "ignore open files" switch to escape
that; not reconsidering is simpler and never surprises you.

> Running a separate view-mode plugin alongside this will make them fight —
> whichever acts last wins, and the winner can change from open to open. Pick
> one.

### On a phone

Everything works, with the gestures a phone has:

- **Select text** and lift your finger — the popover appears once the selection
  stops changing, which is later than the lift, since iOS lets you drag the
  handles afterwards.
- **Press and hold** for the full menu, wherever a right-click would give you
  one: a passage, a picture, an entry in the panel.
- The panel's row actions are always visible there rather than waiting for a
  hover that will never come.

### Versus `==highlight==`

Obsidian's own highlight is markdown syntax living in the note. That makes it
sturdier than anything here — it cannot lose its anchor, because it *is* the
text — and it travels to any markdown tool. What it can't do is carry a comment,
a colour, or a date, or tell you what you marked last week; and it edits the file
to exist at all.

Timestamps use a moment format string — the same vocabulary as daily note
filenames — defaulting to `YYYY-MM-DD HH:mm:ss`. Clear it for relative times
("3 days ago"), which follow your Obsidian's language.

Marks share one colour, set in settings. Choosing a swatch every time turns
noticing something into a decision, and how often a passage caught you carries
more than which shade you picked.

Marks are drawn as an underline by default. They are meant to be many, a page of
filled blocks is unreadable, and a background fill looks exactly like
`==highlight==` — the one thing worth telling apart. Annotations carrying a
comment get a little more weight. Switch to a background fill in settings.

### Status

Working: markdown notes and the transcript panel. Marking a transcript line records the moment
it happens at, so the review panel can put you back there: clicking the entry
seeks the player and plays.

Transcript marks belong to the media file rather than to a subtitle track, and
are re-found by timestamp and quote, so re-transcribing with a different engine
doesn't orphan them.

PDFs, when [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus) is
installed: select text and **Mark** or 💬 it, or use PDF++'s right-click menu,
which gains the module's items. A figure, a table or a formula has no text to
select — draw over it with PDF++'s rectangle tool, and it can be marked too; the
panel shows the region itself. PDF++ does the selecting and drawing, so marks sit
exactly where its own highlights would at any zoom; Media One keeps its record in
`x.pdf.anno.json`, and the PDF is never modified. Many PDFs store Chinese as
look-alike radicals (`⼒` for 力); quotes are shown, copied and searched as the
ordinary characters.

See [`docs/attention-architecture.md`](docs/attention-architecture.md) for the design and what's
still open.

### How it stores things

```
lecture.mp4              ← never touched
lecture.mp4.anno.json    ← your highlights and comments
周报.md                   ← never touched
周报.md.anno.json
```

One sidecar per annotated file, named after the target's full filename. Portable
(move the media, take the annotations), sync-friendly (a conflict touches one file,
not your whole library), and readable.

A highlight and a comment are the same thing — a comment is just an annotation with
a body — so they share one file and one anchor.

### Review

Not spaced repetition. The goal isn't to *memorise* a passage, it's to *run into it
again*, so there's nothing to grade:

- **Time buckets** — today / this week / this month / earlier
- **Resurface** — a random handful, preferring what you haven't revisited

## Web image archive

Archive remote URLs referenced in your markdown to a local cache, and transparently serve the cache when the note is rendered. Defends your vault against link rot without rewriting any markdown.

### The problem

Notes that quote articles, tweets, or research often embed remote images, video, or audio:

```markdown
![](https://mmbiz.qpic.cn/.../abc.jpg)
![](https://pbs.twimg.com/media/XYZ.png?name=orig)
```

When the original host disappears (the WeChat account is deleted, the tweet is removed, the CDN expires the URL), every embed in your vault silently breaks. The note still reads, but the visual context is gone.

### What it does

For every remote `<img>`, `<video>`, `<audio>` it encounters:

1. **Archives** the file under a content-addressed path (SHA1 of the URL). Two storage modes are supported:
   - **Sibling** (default): `<mdDir>/_archive/<sha1>.<ext>` — one folder per markdown's directory, notes stay self-contained.
   - **Central**: `<centralPath>/<bucket>/<sha1>.<ext>` — a single shared folder, bucketed by the first 2 hex chars of the SHA1 (256 buckets). True global dedup; cache survives moving the markdown. The folder can be vault-relative or an absolute path outside the vault (e.g. `~/Media/_archive`).
2. **Redirects** the rendered element's `src` to an archived copy at display time — in both Reading mode and Live Preview. Copies come from an ordered list of **sources**: the local archive, plus any number of your own WebDAV servers (same `<bucket>/<sha1>.<ext>` layout). A copy that fails to load hands over to the next, and the remote URL is the last resort.
3. **Shares the archive through your servers.** A new download is saved locally and uploaded to every server; a server that can't be reached gets it once it's back. A file another device already put on a server is copied from there instead of the original URL — so every device ends up with the same archive.
4. **Works on mobile too.** On a phone or tablet the servers are the archive: copies are read from them, and new downloads are uploaded straight to them (a local folder outside the vault exists only on desktop; one inside the vault works everywhere).
5. **Leaves the markdown file untouched.** The URL in your `.md` never changes. If you later view the file outside Obsidian, share it, or Media One is uninstalled, the remote URL still works as a fallback.

The archive is content-addressed by URL hash, so the same URL appearing in multiple notes is stored once (sibling mode dedups per folder; central mode dedups across the whole vault).

### How it works

```
┌──────────────────────────┐
│  ![](https://remote.url) │   ← markdown stays as-is
└──────────┬───────────────┘
           │
           ▼
   ┌──────────────────────────────────────┐
   │  Scanner extracts URLs               │
   │  Policy decides which to archive     │   ← domain rules + media extension
   │  Downloader fetches with retry       │
   │  File saved at _archive/<sha1>.<ext> │
   └──────────────────────────────────────┘
           │
           ▼
   ┌──────────────────────────────────────┐
   │  At render time:                     │
   │  resolve(url) → server / local copy  │   ← Reading + Live Preview
   │  try them in Load order, then remote │
   └──────────────────────────────────────┘
```

### Triggers

The plugin archives in three ways:

- **On file modify**: when you edit a markdown file, new remote URLs in it are queued for download.
- **Manual scan**: command `Scan vault & archive remote resources` walks every markdown file in scope.
- **No render-time downloads.** Display only swaps to local if the archive already exists.

### Settings

| Setting | Default | Purpose |
|---|---|---|
| Archive mode | `Sibling` | `Sibling` = per-note folder; `Central` = one shared vault-relative folder with hash bucketing. |
| Archive directory name *(sibling)* | `_archive` | Subfolder name (sibling to each `.md`) that holds cached files. |
| Central archive path *(central)* | `_archive` | Folder that holds all cached files, bucketed by hash prefix: vault-relative, or an absolute / `~/` path outside the vault. Migrate and reconcile work only inside the vault. |
| Sources | Local archive | Ordered list of where copies are read from: the local archive and WebDAV servers (e.g. `https://host.ts.net/dav/archive`, readable and writable). Each server is checked once, then every 5 min (30 s while unreachable); one that's down is skipped. The local archive always stays in the list. |
| Waiting to upload | — | Shown when files couldn't reach a server yet; they're retried when it answers and every 10 min, or with **Upload now**. |
| Auto-archive on file modify | on | If off, only the manual scan command triggers downloads. |
| Included paths | (empty = whole vault) | Newline-separated vault paths to operate on. Example: `raw/wechat`. |

### Domain policies

Built-in rules in `policies.ts`:

| Domain | Action | Notes |
|---|---|---|
| `mmbiz.qpic.cn`, `res.wx.qq.com`, `mmbiz.qlogo.cn` | archive | WeChat — requires `Referer: https://mp.weixin.qq.com/` |
| `pbs.twimg.com` | archive | Twitter / X images |
| `video.twimg.com` | **skip** | Twitter videos are large and the CDN is long-term stable |
| `youtube.com`, `youtu.be`, `vimeo.com` | skip | stream-only |
| (anything else) | archive only if URL has a media extension (`.jpg`/`.png`/`.mp4`/…) | prevents accidentally fetching HTML page URLs |

### Failure handling

- 3 attempts with `[0, 1s, 3s]` backoff.
- 15 second timeout per request.
- `http://` URLs are automatically upgraded to `https://` (Obsidian's `requestUrl` does not accept cleartext HTTP).
- Permanent statuses (400 / 401 / 403 / 404 / 410 / 451) skip retry.
- Failed downloads append a JSONL entry to `<archive>/.failed.jsonl` with URL, error, and timestamp.

### ⚠️ Do NOT combine with attachment-cleanup plugins

The archive **never modifies your markdown**. The URL in your `.md` stays
remote; the local cache is swapped in only at render time, via the rendered
`<img>` / `<video>` / `<audio>` element's `src` attribute.

This means **third-party "remove orphaned attachments" plugins cannot see that
the local cache is in use** — they scan for markdown `![]()` or `[[wikilink]]`
references, not HTML `src` attributes. They will flag every file in `_archive/`
as orphaned and may delete the entire folder, **including content whose source
URLs are already dead and unrecoverable.**

Known dangerous combinations (verified via GitHub issues — 450-image vault wipes
have happened in the wild):

- **`oz-clear-unused-images`** — repeated reports of mass deletion of HTML-referenced images.
- **`Local Images Plus`** "Remove orphaned attachments" / "(Plugin folder)" commands.
- Any "garbage-collect unused attachments" tool.

Mitigations the archive ships with:

- A marker file `.archive-redirect-managed` is written into every archive folder
  with a warning. Some cleanup plugins respect such markers; most do not.
- This warning, prominently in the README.

**Your responsibility**: either uninstall the cleanup tool while Archive
Redirect is active, or configure it to exclude your archive folder.

### Multi-device & sync

The archive is designed to behave well across multiple devices that share the same vault via iCloud Drive / Obsidian Sync / Dropbox / Syncthing. URLs are hashed to deterministic paths, settings live in `<vault>/.obsidian/plugins/media-transcript/data.json` (which syncs), and the local cache itself is stored inside the vault — so a file fetched on one device naturally appears on all of them after sync.

That said, real-world sync introduces a handful of caveats worth knowing:

#### Caveats

- **iCloud Drive "Optimize Mac Storage"**: by default, iCloud may keep only file metadata locally and download the bytes on first access. The plugin checks `vault.adapter.exists(path)` which sees the metadata and treats the file as present — but the rendered `<img>` then shows a brief blank while iCloud streams the actual bytes in. Mitigation: in the Finder, right-click `_archive/` → **Download Now**, or disable "Optimize Mac Storage" entirely.
- **Concurrent migration on two devices** is the most dangerous case. If you run **Migrate sibling archives to central** on two devices at the same time, iCloud will reconcile by creating `.icloud-conflict-*` siblings. No data is lost, but you get a mess to clean up. **Run migration on one device, wait for sync to finish, then verify on the other.**
- **Plugin version skew**: if device A is on v0.5.0+ and uses central mode while device B is still on v0.4.x, B's resolver still looks for files in sibling `_archive/` folders that A has emptied. B's notes will silently fall back to remote URLs and stay slower. **Update the plugin on every device before switching to central mode.**
- **Settings drift before sync settles**: if you change `centralArchivePath` on one device and immediately start using the new path on another (before `data.json` has propagated), the two devices will write to different folders. The new `Reconcile stale central archive folders` command (v0.5.1+) detects this by scanning for the `.archive-redirect-managed` marker file outside the current central path and offers to merge.
- **Same-URL race during sync delay**: device A finishes a download just as device B opens the same note. B may not yet see A's file (sync still propagating) and will re-fetch. No data problem — just duplicate network traffic. The plugin is fully idempotent: same URL → same hash → same byte content, so a duplicate write produces a binary-equal file.

#### Recommended setup

1. Install Media One and switch on the archive on **every** device before switching any device to central mode.
2. Run **Migrate sibling archives to central** on **one** device only. Wait for sync to settle (watch the iCloud icon in the menu bar) before touching the other devices.
3. If you use iCloud Drive and want fully offline access to cached media, set `_archive/` (or your central path) to **Always Keep Downloaded** in Finder.
4. If you ever see two folders both containing `.archive-redirect-managed`, run **Reconcile stale central archive folders** from the command palette — it will move the orphan into the current central path.

## Hotlink-protected media

Play hotlink-protected videos, audio and images in your notes.

### The problem

Many sites only serve their media to requests that come from their own pages: the server checks the `Referer` header. In a browser, reading the original article, the Referer is the site itself, so the video plays. Put the same URL in an Obsidian note and the Referer becomes `app://obsidian.md`. The server answers **HTTP 403** and you get a black box that never plays.

A typical case is a WeChat Official Account article (`mp.weixin.qq.com`) clipped into Obsidian: the note keeps the `<video>` tags, but every video is blocked.

Obsidian does not let plugins rewrite request headers globally, so the usual fix is not available.

### What it does

For each `<video>`, `<audio>`, `<img>` or `<source>` in a rendered note whose URL matches one of its rules, it:

1. **Takes over the element**: moves the URL aside so Obsidian doesn't request it and fail.
2. **Fetches the file itself when the element scrolls near the viewport**, sending the headers the source site expects.
3. **Hands the file to the element as a `blob:` URL.** Nothing is written to your vault; the file lives in memory until the note is closed.
4. If a site's rule knows how, **gets a fresh URL when the old one is rejected** and retries.
5. If it still fails, shows a short note under the media with a link to the original page.

URLs that match no rule are never touched. Your markdown is never modified.

Works in Reading view and Live Preview.

### Supported sites

| Rule | Handles | How |
|---|---|---|
| WeChat Official Account videos | `mpvideo.qpic.cn` | Sends `Referer: https://mp.weixin.qq.com/` and a browser User-Agent. When rejected, re-fetches the original article (the note's `source` frontmatter field), finds the same video's fresh URL, and retries, up to 4 attempts. |

Measured on 2026-10-04: the same WeChat video URL works only part of the time (3 out of 8 checks over two hours, one every 15 minutes), while re-fetching the article always yields working URLs. That is why the rule refreshes and retries rather than giving up on the first 403.

### Desktop only

Requests use Node's built-in `http`/`https` modules instead of `fetch` or `requestUrl`: browsers
forbid setting `Referer` by hand, and Electron's network stack does not reliably send it either.
So this module runs in the desktop app only; on a phone it stays off.

### Adding a site

Add an entry to `RULES` in `src/modules/hotlink/rules.ts`:

```ts
{
	id: "example",
	name: "Example images",
	match: /^https:\/\/img\.example\.com\//,          // which media URLs this rule handles
	headers: { Referer: "https://www.example.com/" }, // headers to send
	// refresh: optional, how to get a fresh URL when the old one is rejected
}
```

### Notes

- A file is downloaded in full before it plays, so long videos take a few seconds to start.
- The same file shown in both Reading view and Live Preview is downloaded once.
- Files are fetched only when they scroll within 400px of the viewport, so a note with many videos does not download them all on open.

## Installation

### Via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Command palette → `BRAT: Add a beta plugin for testing`.
3. Enter `semsevens/obsidian-media-transcript`.
4. Enable **Media One** in Community plugins.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/semsevens/obsidian-media-transcript/releases) into
`<vault>/.obsidian/plugins/media-transcript/`, then enable the plugin.

### From source

```bash
npm install
npm run build
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/media-transcript/
```

## Development

```bash
npm install
npm test        # vitest suites, then the node:test suites of the web image archive and hotlink modules
npm run build   # typecheck, test, bundle main.js
```

Each module lives in `src/modules/<name>/`; `src/modules/module.ts` is the small adapter that
lets code written as a separate plugin run inside Media One.

## License

MIT
