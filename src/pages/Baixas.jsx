import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Info,
  Printer,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import PainelFiltros from "../components/comuns/PainelFiltros";
import ModalRegistrarBaixa from "../components/baixas/ModalRegistrarBaixa";
import ModalEstornarBaixa from "../components/baixas/ModalEstornarBaixa";
import { carregarBaseDaTelaDeBaixas, carregarNotasEBaixas } from "../lib/baixasPagamentos";
import { usePermissoesBaixas } from "../lib/permissoesBaixas";
import {
  baixasDaNota,
  descricaoDaNota,
  filtrarFornecedores,
  filtrarNotasDaTela,
  filtroBaixasAtivo,
  FILTRO_BAIXAS_VAZIO,
  nomeDoFornecedor,
  notasEmAberto,
  numeroDaNota,
  resumoDaNota,
  totaisDasNotas,
} from "../lib/regrasBaixas";
import { exportarExcelBaixas, gerarPdfBaixas, imprimirBaixas, VISAO_BAIXAS, VISAO_NOTAS } from "../lib/baixasDocumento";
import { formatarData, hojeISO, situacaoDaNota } from "../lib/notasFornecedor";
import { formatBRL } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";

/**
 * Aba "Baixas de Pagamentos".
 *
 * A baixa é a confirmação de que o pagamento saiu de fato no banco. Ela é
 * INDEPENDENTE da Programação Diária -- uma nota pode ser baixada sem nunca ter
 * sido programada -- e NÃO DEBITA O SALDO DA CONTA: registra o pagamento e abate
 * o valor em aberto da nota do fornecedor. O saldo continua sendo movimentado
 * exclusivamente pelos fluxos que já existiam (lançamento do saldo do dia e
 * transferência entre contas).
 *
 * O caminho da tela é o do balcão:
 *   1. escolher o fornecedor (nome, razão social, nome fantasia ou CNPJ/CPF);
 *   2. ver as notas dele que ainda têm valor em aberto;
 *   3. abrir a nota para registrar a baixa -- parcial ou integral -- e ler o
 *      histórico das baixas que ela já recebeu.
 *
 * Baixa parcial deixa o restante em aberto, que pode receber quantas baixas
 * forem necessárias até zerar; ao zerar, a nota fica quitada e sai da lista.
 * Estorno devolve o valor para o em aberto e PRESERVA o registro original.
 */

/** Situações em que a nota ainda pode receber baixa, com o rótulo da listagem. */
const SITUACOES_NOTA = [
  { value: "em_aberto", label: "Em aberto" },
  { value: "programado", label: "Programada" },
  { value: "parcialmente_pago", label: "Parcialmente paga" },
  { value: "suspenso", label: "Suspensa" },
];

const LIMITE_SUGESTOES = 8;

function textoDaConta(conta) {
  if (!conta) return "--";
  const nome = String(conta.nome_conta ?? "").trim() || `Conta ${conta.id}`;
  const banco = String(conta.bancos?.nome ?? "").trim();
  const numero = String(conta.numero_conta ?? "").trim();
  return [nome, banco, numero].filter(Boolean).join(" · ");
}

export default function Baixas() {
  const { carregando: verificando, usuario: usuarioLogado, permissoes, erro: erroPermissao } = usePermissoesBaixas();

  const [base, setBase] = React.useState({ fornecedores: [], contas: [], usuarios: [] });
  const [fornecedorId, setFornecedorId] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [notas, setNotas] = React.useState([]);
  const [baixas, setBaixas] = React.useState([]);
  const [filtros, setFiltros] = React.useState(FILTRO_BAIXAS_VAZIO);
  const [expandida, setExpandida] = React.useState("");
  const [notaParaBaixa, setNotaParaBaixa] = React.useState(null);
  const [baixaParaEstorno, setBaixaParaEstorno] = React.useState(null);
  const [carregandoBase, setCarregandoBase] = React.useState(true);
  const [carregandoNotas, setCarregandoNotas] = React.useState(false);
  const [exportando, setExportando] = React.useState(null);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);

  const podeVisualizar = permissoes.visualizar;

  // Fornecedores, contas e usuários: a base da tela, carregada uma vez.
  React.useEffect(() => {
    if (verificando || !podeVisualizar) return;
    let ativo = true;

    (async () => {
      setCarregandoBase(true);
      try {
        const dados = await carregarBaseDaTelaDeBaixas();
        if (ativo) setBase(dados);
      } catch (falha) {
        console.error("[Baixas] Não foi possível carregar fornecedores e contas.", falha);
        if (ativo) setErro(mensagemAmigavel(falha, "Não foi possível carregar os fornecedores e as contas."));
      } finally {
        if (ativo) setCarregandoBase(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [verificando, podeVisualizar]);

  const recarregarNotas = React.useCallback(async () => {
    if (!fornecedorId) {
      setNotas([]);
      setBaixas([]);
      return;
    }
    setCarregandoNotas(true);
    setErro(null);
    try {
      // As quitadas vêm junto: a listagem só mostra as que têm valor em aberto,
      // mas o histórico e os documentos precisam da nota que a baixa quitou.
      const dados = await carregarNotasEBaixas(fornecedorId, { incluirQuitadas: true });
      setNotas(dados.notas);
      setBaixas(dados.baixas);
    } catch (falha) {
      console.error("[Baixas] Não foi possível carregar as notas do fornecedor.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as notas deste fornecedor."));
    } finally {
      setCarregandoNotas(false);
    }
  }, [fornecedorId]);

  React.useEffect(() => {
    recarregarNotas();
  }, [recarregarNotas]);

  const fornecedor = React.useMemo(
    () => base.fornecedores.find((item) => String(item.id) === String(fornecedorId)) ?? null,
    [base.fornecedores, fornecedorId],
  );
  const sugestoes = React.useMemo(
    () => (busca.trim() === "" ? [] : filtrarFornecedores(base.fornecedores, busca).slice(0, LIMITE_SUGESTOES)),
    [base.fornecedores, busca],
  );

  const hoje = hojeISO();
  const abertas = React.useMemo(() => notasEmAberto(notas), [notas]);
  const notasFiltradas = React.useMemo(() => filtrarNotasDaTela(abertas, filtros, hoje), [abertas, filtros, hoje]);
  const totais = React.useMemo(() => totaisDasNotas(notasFiltradas), [notasFiltradas]);
  const contaPorId = React.useMemo(
    () => new Map(base.contas.map((conta) => [String(conta.id), conta])),
    [base.contas],
  );
  const usuarioPorId = React.useMemo(
    () => new Map(base.usuarios.map((item) => [String(item.id), item])),
    [base.usuarios],
  );

  const filtrosAtivos = filtroBaixasAtivo(filtros);
  const chips = [
    filtros.busca.trim() && { chave: "busca", rotulo: `Nota: ${filtros.busca.trim()}` },
    filtros.situacao && {
      chave: "situacao",
      rotulo: `Situação: ${SITUACOES_NOTA.find((s) => s.value === filtros.situacao)?.label ?? filtros.situacao}`,
    },
    filtros.inicio && { chave: "inicio", rotulo: `Vence de ${formatarData(filtros.inicio)}` },
    filtros.fim && { chave: "fim", rotulo: `Vence até ${formatarData(filtros.fim)}` },
    filtros.somenteVencidas && { chave: "vencidas", rotulo: "Somente vencidas" },
  ].filter(Boolean);

  function alterarFiltro(campo, valor) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  function escolherFornecedor(item) {
    setFornecedorId(String(item.id));
    setBusca("");
    setExpandida("");
    setAviso(null);
    setFiltros(FILTRO_BAIXAS_VAZIO);
  }

  function trocarFornecedor() {
    setFornecedorId("");
    setNotas([]);
    setBaixas([]);
    setExpandida("");
    setAviso(null);
  }

  /* --- Documentos: sempre com o recorte que está na tela --- */

  function dadosDoDocumento(visao) {
    return {
      visao,
      notas: notasFiltradas,
      notasTodas: notas,
      baixas,
      contas: base.contas,
      usuarios: base.usuarios,
      fornecedores: base.fornecedores,
      situacoes: SITUACOES_NOTA,
      filtros: { ...filtros, fornecedorId },
      usuario: usuarioLogado,
      agrupado: true,
      hoje,
    };
  }

  function imprimir() {
    return imprimirBaixas(dadosDoDocumento(VISAO_NOTAS));
  }

  function exportarPDF() {
    return gerarPdfBaixas(dadosDoDocumento(VISAO_NOTAS));
  }

  function exportarExcel() {
    return exportarExcelBaixas(dadosDoDocumento(VISAO_BAIXAS));
  }

  async function gerarDocumento(destino) {
    setExportando(destino);
    setErro(null);
    try {
      const gerou =
        destino === "impressao" ? imprimir() : destino === "pdf" ? exportarPDF() : exportarExcel();
      if (!gerou) setErro("Não há nada para incluir no documento com os filtros aplicados.");
    } catch (falha) {
      console.error("[Baixas] Não foi possível gerar o documento.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível gerar o documento."));
    } finally {
      setExportando(null);
    }
  }

  /* --- Baixa e estorno --- */

  async function aoRegistrarBaixa(retorno) {
    await recarregarNotas();
    if (retorno?.ja_registrada) {
      setAviso("Esta baixa já havia sido registrada. Nada foi lançado em duplicidade.");
      return;
    }
    const emAberto = Number(retorno?.valor_em_aberto ?? 0);
    setAviso(
      retorno?.quitada
        ? `Baixa registrada. A nota foi quitada e saiu da lista de notas em aberto. O saldo da conta não foi alterado.`
        : `Baixa registrada. A nota continua com ${formatBRL(emAberto)} em aberto. O saldo da conta não foi alterado.`,
    );
  }

  async function aoEstornarBaixa(retorno) {
    await recarregarNotas();
    setAviso(
      retorno?.ja_estornada
        ? "Esta baixa já estava estornada."
        : `Baixa estornada. O valor voltou para o em aberto da nota e o registro original foi preservado.`,
    );
  }

  const infoLayout = usuarioLogado ? { nome: usuarioLogado.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Baixas de Pagamentos" detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`} />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Baixas de Pagamentos" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
              Pagamentos executados
            </div>
            <h1 className="mt-0.5 text-2xl font-semibold text-[#0F2A44]">Baixas de Pagamentos</h1>
            <p className="mt-0.5 text-sm text-[#0F2A44]/60">
              {fornecedor
                ? `${notasFiltradas.length} ${
                    notasFiltradas.length === 1 ? "nota em aberto" : "notas em aberto"
                  } de ${nomeDoFornecedor(fornecedor)}`
                : "Escolha o fornecedor para ver as notas que ainda têm valor em aberto"}
            </p>
          </div>

          {fornecedor && (
            <div className="flex flex-wrap items-center gap-2 self-start">
              {permissoes.imprimir && (
                <>
                  <button
                    type="button"
                    onClick={() => gerarDocumento("impressao")}
                    disabled={carregandoNotas || exportando !== null}
                    className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
                  >
                    <Printer size={15} />
                    {exportando === "impressao" ? "Preparando..." : "Imprimir"}
                  </button>
                  <button
                    type="button"
                    onClick={() => gerarDocumento("pdf")}
                    disabled={carregandoNotas || exportando !== null}
                    className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
                  >
                    <FileText size={15} />
                    {exportando === "pdf" ? "Gerando..." : "PDF"}
                  </button>
                </>
              )}
              {permissoes.exportar && (
                <button
                  type="button"
                  onClick={() => gerarDocumento("excel")}
                  disabled={carregandoNotas || exportando !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
                >
                  <FileSpreadsheet size={15} />
                  {exportando === "excel" ? "Exportando..." : "Excel"}
                </button>
              )}
            </div>
          )}
        </div>

        {erro && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
        )}
        {aviso && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-[#C9A227]/30 bg-[#FBF6E6] px-4 py-3 text-sm text-[#0F2A44]/80">
            <Info size={16} className="mt-0.5 shrink-0 text-[#C9A227]" />
            <span>{aviso}</span>
          </div>
        )}

        {/* Passo 1 -- o fornecedor. */}
        <section className="mb-5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
          {fornecedor ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF1FF] text-[#0F2A44]">
                  <Users size={17} />
                </span>
                <div>
                  <div className="text-sm font-semibold text-[#0F2A44]">{nomeDoFornecedor(fornecedor)}</div>
                  <div className="text-xs text-[#0F2A44]/55">
                    {[fornecedor.cpf_cnpj, fornecedor.secretarias?.nome].filter(Boolean).join(" · ") ||
                      "Sem CNPJ/CPF informado"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={trocarFornecedor}
                className="rounded-lg border border-black/10 px-3 py-2 text-xs text-[#0F2A44]/70 hover:bg-black/5"
              >
                Trocar fornecedor
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-[#0F2A44]/70">
                Fornecedor
                <div className="relative mt-1">
                  <Search size={15} className="pointer-events-none absolute left-3 top-3 text-[#0F2A44]/35" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Busque por nome, razão social, nome fantasia ou CNPJ/CPF"
                    className="w-full rounded-lg border border-black/10 py-2.5 pl-9 pr-3 text-sm"
                  />
                </div>
              </label>

              {carregandoBase && <p className="mt-3 text-xs text-[#0F2A44]/45">Carregando fornecedores...</p>}

              {!carregandoBase && busca.trim() !== "" && sugestoes.length === 0 && (
                <p className="mt-3 text-xs text-[#0F2A44]/45">Nenhum fornecedor encontrado para essa busca.</p>
              )}

              {sugestoes.length > 0 && (
                <ul className="mt-3 divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5">
                  {sugestoes.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => escolherFornecedor(item)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#F4F7F9]"
                      >
                        <span>
                          <span className="block text-sm text-[#0F2A44]">{nomeDoFornecedor(item)}</span>
                          <span className="block text-xs text-[#0F2A44]/50">
                            {[item.cpf_cnpj, item.secretarias?.nome].filter(Boolean).join(" · ") || "Sem CNPJ/CPF"}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-[#0F2A44]/30" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {fornecedor && (
          <>
            <PainelFiltros
              rotulo="Filtros das notas"
              chips={chips}
              totalAtivos={chips.length}
              onLimpar={() => setFiltros(FILTRO_BAIXAS_VAZIO)}
              className="mb-4"
              resumo={filtrosAtivos ? "As notas, a impressão, o PDF e o Excel seguem estes filtros." : null}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-xs font-medium text-[#0F2A44]/70">
                  Nota, empenho ou processo
                  <input
                    value={filtros.busca}
                    onChange={(e) => alterarFiltro("busca", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#0F2A44]/70">
                  Vencimento de
                  <input
                    type="date"
                    value={filtros.inicio}
                    onChange={(e) => alterarFiltro("inicio", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#0F2A44]/70">
                  Vencimento até
                  <input
                    type="date"
                    value={filtros.fim}
                    onChange={(e) => alterarFiltro("fim", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-[#0F2A44]/70">
                  Situação
                  <select
                    value={filtros.situacao}
                    onChange={(e) => alterarFiltro("situacao", e.target.value)}
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Todas</option>
                    {SITUACOES_NOTA.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end text-xs font-medium text-[#0F2A44]/70">
                  <input
                    type="checkbox"
                    checked={filtros.somenteVencidas}
                    onChange={(e) => alterarFiltro("somenteVencidas", e.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  Somente notas vencidas
                </label>
              </div>
            </PainelFiltros>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <span className="text-xs text-[#0F2A44]/50">Notas em aberto</span>
                <strong className="block text-xl text-[#0F2A44]">{totais.notas}</strong>
              </div>
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <span className="text-xs text-[#0F2A44]/50">Valor original</span>
                <strong className="block text-xl tabular-nums text-[#0F2A44]">{formatBRL(totais.valorTotal)}</strong>
              </div>
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <span className="text-xs text-[#0F2A44]/50">Já baixado</span>
                <strong className="block text-xl tabular-nums text-[#0F2A44]">{formatBRL(totais.valorBaixado)}</strong>
              </div>
              <div className="rounded-xl border border-black/5 bg-white p-4">
                <span className="text-xs text-[#0F2A44]/50">Em aberto</span>
                <strong className="block text-xl tabular-nums text-[#0F2A44]">{formatBRL(totais.valorEmAberto)}</strong>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/45">
                    <th className="w-8 p-3"></th>
                    <th className="p-3">Vencimento</th>
                    <th className="p-3">Nota fiscal</th>
                    <th className="p-3">Descrição</th>
                    <th className="p-3">Situação</th>
                    <th className="p-3 text-right">Valor original</th>
                    <th className="p-3 text-right">Já baixado</th>
                    <th className="p-3 text-right">Em aberto</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {carregandoNotas && (
                    <tr>
                      <td colSpan="9" className="p-8 text-center text-[#0F2A44]/40">
                        Carregando notas...
                      </td>
                    </tr>
                  )}

                  {!carregandoNotas && notasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan="9" className="p-8 text-center text-[#0F2A44]/40">
                        {abertas.length === 0
                          ? "Este fornecedor não tem notas com valor em aberto."
                          : "Nenhuma nota encontrada com os filtros aplicados."}
                      </td>
                    </tr>
                  )}

                  {!carregandoNotas &&
                    notasFiltradas.map((nota) => {
                      const resumo = resumoDaNota(nota);
                      const situacao = situacaoDaNota(nota, SITUACOES_NOTA, hoje);
                      const historico = baixasDaNota(nota, baixas);
                      const aberta = String(expandida) === String(nota.id);

                      return (
                        <React.Fragment key={nota.id}>
                          <tr
                            className="cursor-pointer border-b border-black/5 align-top hover:bg-[#F9FBFC]"
                            onClick={() => setExpandida(aberta ? "" : String(nota.id))}
                          >
                            <td className="p-3 text-[#0F2A44]/35">
                              {aberta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </td>
                            <td className="p-3 whitespace-nowrap">{formatarData(nota.data_vencimento)}</td>
                            <td className="p-3 font-medium text-[#0F2A44]">{numeroDaNota(nota)}</td>
                            <td className="p-3 text-xs text-[#0F2A44]/60">{descricaoDaNota(nota) || "--"}</td>
                            <td className="p-3">
                              <span
                                className="rounded-full px-2 py-1 text-[11px]"
                                style={{ color: situacao.cor, background: situacao.bg }}
                              >
                                {situacao.rotulo}
                              </span>
                            </td>
                            <td className="p-3 text-right tabular-nums">{formatBRL(resumo.valorTotal)}</td>
                            <td className="p-3 text-right tabular-nums text-[#0F2A44]/60">
                              {formatBRL(resumo.valorBaixado)}
                            </td>
                            <td className="p-3 text-right font-semibold tabular-nums">
                              {formatBRL(resumo.valorEmAberto)}
                            </td>
                            <td className="p-3 text-right">
                              {permissoes.registrar && (
                                <button
                                  type="button"
                                  onClick={(evento) => {
                                    evento.stopPropagation();
                                    setNotaParaBaixa(nota);
                                  }}
                                  className="whitespace-nowrap rounded-lg bg-[#0F2A44] px-3 py-2 text-xs font-medium text-white hover:bg-[#0F2A44]/90"
                                >
                                  Registrar baixa
                                </button>
                              )}
                            </td>
                          </tr>

                          {aberta && (
                            <tr className="border-b border-black/5 bg-[#F9FBFC]">
                              <td colSpan="9" className="px-5 py-4">
                                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#0F2A44]/45">
                                  Baixas desta nota
                                </div>

                                {historico.length === 0 ? (
                                  <p className="text-xs text-[#0F2A44]/50">
                                    Esta nota ainda não recebeu baixa. O valor em aberto é{" "}
                                    {formatBRL(resumo.valorEmAberto)}.
                                  </p>
                                ) : (
                                  <ul className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5 bg-white">
                                    {historico.map((baixa) => {
                                      const estornada = baixa.status === "estornada";
                                      return (
                                        <li
                                          key={baixa.id}
                                          className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
                                        >
                                          <div className="min-w-0 text-xs text-[#0F2A44]/60">
                                            <div className="text-sm text-[#0F2A44]">
                                              <strong className="tabular-nums">{formatBRL(baixa.valor_pago)}</strong>
                                              {" · "}
                                              {formatarData(baixa.data_pagamento)}
                                              {estornada && (
                                                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                                  Estornada
                                                </span>
                                              )}
                                            </div>
                                            <div>
                                              {textoDaConta(contaPorId.get(String(baixa.conta_id)))}
                                              {" · "}
                                              {usuarioPorId.get(String(baixa.usuario_id))?.nome_completo ??
                                                "usuário não identificado"}
                                            </div>
                                            {baixa.observacao && <div className="mt-0.5">{baixa.observacao}</div>}
                                            {baixa.motivo_estorno && (
                                              <div className="mt-0.5 text-[#8A321C]">
                                                Estorno: {baixa.motivo_estorno}
                                              </div>
                                            )}
                                          </div>

                                          {permissoes.estornar && !estornada && (
                                            <button
                                              type="button"
                                              onClick={() => setBaixaParaEstorno({ baixa, nota })}
                                              className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-xs text-[#8A321C] hover:bg-[#FBE9DF]"
                                            >
                                              <RotateCcw size={14} /> Estornar
                                            </button>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}

                                {permissoes.registrar && (
                                  <button
                                    type="button"
                                    onClick={() => setNotaParaBaixa(nota)}
                                    className="mt-3 rounded-lg border border-[#0F2A44]/15 px-3 py-2 text-xs font-medium text-[#0F2A44] hover:bg-black/5"
                                  >
                                    Registrar nova baixa desta nota
                                  </button>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-[#0F2A44]/50">
              A baixa confirma o pagamento e abate o valor em aberto da nota. Ela não altera o saldo da conta bancária:
              o saldo continua sendo movimentado apenas pelo lançamento do saldo do dia e pela transferência entre
              contas.
            </p>
          </>
        )}
      </div>

      {notaParaBaixa && (
        <ModalRegistrarBaixa
          nota={notaParaBaixa}
          fornecedor={nomeDoFornecedor(fornecedor)}
          contas={base.contas}
          onFechar={() => setNotaParaBaixa(null)}
          onConcluida={aoRegistrarBaixa}
        />
      )}

      {baixaParaEstorno && (
        <ModalEstornarBaixa
          baixa={baixaParaEstorno.baixa}
          nota={numeroDaNota(baixaParaEstorno.nota)}
          nomeConta={textoDaConta(contaPorId.get(String(baixaParaEstorno.baixa.conta_id)))}
          onFechar={() => setBaixaParaEstorno(null)}
          onConcluido={aoEstornarBaixa}
        />
      )}
    </Layout>
  );
}
