import React from "react";
import {
  Bell, Search, Landmark, HeartPulse, GraduationCap, HandHeart,
  Plus, Users, FileBarChart, DatabaseBackup, ChevronRight, TrendingUp, TrendingDown,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import { mensagemAmigavel } from "../lib/erros";

const ICONES_SECRETARIA = {
  finan: Landmark,
  saúde: HeartPulse,
  saude: HeartPulse,
  educa: GraduationCap,
  social: HandHeart,
  assist: HandHeart,
};
const CORES_SECRETARIA = {
  finan: { cor: "#2563EB", bg: "#EAF1FF" },
  saúde: { cor: "#16A34A", bg: "#EAFBF0" },
  saude: { cor: "#16A34A", bg: "#EAFBF0" },
  educa: { cor: "#EA9A1E", bg: "#FFF6E5" },
  social: { cor: "#7C3AED", bg: "#F3EDFF" },
  assist: { cor: "#7C3AED", bg: "#F3EDFF" },
};

function iconePara(nome) {
  const chave = Object.keys(ICONES_SECRETARIA).find((k) => nome.toLowerCase().includes(k));
  return ICONES_SECRETARIA[chave] ?? Landmark;
}
function corPara(nome) {
  const chave = Object.keys(CORES_SECRETARIA).find((k) => nome.toLowerCase().includes(k));
  return CORES_SECRETARIA[chave] ?? { cor: "#0F2A44", bg: "#EAF1FF" };
}

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
function tempoRelativo(dataISO) {
  const diff = (new Date() - new Date(dataISO)) / 1000;
  if (diff < 60) return "agora há pouco";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hoje, ${new Date(dataISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  return new Date(dataISO).toLocaleDateString("pt-BR");
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [nomeUsuario, setNomeUsuario] = React.useState("");
  const [busca, setBusca] = React.useState("");

  const [secretariasComSaldo, setSecretariasComSaldo] = React.useState([]);
  const [saldoDisponivelTotal, setSaldoDisponivelTotal] = React.useState(0);
  const [totalProgramadoHoje, setTotalProgramadoHoje] = React.useState(0);
  const [pendencias, setPendencias] = React.useState([]);
  const [ultimosRegistros, setUltimosRegistros] = React.useState([]);
  const [pagamentosProgramados, setPagamentosProgramados] = React.useState([]);

  React.useEffect(() => {
    carregarTudo();
  }, []);
  async function carregarTudo() {
    setCarregando(true);
    setErro(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: usuarioRow } = await supabase
        .from("usuarios").select("nome").eq("id", userData.user.id).maybeSingle();
      setNomeUsuario(usuarioRow?.nome ?? "");

      const { data: secs, error: eSecs } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (eSecs) throw eSecs;

      const { data: contas, error: eContas } = await supabase
        .from("contas_bancarias").select("id, secretaria_id").eq("ativo", true);
      if (eContas) throw eContas;

      const { data: saldos, error: eSaldos } = await supabase
        .from("saldos_historico")
        .select("conta_id, valor_saldo, data_saldo")
        .order("data_saldo", { ascending: false });
      if (eSaldos) throw eSaldos;

      const ultimoSaldo = {};
      const penultimoSaldo = {};
      for (const s of saldos ?? []) {
        if (!(s.conta_id in ultimoSaldo)) {
          ultimoSaldo[s.conta_id] = s;
        } else if (!(s.conta_id in penultimoSaldo)) {
          penultimoSaldo[s.conta_id] = s;
        }
      }

      const secsComSaldo = (secs ?? []).map((sec) => {
        const contasDaSec = (contas ?? []).filter((c) => c.secretaria_id === sec.id);
        const total = contasDaSec.reduce((acc, c) => acc + (ultimoSaldo[c.id]?.valor_saldo ?? 0), 0);
        const totalAnterior = contasDaSec.reduce((acc, c) => acc + (penultimoSaldo[c.id]?.valor_saldo ?? 0), 0);
        const temHistorico = contasDaSec.some((c) => c.id in penultimoSaldo);
        const variacao = temHistorico && totalAnterior !== 0 ? ((total - totalAnterior) / totalAnterior) * 100 : null;
        return { id: sec.id, nome: sec.nome, total, variacao };
      });
      setSecretariasComSaldo(secsComSaldo);
      setSaldoDisponivelTotal(secsComSaldo.reduce((acc, s) => acc + s.total, 0));

      const hojeStr = new Date().toISOString().slice(0, 10);
      const { data: progsHoje, error: eProgs } = await supabase
        .from("programacoes_pagamento").select("id").eq("data_programacao", hojeStr);
      if (eProgs) throw eProgs;

      let totalProgramado = 0;
      if (progsHoje && progsHoje.length > 0) {
        const { data: pgs } = await supabase
          .from("pagamentos")
          .select("valor_a_pagar, situacao")
          .in("programacao_id", progsHoje.map((p) => p.id))
          .neq("situacao", "cancelado");
        totalProgramado = (pgs ?? []).reduce((acc, p) => acc + (parseFloat(p.valor_a_pagar) || 0), 0);
      }
      setTotalProgramadoHoje(totalProgramado);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar painel."));
    } finally {
      setCarregando(false);
    }
  }
  React.useEffect(() => {
    carregarPendenciasERegistros();
  }, []);

  async function carregarPendenciasERegistros() {
    try {
      const hojeStr = new Date().toISOString().slice(0, 10);

      const { data: vencidos } = await supabase
        .from("valores_em_aberto")
        .select("id")
        .lt("data_vencimento", hojeStr)
        .in("situacao", ["em_aberto", "programado", "parcialmente_pago"]);

      const seteDias = new Date();
      seteDias.setDate(seteDias.getDate() + 7);
      const { data: proximosVencer } = await supabase
        .from("valores_em_aberto")
        .select("id")
        .gte("data_vencimento", hojeStr)
        .lte("data_vencimento", seteDias.toISOString().slice(0, 10))
        .in("situacao", ["em_aberto", "programado", "parcialmente_pago"]);

      const { data: progsAbertas } = await supabase
        .from("programacoes_pagamento")
        .select("id")
        .eq("fechado", false)
        .lt("data_programacao", hojeStr);

      const listaPendencias = [];
      if (vencidos && vencidos.length > 0) {
        listaPendencias.push({
          cor: "#DC2626", label: `Notas fiscais vencidas -- ${vencidos.length}`, rota: "/fornecedores",
        });
      }
      if (proximosVencer && proximosVencer.length > 0) {
        listaPendencias.push({
          cor: "#2563EB", label: `Documentos próximos do vencimento -- ${proximosVencer.length}`, rota: "/fornecedores",
        });
      }
      if (progsAbertas && progsAbertas.length > 0) {
        listaPendencias.push({
          cor: "#EA9A1E", label: `Fechamentos diários pendentes -- ${progsAbertas.length}`, rota: "/pagamentos",
        });
      }
      setPendencias(listaPendencias);

      const eventos = [];

      const { data: pagosRecentes } = await supabase
        .from("pagamentos")
        .select("valor_a_pagar, updated_at, nome_avulso, fornecedores(razao_social)")
        .eq("situacao", "pago")
        .order("updated_at", { ascending: false })
        .limit(5);
      (pagosRecentes ?? []).forEach((p) => {
        eventos.push({
          tipo: "Pagamento realizado",
          titulo: p.fornecedores?.razao_social ?? p.nome_avulso,
          detalhe: formatBRL(p.valor_a_pagar),
          data: p.updated_at,
        });
      });

      const { data: saldosRecentes } = await supabase
        .from("saldos_historico")
        .select("valor_saldo, created_at, contas_bancarias(nome_conta, bancos(nome))")
        .order("created_at", { ascending: false })
        .limit(5);
      (saldosRecentes ?? []).forEach((s) => {
        eventos.push({
          tipo: "Saldo atualizado",
          titulo: `${s.contas_bancarias?.bancos?.nome ?? ""} -- ${s.contas_bancarias?.nome_conta ?? ""}`,
          detalhe: formatBRL(s.valor_saldo),
          data: s.created_at,
        });
      });

      const { data: fornsRecentes } = await supabase
        .from("fornecedores")
        .select("razao_social, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      (fornsRecentes ?? []).forEach((f) => {
        eventos.push({
          tipo: "Fornecedor cadastrado",
          titulo: f.razao_social,
          detalhe: "",
          data: f.created_at,
        });
      });

      eventos.sort((a, b) => new Date(b.data) - new Date(a.data));
      setUltimosRegistros(eventos.slice(0, 5));

      const { data: progVals } = await supabase
        .from("pagamentos")
        .select("valor_a_pagar, situacao, fornecedores(razao_social, secretarias(nome)), programacoes_pagamento(data_programacao)")
        .in("situacao", ["pendente", "programado"])
        .order("created_at", { ascending: false })
        .limit(20);

      const proximos = (progVals ?? [])
        .filter((p) => p.programacoes_pagamento?.data_programacao)
        .sort((a, b) => new Date(a.programacoes_pagamento.data_programacao) - new Date(b.programacoes_pagamento.data_programacao))
        .slice(0, 5)
        .map((p) => ({
          fornecedor: p.fornecedores?.razao_social ?? "--",
          secretaria: p.fornecedores?.secretarias?.nome ?? "--",
          valor: p.valor_a_pagar,
          data: p.programacoes_pagamento.data_programacao,
        }));
      setPagamentosProgramados(proximos);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar pendências e registros."));
    }
  }

  const saldoLiquido = saldoDisponivelTotal - totalProgramadoHoje;

  function handleBuscar(e) {
    e.preventDefault();
    if (!busca.trim()) return;
    navigate(`/fornecedores?q=${encodeURIComponent(busca)}`);
  }
  return (
    <Layout>
      <div className="px-8 py-7">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">
              {saudacao()}{nomeUsuario ? `, ${nomeUsuario.split(" ")[0]}` : ""}! 👋
            </h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">Bem-vinda ao Sistema Financeiro Integrado</p>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={handleBuscar} className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F2A44]/40" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar fornecedor, conta, pagamento..."
                className="pl-9 pr-3 py-2 rounded-lg border border-black/10 text-sm bg-white w-72"
              />
            </form>
            <div className="flex items-center gap-2 bg-white border border-black/5 rounded-lg px-3 py-2 text-sm shadow-sm">
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
            </div>
            <button className="relative w-9 h-9 rounded-lg bg-white border border-black/5 flex items-center justify-center shadow-sm">
              <Bell size={16} className="text-[#0F2A44]/70" />
              {pendencias.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {pendencias.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 my-5">
            {erro}
          </div>
        )}
        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50 mt-6">Carregando painel...</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 mt-6 mb-4">
              {secretariasComSaldo.length === 0 ? (
                <div className="col-span-4 bg-white rounded-2xl border border-dashed border-black/10 p-6 text-center text-sm text-[#0F2A44]/50">
                  Nenhuma secretaria cadastrada ainda.
                </div>
              ) : (
                secretariasComSaldo.map((sec) => {
                  const Icone = iconePara(sec.nome);
                  const { cor, bg } = corPara(sec.nome);
                  return (
                    <div key={sec.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: bg }}>
                          <Icone size={18} style={{ color: cor }} />
                        </div>
                        <div className="text-xs font-semibold tracking-wide" style={{ color: cor }}>
                          {sec.nome.toUpperCase()}
                        </div>
                      </div>
                      <div className="text-xl font-semibold text-[#0F2A44]">{formatBRL(sec.total)}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-xs text-[#0F2A44]/50">Saldo total em contas</span>
                        {sec.variacao !== null && (
                          <span
                            className="flex items-center gap-0.5 text-[11px] font-medium"
                            style={{ color: sec.variacao >= 0 ? "#16A34A" : "#DC2626" }}
                          >
                            {sec.variacao >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                            {Math.abs(sec.variacao).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[#0F2A44]">Saldo líquido de hoje</div>
                <div className="text-xs text-[#0F2A44]/50 mt-0.5">Saldo disponível menos pagamentos programados para hoje</div>
              </div>
              <div className="flex items-center gap-8">
                <div className="text-right">
                  <div className="text-xs text-[#0F2A44]/50">Disponível</div>
                  <div className="text-base font-semibold text-[#0F2A44]">{formatBRL(saldoDisponivelTotal)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#0F2A44]/50">Programado hoje</div>
                  <div className="text-base font-semibold text-[#0F2A44]">{formatBRL(totalProgramadoHoje)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#0F2A44]/50">Líquido</div>
                  <div
                    className="text-lg font-semibold"
                    style={{ color: saldoLiquido < 0 ? "#DC2626" : "#0F2A44" }}
                  >
                    {formatBRL(saldoLiquido)}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-5">
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                <h2 className="text-base font-semibold mb-3">Pendências e Alertas</h2>
                {pendencias.length === 0 ? (
                  <div className="text-sm text-[#16A34A] flex items-center gap-1.5">
                    ✓ Nenhuma pendência encontrada.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendencias.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => navigate(p.rota)}
                        className="w-full flex items-center justify-between text-left px-3 py-2.5 rounded-lg hover:bg-black/[0.02] border border-black/5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.cor }} />
                          <span className="text-sm text-[#0F2A44]">{p.label}</span>
                        </div>
                        <ChevronRight size={14} className="text-[#0F2A44]/30" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold">Últimos Registros</h2>
                </div>
                {ultimosRegistros.length === 0 ? (
                  <div className="text-xs text-[#0F2A44]/40">Nenhum registro ainda.</div>
                ) : (
                  <div className="space-y-3">
                    {ultimosRegistros.map((r, i) => (
                      <div key={i} className="text-sm">
                        <div className="font-medium text-[#0F2A44]">{r.tipo}</div>
                        <div className="text-xs text-[#0F2A44]/60">{r.titulo}</div>
                        <div className="flex items-center justify-between mt-0.5">
                          {r.detalhe && <span className="text-xs text-[#0F2A44]/50">{r.detalhe}</span>}
                          <span className="text-[11px] text-[#0F2A44]/40 ml-auto">{tempoRelativo(r.data)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold">Pagamentos Programados</h2>
                  <button onClick={() => navigate("/pagamentos")} className="text-xs text-[#0F2A44]/50 hover:text-[#0F2A44]">
                    Ver todos
                  </button>
                </div>
                {pagamentosProgramados.length === 0 ? (
                  <div className="text-xs text-[#0F2A44]/40">Nenhum pagamento programado.</div>
                ) : (
                  <div className="space-y-3">
                    {pagamentosProgramados.map((p, i) => (
                      <div key={i} className="text-sm">
                        <div className="font-medium text-[#0F2A44]">{p.fornecedor}</div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#0F2A44]/50">{p.secretaria}</span>
                          <span className="text-xs text-[#0F2A44]/50">
                            {new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[#0F2A44] mt-0.5">{formatBRL(p.valor)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mt-5">
              <h2 className="text-base font-semibold mb-3">Ações Rápidas</h2>
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: "Novo Pagamento", icon: Landmark, rota: "/pagamentos" },
                  { label: "Novo Fornecedor", icon: Users, rota: "/fornecedores" },
                  { label: "Novo Registro de Saldo", icon: Plus, rota: "/saldos" },
                  { label: "Gerar Relatório", icon: FileBarChart, rota: "/relatorios" },
                  { label: "Backup Manual", icon: DatabaseBackup, rota: "/configuracoes" },
                ].map((a) => (
                  <button
                    key={a.label}
                    onClick={() => navigate(a.rota)}
                    className="flex flex-col items-center gap-2 py-4 rounded-xl border border-black/5 hover:bg-black/[0.02] text-center"
                  >
                    <div className="w-9 h-9 rounded-full bg-[#0F2A44]/5 flex items-center justify-center">
                      <a.icon size={16} className="text-[#0F2A44]" />
                    </div>
                    <span className="text-[11px] text-[#0F2A44]/70 leading-tight">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
