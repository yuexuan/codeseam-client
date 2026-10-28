import ReactDOM from "react-dom/client";
import App from "./codeseam/App";

async function boot() {
  // 浏览器预览（非 Tauri 壳）下用模拟后端，生产包不含此分支。
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./codeseam/lib/devMock")).installDevMock();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App />,
  );
}

void boot();
