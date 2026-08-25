import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Home, Landmark, Users, Calendar, History, BarChart2, Settings,
  LogOut, ShieldCheck, ClipboardList, FileCheck2, Menu, X, PanelLeftClose,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { CATEGORIAS } from "../lib/configuracoesSistema";

const navItems = [
  { to: "/", label: "Painel Principal", icon: Home, end: true },
  { to: "/saldos", label: "Saldos das Contas", icon: Landmark },
  { to: "/fornecedores", label: "Fornecedores", icon: Users },
  { to: "/certidoes", label: "Certidões", icon: FileCheck2 },
  { to: "/pagamentos", label: "Pagamentos Diários", icon: Calendar },
  { to: "/tarefas", label: "Tarefas", icon: ClipboardList },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/relatorios", label: "Relatórios", icon: BarChart2 },
  { to: "/auditoria", label: "Auditoria", icon: ShieldCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

// Cada tela monta o seu próprio Layout, então a preferência de menu recolhido
// vive no localStorage: é ela que mantém o estado ao navegar entre páginas.
const CHAVE_MENU_RECOLHIDO = "sfi.menuLateral.recolhido";

// Abaixo de 768px (celular) o menu vira gaveta sobreposta; de tablet para cima
// o usuário escolhe entre menu aberto e faixa de ícones.
const CONSULTA_TELA_ESTREITA = "(max-width: 767px)";

function lerPreferenciaRecolhido() {
  try {
    return window.localStorage.getItem(CHAVE_MENU_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

function gravarPreferenciaRecolhido(recolhido) {
  try {
    window.localStorage.setItem(CHAVE_MENU_RECOLHIDO, recolhido ? "1" : "0");
  } catch {
    /* navegador sem armazenamento local: a preferência vale só para esta tela */
  }
}

function usarTelaEstreita() {
  const [estreita, definirEstreita] = React.useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(CONSULTA_TELA_ESTREITA).matches;
  });

  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const consulta = window.matchMedia(CONSULTA_TELA_ESTREITA);
    const aoMudar = (evento) => definirEstreita(evento.matches);
    definirEstreita(consulta.matches);
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  return estreita;
}

/** Balão com o nome do item, usado só quando o menu está na faixa de ícones. */
function Balao({ children }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-40 whitespace-nowrap rounded-md bg-[#0F2A44] text-white text-xs font-normal px-2.5 py-1.5 border border-white/15 shadow-lg opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
    >
      {children}
    </span>
  );
}

/**
 * Configurações na faixa de ícones: em vez de navegar direto, abre um painel
 * flutuante com as categorias internas, para não precisar expandir o menu.
 */
function ConfiguracoesCompacto({ item, ativo, aberto, onAlternar, onEscolher, classe }) {
  const referencia = React.useRef(null);

  React.useEffect(() => {
    if (!aberto) return undefined;
    function aoClicarFora(evento) {
      if (referencia.current && !referencia.current.contains(evento.target)) onAlternar(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto, onAlternar]);

  return (
    <div ref={referencia} className="relative">
      <button
        type="button"
        onClick={() => onAlternar(!aberto)}
        aria-label={item.label}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={classe(ativo)}
      >
        <item.icon size={18} className="shrink-0" />
        {!aberto && <Balao>{item.label}</Balao>}
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label="Categorias de Configurações"
          className="absolute left-full bottom-0 ml-2 w-64 max-h-[70vh] overflow-y-auto rounded-xl bg-white text-[#0F2A44] border border-black/10 shadow-xl py-2 z-40"
        >
          <div className="px-3 pb-2 mb-1 border-b border-black/5 text-[11px] uppercase tracking-[0.14em] text-[#0F2A44]/40">
            Configurações
          </div>
          {CATEGORIAS.map((categoria) => (
            <Link
              key={categoria.id}
              role="menuitem"
              to={`/configuracoes?categoria=${categoria.id}`}
              onClick={onEscolher}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[#0F2A44]/5 focus:outline-none focus-visible:bg-[#0F2A44]/5"
            >
              <span>{categoria.label}</span>
              {!categoria.pronta && (
                <span className="text-[9px] uppercase tracking-[0.1em] text-[#0F2A44]/30 shrink-0">Em breve</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children, usuario }) {
  const localizacao = useLocation();
  const telaEstreita = usarTelaEstreita();
  const [recolhido, definirRecolhido] = React.useState(lerPreferenciaRecolhido);
  const [gavetaAberta, definirGavetaAberta] = React.useState(false);
  const [submenuAberto, definirSubmenuAberto] = React.useState(false);
  const botaoFecharRef = React.useRef(null);

  // Faixa de ícones só existe de tablet para cima: no celular o menu, quando
  // aparece, aparece inteiro por cima da página.
  const compacto = recolhido && !telaEstreita;
  const gavetaEscondida = telaEstreita && !gavetaAberta;

  async function sair() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function alternarRecolhido() {
    definirSubmenuAberto(false);
    definirRecolhido((atual) => {
      const proximo = !atual;
      gravarPreferenciaRecolhido(proximo);
      return proximo;
    });
  }

  function fecharGaveta() {
    definirGavetaAberta(false);
    definirSubmenuAberto(false);
  }

  // Sai do modo compacto (ou vira celular): o painel flutuante perde o sentido.
  React.useEffect(() => {
    if (!compacto) definirSubmenuAberto(false);
  }, [compacto]);

  React.useEffect(() => {
    if (!telaEstreita) definirGavetaAberta(false);
  }, [telaEstreita]);

  // Esc fecha o que estiver sobreposto.
  React.useEffect(() => {
    if (!gavetaAberta && !submenuAberto) return undefined;
    function aoTeclar(evento) {
      if (evento.key !== "Escape") return;
      definirSubmenuAberto(false);
      definirGavetaAberta(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [gavetaAberta, submenuAberto]);

  // Gaveta aberta no celular: trava a rolagem do fundo e leva o foco para ela.
  React.useEffect(() => {
    if (!(telaEstreita && gavetaAberta)) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    botaoFecharRef.current?.focus();
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [telaEstreita, gavetaAberta]);

  const classeBotao =
    "w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]";

  const classeItem = (isActive) =>
    `group relative w-full flex items-center rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
      compacto ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
    } ${isActive ? "bg-white text-[#0F2A44] font-medium" : "text-white/80 hover:bg-white/10"}`;

  const classeLink = ({ isActive }) => classeItem(isActive);

  const classeAside = [
    "bg-[#0F2A44] text-white flex flex-col print:hidden",
    "transition-[width,transform] duration-[250ms] ease-in-out motion-reduce:transition-none",
    telaEstreita
      ? `fixed inset-y-0 left-0 z-40 w-64 shadow-2xl ${gavetaAberta ? "translate-x-0" : "-translate-x-full"}`
      : `static shrink-0 translate-x-0 ${compacto ? "w-[4.5rem]" : "w-64"}`,
  ].join(" ");

  return (
    <div className="min-h-screen w-full flex bg-[#F5F3EF] text-[#0F2A44]">
      {telaEstreita && gavetaAberta && (
        <div
          aria-hidden="true"
          onClick={fecharGaveta}
          className="fixed inset-0 z-30 bg-[#0F2A44]/50 print:hidden"
        />
      )}

      <aside
        id="menu-lateral"
        className={classeAside}
        {...(gavetaEscondida ? { inert: "" } : {})}
      >
        <div className={`flex items-center px-3 pt-3 ${compacto ? "justify-center" : "justify-end"}`}>
          {telaEstreita ? (
            <button
              type="button"
              ref={botaoFecharRef}
              onClick={fecharGaveta}
              aria-label="Fechar menu"
              title="Fechar menu"
              className={classeBotao}
            >
              <X size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={alternarRecolhido}
              aria-label={compacto ? "Abrir menu" : "Recolher menu"}
              aria-expanded={!compacto}
              aria-controls="menu-lateral"
              title={compacto ? "Abrir menu" : "Recolher menu"}
              className={classeBotao}
            >
              {compacto ? <Menu size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
        </div>

        <div
          className={`flex flex-col items-center text-center border-b border-white/10 ${
            compacto ? "px-2 pt-2 pb-4" : "px-6 pt-2 pb-6"
          }`}
        >
          <div
            className={`rounded-full border-2 border-[#C9A227] flex items-center justify-center transition-all duration-[250ms] ${
              compacto ? "w-11 h-11" : "w-16 h-16 mb-3"
            }`}
          >
            <Landmark size={26} className={`text-[#C9A227] ${compacto ? "scale-[0.7]" : ""}`} />
          </div>
          {!compacto && (
            <>
              <div className="uppercase text-[10px] tracking-[0.2em] text-white/60">Secretaria de</div>
              <div className="text-xl font-semibold italic -mt-0.5">Finanças</div>
              <div className="uppercase text-[9px] tracking-[0.15em] text-[#C9A227] mt-1">Gestão que transforma</div>
            </>
          )}
        </div>

        <nav
          className={`flex-1 py-4 space-y-1 ${compacto ? "px-2" : "px-3"} ${
            telaEstreita ? "overflow-y-auto" : ""
          }`}
        >
          {navItems.map((item) =>
            compacto && item.to === "/configuracoes" ? (
              <ConfiguracoesCompacto
                key={item.to}
                item={item}
                ativo={localizacao.pathname.startsWith("/configuracoes")}
                aberto={submenuAberto}
                onAlternar={definirSubmenuAberto}
                onEscolher={fecharGaveta}
                classe={classeItem}
              />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={fecharGaveta}
                className={classeLink}
                aria-label={compacto ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                {compacto ? <Balao>{item.label}</Balao> : <span className="truncate">{item.label}</span>}
              </NavLink>
            )
          )}
        </nav>

        <div
          className={`group relative border-t border-white/10 flex items-center cursor-pointer ${
            compacto ? "px-2 py-4 justify-center" : "px-4 py-4 gap-3"
          }`}
          onClick={sair}
        >
          <div className="w-9 h-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-sm font-semibold">
            {usuario?.nome?.[0]?.toUpperCase() ?? "A"}
          </div>
          {compacto ? (
            <Balao>Sair</Balao>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{usuario?.nome ?? "Administrador"}</div>
                <div className="text-[11px] text-white/60 truncate">Sair</div>
              </div>
              <LogOut size={16} className="text-white/50" />
            </>
          )}
        </div>
      </aside>

      {/* Celular: barra fixa com o ☰, já que a página inteira ocupa a largura. */}
      {telaEstreita && (
        <div className="fixed top-0 inset-x-0 z-20 h-14 flex items-center gap-3 px-4 bg-[#0F2A44] text-white print:hidden">
          <button
            type="button"
            onClick={() => definirGavetaAberta(true)}
            aria-label="Abrir menu"
            aria-expanded={gavetaAberta}
            aria-controls="menu-lateral"
            title="Abrir menu"
            className={classeBotao}
          >
            <Menu size={20} />
          </button>
          <span className="text-base font-semibold italic">Finanças</span>
        </div>
      )}

      <main className={`flex-1 overflow-y-auto ${telaEstreita ? "pt-14 print:pt-0" : ""}`}>{children}</main>
    </div>
  );
}
