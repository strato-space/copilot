import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";
// import "./i18n";

const isEmbedded = (() => {
  try {
    return window.self !== window.top;
  } catch (error) {
    return true;
  }
})();
const hasEmbedPath = window.location.pathname.startsWith("/embed");
const embedMode = isEmbedded || hasEmbedPath;

if (embedMode) {
  window.__VOICEBOT_EMBED__ = true;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter
    basename={embedMode ? "/embed" : "/"}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <Suspense fallback={<div>loading ...</div>}>
      <App />
    </Suspense>
  </BrowserRouter>
);
