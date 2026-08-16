import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDbBucket, ensureTable } from '../functions/api/_shared/dbStore';

type Row = { key: string; value: string; updated_at: string };

/** 轻量内存版 D1：只实现 dbStore 用到的 SQL 子集，并支持按调用序号注入 batch 失败。 */
const createFakeD1 = () => {
    const tables = new Map<string, Map<string, Row>>();
    let batchCounter = 0;
    const failBatchOn = new Set<number>();

    const getTable = (name: string) => {
        let table = tables.get(name);
        if (!table) {
            table = new Map();
            tables.set(name, table);
        }
        return table;
    };

    const execOne = (sql: string, params: any[]): any => {
        let m = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+) /);
        if (m) {
            getTable(m[1]);
            return;
        }
        m = sql.match(/^INSERT OR REPLACE INTO (\w+) \(key, value, updated_at\) VALUES \(\?, \?, \?\)$/);
        if (m) {
            getTable(m[1]).set(String(params[0]), { key: String(params[0]), value: String(params[1]), updated_at: String(params[2]) });
            return;
        }
        m = sql.match(/^DELETE FROM (\w+) WHERE key = \?$/);
        if (m) {
            getTable(m[1]).delete(String(params[0]));
            return;
        }
        m = sql.match(/^SELECT key, value FROM (\w+) WHERE key = \?$/);
        if (m) {
            return getTable(m[1]).get(String(params[0])) || null;
        }
        m = sql.match(/^SELECT value FROM (\w+) WHERE key = \?$/);
        if (m) {
            const row = getTable(m[1]).get(String(params[0]));
            return row ? { value: row.value } : null;
        }
        m = sql.match(/^SELECT key, value FROM (\w+) WHERE key LIKE \?(?: AND key > \?)? ORDER BY key ASC LIMIT \?$/);
        if (m) {
            const table = getTable(m[1]);
            const prefix = String(params[0]).replace(/%$/, '');
            const cursor = params.length > 2 ? String(params[1]) : '';
            const limit = Number(params[params.length - 1]);
            const rows = Array.from(table.values())
                .filter((row) => row.key.startsWith(prefix) && row.key > cursor)
                .sort((a, b) => (a.key < b.key ? -1 : 1))
                .slice(0, limit);
            return { results: rows };
        }
        throw new Error(`fake D1 不支持的 SQL: ${sql}`);
    };

    const d1: any = {
        prepare(sql: string) {
            const makeStatement = (params: any[]): any => ({
                sql,
                params,
                bind: (...next: any[]) => makeStatement(next),
                run: async () => { execOne(sql, params); },
                first: async () => execOne(sql, params),
                all: async () => execOne(sql, params)
            });
            return makeStatement([]);
        },
        async batch(statements: any[]) {
            const index = batchCounter++;
            if (failBatchOn.has(index)) throw new Error('注入的 D1 batch 故障');
            for (const statement of statements) {
                execOne(statement.sql, statement.params);
            }
        }
    };
    d1.__failBatchOn = failBatchOn;
    d1.__tables = tables;
    d1.__resetBatchCounter = () => { batchCounter = 0; };
    return d1;
};

const KB = 1024;
// 1.15MB → 2 chunks；1.25MB → 3 chunks（chunk 上限 600KB）
const bigValue2Chunks = 'x'.repeat(1150 * KB);
const bigValue3Chunks = 'y'.repeat(1250 * KB);

describe('dbStore D1 分块存储原子性', () => {
    it('大值分块写入后 get() 能完整还原', async () => {
        const d1 = createFakeD1();
        await ensureTable(d1, 't');
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue2Chunks);
        expect(await bucket.get('k').then((o: any) => o?.text())).toBe(bigValue2Chunks);
    });

    it('覆盖为更小的分块值后，多余的旧 chunk 行被清理', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue3Chunks);
        await bucket.put('k', bigValue2Chunks);
        const table = d1.__tables.get('t');
        expect(table?.has('k::chunk-2')).toBe(false);
        expect(table?.has('k::chunk-0')).toBe(true);
        expect(await bucket.get('k').then((o: any) => o?.text())).toBe(bigValue2Chunks);
    });

    it('覆盖为单行值后，全部旧 chunk 行被清理', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue2Chunks);
        await bucket.put('k', 'small');
        const table = d1.__tables.get('t');
        expect(table?.has('k::chunk-0')).toBe(false);
        expect(table?.has('k::chunk-1')).toBe(false);
        expect(await bucket.get('k').then((o: any) => o?.text())).toBe('small');
    });

    it('核心回归：分块值覆盖写入失败时，旧值保持完整可读（不产生孤儿 manifest）', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue2Chunks);
        // 让下一次 batch（新值的写入批次）失败
        d1.__resetBatchCounter();
        d1.__failBatchOn.add(0);
        await expect(bucket.put('k', bigValue3Chunks)).rejects.toThrow('注入的 D1 batch 故障');
        // 旧值必须仍然完整可读；修复前这里会拿到 null（chunk 已被提前删除）
        expect(await bucket.get('k').then((o: any) => o?.text())).toBe(bigValue2Chunks);
    });

    it('清理多余 chunk 的批次失败不会导致 put() 报错，新值仍然生效', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue3Chunks);
        // 第 0 次 batch：3 chunk 写入（成功）；第 1 次 batch：清理 chunk-2（失败）
        d1.__resetBatchCounter();
        d1.__failBatchOn.add(1);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(bucket.put('k', bigValue2Chunks)).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
        expect(await bucket.get('k').then((o: any) => o?.text())).toBe(bigValue2Chunks);
    });

    it('孤儿 manifest（chunk 缺失）时 get() 返回 null 并记录错误日志', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue2Chunks);
        // 直接删掉一个 chunk 行模拟孤儿 manifest
        d1.__tables.get('t')?.delete('k::chunk-1');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await bucket.get('k')).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('orphan chunk manifest'));
        errorSpy.mockRestore();
    });

    it('list() 隐藏 chunk 行并支持游标分页', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('a', '1');
        await bucket.put('k', bigValue2Chunks);
        await bucket.put('z', '3');
        const listed = await bucket.list({ prefix: '' });
        expect(listed.objects.map((o: any) => o.key)).toEqual(['a', 'k', 'z']);
        expect(listed.truncated).toBe(false);
    });

    it('delete() 同时清理 manifest 与全部 chunk 行', async () => {
        const d1 = createFakeD1();
        const bucket = getDbBucket(d1, 't');
        await bucket.put('k', bigValue3Chunks);
        await bucket.delete('k');
        const table = d1.__tables.get('t');
        expect(table?.has('k')).toBe(false);
        for (let i = 0; i < 3; i++) expect(table?.has(`k::chunk-${i}`)).toBe(false);
        expect(await bucket.get('k')).toBeNull();
    });
});
