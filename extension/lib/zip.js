/* Dependency-free ZIP (STORE) writer. UTF-8 names, CRC-32, explicit empty directory
 * entries, no ZIP64 and no compression. Payloads stay as Blob parts, rather than
 * one giant JS byte array. Limits are checked before accepting each entry.
 */
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let bit = 0; bit < 8; bit++)
        n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
    return n >>> 0;
});
export function crc32(bytes, previous = 0) {
    let crc = (previous ^ 0xffffffff) >>> 0;
    for (const byte of bytes)
        crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
}
function validPath(path, directory) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\u0000-\u001f:]/.test(path))
        throw new Error('Unsafe ZIP path.');
    const parts = (directory ? path.replace(/\/$/, '') : path).split('/');
    if (parts.some(part => !part || part === '.' || part === '..'))
        throw new Error('Unsafe ZIP path.');
    return directory ? parts.join('/') + '/' : parts.join('/');
}
function dosTime(date) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}
export class ZipWriter {
    constructor({ maxBytes = 512 * 1024 ** 2, date = new Date(), shouldStop = () => false } = {}) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes >= 0xffffffff)
            throw new Error('Invalid ZIP size limit.');
        this.maxBytes = maxBytes;
        this.date = dosTime(date);
        this.shouldStop = shouldStop;
        this.parts = [];
        this.entries = [];
        this.paths = new Set();
        this.offset = 0;
        this.directoryBytes = 0;
    }
    assertRunning() { if (this.shouldStop())
        throw new Error('Stopped by user.'); }
    reserve(path, size) {
        this.assertRunning();
        const name = encoder.encode(path);
        if (name.length > 65535 || this.entries.length >= 65534)
            throw new Error('ZIP entry limit reached. Select fewer resources.');
        const overhead = 30 + name.length + 46 + name.length;
        if (this.offset + this.directoryBytes + size + overhead + 22 > this.maxBytes)
            throw new Error('ZIP size limit reached. Increase the ZIP limit or select fewer resources.');
        return name;
    }
    async add(path, value = new Blob([]), { directory = false, checksum, onBytes } = {}) {
        path = validPath(path, directory);
        if (this.paths.has(path)) {
            if (directory)
                return;
            throw new Error('Duplicate archive path; export stopped to prevent overwriting.');
        }
        const blob = directory ? new Blob([]) : value instanceof Blob ? value : new Blob([value]);
        const name = this.reserve(path, blob.size);
        let crc = checksum;
        if (crc === undefined) {
            crc = 0;
            // Bounded slices yield to the UI and the Stop button while hashing large files.
            for (let at = 0; at < blob.size; at += 256 * 1024) {
                this.assertRunning();
                const part = new Uint8Array(await blob.slice(at, at + 256 * 1024).arrayBuffer());
                crc = crc32(part, crc);
                onBytes?.(Math.min(at + part.length, blob.size));
                if (at % (8 * 1024 ** 2) === 0)
                    await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        this.assertRunning();
        const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x800, true);
        view.setUint16(10, this.date.time, true);
        view.setUint16(12, this.date.date, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, blob.size, true);
        view.setUint32(22, blob.size, true);
        view.setUint16(26, name.length, true);
        local.set(name, 30);
        this.entries.push({ name, size: blob.size, crc, offset: this.offset, directory });
        this.parts.push(local, blob);
        this.paths.add(path);
        this.offset += local.length + blob.size;
        this.directoryBytes += 46 + name.length;
        return crc;
    }
    async addDirectory(path) { return this.add(path, undefined, { directory: true }); }
    toBlob() {
        this.assertRunning();
        const central = this.entries.map(entry => {
            const bytes = new Uint8Array(46 + entry.name.length), view = new DataView(bytes.buffer);
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint16(8, 0x800, true);
            view.setUint16(12, this.date.time, true);
            view.setUint16(14, this.date.date, true);
            view.setUint32(16, entry.crc, true);
            view.setUint32(20, entry.size, true);
            view.setUint32(24, entry.size, true);
            view.setUint16(28, entry.name.length, true);
            view.setUint32(38, entry.directory ? 0x10 : 0, true);
            view.setUint32(42, entry.offset, true);
            bytes.set(entry.name, 46);
            return bytes;
        });
        const end = new Uint8Array(22), view = new DataView(end.buffer);
        view.setUint32(0, 0x06054b50, true);
        view.setUint16(8, this.entries.length, true);
        view.setUint16(10, this.entries.length, true);
        view.setUint32(12, this.directoryBytes, true);
        view.setUint32(16, this.offset, true);
        return new Blob([...this.parts, ...central, end], { type: 'application/zip' });
    }
    dispose() { this.parts = []; this.entries = []; this.paths.clear(); }
}
