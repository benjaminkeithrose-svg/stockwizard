import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { makeStore } from "./ui/App";
import "./ui/app.css";

const store = makeStore();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);

// Works offline once loaded. The service worker only caches the app's own files.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
