import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

const rootEl = document.getElementById("root");

// Tela de falha do último recurso: o usuário vê um recado claro e o detalhe
// técnico (mensagem original e stack) fica só no console, para investigação.
function mostrarFalha(titulo, detalhe) {
  if (detalhe) console.error(titulo, detalhe);
  rootEl.innerHTML =
    '<div style="padding:40px;max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;color:#0F2A44;">' +
    '<h1 style="font-size:18px;font-weight:600;margin:0 0 8px;">' + titulo + "</h1>" +
    '<p style="font-size:14px;line-height:1.5;opacity:.7;margin:0 0 20px;">' +
    "Recarregue a página para continuar. Se a mensagem voltar a aparecer, avise o responsável pelo sistema." +
    "</p>" +
    '<button onclick="window.location.reload()" style="font-size:14px;padding:10px 16px;border-radius:8px;border:none;background:#0F2A44;color:#fff;cursor:pointer;">' +
    "Recarregar" +
    "</button>" +
    "</div>";
}

window.addEventListener("error", (e) => {
  mostrarFalha("Algo não funcionou como esperado nesta tela.", e.error ?? e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Falha não tratada", e.reason);
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
  mostrarFalha("Não foi possível abrir o sistema agora.", err);
}
