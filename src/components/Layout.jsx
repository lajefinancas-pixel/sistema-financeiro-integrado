import React from "react";
import { NavLink } from "react-router-dom";
import {
  Home, Landmark, Users, Calendar, History, BarChart2, Settings,
  LogOut, ShieldCheck, UserCog,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const navItems = [
  { to: "/", label: "Painel Principal", icon: Home, end: true },
  { to: "/saldos", label: "Saldos das Contas", icon: Landmark },
  { to: "/fornecedores", label: "Fornecedores", icon: Users },
  { to: "/pagamentos", label: "Pagamentos Diários", icon: Calendar },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/relatorios", label: "Relatórios", icon: BarChart2 },
  { to: "/auditoria", label: "Auditoria", icon: ShieldCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const equipeItems = [
  { to: "/equipe/usuarios", label: "Usuários", icon: UserCog },
];

export default function Layout({ children, usuario }) {
  async function sair() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const classeLink = ({ isActive }) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
      isActive ? "bg-white text-[#0F2A44] font-medium" : "text-white/80 hover:bg-white/10"
    }`;

  return (
    <div className="min-h-screen w-full flex bg-[#F5F3EF] text-[#0F2A44]">
      <aside className="w-64 shrink-0 bg-[#0F2A44] text-white flex flex-col print:hidden">
        <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center border-b border-white/10">
          <div className="w-16 h-16 rounded-full border-2 border-[#C9A227] flex items-center justify-center mb-3">
            <Landmark size={26} className="text-[#C9A227]" />
          </div>
          <div className="uppercase text-[10px] tracking-[0.2em] text-white/60">Secretaria de</div>
          <div className="text-xl font-semibold italic -mt-0.5">Finanças</div>
          <div className="uppercase text-[9px] tracking-[0.15em] text-[#C9A227] mt-1">Gestão que transforma</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={classeLink}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}

          <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-[0.18em] text-[#C9A227]">
            Equipe
          </div>
          {equipeItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={classeLink}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10 flex items-center gap-3 cursor-pointer" onClick={sair}>
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-sm font-semibold">
            {usuario?.nome?.[0]?.toUpperCase() ?? "A"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{usuario?.nome ?? "Administrador"}</div>
            <div className="text-[11px] text-white/60 truncate">Sair</div>
          </div>
          <LogOut size={16} className="text-white/50" />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
