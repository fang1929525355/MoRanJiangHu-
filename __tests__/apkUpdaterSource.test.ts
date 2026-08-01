import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
    testDir,
    '../android/app/src/main/java/com/moranjianghu/game/ApkUpdaterPlugin.java'
);

describe('Android APK updater source safeguards', () => {
    it('switches providers after two slow 128 KB/s windows', () => {
        const source = fs.readFileSync(sourcePath, 'utf8');

        expect(source).toContain('MIN_SPEED_BYTES_PER_SEC = 128L * 1024L');
        expect(source).toContain('SPEED_CHECK_INTERVAL_MS = 5000L');
        expect(source).toContain('MAX_SLOW_CHECKS = 2');
        expect(source).toContain('throw new SlowDownloadException');
        expect(source).toContain('if (apkFile.exists() && !apkFile.delete())');
    });
});
