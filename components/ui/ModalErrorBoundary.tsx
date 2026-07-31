import React from 'react';
import { isDynamicImportFetchError } from '../../utils/lazyImportWithReload';

export class ModalErrorBoundary extends React.Component<
    { children: React.ReactNode; title: string; onClose?: () => void },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        console.error('Modal render failed:', error);
    }

    render() {
        if (!this.state.error) {
            return this.props.children;
        }

        const isLazyImportError = isDynamicImportFetchError(this.state.error);
        return (
            <div className="fixed inset-0 z-[280] flex items-center justify-center bg-black/88 px-5 py-8">
                <div className="w-full max-w-md rounded-2xl border border-red-500/45 bg-[#120909] p-5 text-red-100 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
                    <div className="text-base font-semibold tracking-[0.12em] text-red-200">{this.props.title}</div>
                    <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-red-100/90">
                        {this.state.error.message || '界面渲染失败'}
                    </div>
                    <div className="mt-4 text-xs leading-5 text-red-200/70">
                        {isLazyImportError
                            ? '检测到页面资源已经更新，但当前页面还停留在旧版本。点击下面按钮刷新后，通常就能直接恢复。'
                            : '这次错误已写入运行日志。可打开"设置 → 运行日志"查看详情、复制诊断或点击"上报日志"提交给维护人员。'}
                    </div>
                    {isLazyImportError && (
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-wuxia-gold/35 bg-wuxia-gold/10 px-4 text-sm text-wuxia-gold"
                        >
                            刷新重试
                        </button>
                    )}
                    {this.props.onClose && (
                        <button
                            type="button"
                            onClick={this.props.onClose}
                            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-red-300/40 bg-red-950/40 px-4 text-sm text-red-50"
                        >
                            关闭
                        </button>
                    )}
                </div>
            </div>
        );
    }
}

