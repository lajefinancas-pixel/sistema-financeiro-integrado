import React from "react";
import {
  Calendar, Bell, Plus
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

const CORES = ["#2563EB", "#16A34A", "#EA9A1E", "#7C3AED", "#DB2777", "#0EA5E9"];

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Dashboard() {
  const [carregando, setCarregando] = React.useState(true);
  const [secretarias, setSecretarias] = React.useState([]);
  const [contasPorSecretaria, setContasPorSecretaria] = React.useState([]);
  const [ultimosRegistros, setUltimosRegistros] = React.useState([]);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    setCarregando(true);
    setErro(null);
    try {
      const { data: secs, error: errSecs } = await supabase
        .from("secretarias")
        .select("id, nome")
        .eq("ativo", true);
      if (errSecs) throw errSecs;

      const { data: contas, error: errContas } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)")
        .eq("ativo", true);
      if (errContas) throw errContas;

      const { data: saldos, error: errSaldos } = await supabase
        .from("saldos_historico")
        .select("conta_id, valor_saldo, data_saldo")
        .order("data_saldo", { ascending: false });
      if (errSaldos) throw errSaldos;

      const ultimoSaldoPorConta = {};
      for (const s of saldos ?? []) {
        if (!(s.conta_id in ultimoSaldoPorConta)) ultimoSaldoPorConta[s.conta_id] = s.valor_saldo;
      }

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSecretaria = (contas ?? [])
          .filter((c) => c.secretaria_id === sec.id)
          .map((c) => ({
            banco: c.bancos?.nome ?? "--",
            conta: c.nome_conta,
            saldo: ultimoSaldoPorConta[c.id] ?? 0,
          }));
        const total = contasDaSecretaria.reduce((acc, c) => acc + c.saldo, 0);
        return { nome: sec.nome, cor: CORES[i % CORES.length], total, contas: contasDaSecretaria };
      });

      setSecretarias(agrupado.map((s) => ({ nome: s.nome, total: s.total, cor: s.cor })));
      setContasPorSecretaria(agrupado);

      const { data: hist } = await supabase
        .from("historico_alteracoes")
        .select("acao, tabela_referencia, data_hora")
        .order("data_hora", { ascending: false })
        .limit(5);
      setUltimosRegistros(hist ?? []);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar dados. Verifique a conexão com o Supabase.");
    } finally {
      setCarregando(false);
    }
  }

  const totalGeral = secretarias.reduce((acc, s) => acc + s.total, 0);
  const pieData = secretarias.map((s) => ({ name: s.nome, value: s.total, color: s.cor }));

  return (
    <Layout>
      <div className="px-8 py-7">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Sistema Financeiro Integrado</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">Painel Principal</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-black/5 rounded-lg px-3 py-2 text-sm shadow-sm">
              <Calendar size={15} className="text-[#0F2A44]/60" />
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
            </div>
            <button className="w-9 h-9 rounded-lg bg-white border border-black/5 flex items-center justify-center shadow-sm">
              <Bell size={16} className="text-[#0F2A44]/70" />
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro} -- cadastre secretarias e contas no Supabase (ou rode o schema em <code>supabase/schema.sql</code>).
          </div>
        )}
         {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando dados do Supabase...</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {secretarias.map((s) => (
                <div key={s.nome} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                  <div className="text-xs font-semibold tracking-wide mb-2" style={{ color: s.cor }}>
                    {s.nome.toUpperCase()}
                  </div>
                  <div className="text-xl font-semibold text-[#0F2A44]">{formatBRL(s.total)}</div>
                  <div className="text-xs text-[#0F2A44]/50 mt-0.5">Saldo total em contas</div>
                </div>
              ))}
              {secretarias.length === 0 && (
                <div className="col-span-4 bg-white rounded-2xl border border-dashed border-black/10 p-6 text-center text-sm text-[#0F2A44]/50">
                  Nenhuma secretaria cadastrada ainda. Rode o schema SQL e cadastre a primeira secretaria no Supabase.
                </div>
              )}
            </div>

            <div className="grid grid-cols-[1fr_360px] gap-5">
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold">Saldos das Contas por Secretaria</h2>
                  <button className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90">
                    <Plus size={14} /> Novo Registro
                  </button>
                </div>
                <div className="space-y-4">
                  {contasPorSecretaria.map((sec) => (
                    <div key={sec.nome} className="rounded-xl border border-black/5 overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-2.5"
                        style={{ backgroundColor: `${sec.cor}14`, borderLeft: `4px solid ${sec.cor}` }}
                      >
                        <span className="text-sm font-semibold" style={{ color: sec.cor }}>{sec.nome.toUpperCase()}</span>
                        <span className="text-sm font-semibold" style={{ color: sec.cor }}>Total: {formatBRL(sec.total)}</span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {sec.contas.map((c, i) => (
                            <tr key={i} className="border-t border-black/5">
                              <td className="px-4 py-2.5">{c.banco}</td>
                              <td className="px-4 py-2.5">{c.conta}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(c.saldo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                  <h2 className="text-base font-semibold mb-3">Resumo Geral</h2>
                  {pieData.length > 0 ? (
                    <div className="relative h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} stroke="none" />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-xs text-[#0F2A44]/50">Total</span>
                        <span className="text-sm font-semibold">{formatBRL(totalGeral)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-[#0F2A44]/40">Sem dados ainda.</div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
                  <h2 className="text-base font-semibold mb-3">Últimos Registros</h2>
                  {ultimosRegistros.length === 0 ? (
                    <div className="text-xs text-[#0F2A44]/40">Nenhum registro no histórico ainda.</div>
                  ) : (
                    <div className="space-y-3">
                      {ultimosRegistros.map((r, i) => (
                        <div key={i} className="text-sm">
                          <div className="font-medium">{r.acao} -- {r.tabela_referencia}</div>
                          <div className="text-xs text-[#0F2A44]/50">
                            {new Date(r.data_hora).toLocaleString("pt-BR")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

