import React from "react";
import { Eye, Pencil, Plus, RotateCcw, UserMinus } from "lucide-react";
import PainelFiltros from "../comuns/PainelFiltros.jsx";
import ModalConfirmarExclusao from "../comuns/ModalConfirmarExclusao.jsx";
import ModalServidor from "./ModalServidor.jsx";
import { mensagemAmigavel } from "../../lib/erros.js";
import {
  AVISO_MIGRATION_SERVIDORES,
  CATEGORIAS_DIARIA,
  SITUACOES_SERVIDOR,
  acoesNoServidor,
  cpfFormatado,
  filtrarServidores,
  filtrosVaziosDeServidores,
  nomeDaSecretariaDoServidor,
  ordenarServidores,
  rotuloDaCategoria,
  situacaoServidorInfo,
  totalFiltrosDeServidoresAtivos,
} from "../../lib/processosServidores.js";
import {
  carregarServidores,
  criarServidor,
  estruturaDeServidoresAusente,
  inativarServidor,
  reativarServidor,
  salvarServidor,
} from "../../lib/processosServidoresDados.js";

/**
 * A subaba SERVIDORES: o cadastro dos servidores do município.
 *
 * ⚠️ NÃO É O CADASTRO DE FORNECEDORES, e não se mistura com ele. Fornecedor é
 * quem VENDE para o município; servidor é quem TRABALHA no município --
 * efetivos, comissionados, secretários e agentes políticos. São duas listas
 * distintas: esta tela não lê, não escreve e não duplica nada em Fornecedores.
 *
 * O mesmo servidor serve aos DOIS papéis que os processos pedem: BENEFICIÁRIO
 * da diária (quem viaja) e SIGNATÁRIO dos documentos (quem assina). Ele é
 * cadastrado uma vez só, e o papel é escolhido no processo.
 *
 * A EXCLUSÃO É LÓGICA: inativar. O cadastro nunca é apagado, porque processos
 * antigos apontam para ele -- apagá-lo quebraria documento já emitido.
 *
 * DOCUMENTAL: nenhuma ação desta tela debita conta, dá baixa em NF, altera
 * saldo, marca fornecedor como pago, cria pagamento ou mexe na Programação
 * Diária. As únicas tabelas que ela escreve são processos_servidores e a
 * auditoria.
 */
export default function PaginaServidores({ permissoes = {}, secretarias = [], carregandoApoio = false }) {
  const [servidores, setServidores] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [faltaMigration, setFaltaMigration] = React.useState(false);

  const [busca, setBusca] = React.useState("");
  const [filtros, setFiltros] = React.useState(filtrosVaziosDeServidores);

  const [aberto, setAberto] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erroForm, setErroForm] = React.useState(null);
  const [confirmacao, setConfirmacao] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setFaltaMigration(false);
    try {
      setServidores(await carregarServidores());
    } catch (falha) {
      if (estruturaDeServidoresAusente(falha)) {
        setFaltaMigration(true);
        setServidores([]);
      } else {
        setErro(mensagemAmigavel(falha, "Não foi possível carregar o cadastro de servidores."));
      }
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = React.useMemo(
    () => ordenarServidores(filtrarServidores(servidores, { busca, filtros, secretarias })),
    [servidores, busca, filtros, secretarias],
  );
  const ativos = totalFiltrosDeServidoresAtivos(filtros);

  const chips = React.useMemo(() => {
    const rotulos = {
      secretaria: (v) => `Secretaria: ${secretarias.find((s) => String(s.id) === String(v))?.nome ?? v}`,
      categoria: (v) => `Categoria: ${rotuloDaCategoria(v) || v}`,
      situacao: (v) => `Situação: ${situacaoServidorInfo(v).rotulo}`,
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

  async function criar(formulario) {
    setSalvando(true);
    setErroForm(null);
    try {
      const criado = await criarServidor(formulario);
      setAberto(null);
      setAviso(`Servidor ${criado?.nome ?? ""} cadastrado.`);
      await carregar();
    } catch (falha) {
      setErroForm(mensagemAmigavel(falha, "Não foi possível cadastrar o servidor."));
    } finally {
      setSalvando(false);
    }
  }

  async function salvar(id, formulario) {
    setSalvando(true);
    setErroForm(null);
    try {
      const anterior = servidores.find((s) => String(s.id) === String(id)) ?? null;
      const salvo = await salvarServidor(id, formulario, { anterior });
      setAberto(null);
      setAviso(`Cadastro de ${salvo?.nome ?? "servidor"} atualizado.`);
      await carregar();
    } catch (falha) {
      setErroForm(mensagemAmigavel(falha, "Não foi possível salvar o cadastro."));
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarInativacao(servidor, motivo) {
    await inativarServidor(servidor.id, { motivo, anterior: servidor });
    setConfirmacao(null);
    setAviso(`${servidor.nome} foi inativado. O cadastro continua no banco e os processos antigos estão intactos.`);
    await carregar();
  }

  async function reativar(servidor) {
    setErro(null);
    try {
      await reativarServidor(servidor.id, { anterior: servidor });
      setAviso(`${servidor.nome} voltou a ficar ativo.`);
      await carregar();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível reativar o servidor."));
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">Processos</div>
          <h1 className="mt-0.5 text-2xl font-semibold text-[#0F2A44]">Servidores</h1>
          <p className="mt-0.5 text-sm text-[#0F2A44]/60">
            {carregando
              ? "Carregando..."
              : `${visiveis.length} ${visiveis.length === 1 ? "servidor" : "servidores"} — beneficiários de diária e signatários dos documentos`}
          </p>
        </div>
        {permissoes.criar && !faltaMigration && (
          <button
            type="button"
            onClick={() => {
              setErroForm(null);
              setAberto({ servidor: null });
            }}
            className="flex min-h-[2.75rem] items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm text-white hover:bg-[#0F2A44]/90"
          >
            <Plus size={16} /> Novo Servidor
          </button>
        )}
      </div>

      {faltaMigration && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {AVISO_MIGRATION_SERVIDORES}
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
        onLimpar={() => setFiltros(filtrosVaziosDeServidores())}
        topo={
          <>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="🔎 Buscar por nome, CPF, cargo ou secretaria..."
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
            <p className="mt-1.5 text-[11px] text-[#0F2A44]/40">
              A busca filtra enquanto você digita. O CPF encontra com ou sem ponto e traço.
            </p>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Categoria para diária</label>
            <select
              value={filtros.categoria}
              onChange={(e) => setFiltros((atual) => ({ ...atual, categoria: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todas</option>
              {CATEGORIAS_DIARIA.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Situação</label>
            <select
              value={filtros.situacao}
              onChange={(e) => setFiltros((atual) => ({ ...atual, situacao: e.target.value }))}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            >
              <option value="">Todas</option>
              {SITUACOES_SERVIDOR.map((situacao) => (
                <option key={situacao.id} value={situacao.id}>
                  {situacao.rotulo}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PainelFiltros>

      {/* Lista compacta: uma linha por servidor. */}
      <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/50">
            <tr>
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 font-medium">CPF</th>
              <th className="px-3 py-2.5 font-medium">Cargo</th>
              <th className="px-3 py-2.5 font-medium">Secretaria</th>
              <th className="px-3 py-2.5 font-medium">Categoria</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
              <th className="px-3 py-2.5 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {carregando || carregandoApoio ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  Carregando...
                </td>
              </tr>
            ) : visiveis.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  {servidores.length === 0
                    ? "Nenhum servidor cadastrado ainda."
                    : "Nenhum servidor atende à busca ou aos filtros."}
                </td>
              </tr>
            ) : (
              visiveis.map((servidor) => (
                <Linha
                  key={servidor.id}
                  servidor={servidor}
                  secretarias={secretarias}
                  permissoes={permissoes}
                  onAbrir={() => {
                    setErroForm(null);
                    setAberto({ servidor });
                  }}
                  onInativar={() => setConfirmacao({ servidor })}
                  onReativar={() => reativar(servidor)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
        Este é o cadastro dos servidores do município — não é o cadastro de fornecedores, e os dois
        não se misturam. O mesmo servidor pode aparecer nos processos como beneficiário da diária e
        como signatário dos documentos. Módulo documental: nada aqui debita conta, dá baixa em NF,
        altera saldo ou cria pagamento.
      </p>

      {aberto && (
        <ModalServidor
          servidor={aberto.servidor}
          servidores={servidores}
          secretarias={secretarias}
          permissoes={permissoes}
          salvando={salvando}
          erro={erroForm}
          onFechar={() => setAberto(null)}
          onCriar={criar}
          onSalvar={salvar}
        />
      )}

      {confirmacao && (
        <ModalConfirmarExclusao
          titulo="Inativar servidor"
          subtitulo="A exclusão deste cadastro é a inativação: a linha continua no banco."
          registro={confirmacao.servidor?.nome ?? ""}
          detalhes={detalhesDoServidor(confirmacao.servidor, secretarias)}
          aviso={
            "O servidor deixa de ser oferecido em processos novos. O cadastro NÃO é apagado e os " +
            "processos antigos continuam intactos, com o nome, o CPF e o cargo já gravados neles. " +
            "Nenhum saldo, baixa, NF ou programação é alterado por isto."
          }
          exigirMotivo
          textoConfirmar="Confirmar inativação"
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={(motivo) => confirmarInativacao(confirmacao.servidor, motivo)}
        />
      )}
    </>
  );
}

/** Uma linha da lista: Nome | CPF | Cargo | Secretaria | Categoria | Situação | Ações. */
function Linha({ servidor, secretarias, permissoes, onAbrir, onInativar, onReativar }) {
  const acoes = acoesNoServidor(servidor, permissoes);
  const situacao = situacaoServidorInfo(servidor.situacao);
  const inativo = situacao.id === "inativo";

  return (
    <tr className={inativo ? "opacity-60" : undefined}>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[16rem] truncate font-medium">{servidor.nome || "--"}</span>
        {servidor.matricula && (
          <span className="block text-[11px] text-[#0F2A44]/45">Matrícula {servidor.matricula}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[#0F2A44]">{cpfFormatado(servidor.cpf) || "--"}</td>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[12rem] truncate">{servidor.cargo || "--"}</span>
      </td>
      <td className="px-3 py-2.5 text-[#0F2A44]">
        <span className="block max-w-[12rem] truncate">
          {nomeDaSecretariaDoServidor(servidor, secretarias) || "--"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-[#0F2A44]/80">
        <span className="block max-w-[12rem] truncate">{rotuloDaCategoria(servidor.categoria_diaria) || "--"}</span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${
            inativo ? "bg-black/5 text-[#0F2A44]/60" : "bg-emerald-50 text-emerald-700"
          }`}
        >
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
          {acoes.inativar && (
            <BotaoAcao
              titulo="Inativar (o cadastro não é apagado)"
              onClick={onInativar}
              icone={UserMinus}
            />
          )}
          {acoes.reativar && (
            <BotaoAcao titulo="Reativar servidor" onClick={onReativar} icone={RotateCcw} />
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

function detalhesDoServidor(servidor, secretarias) {
  return [
    { rotulo: "CPF", valor: cpfFormatado(servidor?.cpf) || "--" },
    { rotulo: "Cargo", valor: servidor?.cargo || "--" },
    { rotulo: "Secretaria", valor: nomeDaSecretariaDoServidor(servidor, secretarias) || "--" },
    { rotulo: "Categoria para diária", valor: rotuloDaCategoria(servidor?.categoria_diaria) || "--" },
    { rotulo: "Situação", valor: situacaoServidorInfo(servidor?.situacao).rotulo },
  ];
}
