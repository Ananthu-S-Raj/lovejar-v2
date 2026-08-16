import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

// Catches render/lifecycle errors so the app never shows a silent white screen.
// "Try again" re-renders the tree without a full reload; "Reload app" is kept
// for cases that need a fresh boot (it now goes through the service worker's
// fresh-shell path, so it recovers rather than re-showing the same failure).
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? "" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Diagnostic log; never surfaced to the user.
    console.error("LoveJar UI error:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <p>Something went wrong on this screen.</p>
          {this.state.message && <p className="error-fallback-detail">{this.state.message}</p>}
          <div className="error-fallback-actions">
            <button onClick={this.reset}>Try again</button>
            <button onClick={() => window.location.reload()}>Reload app</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
