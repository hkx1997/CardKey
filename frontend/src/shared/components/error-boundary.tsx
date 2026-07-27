import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** 可选：局部边界标题 */
  title?: string;
  fallback?: ReactNode;
};

type State = {
  error: Error | null;
};

/** 路由/布局级错误兜底，避免整页白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            {this.props.title ?? "页面出了点问题"}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {error.message || "未知错误"}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </Button>
          <Button
            onClick={() => {
              window.location.href = "/";
            }}
          >
            回首页
          </Button>
        </div>
      </div>
    );
  }
}
