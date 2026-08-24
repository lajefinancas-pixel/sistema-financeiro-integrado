import React from "react";
import {
  ArrowUpDown,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  LayoutList,
  Pencil,
  Plus,
  Printer,
  Rows3,
  Settings2,
  Trash2,
} from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import FiltrosCertidoes from "../components/certidoes/FiltrosCertidoes";
import ModalCertidao from "../components/certidoes/ModalCertidao";
import ModalDetalheCertidao from "../components/certidoes/ModalDetalheCertidao";
import ModalExcluirCertidao from "../components/certidoes/ModalExcluirCertidao";
import ModalRenovarCertidao from "../components/certidoes/ModalRenovarCertidao";
import ModalTipoCertidao from "../components/certidoes/ModalTipoCertidao";
import PainelAlertas from "../components/certidoes/PainelAlertas";
import TiposCertidao from "../components/certidoes/TiposCertidao";
import { BadgeSituacao } from "../components/certidoes/badges";
import { sincronizarAlertasCertidoes } from "../lib/alertasCertidoes";
import { usePermissaoModulo } from "../lib/permissoes";
import {
  MODULO,
  formatarData,
  listarCertidoes,
  listarTipos,
  nomeFornecedor,
  nomeSecretaria,
  secretariasDosFornecedores,
  urlDeDownload,
} from "../lib/certidoes";
import {
  comFornecedorIdentificado,
  listarFornecedoresIdentificacao,
} from "../lib/fornecedoresIdentificacao";
import {
  FILTROS_VAZIOS,
  ORDENACOES,
  ORDENACAO_PADRAO,
  agruparPorFornecedor,
  filtrarCertidoes,
  haFiltroAtivo,
  ordenarCertidoes,
  situacaoDaLinha,
} from "../lib/filtrosCertidoes";
import {
  exportarExcelCertidoes,
  gerarPdfCertidoes,
  imprimirCertidoes,
} from "../lib/certidoesDocumento";
import { agoraBR } from "../lib/saldosDocumento";
import { mensagemAmigavel } from "../lib/erros";

const ABAS = [
  { id: "certidoes", label: "Certidões", icone: FileCheck2 },
  { id: "tipos", label: "Tipos de Certidão", icone: Settings2 },
];

export default function Certidoes() {
  const { carregando: verificando, usuario: usuarioLogado, permissao, erro: erroPermissao } =
    usePermissaoModulo(MODULO);

  const podeVisualizar = permissao?.pode_visualizar === true;
  const podeCadastrar = permissao?.pode_cadastrar === true;
  const podeEditar = permissao?.pode_editar === true;
  const podeExcluir = permissao?.pode_excluir === true;
  // Renovar é cadastrar a nova emissão e marcar a anterior como substituída:
  // exige as duas permissões, sem criar nenhuma regra nova de acesso.
  const podeRenovar = podeCadastrar && podeEditar;

  const [aba, setAba] = React.useState("certidoes");
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [certidoes, setCertidoes] = React.useState([]);
  const [tipos, setTipos] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);

  const [alertas, setAlertas] = React.useState([]);
  const [erroAlertas, setErroAlertas] = React.useState(null);

  const [certidaoEmEdicao, setCertidaoEmEdicao] = React.useState(null);
  const [certidaoDetalhe, setCertidaoDetalhe] = React.useState(null);
  const [certidaoParaExcluir, setCertidaoParaExcluir] = React.useState(null);
  const [certidaoParaRenovar, setCertidaoParaRenovar] = React.useState(null);
  const [tipoEmEdicao, setTipoEmEdicao] = React.useState(null);

  // Exportação: qual documento está sendo gerado e o aviso de recorte vazio.
  const [exportando, setExportando] = React.useState(null);
  const [avisoExportacao, setAvisoExportacao] = React.useState(null);

  // Filtros: o formulário só passa a valer em "Aplicar Filtros"; os atalhos
  // rápidos valem no clique.
  const [filtros, setFiltros] = React.useState(FILTROS_VAZIOS);
  const [filtrosAplicados, setFiltrosAplicados] = React.useState(FILTROS_VAZIOS);
  const [ordenacao, setOrdenacao] = React.useState(ORDENACAO_PADRAO);
  // Visão da listagem: linha a linha ou com as certidões reunidas por fornecedor.
  const [agrupado, setAgrupado] = React.useState(false);
  // Fornecedor escolhido na listagem: mostra só as certidões dele, agrupadas.
  const [fornecedorFoco, setFornecedorFoco] = React.useState(null);

  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        // Os fornecedores vêm da fonte de identificação do próprio módulo
        // (nome, CPF/CNPJ, secretaria e situação), liberada pela permissão de
        // Certidões — não pela do módulo Fornecedores.
        const [listaCertidoes, listaTipos, listaFornecedores] = await Promise.all([
          listarCertidoes(),
          listarTipos(),
          listarFornecedoresIdentificacao(),
        ]);
        if (!ativo) return;
        setCertidoes(listaCertidoes);
        setTipos(listaTipos);
        setFornecedores(listaFornecedores);
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar as certidões."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar]);

  /**
   * Acerta os alertas de vencimento sempre que a lista muda: abrir a tela, criar,
   * editar ou excluir uma certidão. A varredura não duplica pendência — quando o
   * aviso já existe, ela apenas o mantém (ou o atualiza, se o prazo apertou).
   */
  const usuarioId = usuarioLogado?.id ?? null;
  React.useEffect(() => {
    if (!podeVisualizar || carregando || !usuarioId) return undefined;
    let ativo = true;

    (async () => {
      const { alertas: ativos, erro: falha } = await sincronizarAlertasCertidoes(usuarioId, certidoes);
      if (!ativo) return;
      setAlertas(ativos);
      setErroAlertas(falha);
    })();

    return () => {
      ativo = false;
    };
  }, [podeVisualizar, carregando, usuarioId, certidoes]);

  function aoSalvarCertidao(salva, edicao) {
    setCertidoes((atual) =>
      edicao ? atual.map((c) => (c.id === salva.id ? salva : c)) : [salva, ...atual],
    );
  }

  function aoExcluirCertidao(id) {
    setCertidoes((atual) => atual.filter((c) => c.id !== id));
    setAlertas((atual) => atual.filter((a) => a.certidao_id !== id));
  }

  /**
   * Abre a renovação a partir do detalhe ou da edição: os dois modais saem de
   * cena para a tela não ficar com duas janelas do mesmo documento abertas.
   */
  function abrirRenovacao(certidao) {
    if (!certidao?.id) return;
    setCertidaoEmEdicao(null);
    setCertidaoDetalhe(null);
    setCertidaoParaRenovar(certidao);
  }

  /**
   * Renovada: a emissão anterior sai da listagem (continua no banco, agora como
   * histórico) e a nova ocupa o lugar dela. O alerta de vencimento da antiga é
   * recolhido na varredura que roda logo em seguida, junto com a lista nova.
   */
  function aoRenovarCertidao(nova, anterior) {
    setCertidoes((atual) => [nova, ...atual.filter((c) => c.id !== anterior?.id)]);
    setAlertas((atual) => atual.filter((a) => a.certidao_id !== anterior?.id));
  }

  // Secretarias oferecidas no filtro: as que aparecem nos fornecedores carregados.
  const secretarias = React.useMemo(() => secretariasDosFornecedores(fornecedores), [fornecedores]);

  // O fornecedor embutido em cada certidão obedece à RLS do módulo Fornecedores;
  // para quem só tem Certidões ele chega nulo e o nome some da listagem. A fonte
  // de identificação já carregada refaz esse vínculo — só onde ele falta.
  const certidoesComFornecedor = React.useMemo(
    () => comFornecedorIdentificado(certidoes, fornecedores),
    [certidoes, fornecedores],
  );

  // Listagem exibida: filtros aplicados + ordenação escolhida.
  const listaVisivel = React.useMemo(
    () => ordenarCertidoes(filtrarCertidoes(certidoesComFornecedor, fornecedores, filtrosAplicados), ordenacao),
    [certidoesComFornecedor, fornecedores, filtrosAplicados, ordenacao],
  );

  const grupos = React.useMemo(() => {
    const todos = agruparPorFornecedor(listaVisivel);
    return fornecedorFoco ? todos.filter((g) => g.id === String(fornecedorFoco)) : todos;
  }, [listaVisivel, fornecedorFoco]);

  const filtrando = haFiltroAtivo(filtrosAplicados);

  const nomeDoFoco = React.useMemo(() => {
    if (!fornecedorFoco) return "";
    const cadastro = fornecedores.find((f) => String(f.id) === String(fornecedorFoco));
    return cadastro ? nomeFornecedor(cadastro) : "";
  }, [fornecedorFoco, fornecedores]);

  /**
   * Impressão, PDF e planilha do que está na tela: o documento sai com as mesmas
   * certidões da listagem, na ordem escolhida e com os filtros aplicados no
   * momento — inclusive o agrupamento por fornecedor, quando é a visão em uso.
   */
  function exportar(formato) {
    if (exportando) return;
    setExportando(formato);
    setAvisoExportacao(null);

    try {
      const paraDocumento = agrupado ? grupos.flatMap((g) => g.certidoes) : listaVisivel;

      if (paraDocumento.length === 0) {
        setAvisoExportacao("Não há certidões para exportar com os filtros atuais.");
        return;
      }

      const documento = {
        certidoes: paraDocumento,
        filtros: filtrosAplicados,
        secretarias,
        tipos,
        usuario: usuarioLogado,
        geradoEm: agoraBR(),
        agrupado,
      };

      if (formato === "impressao") imprimirCertidoes(documento);
      else if (formato === "pdf") gerarPdfCertidoes(documento);
      else exportarExcelCertidoes(documento);
    } catch (e) {
      setAvisoExportacao(mensagemAmigavel(e, "Não foi possível gerar o documento das certidões."));
    } finally {
      setExportando(null);
    }
  }

  function aplicarFiltros() {
    setFiltrosAplicados(filtros);
    setFornecedorFoco(null);
  }

  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    setFiltrosAplicados(FILTROS_VAZIOS);
    setFornecedorFoco(null);
  }

  /**
   * Remoção de um filtro pelo chip, com o painel fechado. Mexe no formulário e
   * no que está aplicado ao mesmo tempo, como "Limpar Filtros" já fazia --
   * nenhum critério novo entra aqui.
   */
  function removerFiltro(alteracao) {
    setFiltros((atual) => ({ ...atual, ...alteracao }));
    setFiltrosAplicados((atual) => ({ ...atual, ...alteracao }));
    setFornecedorFoco(null);
  }

  /** Atalho rápido: vale na hora, sem esperar "Aplicar Filtros". */
  function usarAtalho(id) {
    setFiltros((atual) => ({ ...atual, atalho: id }));
    setFiltrosAplicados((atual) => ({ ...atual, atalho: id }));
    setFornecedorFoco(null);
  }

  /** Clique no fornecedor: reúne as certidões dele em um bloco só. */
  function verFornecedor(id) {
    if (!id) return;
    setAgrupado(true);
    setFornecedorFoco(String(id));
  }

  function aoSalvarTipo(salvo, edicao) {
    setTipos((atual) => {
      const lista = edicao ? atual.map((t) => (t.id === salvo.id ? salvo : t)) : [...atual, salvo];
      return [...lista].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    });
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
        <AcessoNegado modulo="Certidões" detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`} />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Certidões" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">Documentação</div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Certidões</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando documentos..."
                : `${certidoes.length} ${
                    certidoes.length === 1 ? "certidão cadastrada" : "certidões cadastradas"
                  } para os fornecedores do sistema`}
            </p>
          </div>

          {aba === "certidoes" && (
            <div className="flex flex-wrap items-center gap-2 self-start">
              {/* Impressão e exportação do recorte que está na tela: os três
                  documentos saem com os filtros aplicados no momento. */}
              <button
                type="button"
                onClick={() => exportar("impressao")}
                disabled={carregando || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <Printer size={15} />
                {exportando === "impressao" ? "Preparando..." : "🖨 Imprimir"}
              </button>
              <button
                type="button"
                onClick={() => exportar("pdf")}
                disabled={carregando || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <FileText size={15} />
                {exportando === "pdf" ? "Gerando..." : "PDF"}
              </button>
              <button
                type="button"
                onClick={() => exportar("excel")}
                disabled={carregando || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <FileSpreadsheet size={15} />
                {exportando === "excel" ? "Exportando..." : "Excel"}
              </button>

              {podeCadastrar && (
                <button
                  type="button"
                  onClick={() => setCertidaoEmEdicao({})}
                  className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 whitespace-nowrap"
                >
                  <Plus size={16} />
                  Cadastrar Certidão
                </button>
              )}
            </div>
          )}
        </div>

        {erro && (
          <div className="mb-5 border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
        )}

        <div className="flex gap-1 border-b border-black/10 mb-5 overflow-x-auto">
          {ABAS.map((item) => {
            const Icone = item.icone;
            const ativa = aba === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                aria-current={ativa ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  ativa
                    ? "border-[#C9A227] text-[#0F2A44] font-medium"
                    : "border-transparent text-[#0F2A44]/50 hover:text-[#0F2A44]/80"
                }`}
              >
                <Icone size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

        {aba === "tipos" ? (
          <TiposCertidao
            tipos={tipos}
            carregando={carregando}
            podeCadastrar={podeCadastrar}
            podeEditar={podeEditar}
            onNovo={() => setTipoEmEdicao({})}
            onEditar={(tipo) => setTipoEmEdicao(tipo)}
          />
        ) : (
          <>
            {erroAlertas && (
              <div className="mb-5 border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-lg px-4 py-3">
                {erroAlertas}
              </div>
            )}

            {avisoExportacao && (
              <div className="mb-5 border border-amber-200 bg-amber-50 text-amber-800 text-sm rounded-lg px-4 py-3">
                {avisoExportacao}
              </div>
            )}

            {certidoes.length > 0 && (
              <PainelAlertas
                alertas={alertas}
                carregando={carregando}
                onDispensado={(id) => setAlertas((atual) => atual.filter((a) => a.id !== id))}
              />
            )}

            <FiltrosCertidoes
              filtros={filtros}
              filtrosAplicados={filtrosAplicados}
              onMudar={setFiltros}
              onAplicar={aplicarFiltros}
              onLimpar={limparFiltros}
              onAtalho={usarAtalho}
              onRemover={removerFiltro}
              secretarias={secretarias}
              tipos={tipos}
              totalEncontrado={listaVisivel.length}
              totalGeral={certidoes.length}
            />

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="inline-flex items-center gap-0.5 self-start bg-white border border-black/10 rounded-lg p-0.5">
                <BotaoVisao
                  ativo={!agrupado}
                  icone={LayoutList}
                  rotulo="Lista"
                  onClick={() => {
                    setAgrupado(false);
                    setFornecedorFoco(null);
                  }}
                />
                <BotaoVisao
                  ativo={agrupado}
                  icone={Rows3}
                  rotulo="Agrupar por fornecedor"
                  onClick={() => setAgrupado(true)}
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[#0F2A44]/55">
                <ArrowUpDown size={14} className="shrink-0" />
                <span className="whitespace-nowrap">Ordenar por</span>
                <select
                  value={ordenacao}
                  onChange={(e) => setOrdenacao(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-black/10 bg-white text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44]"
                >
                  {ORDENACOES.map((opcao) => (
                    <option key={opcao.id} value={opcao.id}>
                      {opcao.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {agrupado && fornecedorFoco && (
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span className="px-3 py-1.5 rounded-full bg-[#0F2A44]/[0.06] text-[#0F2A44]/70">
                  Mostrando apenas {nomeDoFoco || "o fornecedor escolhido"}
                </span>
                <button
                  type="button"
                  onClick={() => setFornecedorFoco(null)}
                  className="text-[#0F2A44]/55 underline underline-offset-2 hover:text-[#0F2A44]"
                >
                  Ver todos os fornecedores
                </button>
              </div>
            )}

            {agrupado ? (
              <CertidoesPorFornecedor
                grupos={grupos}
                carregando={carregando}
                filtrando={filtrando || Boolean(fornecedorFoco)}
                podeCadastrar={podeCadastrar}
                podeEditar={podeEditar}
                podeExcluir={podeExcluir}
                onLimpar={limparFiltros}
                onVisualizar={setCertidaoDetalhe}
                onEditar={setCertidaoEmEdicao}
                onExcluir={setCertidaoParaExcluir}
                onCadastrar={(fornecedorId) => setCertidaoEmEdicao({ fornecedor_id: fornecedorId })}
              />
            ) : (
              <ListaCertidoes
                certidoes={listaVisivel}
                carregando={carregando}
                filtrando={filtrando}
                podeCadastrar={podeCadastrar}
                podeEditar={podeEditar}
                podeExcluir={podeExcluir}
                onLimpar={limparFiltros}
                onVisualizar={setCertidaoDetalhe}
                onEditar={setCertidaoEmEdicao}
                onExcluir={setCertidaoParaExcluir}
                onCadastrar={(fornecedorId) => setCertidaoEmEdicao({ fornecedor_id: fornecedorId })}
                onSelecionarFornecedor={verFornecedor}
              />
            )}
          </>
        )}
      </div>

      {certidaoEmEdicao && (
        <ModalCertidao
          certidao={certidaoEmEdicao}
          fornecedores={fornecedores}
          carregandoFornecedores={carregando}
          tipos={tipos}
          usuario={usuarioLogado}
          podeRenovar={podeRenovar}
          onFechar={() => setCertidaoEmEdicao(null)}
          onSalva={aoSalvarCertidao}
          onRenovar={abrirRenovacao}
        />
      )}

      {certidaoDetalhe && (
        <ModalDetalheCertidao
          certidao={certidaoDetalhe}
          podeRenovar={podeRenovar}
          onFechar={() => setCertidaoDetalhe(null)}
          onRenovar={abrirRenovacao}
        />
      )}

      {certidaoParaRenovar && (
        <ModalRenovarCertidao
          certidao={certidaoParaRenovar}
          tipos={tipos}
          usuario={usuarioLogado}
          onFechar={() => setCertidaoParaRenovar(null)}
          onRenovada={aoRenovarCertidao}
        />
      )}

      {certidaoParaExcluir && (
        <ModalExcluirCertidao
          certidao={certidaoParaExcluir}
          usuario={usuarioLogado}
          onFechar={() => setCertidaoParaExcluir(null)}
          onExcluida={aoExcluirCertidao}
        />
      )}

      {tipoEmEdicao && (
        <ModalTipoCertidao
          tipo={tipoEmEdicao.id ? tipoEmEdicao : null}
          onFechar={() => setTipoEmEdicao(null)}
          onSalvo={aoSalvarTipo}
        />
      )}
    </Layout>
  );
}

/** Alternador de visão (lista / agrupada) da listagem. */
function BotaoVisao({ ativo, icone: Icone, rotulo, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md whitespace-nowrap transition-colors ${
        ativo ? "bg-[#0F2A44] text-white" : "text-[#0F2A44]/60 hover:bg-black/5"
      }`}
    >
      <Icone size={14} />
      {rotulo}
    </button>
  );
}

/** Vazio da listagem: muda de texto quando o que sumiu foi por causa do filtro. */
function ListaVazia({ filtrando, onLimpar }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center">
      <FileCheck2 size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
      {filtrando ? (
        <>
          <div className="text-sm text-[#0F2A44]/40">
            Nenhuma certidão encontrada com os filtros aplicados.
          </div>
          <button
            type="button"
            onClick={onLimpar}
            className="mt-3 text-xs text-[#0F2A44]/60 underline underline-offset-2 hover:text-[#0F2A44]"
          >
            Limpar Filtros
          </button>
        </>
      ) : (
        <div className="text-sm text-[#0F2A44]/40">
          Nenhuma certidão cadastrada ainda. Use “Cadastrar Certidão” para registrar o primeiro documento.
        </div>
      )}
    </div>
  );
}

/** Nome do fornecedor da linha — vira botão quando dá para abrir a visão dele. */
function NomeDoFornecedor({ certidao, onSelecionar }) {
  const nome = nomeFornecedor(certidao.fornecedores);
  const secretaria = nomeSecretaria(certidao.fornecedores);
  const detalhe = [certidao.fornecedores?.cpf_cnpj, secretaria].filter(Boolean).join(" · ");

  const conteudo = (
    <>
      <span className="font-medium text-[#0F2A44]">{nome}</span>
      {detalhe && <span className="block text-[11px] font-normal text-[#0F2A44]/40">{detalhe}</span>}
    </>
  );

  if (!onSelecionar) return <div>{conteudo}</div>;

  return (
    <button
      type="button"
      onClick={() => onSelecionar(certidao.fornecedor_id)}
      title="Ver todas as certidões deste fornecedor"
      className="text-left hover:underline underline-offset-2 decoration-[#C9A227]"
    >
      {conteudo}
    </button>
  );
}

/** Listagem principal: tabela nas telas médias e cartões no celular. */
function ListaCertidoes({
  certidoes,
  carregando,
  filtrando,
  podeCadastrar,
  podeEditar,
  podeExcluir,
  onLimpar,
  onVisualizar,
  onEditar,
  onExcluir,
  onCadastrar,
  onSelecionarFornecedor,
}) {
  if (carregando) {
    return (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center text-sm text-[#0F2A44]/40">
        Carregando certidões...
      </div>
    );
  }

  if (certidoes.length === 0) {
    return <ListaVazia filtrando={filtrando} onLimpar={onLimpar} />;
  }

  return (
    <>
      {/* Tabela — telas médias e grandes */}
      <div className="hidden md:block bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
              <th className="py-3 pl-5 pr-3 font-medium">Fornecedor</th>
              <th className="py-3 px-3 font-medium">Documento</th>
              <th className="py-3 px-3 font-medium whitespace-nowrap">Emissão</th>
              <th className="py-3 px-3 font-medium whitespace-nowrap">Vencimento</th>
              <th className="py-3 px-3 font-medium">Situação</th>
              <th className="py-3 pl-3 pr-5 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {certidoes.map((certidao) => (
              <tr key={certidao.id} className="border-t border-black/5 hover:bg-black/[0.02]">
                <td className="py-3 pl-5 pr-3">
                  <NomeDoFornecedor certidao={certidao} onSelecionar={onSelecionarFornecedor} />
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70">
                  {certidao.naoCadastrada ? (
                    <span className="text-[#0F2A44]/40">Nenhum documento cadastrado</span>
                  ) : (
                    <>
                      {certidao.tipos_certidao?.nome ?? "--"}
                      {certidao.numero_documento && (
                        <span className="block text-[11px] text-[#0F2A44]/40">nº {certidao.numero_documento}</span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70 whitespace-nowrap">
                  {formatarData(certidao.data_emissao)}
                </td>
                <td className="py-3 px-3 text-[#0F2A44]/70 whitespace-nowrap">
                  {certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
                </td>
                <td className="py-3 px-3">
                  <BadgeSituacao situacao={situacaoDaLinha(certidao)} />
                </td>
                <td className="py-3 pl-3 pr-5">
                  <Acoes
                    certidao={certidao}
                    podeCadastrar={podeCadastrar}
                    podeEditar={podeEditar}
                    podeExcluir={podeExcluir}
                    onVisualizar={onVisualizar}
                    onEditar={onEditar}
                    onExcluir={onExcluir}
                    onCadastrar={onCadastrar}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cartões — celular */}
      <div className="md:hidden space-y-3">
        {certidoes.map((certidao) => (
          <div key={certidao.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#0F2A44] break-words">
                  {nomeFornecedor(certidao.fornecedores)}
                </div>
                <div className="text-xs text-[#0F2A44]/55 mt-0.5">
                  {certidao.naoCadastrada
                    ? "Nenhum documento cadastrado"
                    : `${certidao.tipos_certidao?.nome ?? "--"}${
                        certidao.numero_documento ? ` — nº ${certidao.numero_documento}` : ""
                      }`}
                </div>
              </div>
              <BadgeSituacao situacao={situacaoDaLinha(certidao)} />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-black/5 text-xs">
              <div>
                <div className="text-[#0F2A44]/40">Emissão</div>
                <div className="text-[#0F2A44]/75 mt-0.5">{formatarData(certidao.data_emissao)}</div>
              </div>
              <div>
                <div className="text-[#0F2A44]/40">Vencimento</div>
                <div className="text-[#0F2A44]/75 mt-0.5">
                  {certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-black/5 flex items-center justify-between gap-2">
              <Acoes
                certidao={certidao}
                podeCadastrar={podeCadastrar}
                podeEditar={podeEditar}
                podeExcluir={podeExcluir}
                onVisualizar={onVisualizar}
                onEditar={onEditar}
                onExcluir={onExcluir}
                onCadastrar={onCadastrar}
              />
              {onSelecionarFornecedor && !certidao.naoCadastrada && (
                <button
                  type="button"
                  onClick={() => onSelecionarFornecedor(certidao.fornecedor_id)}
                  className="text-[11px] text-[#0F2A44]/50 underline underline-offset-2 whitespace-nowrap"
                >
                  Ver fornecedor
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Visão "Agrupar por fornecedor": um bloco por fornecedor, com o nome no
 * cabeçalho e, dentro dele, cada certidão com tipo, situação e vencimento.
 * É a mesma lista já filtrada e ordenada — só a apresentação muda.
 */
function CertidoesPorFornecedor({
  grupos,
  carregando,
  filtrando,
  podeCadastrar,
  podeEditar,
  podeExcluir,
  onLimpar,
  onVisualizar,
  onEditar,
  onExcluir,
  onCadastrar,
}) {
  if (carregando) {
    return (
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center text-sm text-[#0F2A44]/40">
        Carregando certidões...
      </div>
    );
  }

  if (grupos.length === 0) {
    return <ListaVazia filtrando={filtrando} onLimpar={onLimpar} />;
  }

  return (
    <div className="space-y-3">
      {grupos.map((grupo) => {
        const secretaria = nomeSecretaria(grupo.fornecedor);
        const detalhe = [grupo.fornecedor?.cpf_cnpj, secretaria].filter(Boolean).join(" · ");
        const quantidade = grupo.certidoes.filter((c) => !c.naoCadastrada).length;

        return (
          <section key={grupo.id} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 bg-[#F5F3EF] border-b border-black/5">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#0F2A44] break-words">
                  {nomeFornecedor(grupo.fornecedor)}
                </h3>
                {detalhe && <p className="text-[11px] text-[#0F2A44]/45 mt-0.5">{detalhe}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#0F2A44]/45 tabular-nums whitespace-nowrap">
                  {quantidade === 1 ? "1 certidão" : `${quantidade} certidões`}
                </span>
                {podeCadastrar && (
                  <button
                    type="button"
                    onClick={() => onCadastrar(grupo.fornecedor?.id ?? grupo.id)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap"
                  >
                    <Plus size={13} />
                    Nova certidão
                  </button>
                )}
              </div>
            </header>

            <ul className="divide-y divide-black/5">
              {grupo.certidoes.map((certidao) => (
                <li
                  key={certidao.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[#0F2A44]">
                      {certidao.naoCadastrada
                        ? "Nenhum documento cadastrado"
                        : certidao.tipos_certidao?.nome ?? "--"}
                      {certidao.numero_documento && (
                        <span className="text-[11px] text-[#0F2A44]/40"> · nº {certidao.numero_documento}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#0F2A44]/45 mt-0.5">
                      Emissão {formatarData(certidao.data_emissao)} · Vencimento{" "}
                      {certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <BadgeSituacao situacao={situacaoDaLinha(certidao)} />
                    <Acoes
                      certidao={certidao}
                      podeCadastrar={podeCadastrar}
                      podeEditar={podeEditar}
                      podeExcluir={podeExcluir}
                      onVisualizar={onVisualizar}
                      onEditar={onEditar}
                      onExcluir={onExcluir}
                      onCadastrar={onCadastrar}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Acoes({
  certidao,
  podeCadastrar,
  podeEditar,
  podeExcluir,
  onVisualizar,
  onEditar,
  onExcluir,
  onCadastrar,
}) {
  const classe =
    "w-9 h-9 rounded-lg flex items-center justify-center text-[#0F2A44]/50 hover:text-[#0F2A44] hover:bg-black/5";

  // Linha de fornecedor sem nenhuma certidão: não há documento para visualizar,
  // baixar ou excluir — o que cabe ali é começar o cadastro.
  if (certidao.naoCadastrada) {
    if (!podeCadastrar) return <span className="text-xs text-[#0F2A44]/30">--</span>;
    return (
      <div className="flex md:justify-end">
        <button
          type="button"
          onClick={() => onCadastrar(certidao.fornecedor_id)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap"
        >
          <FilePlus2 size={14} />
          Cadastrar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 md:justify-end">
      <button
        type="button"
        onClick={() => onVisualizar(certidao)}
        title="Visualizar certidão"
        aria-label="Visualizar certidão"
        className={classe}
      >
        <Eye size={16} />
      </button>

      {certidao.arquivo_url ? (
        <a
          href={urlDeDownload(certidao.arquivo_url)}
          target="_blank"
          rel="noreferrer"
          title="Baixar anexo"
          aria-label="Baixar anexo"
          className={classe}
        >
          <Download size={16} />
        </a>
      ) : (
        <span
          title="Sem anexo"
          aria-label="Sem anexo"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#0F2A44]/15"
        >
          <Download size={16} />
        </span>
      )}

      {podeEditar && (
        <button
          type="button"
          onClick={() => onEditar(certidao)}
          title="Editar certidão"
          aria-label="Editar certidão"
          className={classe}
        >
          <Pencil size={16} />
        </button>
      )}

      {/* Só aparece para quem tem pode_excluir no módulo; a exclusão em si
          ainda passa pela confirmação e pelo RLS de delete. */}
      {podeExcluir && (
        <button
          type="button"
          onClick={() => onExcluir(certidao)}
          title="Excluir certidão"
          aria-label="Excluir certidão"
          className="h-9 px-2.5 md:w-9 md:px-0 rounded-lg flex items-center justify-center gap-1.5 text-[#0F2A44]/50 hover:text-[#DC2626] hover:bg-[#DC2626]/5"
        >
          <Trash2 size={16} />
          <span className="text-xs md:hidden">Excluir</span>
        </button>
      )}
    </div>
  );
}
