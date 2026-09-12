import React from "react";
import {
  Ban,
  Copy,
  Eye,
  FileDown,
  History,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import PainelFiltros from "../comuns/PainelFiltros.jsx";
import ModalConfirmarExclusao from "../comuns/ModalConfirmarExclusao.jsx";
import ModalProcessoServico from "./ModalProcessoServico.jsx";
import { podeVerServidores } from "../../lib/processosServidores.js";
import PreVisualizacaoProcessoServico from "./PreVisualizacaoProcessoServico.jsx";
import ModalHistoricoProcesso from "./ModalHistoricoProcesso.jsx";
// ⚠️ As falhas desta tela passam por `mensagemFalhaDoProcesso`, não pela
// mensagem genérica: recusa por TIPO de coluna (22P02) precisa dizer ao
// operador que não foi ele, que nada foi gravado e qual migration corrige.
import { mensagemFalhaDoProcesso } from "../../lib/processosErros.js";
import {
  AVISO_MIGRATION_SERVICOS,
  SITUACOES_SERVICO,
  TIPOS_REQUISICAO,
  acoesDisponiveis,
  anosDosProcessos,
  dataBR,
  duplicarProcesso,
  filtrarProcessos,
  filtrosVazios,
  nomeDaSecretaria,
  numeroDoProcesso,
  objetoDoProcesso,
  preenchimentoDoProcesso,
  rotuloDoTipo,
  situacaoServicoInfo,
  tipoInfo,
  tituloDoProcesso,
  totalFiltrosAtivos,
  valorDoProcesso,
} from "../../lib/processosServicos.js";
import {
  cancelarProcessoServico,
  carregarProcessosServicos,
  criarProcessoServico,
  estruturaDeServicosAusente,
  excluirRascunhoServico,
  finalizarProcessoServico,
  listarHistorico,
  reabrirProcessoServico,
  registrarSaidaDoDocumento,
  salvarProcessoServico,
} from "../../lib/processosServicosDados.js";
import {
  dadosDoDocumento,
  folhasDoEscopo,
  gerarPdfDoProcesso,
  imprimirProcesso,
} from "../../lib/processosServicosDocumento.js";
import {
  carregarIdentidadeProcessos,
  carregarLogomarcaDoSistema,
  prepararLogoParaDocumento,
} from "../../lib/processosIdentidadeDados.js";
import { identidadeDoProcesso, logoDoDocumento } from "../../lib/processosIdentidade.js";
import { carregarPrefeitas, registrosDoCadastro } from "../../lib/processosCadastrosDados.js";
import { prefeitaVigente } from "../../lib/processosPrefeita.js";

/**
 * A área de SERVIÇOS/MATERIAIS: a lista dos processos e tudo o que se faz com um.
 *
 * Cada linha é UM processo com DUAS páginas (Requisição de Material/Serviço e
 * Liquidação/Solicitação de Pagamento). Não há lista de liquidações em separado,
 * porque a liquidação não existe em separado: é a segunda folha do mesmo
 * processo, com os mesmos dados gerais. O indicador embaixo do fornecedor diz
 * quais páginas já foram preenchidas -- e liquidação pendente é informação, não
 * impedimento.
 *
 * NADA AQUI É FINANCEIRO. Criar, salvar, finalizar, duplicar, imprimir, gerar
 * PDF ou cancelar não debita conta, não dá baixa em NF, não altera saldo, não
 * marca fornecedor como pago, não cria pagamento e não mexe na Programação
 * Diária. "Liquidação/Solicitação de Pagamento" é o NOME DO DOCUMENTO: ele pede
 * autorização em papel, e não dá baixa em nada. As únicas tabelas que a tela
 * escreve são as do módulo e a auditoria.
 */
export default function PaginaServicos({
  permissoes = {},
  permissoesServidores = {},
  fornecedores = [],
  // ⚠️ O cadastro PRÓPRIO do módulo: quem REQUISITA. `secretarias` é a lista de
  // CONSULTA (solicitantes + as do financeiro, só leitura), usada para resolver
  // nome e filtrar -- inclusive no processo antigo.
  solicitantes = [],
  secretarias = [],
  // As secretarias ATIVAS do cadastro do MÓDULO FINANCEIRO, apenas para LER:
  // são as oferecidas em "Encaminhar à Secretaria de", o destino do despacho da
  // prefeita. Nada é criado, alterado ou excluído nesse cadastro daqui.
  secretariasFinanceiras = [],
  bancos = [],
  servidores = [],
  carregandoApoio = false,
  usuario = null,
}) {
  const [processos, setProcessos] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [faltaMigration, setFaltaMigration] = React.useState(false);

  const [busca, setBusca] = React.useState("");
  const [filtros, setFiltros] = React.useState(filtrosVazios);

  // O processo aberto no formulário. `aberto.processo` é null em "+ Nova
  // Solicitação" e em duplicação -- nos dois casos o número é emitido na
  // gravação.
  const [aberto, setAberto] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erroForm, setErroForm] = React.useState(null);
  const [ultimoSalvamento, setUltimoSalvamento] = React.useState(null);

  const [previa, setPrevia] = React.useState(null);
  const [historico, setHistorico] = React.useState(null);
  const [confirmacao, setConfirmacao] = React.useState(null);

  // A IDENTIDADE VISUAL vigente, lida uma vez: ela alimenta a folha (brasão e
  // rodapé). Esta tela só a lê; quem a configura é Configurações → Processos.
  const [identidade, setIdentidade] = React.useState(null);
  // A LOGOMARCA CADASTRADA do sistema (Configurações -> Aparência) e a PREFEITA
  // em vigor. A logomarca é o segundo degrau da escolha do brasão do documento;
  // a prefeita preenche, já pronta, a autorização e a identificação abaixo da
  // linha de assinatura. Só leitura: esta tela não escreve nenhuma das duas.
  const [logoSistema, setLogoSistema] = React.useState(null);
  const [prefeita, setPrefeita] = React.useState(null);

  React.useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const url = await carregarLogomarcaDoSistema();
        if (vivo) setLogoSistema(url);
      } catch {
        // Sem a logomarca do sistema o documento cai no degrau seguinte.
      }
      try {
        const cadastradas = registrosDoCadastro(await carregarPrefeitas());
        if (vivo) setPrefeita(prefeitaVigente(cadastradas));
      } catch {
        // Sem o cadastro da prefeita as linhas dela saem em branco, para
        // completar à mão -- exatamente como era antes deste cadastro existir.
      }
      try {
        const { identidade: atual } = await carregarIdentidadeProcessos();
        if (vivo) setIdentidade(atual);
      } catch {
        // Identidade indisponível: a folha sai com o cabeçalho e o brasão padrão.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setFaltaMigration(false);
    try {
      setProcessos(await carregarProcessosServicos());
    } catch (falha) {
      if (estruturaDeServicosAusente(falha)) {
        setFaltaMigration(true);
        setProcessos([]);
      } else {
        setErro(mensagemFalhaDoProcesso(falha, "Não foi possível carregar os processos de serviços/materiais."));
      }
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = React.useMemo(
    () => filtrarProcessos(processos, { busca, filtros, secretarias }),
    [processos, busca, filtros, secretarias],
  );
  const anos = React.useMemo(() => anosDosProcessos(processos), [processos]);
  const ativos = totalFiltrosAtivos(filtros);

  const chips = React.useMemo(() => {
    const rotulos = {
      ano: (v) => `Ano: ${v}`,
      periodoInicio: (v) => `A partir de ${dataBR(v)}`,
      periodoFim: (v) => `Até ${dataBR(v)}`,
      secretaria: (v) => `Secretaria: ${secretarias.find((s) => String(s.id) === String(v))?.nome ?? v}`,
      tipo: (v) => `Tipo: ${tipoInfo(v)?.curto ?? v}`,
      fornecedor: (v) => `Fornecedor: ${v}`,
      situacao: (v) => `Situação: ${situacaoServicoInfo(v).rotulo}`,
    };
    return Object.entries(filtros)
      .filter(([, valor]) => String(valor ?? "").trim() !== "")
      .map(([chave, valor]) => ({
        chave,
        rotulo: rotulos[chave] ? rotulos[chave](valor) : `${chave}: ${valor}`,
        remover: () => setFiltros((atual) => ({ ...atual, [chave]: "" })),
      }));
  }, [filtros, secretarias]);

  /* ---------------------------------------------------------------------
   * Gravação
   * ------------------------------------------------------------------ */

  function marcarSalvamento() {
    setUltimoSalvamento(
      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    );
  }

  /** Cria o processo: é aqui que o número é emitido, pelo banco. */
  async function criar(formulario) {
    setSalvando(true);
    setErroForm(null);
    try {
      const origem = aberto?.origem ?? null;
      const criado = await criarProcessoServico(formulario, {
        ano: formulario.ano ?? new Date().getFullYear(),
        origem,
      });
      setAberto({ processo: criado, origem: null, inicial: null });
      marcarSalvamento();
      setAviso(
        origem?.id
          ? `Processo nº ${numeroDoProcesso(criado)} criado por duplicação. O processo nº ${
              origem.numero ?? "--"
            } não foi alterado.`
          : `Processo nº ${numeroDoProcesso(criado)} criado como rascunho. Nenhum pagamento foi gerado.`,
      );
      await carregar();
      return true;
    } catch (falha) {
      setErroForm(mensagemFalhaDoProcesso(falha, "Não foi possível criar este processo."));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Salva o rascunho. O mesmo caminho serve ao botão Salvar e ao salvamento
   * automático -- o automático só não enche a trilha de uma linha por tecla.
   */
  async function salvar(formulario, { silencioso = false } = {}) {
    if (!silencioso) setSalvando(true);
    setErroForm(null);
    try {
      const atualizado = await salvarProcessoServico(aberto?.processo, formulario, { silencioso });
      setAberto((atual) => (atual ? { ...atual, processo: atualizado } : atual));
      marcarSalvamento();
      setProcessos((atual) => atual.map((p) => (p.id === atualizado.id ? atualizado : p)));
      return true;
    } catch (falha) {
      setErroForm(mensagemFalhaDoProcesso(falha, "Não foi possível salvar as alterações."));
      return false;
    } finally {
      if (!silencioso) setSalvando(false);
    }
  }

  /** FINALIZAR NÃO É PAGAR: fecha o documento, e nada mais. */
  /**
   * FINALIZAR, e -- quando pedido -- JÁ ABRIR A IMPRESSÃO, numa única ação.
   *
   * `comImpressao` é o botão "Finalizar e imprimir" do formulário. A ordem
   * importa: FINALIZA primeiro, e só imprime se a finalização deu certo, com
   * o processo JÁ FINALIZADO em mãos -- é ele que carrega a identidade visual
   * e a prefeita congeladas, que são o que o papel precisa mostrar. Falha na
   * finalização não imprime nada.
   *
   * NADA DISTO É PAGAR. Finalizar fecha o papel; imprimir só o põe em papel.
   * Nenhum saldo, baixa, NF, conta ou programação é tocado por qualquer um
   * dos dois.
   */
  async function finalizar(formulario, { comImpressao = false } = {}) {
    setSalvando(true);
    setErroForm(null);
    try {
      // ⚠️ O congelamento vai JUNTO com a finalização: a identidade visual fica
      // guardada dentro do processo. Trocar o brasão ou o rodapé depois disto
      // não altera este documento.
      const atualizado = await finalizarProcessoServico(aberto?.processo, formulario, {
        identidade,
        logoSistema,
        prefeita,
      });
      setAberto(null);
      marcarSalvamento();
      // A impressão sai do processo FINALIZADO, com os congelamentos dentro.
      if (comImpressao) await imprimir(atualizado, "completo");
      setAviso(
        `Processo nº ${numeroDoProcesso(atualizado)} finalizado${comImpressao ? " e enviado para impressão" : ""}. ` +
          "Finalizar não é pagar: nenhum saldo, baixa, NF ou programação foi alterado" +
          `${comImpressao ? ", e imprimir não altera o processo" : ""}.`,
      );
      await carregar();
      return true;
    } catch (falha) {
      setErroForm(mensagemFalhaDoProcesso(falha, "Não foi possível finalizar este processo."));
      return false;
    } finally {
      setSalvando(false);
    }
  }

  async function reabrir(processo) {
    setAviso(null);
    setErro(null);
    try {
      await reabrirProcessoServico(processo);
      setAviso(`Processo nº ${numeroDoProcesso(processo)} reaberto para edição.`);
      await carregar();
    } catch (falha) {
      setErro(mensagemFalhaDoProcesso(falha, "Não foi possível reabrir este processo."));
    }
  }

  /** DUPLICAR: novo processo, nova numeração. O original não é tocado. */
  function duplicar(processo) {
    setErroForm(null);
    setUltimoSalvamento(null);
    setAberto({
      processo: null,
      inicial: duplicarProcesso(processo, { ano: new Date().getFullYear() }),
      origem: { id: processo.id, numero: numeroDoProcesso(processo) },
    });
  }

  /* ---------------------------------------------------------------------
   * Documento
   * ------------------------------------------------------------------ */

  function abrirPrevia(processo) {
    setPrevia(processo);
  }

  /**
   * Os dados da folha, com a IDENTIDADE CORRETA e o brasão em alta resolução.
   *
   * Processo finalizado imprime a identidade que ele congelou; rascunho imprime
   * a vigente. O brasão é rasterizado a partir da imagem DESSA identidade, e é
   * isso que dá PDF sem serrilhado sem trocar o brasão de documento antigo.
   */
  async function dadosParaSaida(processo) {
    const daFolha = identidadeDoProcesso(processo, identidade);
    const logo = await prepararLogoParaDocumento(logoDoDocumento(daFolha, logoSistema));
    return dadosDoDocumento(processo, {
      secretarias,
      emissor: usuario?.nome_completo ?? "",
      identidade: daFolha,
      logo,
      logoSistema,
      prefeita,
    });
  }

  async function imprimir(processo, escopo) {
    imprimirProcesso(await dadosParaSaida(processo), { escopo });
    // Imprimir não altera o processo; o registro é de quem levou o papel.
    registrarSaidaDoDocumento(processo, {
      acao: "imprimiu",
      detalhes: { descricao: descricaoDaSaida(escopo) },
    });
  }

  async function gerarPdf(processo, escopo) {
    gerarPdfDoProcesso(await dadosParaSaida(processo), { escopo });
    registrarSaidaDoDocumento(processo, {
      acao: "gerou_pdf",
      detalhes: { descricao: descricaoDaSaida(escopo) },
    });
  }

  async function abrirHistorico(processo) {
    setHistorico({ processo, registros: [], carregando: true, erro: null });
    try {
      const registros = await listarHistorico(processo.id);
      setHistorico({ processo, registros, carregando: false, erro: null });
    } catch (falha) {
      setHistorico({
        processo,
        registros: [],
        carregando: false,
        erro: mensagemFalhaDoProcesso(falha, "Não foi possível carregar o histórico."),
      });
    }
  }

  /* ---------------------------------------------------------------------
   * Cancelar e excluir rascunho
   * ------------------------------------------------------------------ */

  async function confirmarCancelamento(processo, motivo) {
    await cancelarProcessoServico(processo, motivo);
    setConfirmacao(null);
    setAviso(
      `Processo nº ${numeroDoProcesso(processo)} cancelado. O registro, o número e o histórico foram ` +
        "preservados — e o número não volta a ser usado.",
    );
    await carregar();
  }

  async function confirmarExclusao(processo, motivo) {
    await excluirRascunhoServico(processo, motivo);
    setConfirmacao(null);
    setAviso(`Rascunho nº ${numeroDoProcesso(processo)} excluído. A linha continua no banco, fora da lista.`);
    await carregar();
  }

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">Processos</div>
          <h1 className="mt-0.5 text-2xl font-semibold text-[#0F2A44]">Serviços/Materiais</h1>
          <p className="mt-0.5 text-sm text-[#0F2A44]/60">
            {carregando
              ? "Carregando..."
              : `${visiveis.length} ${visiveis.length === 1 ? "processo" : "processos"} — cada um com Requisição e Liquidação`}
          </p>
        </div>
        {permissoes.criar && !faltaMigration && (
          <button
            type="button"
            onClick={() => {
              setErroForm(null);
              setUltimoSalvamento(null);
              setAberto({ processo: null, inicial: null, origem: null });
            }}
            className="flex min-h-[2.75rem] items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm text-white hover:bg-[#0F2A44]/90"
          >
            <Plus size={16} /> Nova Solicitação
          </button>
        )}
      </div>

      {faltaMigration && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {AVISO_MIGRATION_SERVICOS}
        </div>
      )}

      {erro && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
      )}

      {aviso && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {aviso}
        </div>
      )}

      <PainelFiltros
        className="mb-6"
        rotulo="Filtros"
        chips={chips}
        totalAtivos={ativos}
        onLimpar={() => setFiltros(filtrosVazios())}
        topo={
          <>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="🔎 Buscar por número, fornecedor, CPF/CNPJ, secretaria, objeto ou situação..."
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
            <p className="mt-1.5 text-[11px] text-[#0F2A44]/40">
              A busca filtra enquanto você digita. O CPF/CNPJ encontra com ou sem ponto, barra e traço.
            </p>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Ano</label>
            <select
              value={filtros.ano}
              onChange={(e) => setFiltros((atual) => ({ ...atual, ano: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todos</option>
              {anos.map((ano) => (
                <option key={ano} value={ano}>
                  {ano}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Período do processo</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filtros.periodoInicio}
                onChange={(e) => setFiltros((atual) => ({ ...atual, periodoInicio: e.target.value }))}
                className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              />
              <input
                type="date"
                value={filtros.periodoFim}
                onChange={(e) => setFiltros((atual) => ({ ...atual, periodoFim: e.target.value }))}
                className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Secretaria</label>
            <select
              value={filtros.secretaria}
              onChange={(e) => setFiltros((atual) => ({ ...atual, secretaria: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todas</option>
              {secretarias.map((secretaria) => (
                <option key={secretaria.id} value={secretaria.id}>
                  {secretaria.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Tipo</label>
            <select
              value={filtros.tipo}
              onChange={(e) => setFiltros((atual) => ({ ...atual, tipo: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todos</option>
              {TIPOS_REQUISICAO.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.curto}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Fornecedor</label>
            <input
              type="text"
              value={filtros.fornecedor}
              onChange={(e) => setFiltros((atual) => ({ ...atual, fornecedor: e.target.value }))}
              placeholder="Nome ou CPF/CNPJ"
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Situação</label>
            <select
              value={filtros.situacao}
              onChange={(e) => setFiltros((atual) => ({ ...atual, situacao: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todas</option>
              {SITUACOES_SERVICO.map((situacao) => (
                <option key={situacao.id} value={situacao.id}>
                  {situacao.rotulo}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PainelFiltros>

      {/* Lista compacta: uma linha por processo. */}
      <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/50">
            <tr>
              <th className="px-3 py-2.5 font-medium">Nº</th>
              <th className="px-3 py-2.5 font-medium">Data</th>
              <th className="px-3 py-2.5 font-medium">Tipo</th>
              <th className="px-3 py-2.5 font-medium">Fornecedor</th>
              <th className="px-3 py-2.5 font-medium">Secretaria</th>
              <th className="px-3 py-2.5 font-medium">Objeto</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
              <th className="px-3 py-2.5 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {carregando || carregandoApoio ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  Carregando...
                </td>
              </tr>
            ) : visiveis.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  {processos.length === 0
                    ? "Nenhum processo de serviços/materiais ainda."
                    : "Nenhum processo atende à busca ou aos filtros."}
                </td>
              </tr>
            ) : (
              visiveis.map((processo) => (
                <Linha
                  key={processo.id}
                  processo={processo}
                  secretarias={secretarias}
                  permissoes={permissoes}
                  onAbrir={() => {
                    setErroForm(null);
                    setUltimoSalvamento(null);
                    setAberto({ processo, inicial: null, origem: null });
                  }}
                  onPrevia={() => abrirPrevia(processo)}
                  onImprimir={() => imprimir(processo, "completo")}
                  onPdf={() => gerarPdf(processo, "completo")}
                  onDuplicar={() => duplicar(processo)}
                  onHistorico={() => abrirHistorico(processo)}
                  onReabrir={() => reabrir(processo)}
                  onCancelar={() => setConfirmacao({ processo, tipo: "cancelar" })}
                  onExcluir={() => setConfirmacao({ processo, tipo: "excluir" })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
        Cada linha é um processo com duas páginas: Requisição de Material/Serviço e
        Liquidação/Solicitação de Pagamento, com os mesmos dados gerais e o mesmo número. A
        requisição NÃO tem valores — eles aparecem só na liquidação. Este módulo é documental —
        nenhuma ação aqui debita conta, dá baixa em NF, altera saldo, marca fornecedor como pago ou
        mexe na Programação Diária.
      </p>

      {aberto && (
        <ModalProcessoServico
          processo={aberto.processo}
          inicial={aberto.inicial}
          fornecedores={fornecedores}
          solicitantes={solicitantes}
          secretarias={secretarias}
          secretariasFinanceiras={secretariasFinanceiras}
          bancos={bancos}
          servidores={podeVerServidores(permissoesServidores) ? servidores : []}
          permissoes={permissoes}
          salvando={salvando}
          erro={erroForm}
          ultimoSalvamento={ultimoSalvamento}
          onFechar={() => setAberto(null)}
          onCriar={criar}
          onSalvar={salvar}
          onFinalizar={finalizar}
          onFinalizarEImprimir={(formulario) => finalizar(formulario, { comImpressao: true })}
          onPreVisualizar={() => {
            if (aberto.processo) abrirPrevia(aberto.processo);
          }}
        />
      )}

      {previa && (
        <PreVisualizacaoProcessoServico
          processo={previa}
          secretarias={secretarias}
          emissor={usuario?.nome_completo ?? ""}
          identidade={identidade}
          logoSistema={logoSistema}
          prefeita={prefeita}
          onFechar={() => setPrevia(null)}
          onImprimir={(escopo) => imprimir(previa, escopo)}
          onGerarPdf={(escopo) => gerarPdf(previa, escopo)}
        />
      )}

      {historico && (
        <ModalHistoricoProcesso
          processo={historico.processo}
          registros={historico.registros}
          carregando={historico.carregando}
          erro={historico.erro}
          onFechar={() => setHistorico(null)}
        />
      )}

      {confirmacao?.tipo === "cancelar" && (
        <ModalConfirmarExclusao
          titulo="Cancelar processo de serviços/materiais"
          subtitulo="O cancelamento anula o documento e preserva o registro, o número e o histórico."
          registro={tituloDoProcesso(confirmacao.processo)}
          detalhes={detalhesDoProcesso(confirmacao.processo, secretarias)}
          aviso={
            "O processo passa a constar como CANCELADO e não é mais alterado. O número continua ocupado " +
            "e nunca será reutilizado. Nenhum saldo, baixa, NF ou programação é alterado por isto."
          }
          exigirMotivo
          textoConfirmar="Confirmar cancelamento"
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={(motivo) => confirmarCancelamento(confirmacao.processo, motivo)}
        />
      )}

      {confirmacao?.tipo === "excluir" && (
        <ModalConfirmarExclusao
          titulo="Excluir rascunho"
          subtitulo="Exclusão lógica, no padrão do sistema: a linha continua no banco, fora da lista."
          registro={tituloDoProcesso(confirmacao.processo)}
          detalhes={detalhesDoProcesso(confirmacao.processo, secretarias)}
          aviso={
            "O rascunho sai da lista e o histórico dele é preservado. O número não volta para a fila. " +
            "Processo finalizado não tem exclusão comum — a saída dele é o cancelamento."
          }
          exigirMotivo
          textoConfirmar="Confirmar exclusão"
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={(motivo) => confirmarExclusao(confirmacao.processo, motivo)}
        />
      )}
    </>
  );
}

/** Uma linha da lista: compacta, com o preenchimento das duas páginas. */
function Linha({
  processo,
  secretarias,
  permissoes,
  onAbrir,
  onPrevia,
  onImprimir,
  onPdf,
  onDuplicar,
  onHistorico,
  onReabrir,
  onCancelar,
  onExcluir,
}) {
  const acoes = acoesDisponiveis(processo, permissoes);
  const situacao = situacaoServicoInfo(processo.situacao);
  const preenchimento = preenchimentoDoProcesso(processo);
  const cancelado = processo.situacao === "cancelada";

  return (
    <tr className={cancelado ? "opacity-60" : undefined}>
      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-[#0F2A44]">
        {numeroDoProcesso(processo) || "--"}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[#0F2A44]">{dataBR(processo.data_processo) || "--"}</td>
      <td className="px-3 py-2.5 text-[#0F2A44]/80">
        <span className="block max-w-[10rem] truncate">{rotuloDoTipo(processo) || "--"}</span>
      </td>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[16rem] truncate">{processo.favorecido_nome || "--"}</span>
        {/* O indicador de preenchimento: quais das duas páginas já estão prontas. */}
        <span className="block text-[11px] text-[#0F2A44]/45">{preenchimento.texto}</span>
      </td>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[12rem] truncate">
          {nomeDaSecretaria(processo, secretarias) || "--"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[16rem] truncate">{objetoDoProcesso(processo) || "--"}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${situacao.classe}`}>
          {situacao.rotulo}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {acoes.abrir && (
            <BotaoAcao
              titulo={acoes.editar ? "Abrir e editar" : "Abrir (somente leitura)"}
              onClick={onAbrir}
              icone={acoes.editar ? Pencil : Eye}
            />
          )}
          {acoes.imprimir && (
            <>
              <BotaoAcao titulo="Pré-visualizar as duas páginas" onClick={onPrevia} icone={Eye} />
              <BotaoAcao titulo="Imprimir processo completo (2 páginas)" onClick={onImprimir} icone={Printer} />
              <BotaoAcao titulo="Gerar PDF (arquivo único, as duas páginas)" onClick={onPdf} icone={FileDown} />
            </>
          )}
          {acoes.duplicar && (
            <BotaoAcao
              titulo="Duplicar (novo processo, nova numeração — o original não muda)"
              onClick={onDuplicar}
              icone={Copy}
            />
          )}
          {acoes.historico && <BotaoAcao titulo="Histórico do processo" onClick={onHistorico} icone={History} />}
          {acoes.reabrir && (
            <BotaoAcao titulo="Reabrir para edição" onClick={onReabrir} icone={RotateCcw} />
          )}
          {acoes.excluir && (
            <BotaoAcao titulo="Excluir rascunho (exclusão lógica)" onClick={onExcluir} icone={Trash2} />
          )}
          {acoes.cancelar && (
            <BotaoAcao titulo="Cancelar processo (preserva registro e histórico)" onClick={onCancelar} icone={Ban} />
          )}
        </div>
      </td>
    </tr>
  );
}

function BotaoAcao({ titulo, onClick, icone: Icone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
    >
      <Icone size={14} />
    </button>
  );
}

function detalhesDoProcesso(processo, secretarias) {
  return [
    { rotulo: "Tipo", valor: rotuloDoTipo(processo) || "--" },
    { rotulo: "Fornecedor", valor: processo?.favorecido_nome || "--" },
    {
      rotulo: "Secretaria",
      valor: nomeDaSecretaria(processo, secretarias) || "--",
    },
    { rotulo: "Objeto", valor: objetoDoProcesso(processo) || "--" },
    { rotulo: "Valor do documento", valor: valorDoProcesso(processo) },
    { rotulo: "Situação", valor: situacaoServicoInfo(processo?.situacao).rotulo },
  ];
}

const DESCRICAO_DA_FOLHA = {
  requisicao: "Somente a Requisição",
  liquidacao: "Somente a Liquidação",
};

function descricaoDaSaida(escopo) {
  const folhas = folhasDoEscopo(escopo);
  if (folhas.length > 1) return `Processo completo (${folhas.length} páginas)`;
  return DESCRICAO_DA_FOLHA[folhas[0]] ?? "Processo completo";
}
