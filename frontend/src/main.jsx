import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Outermost crash guard. App.jsx has one per route, but it sits BELOW the
        nav bar, the footer and the series/season providers — so a throw in any
        of those unwound past it and left a white page with no way back. This one
        catches that last case. It is outside the router on purpose: the router
        itself is one of the things it has to survive. */}
    <ErrorBoundary root>
      {/* opt in to the v7 behaviours now to silence the upgrade warnings */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
