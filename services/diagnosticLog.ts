import { isNativeCapacitorEnvironment } from '../utils/nativeRuntime';

export type DiagnosticLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type DiagnosticLogEntry = {
    id: string;
    level: DiagnosticLogLevel;
    time: string;
    message: string;
    detail?: string;
};

type Listener = () => void;
type PrebootLogEntry = {
    level?: DiagnosticLogLevel;
    time?: string;
    values?: unknown[];
};

const isRecoverableNetworkRejection = (reason: unknown): boolean => (
    /NetworkError when attempting to fetch resource|Failed to fetch|Load failed|The Internet connection appears to be offline|Network request failed|API Error|upstream_error|upstream_status|5\d{2}|rate_limit|bad_response_status_code/i.test(stringifyValue(reason))
);

declare global {
    interface Window {
        __MORAN_PREBOOT_LOGS__?: PrebootLogEntry[];
        __MORAN_PREBOOT_LOGS_CONSUMED__?: boolean;
    }
}

const MAX_LOGS = 500;
const PERSISTED_LOG_LIMIT = 200;
const NATIVE_PERSISTED_LOG_LIMIT = 60;
const MAX_RENDERED_VALUE_CHARS = 4000;
const MAX_MESSAGE_CHARS = 800;
const MAX_DETAIL_CHARS = 6000;
const MAX_PERSISTED_MESSAGE_CHARS = 600;
const MAX_PERSISTED_DETAIL_CHARS = 2500;
const STORAGE_KEY = 'moranjianghu.diagnosticLogs';
const logs: DiagnosticLogEntry[] = [];
const listeners = new Set<Listener>();
let installed = false;
let restoredPersistedLogs = false;

const truncateString = (value: string, maxLength: number): string => {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 20))}\n...日志内容已截断`;
};

const getPersistedLogLimit = (): number => (
    isNativeCapacitorEnvironment() ? NATIVE_PERSISTED_LOG_LIMIT : PERSISTED_LOG_LIMIT
);

const stringifyValue = (value: unknown): string => {
    if (typeof value === 'string') return truncateString(value, MAX_RENDERED_VALUE_CHARS);
    if (value instanceof Error) {
        return truncateString(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`, MAX_RENDERED_VALUE_CHARS);
    }
    try {
        return truncateString(JSON.stringify(value, null, 2), MAX_RENDERED_VALUE_CHARS);
    } catch {
        return truncateString(String(value), MAX_RENDERED_VALUE_CHARS);
    }
};

const emit = () => {
    listeners.forEach(listener => {
        try {
            listener();
        } catch {
            // Listener failures should never break the application log pipeline.
        }
    });
};

const isDiagnosticLogEntry = (value: unknown): value is DiagnosticLogEntry => {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<DiagnosticLogEntry>;
    return typeof entry.id === 'string'
        && normalizeLogLevel(entry.level) === entry.level
        && typeof entry.time === 'string'
        && typeof entry.message === 'string';
};

const sanitizeDiagnosticLogEntry = (entry: DiagnosticLogEntry, persisted = false): DiagnosticLogEntry => ({
    ...entry,
    message: truncateString(entry.message, persisted ? MAX_PERSISTED_MESSAGE_CHARS : MAX_MESSAGE_CHARS),
    detail: entry.detail
        ? truncateString(entry.detail, persisted ? MAX_PERSISTED_DETAIL_CHARS : MAX_DETAIL_CHARS)
        : undefined
});

const restorePersistedLogs = () => {
    if (restoredPersistedLogs || typeof localStorage === 'undefined') return;
    restoredPersistedLogs = true;
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return;
        logs.push(...parsed
            .filter(isDiagnosticLogEntry)
            .slice(0, getPersistedLogLimit())
            .map(entry => sanitizeDiagnosticLogEntry(entry)));
        if (logs.length > MAX_LOGS) {
            logs.length = MAX_LOGS;
        }
    } catch {
        // Ignore broken persisted logs; the live log pipeline should keep working.
    }
};

const persistLogs = () => {
    if (typeof localStorage === 'undefined') return;
    try {
        const persistedLogs = logs
            .slice(0, getPersistedLogLimit())
            .map(entry => sanitizeDiagnosticLogEntry(entry, true));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedLogs));
    } catch {
        // Ignore quota/storage failures; in-memory logs are still available.
    }
};

export const recordDiagnosticLog = (level: DiagnosticLogLevel, valuesOrFirst: unknown[] | unknown, ...restValues: unknown[]) => {
    restorePersistedLogs();
    const values = Array.isArray(valuesOrFirst) && restValues.length === 0
        ? valuesOrFirst
        : [valuesOrFirst, ...restValues];
    const rendered = values.map(stringifyValue).filter(Boolean);
    const message = truncateString(rendered[0] || '(empty log)', MAX_MESSAGE_CHARS);
    const detail = rendered.length > 1
        ? truncateString(rendered.slice(1).join('\n'), MAX_DETAIL_CHARS)
        : undefined;
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        level,
        time: new Date().toISOString(),
        message,
        detail
    };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) {
        logs.length = MAX_LOGS;
    }
    persistLogs();
    emit();
};

const normalizeLogLevel = (level: unknown): DiagnosticLogLevel => {
    return level === 'log' || level === 'info' || level === 'warn' || level === 'error' || level === 'debug'
        ? level
        : 'debug';
};

export const getDiagnosticLogs = (): DiagnosticLogEntry[] => {
    restorePersistedLogs();
    return logs.slice();
};

export const clearDiagnosticLogs = () => {
    restorePersistedLogs();
    logs.length = 0;
    persistLogs();
    emit();
};

export const subscribeDiagnosticLogs = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const installDiagnosticLogCapture = () => {
    if (installed || typeof console === 'undefined') return;
    installed = true;
    restorePersistedLogs();

    (['log', 'info', 'warn', 'error', 'debug'] as DiagnosticLogLevel[]).forEach(level => {
        const original = console[level]?.bind(console);
        if (!original) return;
        console[level] = (...args: unknown[]) => {
            recordDiagnosticLog(level, args);
            original(...args);
        };
    });

    if (typeof window !== 'undefined') {
        if (!window.__MORAN_PREBOOT_LOGS_CONSUMED__ && Array.isArray(window.__MORAN_PREBOOT_LOGS__)) {
            window.__MORAN_PREBOOT_LOGS_CONSUMED__ = true;
            window.__MORAN_PREBOOT_LOGS__.forEach(entry => {
                const values = Array.isArray(entry.values) ? entry.values : ['preboot log'];
                recordDiagnosticLog(normalizeLogLevel(entry.level), values);
            });
        }

        window.addEventListener('error', event => {
            recordDiagnosticLog('error', [
                'window.error',
                {
                    message: event.message,
                    source: event.filename,
                    line: event.lineno,
                    column: event.colno,
                    error: event.error instanceof Error ? event.error.stack || event.error.message : event.error
                }
            ]);
        });
        window.addEventListener('unhandledrejection', event => {
            if (isRecoverableNetworkRejection(event.reason)) {
                recordDiagnosticLog('warn', ['recoverable unhandledrejection', event.reason]);
                event.preventDefault();
                return;
            }
            recordDiagnosticLog('error', ['unhandledrejection', event.reason]);
        });
    }
};

installDiagnosticLogCapture();
