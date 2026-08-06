import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

const rootEl = document.getElementById("root");

window.addEventListener("error", (e) => {
  rootEl.innerHTML =
    '<pre style="padding:20px;color:red;white-space:pre-wrap;font-size:14px;">Erro: ' +
    e.message + '\n' + (e.error && e.error.stack ? e.error.stack : '') +
    '</pre>';
});

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
} catch (err) {
  rootEl.innerHTML =
    '<pre style="padding:20px;color:red;white-space:pre-wrap;font-size:14px;">Erro ao iniciar: ' +
    err.message + '\n' + err.stack +
    '</pre>';
}

