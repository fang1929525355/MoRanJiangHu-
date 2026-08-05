import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModeRuntimeProfile, 题材模式类型 } from '../models/system';
import type { 小说拆分数据集结构 } from '../models/novelDecomposition';
import type { 小说模式包完善记录 } from '../models/novelModePackCompletion';
import type { 当前可用接口结构 } from '../utils/apiConfig';
import {
    删除小说模式包完善记录,
    构建小说模式包数据集指纹,
    读取小说模式包完善记录,
    保存小说模式包完善记录
} from '../services/novelModePackCompletionStore';
import { 执行小说模式包逐段完善 } from '../services/novelModePackCompletionWorkflow';
import { generateNovelModePackFinalization, generateNovelModePackSegmentCompletion } from '../services/ai/storyTasks';
import { 清洗小说模式包累积草稿 } from '../services/novelDecompositionWorkshopBridge';

type Toast = { title: string; message: string; tone?: 'info' | 'success' | 'error' };

export interface 小说模式包完善界面状态 {
    primaryAction: 'start' | 'resume' | 'cancel' | 'none';
    showRestart: boolean;
    canUseDraft: boolean;
    canEditDraft: boolean;
    statusText: string;
    truncationText: string;
    progressPercent: number;
}

export const 是否允许模式包完善运行回写 = (
    activeTargetKey: string,
    runTargetKey: string,
    activeToken: number,
    runToken: number
): boolean => activeTargetKey === runTargetKey && activeToken === runToken;

export const 计算小说模式包完善界面状态 = (
    record: 小说模式包完善记录 | null,
    running: boolean,
    fingerprintMatches: boolean,
    targetReady = true
): 小说模式包完善界面状态 => {
    const total = record?.总分段数 || 0;
    const current = Math.min((record?.下一个分段索引 || 0) + 1, total);
    const latestInput = record?.当前分段ID
        ? record.分段输入记录.find((item) => item.分段ID === record.当前分段ID)
        : undefined;
    const statusText = !targetReady
        ? '正在加载模式包完善进度…'
        : !record
        ? '尚未开始逐分段完善'
        : record.状态 === 'completed'
            ? '全部分段和最终一致性整理已完成'
        : record.当前阶段 === 'finalize'
            ? (record.状态 === 'finalizing' || running ? '正在进行最终一致性整理' : '最终一致性整理已暂停，可继续完善')
            : `正在完善第 ${current} / ${total} 分段${record.当前分段标题 ? `：${record.当前分段标题}` : ''}`;
    return {
        primaryAction: !targetReady
            ? 'none'
            : running
            ? 'cancel'
            : !record
                ? 'start'
                : record.状态 === 'completed'
                    ? 'none'
                    : 'resume',
        showRestart: Boolean(record),
        canUseDraft: record?.状态 === 'completed' && fingerprintMatches,
        canEditDraft: targetReady && Boolean(record) && !running,
        statusText,
        truncationText: latestInput && !latestInput.是否完整输入 ? '本段输入已按上限截断' : '',
        progressPercent: total > 0 ? Math.round(((record?.已完成分段数 || 0) / total) * 100) : 0
    };
};

export interface UseNovelModePackCompletionResult {
    record: 小说模式包完善记录 | null;
    draft: Partial<ModeRuntimeProfile> | null;
    running: boolean;
    log: string;
    fingerprintMatches: boolean;
    uiState: 小说模式包完善界面状态;
    start: () => Promise<void>;
    resume: () => Promise<void>;
    restart: () => Promise<void>;
    updateDraft: (draft: Partial<ModeRuntimeProfile>, changedPaths: string[]) => Promise<void>;
    cancel: () => void;
}

export const useNovelModePackCompletion = (params: {
    dataset: 小说拆分数据集结构 | null;
    baseMode: 题材模式类型;
    apiConfig: 当前可用接口结构 | null | undefined;
    onNotify?: (toast: Toast) => void;
}): UseNovelModePackCompletionResult => {
    const { dataset, baseMode, apiConfig, onNotify } = params;
    const [record, setRecord] = useState<小说模式包完善记录 | null>(null);
    const [running, setRunning] = useState(false);
    const [log, setLog] = useState('');
    const [fingerprintMatches, setFingerprintMatches] = useState(true);
    const [targetReady, setTargetReady] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const targetKey = dataset ? `${dataset.id}::${baseMode}` : '';
    const targetKeyRef = useRef(targetKey);
    targetKeyRef.current = targetKey;
    const runTokenRef = useRef(0);
    const recordRef = useRef<小说模式包完善记录 | null>(null);
    const editSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const readyTargetKeyRef = useRef('');
    const readyDatasetRef = useRef<小说拆分数据集结构 | null>(null);
    const applyRecord = useCallback((next: 小说模式包完善记录 | null) => {
        recordRef.current = next;
        setRecord(next);
    }, []);
    const currentTargetReady = targetReady
        && readyTargetKeyRef.current === targetKey
        && readyDatasetRef.current === dataset;
    const activeRecord = currentTargetReady
        && record?.数据集ID === dataset?.id
        && record.题材 === baseMode
        ? record
        : null;

    useEffect(() => {
        let active = true;
        abortRef.current?.abort();
        runTokenRef.current += 1;
        setRunning(false);
        applyRecord(null);
        setFingerprintMatches(false);
        setTargetReady(false);
        readyTargetKeyRef.current = '';
        readyDatasetRef.current = null;
        if (!dataset) {
            applyRecord(null);
            setFingerprintMatches(true);
            setTargetReady(true);
            return () => { active = false; };
        }
        void Promise.all([
            读取小说模式包完善记录(dataset.id, baseMode),
            构建小说模式包数据集指纹(dataset)
        ]).then(([stored, fingerprint]) => {
            if (!active) return;
            applyRecord(stored);
            setFingerprintMatches(!stored || stored.数据集指纹 === fingerprint);
            readyTargetKeyRef.current = targetKey;
            readyDatasetRef.current = dataset;
            setTargetReady(true);
            if (stored && stored.数据集指纹 !== fingerprint) {
                setLog('小说分段内容或顺序已变化，请从头重建模式包完善任务。');
            } else {
                setLog(stored?.最近错误 || '');
            }
        }).catch((error) => {
            if (!active) return;
            setLog(error instanceof Error ? error.message : String(error));
        });
        return () => { active = false; };
    }, [applyRecord, baseMode, dataset, targetKey]);

    const execute = useCallback(async (initialRecord: 小说模式包完善记录 | null) => {
        if (!dataset || dataset.分段列表.length === 0) throw new Error('当前数据集没有可用于模式包完善的分段。');
        if (!apiConfig?.apiKey) throw new Error('请先配置小说分解 API。');
        const controller = new AbortController();
        const runTargetKey = targetKey;
        const runToken = ++runTokenRef.current;
        const canWrite = () => 是否允许模式包完善运行回写(
            targetKeyRef.current,
            runTargetKey,
            runTokenRef.current,
            runToken
        );
        abortRef.current = controller;
        setRunning(true);
        setLog(initialRecord ? '继续逐分段完善模式包…' : '开始逐分段完善模式包…');
        try {
            const next = await 执行小说模式包逐段完善({
                dataset,
                baseMode,
                initialRecord,
                signal: controller.signal,
                completeSegment: ({ dataset: currentDataset, segmentIndex, baseMode: currentMode, currentDraft, confirmedFieldPaths, signal }) => (
                    generateNovelModePackSegmentCompletion({
                        dataset: currentDataset,
                        segmentIndex,
                        baseMode: currentMode,
                        currentDraft: currentDraft as Record<string, any>,
                        confirmedFieldPaths
                    }, apiConfig, {
                        stream: true,
                        onDelta: (_delta, accumulated) => { if (canWrite()) setLog(accumulated); }
                    }, signal)
                ),
                finalize: ({ dataset: currentDataset, baseMode: currentMode, currentDraft, conflictHints, confirmedFieldPaths, signal }) => (
                    generateNovelModePackFinalization({
                        dataset: currentDataset,
                        baseMode: currentMode,
                        currentDraft: currentDraft as Record<string, any>,
                        conflictHints,
                        confirmedFieldPaths
                    }, apiConfig, {
                        stream: true,
                        onDelta: (_delta, accumulated) => { if (canWrite()) setLog(accumulated); }
                    }, signal)
                ),
                sanitize: 清洗小说模式包累积草稿,
                save: async (nextRecord) => {
                    await 保存小说模式包完善记录(nextRecord);
                    if (canWrite()) applyRecord(nextRecord);
                }
            });
            if (!canWrite()) return;
            applyRecord(next);
            setFingerprintMatches(true);
            setLog(next.状态 === 'completed' ? '全部分段和最终一致性整理已完成。' : (next.最近错误 || '任务已暂停。'));
            if (next.状态 === 'completed') {
                onNotify?.({ title: '模式包完善完成', message: '所有小说分段均已参与完善，可以生成或贡献模式包。', tone: 'success' });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (canWrite()) {
                setLog(message);
                onNotify?.({ title: '模式包完善失败', message, tone: 'error' });
            }
        } finally {
            if (canWrite()) {
                if (abortRef.current === controller) abortRef.current = null;
                setRunning(false);
            }
        }
    }, [apiConfig, applyRecord, baseMode, dataset, onNotify, targetKey]);

    const start = useCallback(async () => {
        if (!currentTargetReady) throw new Error('模式包完善进度仍在加载，请稍后重试。');
        return execute(null);
    }, [currentTargetReady, execute]);

    const resume = useCallback(async () => {
        if (!currentTargetReady) throw new Error('模式包完善进度仍在加载，请稍后重试。');
        if (!activeRecord) return execute(null);
        if (!fingerprintMatches) throw new Error('小说分段内容或顺序已变化，请从头重建。');
        if (activeRecord.状态 === 'completed') return;
        return execute(activeRecord);
    }, [activeRecord, currentTargetReady, execute, fingerprintMatches]);

    const restart = useCallback(async () => {
        if (!dataset) return;
        abortRef.current?.abort();
        runTokenRef.current += 1;
        await 删除小说模式包完善记录(dataset.id, baseMode);
        applyRecord(null);
        setFingerprintMatches(true);
        await execute(null);
    }, [applyRecord, baseMode, dataset, execute]);

    const updateDraft = useCallback(async (
        draft: Partial<ModeRuntimeProfile>,
        changedPaths: string[]
    ) => {
        if (running) throw new Error('AI 请求执行中不能编辑草稿，请先取消或等待当前分段完成。');
        const currentRecord = recordRef.current;
        if (!currentRecord) throw new Error('尚无可编辑的模式包草稿。');
        if (currentRecord.数据集ID !== dataset?.id || currentRecord.题材 !== baseMode) {
            throw new Error('当前模式包完善记录仍在加载，请稍后重试。');
        }
        const next = {
            ...currentRecord,
            当前草稿: draft,
            用户确认字段路径: Array.from(new Set([...currentRecord.用户确认字段路径, ...changedPaths.filter(Boolean)])),
            updatedAt: Date.now()
        };
        applyRecord(next);
        const saveTargetKey = `${next.数据集ID}::${next.题材}`;
        editSaveQueueRef.current = editSaveQueueRef.current
            .catch(() => undefined)
            .then(async () => {
                await 保存小说模式包完善记录(next);
                if (targetKeyRef.current !== saveTargetKey) return;
            });
        await editSaveQueueRef.current;
    }, [applyRecord, baseMode, dataset?.id, running]);

    const cancel = useCallback(() => abortRef.current?.abort(), []);
    const uiState = useMemo(
        () => 计算小说模式包完善界面状态(activeRecord, running, fingerprintMatches, currentTargetReady),
        [activeRecord, currentTargetReady, fingerprintMatches, running]
    );

    return {
        record: activeRecord,
        draft: activeRecord?.当前草稿 || null,
        running,
        log,
        fingerprintMatches,
        uiState,
        start,
        resume,
        restart,
        updateDraft,
        cancel
    };
};
