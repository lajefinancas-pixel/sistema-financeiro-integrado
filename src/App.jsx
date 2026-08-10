import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Saldos from "./pages/Saldos";
import Fornecedores from "./pages/Fornecedores";
import Pagamentos from "./pages/Pagamentos";
import Tarefas from "./pages/Tarefas";
import Historico from "./pages/Historico";
import Relatorios from "./pages/Relatorios";
import Auditoria from "./pages/Auditoria";
import Configuracoes from "./pages/Configuracoes";
import Usuarios from "./pages/equipe/Usuarios";

function RotaProtegida({ children }) {
  const [sessao, setSessao] = React.useState(undefined);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setSessao(session));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (sessao === undefined) return null;
  if (!sessao) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RotaProtegida><Dashboard /></RotaProtegida>} />
      <Route path="/saldos" element={<RotaProtegida><Saldos /></RotaProtegida>} />
      <Route path="/fornecedores" element={<RotaProtegida><Fornecedores /></RotaProtegida>} />
      <Route path="/pagamentos" element={<RotaProtegida><Pagamentos /></RotaProtegida>} />
      <Route path="/tarefas" element={<RotaProtegida><Tarefas /></RotaProtegida>} />
      <Route path="/equipe/usuarios" element={<RotaProtegida><Usuarios /></RotaProtegida>} />
      <Route path="/historico" element={<RotaProtegida><Historico /></RotaProtegida>} />
      <Route path="/relatorios" element={<RotaProtegida><Relatorios /></RotaProtegida>} />
      <Route path="/auditoria" element={<RotaProtegida><Auditoria /></RotaProtegida>} />
      <Route path="/configuracoes" element={<RotaProtegida><Configuracoes /></RotaProtegida>} />
    </Routes>
  );
}
