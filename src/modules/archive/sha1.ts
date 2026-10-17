/**
 * SHA-1 hex digest of a string's UTF-8 bytes, in plain JS so it runs on mobile
 * (no Node `crypto`) and synchronously (Web Crypto is async). It must match
 * `createHash("sha1").update(s).digest("hex")`: archive file names, and the
 * files already archived, depend on it.
 */
export function sha1Hex(s: string): string {
	const bytes = new TextEncoder().encode(s);
	const bitLen = bytes.length * 8;
	// Pad: 0x80, zeros, then the bit length as a 64-bit big-endian number.
	const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
	view.setUint32(padded.length - 4, bitLen >>> 0);

	let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
	const w = new Uint32Array(80);
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
		for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
		let a = h0, b = h1, c = h2, d = h3, e = h4;
		for (let i = 0; i < 80; i++) {
			const [f, k] =
				i < 20 ? [(b & c) | (~b & d), 0x5a827999]
				: i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
				: i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
				: [b ^ c ^ d, 0xca62c1d6];
			const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
			e = d;
			d = c;
			c = rotl(b, 30);
			b = a;
			a = t;
		}
		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}
	return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, "0")).join("");
}

function rotl(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0;
}
