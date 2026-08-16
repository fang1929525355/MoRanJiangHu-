// D1-backed storage that mimics the R2 bucket API surface.
// Existing code that calls bucket.get/put/list/delete works unchanged
// after swapping getBucket(env) → getDbBucket(env, 'table_name').
//
// Large values that exceed D1's per-row TEXT limit (~750KB–1MB) are
// automatically split into multiple chunk rows. The original key stores
// a lightweight manifest pointing to the chunk rows; `get()` transparently
// reassembles the complete value. This is invisible to callers.
//
// D1 db.batch() has a hard limit of 100 statements per call.
// When a chunked write or delete produces more statements than the limit,
// they are split into multiple sequential batch() calls automatically.

export type R2LikeBucket = {
    get: (key: string) => Promise<R2LikeObject | null>;
    put: (key: string, value: any, options?: any) => Promise<void>;
    list: (options: { prefix?: string; cursor?: string; limit?: number }) => Promise<R2LikeListResult>;
    delete: (key: string) => Promise<void>;
};

export type R2LikeObject = {
    key: string;
    json: <T = any>() => Promise<T>;
    text: () => Promise<string>;
    body: ReadableStream | null;
    size: number;
};

export type R2LikeListResult = {
    objects: R2LikeObject[];
    truncated: boolean;
    cursor?: string;
};

// ---------------------------------------------------------------------------
// Chunking constants & helpers
// ---------------------------------------------------------------------------

/** D1 db.batch() has a hard limit of 100 statements per call. */
const D1_BATCH_LIMIT = 100;

/** Values larger than this (in UTF-8 bytes) get split into chunk rows. */
const D1_CHUNK_THRESHOLD = 700 * 1024; // 700 KB

/** Each chunk row stores at most this many UTF-8 bytes. */
const D1_CHUNK_SIZE = 600 * 1024; // 600 KB

/** Suffix pattern for chunk row keys: `<originalKey>::chunk-<0-based-index>` */
const CHUNK_KEY_SUFFIX_RE = /::chunk-\d+$/;

/** Internal manifest shape stored in the original key row when data is chunked. */
type ChunkManifest = {
    /** Sentinel — if present & true, this row is a manifest, not the real data. */
    _chunked: true;
    /** Number of chunk rows that follow. */
    chunks: number;
    /** Original value size in UTF-8 bytes (for verification). */
    totalSize: number;
};

const isChunkManifest = (raw: string): ChunkManifest | null => {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed._chunked === true && typeof parsed.chunks === 'number') {
            return parsed as ChunkManifest;
        }
    } catch { /* not JSON or not a manifest */ }
    return null;
};

const chunkKey = (baseKey: string, index: number): string =>
    `${baseKey}::chunk-${index}`;

const isChunkKey = (key: string): boolean =>
    CHUNK_KEY_SUFFIX_RE.test(key);

/** Compute the UTF-8 byte length of a string without allocating a full buffer. */
const utf8ByteLength = (text: string): number => {
    // Fast path for pure ASCII
    if (/^[\x00-\x7F]*$/.test(text)) return text.length;
    return new TextEncoder().encode(text).length;
};

/**
 * Split a string into multiple slices, each ≤ maxBytes UTF-8 bytes.
 * Tries to avoid splitting in the middle of a multi-byte character.
 */
const splitByUtf8Bytes = (text: string, maxBytes: number): string[] => {
    const chunks: string[] = [];
    const encoder = new TextEncoder();
    const totalLen = text.length;
    let offset = 0;

    while (offset < totalLen) {
        // Binary search for the longest safe slice ≤ maxBytes.
        let lo = offset;
        let hi = totalLen;
        let bestEnd = offset + 1; // at least 1 char

        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const byteLen = encoder.encode(text.slice(offset, mid)).length;
            if (byteLen <= maxBytes) {
                bestEnd = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        chunks.push(text.slice(offset, bestEnd));
        offset = bestEnd;
    }

    return chunks;
};

/**
 * Execute an array of prepared D1 statements, automatically splitting
 * into multiple db.batch() calls to stay under the D1_BATCH_LIMIT (100).
 */
const batchAll = async (db: any, statements: any[]): Promise<void> => {
    if (statements.length === 0) return;
    if (statements.length <= D1_BATCH_LIMIT) {
        await db.batch(statements);
        return;
    }
    for (let offset = 0; offset < statements.length; offset += D1_BATCH_LIMIT) {
        const slice = statements.slice(offset, offset + D1_BATCH_LIMIT);
        await db.batch(slice);
    }
};

// ---------------------------------------------------------------------------
// Table bootstrap
// ---------------------------------------------------------------------------

/**
 * Creates a D1 table for key-value storage if it doesn't exist.
 * Must be called once per table before first use.
 */
export const ensureTable = async (db: any, tableName: string): Promise<void> => {
    await db.prepare(
        `CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`
    ).run();
};

// ---------------------------------------------------------------------------
// R2-like bucket backed by D1 with transparent chunking
// ---------------------------------------------------------------------------

/**
 * Returns an R2-like bucket backed by D1.
 * Drop-in replacement for getBucket(env) in existing feature code.
 *
 * Large values (exceeding ~700 KB UTF-8) are automatically split across
 * multiple rows using a `{key}::chunk-{i}` naming convention. Callers
 * never see the chunks — `get()` reassembles, `delete()` cleans them up,
 * `list()` hides them.
 *
 * When the number of chunk rows exceeds D1's batch limit of 100,
 * writes and deletes are split into multiple sequential batch() calls.
 */
export const getDbBucket = (db: any, tableName: string): R2LikeBucket => {
    return {
        // -----------------------------------------------------------------
        // GET
        // -----------------------------------------------------------------
        get: async (key: string): Promise<R2LikeObject | null> => {
            await ensureTable(db, tableName);
            const row: any = await db.prepare(
                `SELECT key, value FROM ${tableName} WHERE key = ?`
            ).bind(key).first();
            if (!row) return null;

            let raw = row.value || '';

            // Check if the row is a chunk manifest.
            const manifest = isChunkManifest(raw);
            if (manifest) {
                // Reassemble from chunk rows.
                const parts: string[] = [];
                for (let i = 0; i < manifest.chunks; i++) {
                    const chunkRow: any = await db.prepare(
                        `SELECT value FROM ${tableName} WHERE key = ?`
                    ).bind(chunkKey(key, i)).first();
                    if (!chunkRow) {
                        // Missing chunk — treat as data not found rather than
                        // returning a partial/corrupt value, but surface the
                        // corruption in logs so it cannot fail silently again.
                        console.error(
                            `[dbStore] orphan chunk manifest: key=${key} is missing chunk ${i} of ${manifest.chunks}`
                        );
                        return null;
                    }
                    parts.push(chunkRow.value || '');
                }
                raw = parts.join('');
            }

            return {
                key: row.key,
                json: async <T = any>(): Promise<T> => JSON.parse(raw),
                text: async (): Promise<string> => raw,
                body: null,
                size: utf8ByteLength(raw)
            };
        },

        // -----------------------------------------------------------------
        // PUT
        // -----------------------------------------------------------------
        put: async (key: string, value: any, _options?: any): Promise<void> => {
            await ensureTable(db, tableName);
            const json = typeof value === 'string' ? value : JSON.stringify(value);
            const byteLen = utf8ByteLength(json);

            // Capture the previous chunk layout BEFORE writing. Stale chunk
            // rows are deleted AFTER the new value is durable. Deleting first
            // is unsafe: if the subsequent write fails, the manifest row
            // survives without its chunk rows and every future get() returns
            // null (orphan manifest — silently loses the whole value).
            const existingRow: any = await db.prepare(
                `SELECT value FROM ${tableName} WHERE key = ?`
            ).bind(key).first();
            const oldManifest = existingRow ? isChunkManifest(existingRow.value || '') : null;

            const chunks = byteLen > D1_CHUNK_THRESHOLD ? splitByUtf8Bytes(json, D1_CHUNK_SIZE) : null;

            if (!chunks) {
                // Fits in a single D1 row — write directly (atomically replaces
                // any previous manifest row for this key).
                await db.prepare(
                    `INSERT OR REPLACE INTO ${tableName} (key, value, updated_at) VALUES (?, ?, ?)`
                ).bind(key, json, new Date().toISOString()).run();
            } else {
                // Too large — split into chunk rows + a manifest row. All rows
                // go out in one batch call so the replacement is atomic; if
                // this fails, the previous manifest and chunks are untouched.
                const manifest: ChunkManifest = {
                    _chunked: true,
                    chunks: chunks.length,
                    totalSize: byteLen
                };
                const manifestJson = JSON.stringify(manifest);
                const now = new Date().toISOString();

                const statements: any[] = [
                    db.prepare(
                        `INSERT OR REPLACE INTO ${tableName} (key, value, updated_at) VALUES (?, ?, ?)`
                    ).bind(key, manifestJson, now)
                ];
                for (let i = 0; i < chunks.length; i++) {
                    statements.push(
                        db.prepare(
                            `INSERT OR REPLACE INTO ${tableName} (key, value, updated_at) VALUES (?, ?, ?)`
                        ).bind(chunkKey(key, i), chunks[i], now)
                    );
                }
                await batchAll(db, statements);
            }

            // Best-effort cleanup of chunk rows left over from a previous,
            // larger chunked write. Cleanup failure must NOT fail the put():
            // the new value is already durable, stale chunk rows are invisible
            // to get()/list(), and the next successful put() retries cleanup.
            if (oldManifest) {
                const staleKeys: string[] = [];
                for (let i = chunks ? chunks.length : 0; i < oldManifest.chunks; i++) {
                    staleKeys.push(chunkKey(key, i));
                }
                if (staleKeys.length > 0) {
                    try {
                        await batchAll(db, staleKeys.map((staleKey) =>
                            db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).bind(staleKey)
                        ));
                    } catch (error) {
                        console.warn(`[dbStore] stale chunk cleanup failed for key=${key}:`, error);
                    }
                }
            }
        },

        // -----------------------------------------------------------------
        // LIST
        // -----------------------------------------------------------------
        list: async (options: { prefix?: string; cursor?: string; limit?: number }): Promise<R2LikeListResult> => {
            await ensureTable(db, tableName);
            const prefix = options.prefix || '';
            const limit = Math.min(1000, Math.max(1, options.limit || 100));
            // Cursor-based pagination: cursor is the last key seen.
            let query: string;
            let binds: any[];
            if (options.cursor) {
                query = `SELECT key, value FROM ${tableName} WHERE key LIKE ? AND key > ? ORDER BY key ASC LIMIT ?`;
                binds = [`${prefix}%`, options.cursor, limit + 1];
            } else {
                query = `SELECT key, value FROM ${tableName} WHERE key LIKE ? ORDER BY key ASC LIMIT ?`;
                binds = [`${prefix}%`, limit + 1];
            }
            const rows: any = await db.prepare(query).bind(...binds).all();
            const results = (rows?.results || [])
                .map((row: any) => {
                    const raw = row.value || '';
                    return {
                        key: row.key,
                        json: async <T = any>(): Promise<T> => JSON.parse(raw),
                        text: async (): Promise<string> => raw,
                        body: null as ReadableStream | null,
                        size: utf8ByteLength(raw)
                    };
                })
                // Hide chunk rows from listing results.
                .filter((obj: any) => !isChunkKey(obj.key));
            const truncated = results.length > limit;
            const objects = truncated ? results.slice(0, limit) : results;
            return {
                objects,
                truncated,
                cursor: truncated ? objects[objects.length - 1]?.key : undefined
            };
        },

        // -----------------------------------------------------------------
        // DELETE
        // -----------------------------------------------------------------
        delete: async (key: string): Promise<void> => {
            await ensureTable(db, tableName);

            // Check if the row is a chunk manifest first.
            const row: any = await db.prepare(
                `SELECT value FROM ${tableName} WHERE key = ?`
            ).bind(key).first();
            const manifest = row ? isChunkManifest(row.value || '') : null;

            if (manifest) {
                // Delete all chunk rows + the manifest, respecting the batch limit.
                const statements: any[] = [
                    db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).bind(key)
                ];
                for (let i = 0; i < manifest.chunks; i++) {
                    statements.push(
                        db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).bind(chunkKey(key, i))
                    );
                }
                await batchAll(db, statements);
            } else {
                // Simple single-row delete.
                await db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).bind(key).run();
            }
        }
    };
};

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Convenience: get an R2-like bucket from env, returning null if D1 is not configured.
 * Use this for graceful degradation when D1 might not be available.
 */
export const tryDbBucket = (env: any, tableName: string): R2LikeBucket | null => {
    const db = env?.DB;
    if (!db || typeof db.prepare !== 'function') return null;
    return getDbBucket(db, tableName);
};
