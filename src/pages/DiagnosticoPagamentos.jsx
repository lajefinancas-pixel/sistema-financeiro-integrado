import React from "react";
import { AlertTriangle, ArrowLeft, FileSpreadsheet, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import { usePermissaoModulo } from "../lib/permissoes";
import { mensagemAmigavel } from "../lib/erros";
import { colunasPorCabecalho, formatBRL, marcarColunasDeMoeda, paraNumeroMoeda } from "../lib/moeda";
import { emCentavos, somar, TOLERANCIA } from "../lib/rateioPagamentos";
import { debitoEsperadoPorConta } from "../lib/saldosContas";
import { buscarPaginado, estruturaDeRateioAusente } from "../lib/saldosContasDados";

// Diagnóstico dos pagamentos já marcados como pagos.
//
// Esta tela é SOMENTE LEITURA: ela compara o débito registrado no histórico com
// o débito que deveria ter ocorrido pela lógica correta (rateio do valor do
// pagamento entre as contas escolhidas) e mostra a diferença. Nenhum valor
// histórico é corrigido ou alterado aqui -- a correção, se for o caso, é uma
// decisão manual da administradora em uma etapa futura.

const MODULO_ADMIN = "administracao";

function dataBR(iso) {
  if (!iso) return "--";
  return new Date(String(iso).slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR");
}

function tituloDoPagamento(pagamento) {
  return (
    pagamento.fornecedores?.razao_social ||
    pagamento.nome_avulso ||
    pagamento.descricao ||
    "Pagamento sem identificação"
  );
}

function nomeDaConta(conta) {
  if (!conta) return "Conta não encontrada";
  const banco = conta.bancos?.nome ?? "--";
  const numero = conta.numero_conta ? ` · ${conta.numero_conta}` : "";
  const nome = conta.nome_conta ? ` · ${conta.nome_conta}` : "";
  return `${banco}${numero}${nome}`;
}

export default function DiagnosticoPagamentos() {
  const {
    carregando: verificando,
    usuario,
    permissao,
    erro: erroPermissao,
  } = usePermissaoModulo(MODULO_ADMIN);

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [linhas, setLinhas] = React.useState([]);
  const [somenteDivergentes, setSomenteDivergentes] = React.useState(false);

  const perfil = usuario?.perfis_acesso?.nome ?? "";
  const ehAdministrador = /administrador/i.test(perfil);
  const podeVisualizar = ehAdministrador || permissao?.pode_visualizar === true;

  React.useEffect(() => {
    if (podeVisualizar) carregar();
  }, [podeVisualizar]);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    setAviso(null);
    try {
      // 1. Pagamentos já marcados como pagos.
      const pagos = await buscarPaginado(() =>
        supabase
          .from("pagamentos")
          .select(
            "id, programacao_id, valor_a_pagar, descricao, nome_avulso, updated_at, fornecedores(razao_social)"
          )
          .eq("situacao", "pago")
          .order("id", { ascending: true })
      );

      if (pagos.length === 0) {
        setLinhas([]);
        return;
      }

      // 2. Programações e secretarias (para data e contexto do pagamento).
      const programacoes = await buscarPaginado(() =>
        supabase
          .from("programacoes_pagamento")
          .select("id, data_programacao, nome_programacao, secretaria_id")
          .order("id", { ascending: true })
      );
      const { data: secretarias, error: eSecs } = await supabase
        .from("secretarias")
        .select("id, nome");
      if (eSecs) throw eSecs;

      const mapaSecretarias = new Map((secretarias ?? []).map((s) => [String(s.id), s.nome]));
      const mapaProgramacoes = new Map(
        programacoes.map((p) => [
          String(p.id),
          { ...p, secretaria: mapaSecretarias.get(String(p.secretaria_id)) ?? "--" },
        ])
      );

      // 3. Débito efetivamente registrado, por pagamento e conta.
      //    Agregado em mapa antes de qualquer soma: a razão tem uma linha por
      //    pagamento e por conta, então a conta aparece várias vezes ali.
      let movimentacoes = [];
      let semRazao = false;
      try {
        movimentacoes = await buscarPaginado(() =>
          supabase
            .from("pagamento_movimentacoes")
            .select("pagamento_id, programacao_id, conta_id, valor, data_movimento")
            .order("pagamento_id", { ascending: true })
        );
      } catch (e) {
        if (!estruturaDeRateioAusente(e)) throw e;
        semRazao = true;
        setAviso(
          "Este ambiente ainda não tem o registro de movimentações por conta. " +
            "Sem ele, o débito realizado em cada conta não pode ser lido -- aplique a atualização do banco de dados para o diagnóstico ficar completo."
        );
      }

      const realizadoPorPagamento = new Map();
      const datasDoMovimento = new Map();
      for (const m of movimentacoes) {
        const chave = String(m.pagamento_id);
        if (!realizadoPorPagamento.has(chave)) realizadoPorPagamento.set(chave, new Map());
        const porConta = realizadoPorPagamento.get(chave);
        const conta = String(m.conta_id);
        porConta.set(conta, emCentavos((porConta.get(conta) ?? 0) + paraNumeroMoeda(m.valor)));
        if (m.data_movimento) datasDoMovimento.set(chave, m.data_movimento);
      }

      // 4. Rateio gravado em cada programação (base do débito correto).
      let rateios = [];
      let semRateioNoBanco = false;
      try {
        rateios = await buscarPaginado(() =>
          supabase
            .from("programacao_contas")
            .select("programacao_id, conta_id, valor_rateado, ordem")
            .order("programacao_id", { ascending: true })
        );
      } catch (e) {
        if (!estruturaDeRateioAusente(e)) throw e;
        semRateioNoBanco = true;
      }

      const rateioPorProgramacao = new Map();
      for (const r of rateios) {
        const chave = String(r.programacao_id);
        if (!rateioPorProgramacao.has(chave)) rateioPorProgramacao.set(chave, []);
        rateioPorProgramacao.get(chave).push(r);
      }

      // 5. Contas envolvidas, para mostrar banco/número/nome.
      const { data: contas, error: eContas } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, bancos(nome)");
      if (eContas) throw eContas;
      const mapaContas = new Map((contas ?? []).map((c) => [String(c.id), c]));

      const montadas = pagos.map((pagamento) => {
        const chavePagamento = String(pagamento.id);
        const programacao = mapaProgramacoes.get(String(pagamento.programacao_id)) ?? null;
        const rateioDaProgramacao = rateioPorProgramacao.get(String(pagamento.programacao_id)) ?? [];
        const valor = emCentavos(pagamento.valor_a_pagar);

        const { esperado, somaRateio, semRateio } = debitoEsperadoPorConta(valor, rateioDaProgramacao);
        const realizado = realizadoPorPagamento.get(chavePagamento) ?? new Map();
        const semRegistro = realizado.size === 0;

        const idsContas = [...new Set([...realizado.keys(), ...esperado.keys()])];
        const detalhes = idsContas
          .map((contaId) => {
            const valorRealizado = emCentavos(realizado.get(contaId) ?? 0);
            const valorEsperado = emCentavos(esperado.get(contaId) ?? 0);
            return {
              contaId,
              conta: nomeDaConta(mapaContas.get(contaId)),
              realizado: valorRealizado,
              temRegistro: realizado.has(contaId),
              esperado: valorEsperado,
              diferenca: emCentavos(valorRealizado - valorEsperado),
            };
          })
          .sort((a, b) => a.conta.localeCompare(b.conta));

        const totalRealizado = somar(detalhes.map((d) => d.realizado));
        const totalEsperado = somar(detalhes.map((d) => d.esperado));
        const diferencaTotal = emCentavos(totalRealizado - totalEsperado);

        return {
          id: chavePagamento,
          titulo: tituloDoPagamento(pagamento),
          descricao: pagamento.descricao ?? "",
          secretaria: programacao?.secretaria ?? "--",
          programacao: programacao?.nome_programacao ?? "",
          data: programacao?.data_programacao ?? datasDoMovimento.get(chavePagamento) ?? null,
          valor,
          somaRateio,
          semRateio: semRateio || semRateioNoBanco,
          semRegistro: semRegistro || semRazao,
          detalhes,
          totalRealizado,
          totalEsperado,
          diferencaTotal,
          temDiferenca: !semRegistro && Math.abs(diferencaTotal) > TOLERANCIA,
        };
      });

      montadas.sort((a, b) => String(b.data ?? "").localeCompare(String(a.data ?? "")));
      setLinhas(montadas);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível montar o diagnóstico dos pagamentos."));
    } finally {
      setCarregando(false);
    }
  }

  const resumo = React.useMemo(() => {
    const comDiferenca = linhas.filter((l) => l.temDiferenca);
    return {
      total: linhas.length,
      comDiferenca: comDiferenca.length,
      semRegistro: linhas.filter((l) => l.semRegistro).length,
      semRateio: linhas.filter((l) => l.semRateio).length,
      diferencaTotal: somar(comDiferenca.map((l) => l.diferencaTotal)),
    };
  }, [linhas]);

  const visiveis = React.useMemo(
    () => (somenteDivergentes ? linhas.filter((l) => l.temDiferenca || l.semRegistro) : linhas),
    [linhas, somenteDivergentes]
  );

  function exportarPlanilha() {
    const dados = [];
    visiveis.forEach((l) => {
      if (l.detalhes.length === 0) {
        dados.push({
          Pagamento: l.titulo,
          Secretaria: l.secretaria,
          Data: dataBR(l.data),
          "Valor do pagamento": l.valor,
          Conta: "Nenhuma conta registrada",
          "Débito realizado": null,
          "Débito correto (rateio)": null,
          Diferença: null,
          Observação: l.semRateio ? "Programação sem rateio gravado" : "Sem registro de débito por conta",
        });
        return;
      }
      l.detalhes.forEach((d) => {
        dados.push({
          Pagamento: l.titulo,
          Secretaria: l.secretaria,
          Data: dataBR(l.data),
          "Valor do pagamento": l.valor,
          Conta: d.conta,
          "Débito realizado": l.semRegistro ? null : d.realizado,
          "Débito correto (rateio)": l.semRateio ? null : d.esperado,
          Diferença: l.semRegistro || l.semRateio ? null : d.diferenca,
          Observação: l.semRegistro
            ? "Sem registro de débito por conta"
            : l.semRateio
            ? "Programação sem rateio gravado"
            : "",
        });
      });
    });

    const cabecalho = [
      "Pagamento", "Secretaria", "Data", "Valor do pagamento", "Conta",
      "Débito realizado", "Débito correto (rateio)", "Diferença", "Observação",
    ];
    const ws = XLSX.utils.json_to_sheet(dados, { header: cabecalho });
    // As quatro colunas de valor saem como número com formato de moeda; célula
    // sem apuração (null) continua em branco e não vira R$ 0,00.
    const colunasDeValor = colunasPorCabecalho(cabecalho, [
      "Valor do pagamento", "Débito realizado", "Débito correto (rateio)", "Diferença",
    ]);
    marcarColunasDeMoeda(ws, colunasDeValor, { ultimaLinha: dados.length });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Diagnóstico");
    XLSX.writeFile(wb, `diagnostico-pagamentos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (verificando) {
    return (
      <Layout>
        <div className="px-8 py-7 text-sm text-[#0F2A44]/50">Verificando suas permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout>
        <AcessoNegado
          modulo="Diagnóstico de pagamentos"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout>
        <AcessoNegado
          modulo="Diagnóstico de pagamentos"
          detalhe="Esta tela de conferência é restrita ao perfil Administrador."
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-8 py-7">
        <div className="flex items-start justify-between mb-5">
          <div>
            <Link to="/configuracoes" className="inline-flex items-center gap-1.5 text-xs text-[#0F2A44]/50 hover:text-[#0F2A44] mb-2">
              <ArrowLeft size={13} /> Configurações
            </Link>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Diagnóstico de Pagamentos Antigos</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-1 max-w-3xl">
              Conferência dos pagamentos já marcados como pagos: o que foi debitado em cada conta
              (histórico atual) ao lado do que deveria ter sido debitado pela lógica correta, em que
              o rateio entre as contas soma exatamente o valor do pagamento.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={carregar}
              disabled={carregando}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/[0.02] disabled:opacity-50"
            >
              <RefreshCw size={14} /> Atualizar
            </button>
            <button
              onClick={exportarPlanilha}
              disabled={carregando || visiveis.length === 0}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/[0.02] disabled:opacity-50"
            >
              <FileSpreadsheet size={14} /> Exportar
            </button>
          </div>
        </div>

        <div className="bg-[#FFF6E5] border border-[#EA9A1E]/30 rounded-xl px-4 py-3 mb-5 flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-[#EA9A1E] mt-0.5 shrink-0" />
          <div className="text-sm text-[#0F2A44]/80">
            <span className="font-semibold">Nada é corrigido por esta tela.</span> Ela apenas lê e
            compara os registros. Nenhum saldo, pagamento ou histórico é alterado — a decisão sobre
            o que fazer com as diferenças encontradas é manual, em uma etapa futura.
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">{erro}</div>
        )}
        {aviso && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-5">
            {aviso}
          </div>
        )}

        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Montando o diagnóstico...</div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-4 mb-5">
              {[
                { rotulo: "Pagamentos pagos analisados", valor: String(resumo.total) },
                { rotulo: "Com diferença encontrada", valor: String(resumo.comDiferenca), destaque: resumo.comDiferenca > 0 },
                { rotulo: "Sem registro de débito por conta", valor: String(resumo.semRegistro) },
                { rotulo: "Diferença somada", valor: formatBRL(resumo.diferencaTotal), destaque: Math.abs(resumo.diferencaTotal) > TOLERANCIA },
              ].map((cartao) => (
                <div key={cartao.rotulo} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                  <div className="text-xs text-[#0F2A44]/50">{cartao.rotulo}</div>
                  <div
                    className="text-xl font-semibold mt-1 tabular-nums"
                    style={{ color: cartao.destaque ? "#DC2626" : "#0F2A44" }}
                  >
                    {cartao.valor}
                  </div>
                </div>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-[#0F2A44]/70 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={somenteDivergentes}
                onChange={(e) => setSomenteDivergentes(e.target.checked)}
              />
              Mostrar somente os pagamentos com diferença ou sem registro de débito
            </label>

            {visiveis.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/50">
                {linhas.length === 0
                  ? "Nenhum pagamento marcado como pago foi encontrado."
                  : "Nenhum pagamento com diferença: os débitos registrados batem com o rateio."}
              </div>
            ) : (
              <div className="space-y-4">
                {visiveis.map((linha) => (
                  <div key={linha.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-black/5 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-[#0F2A44] truncate">{linha.titulo}</div>
                        <div className="text-xs text-[#0F2A44]/50 mt-0.5">
                          {dataBR(linha.data)} · {linha.secretaria}
                          {linha.programacao ? ` · ${linha.programacao}` : ""}
                          {linha.descricao ? ` · ${linha.descricao}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-[#0F2A44]/50">Valor do pagamento</div>
                        <div className="text-base font-semibold tabular-nums">{formatBRL(linha.valor)}</div>
                      </div>
                    </div>

                    {(linha.semRegistro || linha.semRateio) && (
                      <div className="px-5 py-2.5 bg-amber-50/70 border-b border-amber-100 flex items-start gap-2 text-xs text-amber-800">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span>
                          {linha.semRegistro &&
                            "Este pagamento não tem registro de débito por conta (foi efetivado antes do controle de movimentações), então o débito realizado não pode ser lido aqui. "}
                          {linha.semRateio &&
                            "A programação deste pagamento não tem rateio gravado, então o débito correto por conta não pode ser calculado."}
                        </span>
                      </div>
                    )}

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-[#0F2A44]/45 border-b border-black/5">
                          <th className="text-left font-medium px-5 py-2">Conta envolvida</th>
                          <th className="text-right font-medium px-5 py-2">Débito realizado (histórico)</th>
                          <th className="text-right font-medium px-5 py-2">Débito correto (rateio)</th>
                          <th className="text-right font-medium px-5 py-2">Diferença</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linha.detalhes.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-5 py-3 text-xs text-[#0F2A44]/50">
                              Nenhuma conta registrada para este pagamento.
                            </td>
                          </tr>
                        ) : (
                          linha.detalhes.map((d) => (
                            <tr key={d.contaId} className="border-b border-black/5 last:border-0">
                              <td className="px-5 py-2.5">{d.conta}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">
                                {linha.semRegistro || !d.temRegistro ? (
                                  <span className="text-[#0F2A44]/40">não registrado</span>
                                ) : (
                                  formatBRL(d.realizado)
                                )}
                              </td>
                              <td className="px-5 py-2.5 text-right tabular-nums">
                                {linha.semRateio ? (
                                  <span className="text-[#0F2A44]/40">--</span>
                                ) : (
                                  formatBRL(d.esperado)
                                )}
                              </td>
                              <td
                                className="px-5 py-2.5 text-right tabular-nums font-medium"
                                style={{ color: Math.abs(d.diferenca) > TOLERANCIA ? "#DC2626" : "#0F2A44" }}
                              >
                                {linha.semRegistro || linha.semRateio ? (
                                  <span className="text-[#0F2A44]/40">--</span>
                                ) : (
                                  formatBRL(d.diferenca)
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {linha.detalhes.length > 0 && (
                        <tfoot>
                          <tr className="bg-black/[0.015] text-[#0F2A44]">
                            <td className="px-5 py-2.5 font-medium">Total do pagamento</td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-semibold">
                              {linha.semRegistro ? "--" : formatBRL(linha.totalRealizado)}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-semibold">
                              {linha.semRateio ? "--" : formatBRL(linha.totalEsperado)}
                            </td>
                            <td
                              className="px-5 py-2.5 text-right tabular-nums font-semibold"
                              style={{ color: linha.temDiferenca ? "#DC2626" : "#0F2A44" }}
                            >
                              {linha.semRegistro || linha.semRateio ? "--" : formatBRL(linha.diferencaTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
