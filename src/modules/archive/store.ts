import { Platform, type DataAdapter, type Vault } from "obsidian";
import { expandHome, isExternalPath } from "./settings.ts";

/**
 * The few file operations the archive needs. The vault adapter provides them
 * for an archive inside the vault; `fsStore` for one outside it, which the
 * vault API cannot reach.
 */
export type Store = Pick<DataAdapter, "exists" | "mkdir" | "write" | "writeBinary" | "append" | "readBinary">;

/**
 * The store that holds `path`, and the path as that store expects it; null for
 * a folder outside the vault on mobile, where there is no file system to reach it.
 */
export function storeFor(vault: Vault, path: string): { store: Store; path: string } | null {
	if (!isExternalPath(path)) return { store: vault.adapter, path };
	const node = desktopNode();
	return node ? { store: fsStore(node.fs), path: expandHome(path, node.os.homedir()) } : null;
}

/**
 * Node's fs and os, on desktop only. Loaded on first use rather than imported,
 * so the plugin still loads on mobile, where these modules don't exist.
 */
export function desktopNode(): { fs: typeof import("fs"); os: typeof import("os") } | null {
	if (!Platform.isDesktopApp) return null;
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
	return { fs: require("fs") as typeof import("fs"), os: require("os") as typeof import("os") };
}

const fsStore = ({ promises: fs }: typeof import("fs")): Store => ({
	exists: (p) => fs.access(p).then(() => true, () => false),
	mkdir: (p) => fs.mkdir(p),
	write: (p, data) => fs.writeFile(p, data),
	writeBinary: (p, data) => fs.writeFile(p, Buffer.from(data)),
	append: (p, data) => fs.appendFile(p, data),
	readBinary: async (p) => {
		const b = await fs.readFile(p);
		return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
	},
});
