import React from "react";
import { Banknote, Building, CircleDollarSign, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { BadgeAtivo, Cartao, ModalConfirmacao } from "./comuns";
import {
  atualizarSecretaria,
  criarSecretaria,
  excluirSecretaria,
  FORMATO_MONETARIO,
  LIMITE_NOME_SECRETARIA,
  listarBancosEmUso,
  listarSecretarias,
} from "../../lib/configuracoesSistema";
import { formatBRL } from "../../lib/moeda";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/** Linha de um dado fixo do sistema: rótulo, valor e a explicação do porquê. */
function ItemFixo({ label, valor, explicacao }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#0F2A44]/40">{label}</div>
      <div className="text-base font-semibold text-[#0F2A44] mt-1">{valor}</div>
      <p className="text-[11px] text-[#0F2A44]/50 mt-1.5 leading-relaxed">{explicacao}</p>
    </div>
  );
}

/** Formulário de cadastro/edição de secretaria, em modal. */
function ModalSecretaria({ secretaria, salvando, erro, onSalvar, onFechar }) {
  const editando = Boolean(secretaria?.id);
  const [nome, setNome] = React.useState(secretaria?.nome ?? "");
  const [ativo, setAtivo] = React.useState(secretaria?.ativo !== false);

  return (
    <ModalShell
      titulo={editando ? "Editar secretaria" : "Nova secretaria"}
      subtitulo={
        editando
          ? "O nome alterado passa a valer em todas as telas que mostram esta secretaria."
          : "A secretaria nova já fica disponível para contas bancárias e fornecedores."
      }
      largura="max-w-lg"
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSalvar({ nome, ativo })}
            disabled={salvando || nome.trim() === ""}
            className="text-sm px-5 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Cadastrar secretaria"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        <Campo label="Nome da secretaria" obrigatorio dica="Ex.: Secretaria Municipal de Educação.">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={LIMITE_NOME_SECRETARIA}
            autoFocus
            className={CLASSE_ENTRADA}
          />
        </Campo>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#0F2A44]"
          />
          <span>
            <span className="text-sm text-[#0F2A44]">Secretaria ativa</span>
            <span className="block text-[11px] text-[#0F2A44]/50 mt-0.5 leading-relaxed">
              Secretarias inativas deixam de ser oferecidas nos cadastros de Saldos, Fornecedores e
              Pagamentos, mas os registros já lançados nelas continuam intactos.
            </span>
          </span>
        </label>
      </div>
    </ModalShell>
  );
}

/**
 * Categoria FINANCEIRO: como o sistema exibe valores, quais bancos estão em uso
 * e o cadastro das secretarias.
 *
 * Formato monetário e casas decimais são informativos — o sistema inteiro
 * trabalha em real com duas casas, e mudar isso não seria uma configuração, e
 * sim uma troca de moeda que afetaria todo o histórico já gravado.
 *
 * A lista de bancos é apenas o retrato do que existe hoje: banco continua sendo
 * cadastrado ao criar a conta bancária, em Saldos das Contas.
 */
export default function CategoriaFinanceiro({ podeEditar }) {
  const [bancos, setBancos] = React.useState([]);
  const [carregandoBancos, setCarregandoBancos] = React.useState(true);
  const [erroBancos, setErroBancos] = React.useState(null);

  const [secretarias, setSecretarias] = React.useState([]);
  const [carregandoSecretarias, setCarregandoSecretarias] = React.useState(true);
  const [erroSecretarias, setErroSecretarias] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  // null = modal fechado; {} = cadastro novo; { id, ... } = edição.
  const [emEdicao, setEmEdicao] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erroModal, setErroModal] = React.useState(null);

  const [paraExcluir, setParaExcluir] = React.useState(null);
  const [excluindo, setExcluindo] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const lista = await listarBancosEmUso();
        if (ativo) setBancos(lista);
      } catch (e) {
        if (ativo) setErroBancos(mensagemAmigavel(e, "Não foi possível carregar os bancos."));
      } finally {
        if (ativo) setCarregandoBancos(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  async function carregarSecretarias() {
    setCarregandoSecretarias(true);
    try {
      const lista = await listarSecretarias();
      setSecretarias(lista);
      setErroSecretarias(null);
    } catch (e) {
      setErroSecretarias(mensagemAmigavel(e, "Não foi possível carregar as secretarias."));
    } finally {
      setCarregandoSecretarias(false);
    }
  }

  React.useEffect(() => {
    carregarSecretarias();
  }, []);

  async function salvarSecretaria({ nome, ativo }) {
    if (salvando) return;
    setSalvando(true);
    setErroModal(null);
    try {
      const editando = Boolean(emEdicao?.id);
      const anterior = editando ? { nome: emEdicao.nome, ativo: emEdicao.ativo } : null;
      const gravada = editando
        ? await atualizarSecretaria(emEdicao.id, { nome, ativo })
        : await criarSecretaria(nome, { ativo });

      await registrarEvento({
        modulo: "administracao",
        acao: editando ? "alterou" : "criou",
        registroAfetado: `Configurações do sistema — Secretaria "${gravada.nome}"`,
        valorAnterior: anterior,
        valorNovo: { nome: gravada.nome, ativo: gravada.ativo },
        nivel: "atencao",
      });

      setEmEdicao(null);
      setSucesso(editando ? "Secretaria atualizada." : "Secretaria cadastrada.");
      await carregarSecretarias();
    } catch (e) {
      setErroModal(mensagemAmigavel(e, "Não foi possível salvar a secretaria."));
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (excluindo || !paraExcluir) return;
    setExcluindo(true);
    setErroSecretarias(null);
    try {
      await excluirSecretaria(paraExcluir.id);

      await registrarEvento({
        modulo: "administracao",
        acao: "excluiu",
        registroAfetado: `Configurações do sistema — Secretaria "${paraExcluir.nome}"`,
        valorAnterior: { nome: paraExcluir.nome, ativo: paraExcluir.ativo },
        nivel: "atencao",
      });

      setParaExcluir(null);
      setSucesso("Secretaria excluída.");
      await carregarSecretarias();
    } catch (e) {
      setParaExcluir(null);
      setErroSecretarias(mensagemAmigavel(e, "Não foi possível excluir a secretaria."));
    } finally {
      setExcluindo(false);
    }
  }

  /** "2 contas · 5 fornecedores" — o que impede (ou libera) a exclusão. */
  function textoVinculos(secretaria) {
    if (secretaria.contas === null || secretaria.fornecedores === null) {
      return "Vínculos não conferidos";
    }
    if (secretaria.contas === 0 && secretaria.fornecedores === 0) return "Sem vínculos";
    const partes = [];
    if (secretaria.contas > 0) {
      partes.push(`${secretaria.contas} ${secretaria.contas === 1 ? "conta" : "contas"}`);
    }
    if (secretaria.fornecedores > 0) {
      partes.push(
        `${secretaria.fornecedores} ${secretaria.fornecedores === 1 ? "fornecedor" : "fornecedores"}`
      );
    }
    return partes.join(" · ");
  }

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Formato dos valores"
        descricao="Como todo valor monetário é exibido e impresso no sistema. Estes dois itens são fixos e aparecem aqui apenas para conferência."
        icone={CircleDollarSign}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ItemFixo
            label="Formato monetário"
            valor={`${FORMATO_MONETARIO.simbolo} (Real brasileiro)`}
            explicacao="Todo o sistema — telas, relatórios, PDFs e planilhas — trabalha em real. Trocar a moeda mudaria o significado de todos os lançamentos já gravados."
          />
          <ItemFixo
            label="Casas decimais"
            valor={String(FORMATO_MONETARIO.casas_decimais)}
            explicacao={`Os centavos são sempre exibidos com duas casas. Exemplo: ${formatBRL(1234.5)}.`}
          />
        </div>
      </Cartao>

      <Cartao
        titulo="Bancos utilizados"
        descricao="Bancos já cadastrados no sistema e quantas contas bancárias existem em cada um. Somente leitura: novos bancos continuam sendo criados ao cadastrar a conta, em Saldos das Contas."
        icone={Landmark}
      >
        {carregandoBancos ? (
          <p className="text-sm text-[#0F2A44]/45">Carregando bancos...</p>
        ) : erroBancos ? (
          <Alerta tipo="erro">{erroBancos}</Alerta>
        ) : bancos.length === 0 ? (
          <p className="text-xs text-[#0F2A44]/40 rounded-xl border border-dashed border-black/10 px-4 py-6 text-center">
            Nenhum banco cadastrado ainda. Eles aparecem aqui assim que a primeira conta bancária for
            criada em Saldos das Contas.
          </p>
        ) : (
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
            {bancos.map((banco) => (
              <li key={banco.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                <div className="w-9 h-9 rounded-xl bg-[#F5F3EF] border border-[#C9A227]/25 flex items-center justify-center shrink-0">
                  <Banknote size={16} className="text-[#0F2A44]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[#0F2A44] truncate">{banco.nome}</div>
                  <div className="text-[11px] text-[#0F2A44]/50">
                    {banco.contas === 0
                      ? "Nenhuma conta vinculada"
                      : `${banco.contasAtivas} de ${banco.contas} ${
                          banco.contas === 1 ? "conta ativa" : "contas ativas"
                        }`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao
        titulo="Secretarias"
        descricao="Cadastro das secretarias usadas em contas bancárias, fornecedores, pagamentos e relatórios."
        icone={Building}
        rodape={
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <p className="text-[11px] text-[#0F2A44]/45 leading-relaxed">
              Uma secretaria com contas ou fornecedores vinculados não pode ser excluída — marque-a
              como inativa para tirá-la dos cadastros sem perder o histórico.
            </p>
            <button
              type="button"
              onClick={() => {
                setErroModal(null);
                setSucesso(null);
                setEmEdicao({});
              }}
              disabled={!podeEditar}
              title={podeEditar ? undefined : "Você não tem permissão para alterar as configurações."}
              className="self-start sm:self-auto flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40 disabled:hover:bg-[#0F2A44] shrink-0"
            >
              <Plus size={15} />
              Nova secretaria
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {erroSecretarias && <Alerta tipo="erro">{erroSecretarias}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

          {carregandoSecretarias ? (
            <p className="text-sm text-[#0F2A44]/45">Carregando secretarias...</p>
          ) : secretarias.length === 0 ? (
            <p className="text-xs text-[#0F2A44]/40 rounded-xl border border-dashed border-black/10 px-4 py-6 text-center">
              Nenhuma secretaria cadastrada.
            </p>
          ) : (
            <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
              {secretarias.map((secretaria) => (
                <li
                  key={secretaria.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 bg-white"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[#0F2A44] truncate">{secretaria.nome}</div>
                    <div className="text-[11px] text-[#0F2A44]/50">{textoVinculos(secretaria)}</div>
                  </div>

                  <BadgeAtivo ativo={secretaria.ativo} />

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setErroModal(null);
                        setSucesso(null);
                        setEmEdicao(secretaria);
                      }}
                      disabled={!podeEditar}
                      title="Editar nome e situação"
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[#0F2A44]/50 hover:text-[#0F2A44] hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSucesso(null);
                        if (!secretaria.podeExcluir) {
                          setErroSecretarias(secretaria.motivoBloqueio);
                          return;
                        }
                        setErroSecretarias(null);
                        setParaExcluir(secretaria);
                      }}
                      disabled={!podeEditar}
                      title={
                        secretaria.podeExcluir
                          ? "Excluir secretaria"
                          : secretaria.motivoBloqueio ?? "Exclusão bloqueada"
                      }
                      className={`w-9 h-9 rounded-lg flex items-center justify-center hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent ${
                        secretaria.podeExcluir
                          ? "text-[#0F2A44]/50 hover:text-red-600"
                          : "text-[#0F2A44]/20"
                      }`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Cartao>

      {emEdicao && (
        <ModalSecretaria
          // Remonta o formulário ao trocar de secretaria (ou ao abrir um cadastro novo).
          key={emEdicao.id ?? "nova"}
          secretaria={emEdicao.id ? emEdicao : null}
          salvando={salvando}
          erro={erroModal}
          onSalvar={salvarSecretaria}
          onFechar={() => {
            if (!salvando) setEmEdicao(null);
          }}
        />
      )}

      {paraExcluir && (
        <ModalConfirmacao
          titulo="Excluir secretaria?"
          subtitulo={paraExcluir.nome}
          aviso="A secretaria será removida do cadastro. Esta ação não pode ser desfeita."
          confirmarLabel="Excluir secretaria"
          confirmandoLabel="Excluindo..."
          confirmando={excluindo}
          onConfirmar={confirmarExclusao}
          onCancelar={() => {
            if (!excluindo) setParaExcluir(null);
          }}
        />
      )}
    </div>
  );
}
