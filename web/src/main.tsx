import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import "./style.css";

const root = createRoot(document.getElementById("root")!);

loadConfig().then((config) => {
  if (!config.apiUrl || (!config.clientId && !config.skipLogin)) {
    root.render(<p className="notice">Sistema ainda não configurado (js/config.js vazio).</p>);
    return;
  }
  root.render(<StrictMode><App /></StrictMode>);
}).catch(() => root.render(<p className="notice">Não foi possível carregar a configuração (js/config.js).</p>));
