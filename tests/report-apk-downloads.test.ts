import { describe, expect, it } from 'vitest';

import {
    buildDownloadReportArgs,
    buildWranglerInvocation
} from '../scripts/report-apk-downloads.mjs';

describe('APK download report Wrangler invocation', () => {
    it('runs the Wrangler JavaScript entry directly', () => {
        expect(buildWranglerInvocation(
            ['d1', 'execute'],
            'C:/Program Files/nodejs/node.exe',
            'C:/repo/node_modules/wrangler/bin/wrangler.js'
        )).toEqual({
            command: 'C:/Program Files/nodejs/node.exe',
            args: ['C:/repo/node_modules/wrangler/bin/wrangler.js', 'd1', 'execute']
        });
    });

    it('passes the report query as one structured argument', () => {
        const sql = 'SELECT day FROM apk_download_daily';
        expect(buildDownloadReportArgs(sql)).toEqual([
            'd1',
            'execute',
            'moranjianghu-db',
            '--remote',
            '--command',
            sql,
            '--json'
        ]);
    });
});
