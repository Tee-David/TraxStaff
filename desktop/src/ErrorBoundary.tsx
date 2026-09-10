import React from "react";

/**
 * Last line of defence against a render error taking the whole tracker down.
 *
 * React unmounts the entire tree when a render throws, which in a Tauri window
 * means a blank white rectangle with no menu, no message and nothing to click.
 * That is exactly what a member saw after requesting time: one undefined field
 * on one row of one tab, and the app was gone.
 *
 * Two things make this worse here than in an ordinary web app, and both are why
 * this exists rather than being left to a reload:
 *
 *  - the window has no address bar and no refresh, so a member has no way back;
 *  - the app lives in the tray behind tauri-plugin-single-instance, so
 *    "restarting" it re-focuses the same dead webview instead of reloading it.
 *    The blank screen therefore looked permanent, and survived every restart.
 *
 * Tracking itself is unaffected by any of this — the timer, activity sampling
 * and screenshots all run in Rust, and keep running while this is on screen.
 * Saying so is the whole point of the message: a member who thinks their time
 * has stopped will stop working, or re-enter the day by hand.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Goes to the webview console, which is reachable from a dev build and from
    // `WEBKIT_DISABLE_COMPOSITING_MODE=1 ... --inspect` style debugging. There is
    // no log file to write to, and inventing one for this would mean writing
    // crash text next to captured screenshots.
    console.error("[trax] render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <h1 className="crash-title">Something in the app broke</h1>
        <p className="crash-body">
          <strong>Your time is still being tracked.</strong> The timer, activity and
          screenshots run outside this window and were not affected.
        </p>
        <p className="crash-body">Reloading gets the window back. Nothing is lost.</p>
        <button className="crash-reload" onClick={() => window.location.reload()}>
          Reload TraxStaff
        </button>
        {/* The message is for the member; this is for whoever they send it to. */}
        <details className="crash-details">
          <summary>Technical details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </div>
    );
  }
}
