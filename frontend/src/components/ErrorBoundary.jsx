import { Component } from "react";

// Route-level crash guard. A render error in any single page (a bad API shape,
// an undefined read) would otherwise unwind all the way to the root and blank
// the whole site — nav bar and every other route included. Wrapped per route in
// App.jsx, BELOW the NavBar, so a crash stays contained to the page area: the
// nav and every other route keep working. Navigating away clears the error
// (App passes the current path as `resetKey`), so recovery needs no hard
// reload. The error is only logged to the console — never sent anywhere.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Developer console only — deliberately not reported to any service.
    console.error("Route error caught by ErrorBoundary:", error, info);
  }

  componentDidUpdate(prevProps) {
    // Recover on navigation: when the route changes, drop the error so the new
    // page renders normally without a full-page reload.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="mx-auto max-w-lg">
        <div className="card p-6 text-center sm:p-8">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
            Something went wrong
          </div>
          <h2 className="mt-2 font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
            This page hit a snag
          </h2>
          <p className="mt-3 text-sm text-light">
            The rest of the site still works. Use the menu to head elsewhere, or reload to try this
            page again.
          </p>
          <button className="btn-primary mt-6" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
