import { Component, type ReactNode } from "react";
import i18n from "@/i18n";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;
            return (
                <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center p-8">
                    <h1 className="text-2xl font-semibold">{i18n.t('error.somethingWentWrong')}</h1>
                    <p className="text-muted-foreground text-sm max-w-md">
                        {this.state.error?.message ?? i18n.t('error.unexpectedError')}
                    </p>
                    <button
                        className="text-sm underline text-muted-foreground"
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        {i18n.t('error.tryAgain')}
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
