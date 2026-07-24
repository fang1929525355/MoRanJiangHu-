const TABLE_SQL = `CREATE TABLE IF NOT EXISTS apk_download_daily (
  day TEXT NOT NULL,
  version_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, version_name, provider)
)`;

const chinaDateKey = (date: Date): string => (
    new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
);

export const incrementApkDownloadCount = async (
    env: any,
    versionName: string,
    provider: string,
    now = new Date()
): Promise<void> => {
    const db = env?.DB;
    if (!db?.prepare) return;
    await db.prepare(TABLE_SQL).run();
    const updatedAt = now.toISOString();
    await db.prepare(`INSERT INTO apk_download_daily (day, version_name, provider, request_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(day, version_name, provider) DO UPDATE SET
        request_count = request_count + 1,
        updated_at = excluded.updated_at`)
        .bind(chinaDateKey(now), versionName, provider, updatedAt)
        .run();
};

export const scheduleApkDownloadCount = (input: {
    env: any;
    waitUntil?: (promise: Promise<unknown>) => void;
    method: string;
    versionName: string;
    provider: string;
    now?: Date;
}): void => {
    if (input.method.toUpperCase() !== 'GET') return;
    const promise = incrementApkDownloadCount(
        input.env,
        input.versionName,
        input.provider,
        input.now
    ).catch(() => undefined);
    input.waitUntil?.(promise);
};
