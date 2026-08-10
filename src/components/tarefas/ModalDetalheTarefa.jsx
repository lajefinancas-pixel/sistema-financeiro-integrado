import React from "react";
import {
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  History,
  ListChecks,
  MessageSquare,
  Paperclip,
  Repeat,
  RotateCcw,
  Share2,
  ShieldCheck,
  Star,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { BadgePrioridade, BadgeStatus } from "./badges";
import PainelAnexos from "./PainelAnexos";
import PainelChecklist from "./PainelChecklist";
import PainelComentarios from "./PainelComentarios";
import PainelHistorico from "./PainelHistorico";
import {
  aprovarTarefa,
  categoriaLabel,
  compartilharTarefa,
  concluirTarefa,
  delegarTarefa,
  devolverTarefa,
  exigeAprovacao,
  formatarData,
  formatarDataHora,
  formatarHora,
  listarCompartilhamentos,
  recorrenciaLabel,
  recorrenciaTipo,
  removerCompartilhamento,
  statusVisual,
  temColuna,
  textoPrazo,
} from "../../lib/tarefas";

function Linha({ icone: Icone, rotulo, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#F5F3EF] flex items-center justify-center shrink-0">
        <Icone size={15} className="text-[#0F2A44]/45" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40">{rotulo}</div>
        <div className="text-sm text-[#0F2A44] mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

const ABAS = [
  { id: "checklist", label: "Checklist", icone: ListChecks },
  { id: "comentarios", label: "Comentários", icone: MessageSquare },
  { id: "anexos", label: "Anexos", icone: Paperclip },
  { id: "historico", label: "Histórico", icone: History },
];

/**
 * Detalhe da tarefa: os dados do cadastro (como já eram exibidos) mais o
 * checklist de etapas, os comentários, os anexos e a linha do tempo.
 *
 * Aqui também ficam a delegação (troca de responsável), o compartilhamento com
 * outras pessoas e, nas tarefas marcadas como importantes, o aval da gestora —
 * aprovar ou devolver para correção.
 *
 * Editar conteúdo e concluir seguem a mesma regra da política de update da
 * tabela: permissão de edição no módulo ou ser a responsável pela tarefa.
 */
export default function ModalDetalheTarefa({
  tarefa,
  usuarioLogado,
  permissao,
  usuarios = [],
  onFechar,
  onAtualizada,
  onListaMudou,
}) {
  const [atual, setAtual] = React.useState(tarefa);
  const [aba, setAba] = React.useState("checklist");
  const [recargaHistorico, setRecargaHistorico] = React.useState(0);
  const [confirmando, setConfirmando] = React.useState(false);
  const [observacao, setObservacao] = React.useState("");
  const [concluindo, setConcluindo] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);

  // Delegação e compartilhamento
  const [novoResponsavel, setNovoResponsavel] = React.useState("");
  const [delegando, setDelegando] = React.useState(false);
  const [compartilhamentos, setCompartilhamentos] = React.useState([]);
  const [selecionados, setSelecionados] = React.useState([]);
  const [compartilhando, setCompartilhando] = React.useState(false);

  // Aprovação / devolução
  const [devolvendo, setDevolvendo] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [salvandoAval, setSalvandoAval] = React.useState(false);

  React.useEffect(() => {
    setAtual(tarefa);
  }, [tarefa]);

  React.useEffect(() => {
    let ativo = true;
    listarCompartilhamentos(tarefa.id)
      .then((lista) => ativo && setCompartilhamentos(lista))
      .catch(() => ativo && setCompartilhamentos([]));
    return () => {
      ativo = false;
    };
  }, [tarefa.id]);

  const hora = formatarHora(atual.horario_limite);
  const prazoAviso = textoPrazo(atual);

  const podeEditar =
    permissao?.pode_editar === true ||
    (Boolean(usuarioLogado?.id) && atual.responsavel_id === usuarioLogado?.id);
  const podeExcluir = permissao?.pode_excluir === true;
  const podeAprovar = permissao?.pode_aprovar === true;
  const concluida = atual.status === "concluida";
  const emAnalise = atual.status === "em_analise";
  const precisaAprovacao = exigeAprovacao(atual);
  const repeticao = recorrenciaTipo(atual);

  const nomePorId = React.useMemo(() => {
    const mapa = {};
    usuarios.forEach((u) => {
      mapa[u.id] = u.nome_completo;
    });
    return mapa;
  }, [usuarios]);

  /** Candidatos a receber a tarefa ou o compartilhamento (fora a responsável). */
  const disponiveisParaCompartilhar = usuarios.filter(
    (u) => u.id !== atual.responsavel_id && !compartilhamentos.some((c) => c.usuario_id === u.id),
  );

  function registrarMudanca(atualizada, avisoTexto) {
    setAtual(atualizada);
    setRecargaHistorico((n) => n + 1);
    setAviso(avisoTexto ?? null);
    onAtualizada?.(atualizada);
  }

  async function concluir() {
    setConcluindo(true);
    setErro(null);
    try {
      const resultado = await concluirTarefa(atual, usuarioLogado?.id, observacao);
      setConfirmando(false);
      setObservacao("");
      registrarMudanca(
        resultado.tarefa,
        resultado.avisoHistorico
          ? `A tarefa foi salva, mas houve um problema no registro: ${resultado.avisoHistorico}`
          : resultado.ocorrencia
            ? `Próxima ocorrência criada para ${formatarData(resultado.ocorrencia.prazo)}.`
            : null,
      );
      if (resultado.ocorrencia) onListaMudou?.();
    } catch (e) {
      setErro(e.message ?? "Não foi possível concluir a tarefa.");
    } finally {
      setConcluindo(false);
    }
  }

  async function aprovar() {
    setSalvandoAval(true);
    setErro(null);
    try {
      const resultado = await aprovarTarefa(atual, usuarioLogado?.id);
      registrarMudanca(
        resultado.tarefa,
        resultado.avisoHistorico
          ? `A tarefa foi aprovada, mas houve um problema no registro: ${resultado.avisoHistorico}`
          : resultado.ocorrencia
            ? `Tarefa aprovada. Próxima ocorrência criada para ${formatarData(resultado.ocorrencia.prazo)}.`
            : null,
      );
      if (resultado.ocorrencia) onListaMudou?.();
    } catch (e) {
      setErro(e.message ?? "Não foi possível aprovar a tarefa.");
    } finally {
      setSalvandoAval(false);
    }
  }

  async function devolver() {
    setSalvandoAval(true);
    setErro(null);
    try {
      const { tarefa: atualizada, avisoHistorico } = await devolverTarefa(atual, usuarioLogado?.id, motivo);
      setDevolvendo(false);
      setMotivo("");
      registrarMudanca(
        atualizada,
        avisoHistorico ? `A tarefa foi devolvida, mas o registro no histórico falhou: ${avisoHistorico}` : null,
      );
    } catch (e) {
      setErro(e.message ?? "Não foi possível devolver a tarefa.");
    } finally {
      setSalvandoAval(false);
    }
  }

  async function delegar() {
    if (!novoResponsavel) return;
    setDelegando(true);
    setErro(null);
    try {
      const { tarefa: atualizada, avisoHistorico } = await delegarTarefa(
        atual,
        novoResponsavel,
        usuarioLogado?.id,
        nomePorId[novoResponsavel],
      );
      setNovoResponsavel("");
      registrarMudanca(
        atualizada,
        avisoHistorico ? `A tarefa foi delegada, mas o registro no histórico falhou: ${avisoHistorico}` : null,
      );
      onListaMudou?.();
    } catch (e) {
      setErro(e.message ?? "Não foi possível delegar a tarefa.");
    } finally {
      setDelegando(false);
    }
  }

  async function compartilhar() {
    if (selecionados.length === 0) return;
    setCompartilhando(true);
    setErro(null);
    try {
      const { adicionados, avisoHistorico } = await compartilharTarefa(
        atual,
        selecionados,
        usuarioLogado?.id,
        nomePorId,
      );
      setCompartilhamentos((lista) => [...lista, ...adicionados]);
      setSelecionados([]);
      setRecargaHistorico((n) => n + 1);
      setAviso(
        avisoHistorico ? `A tarefa foi compartilhada, mas o registro no histórico falhou: ${avisoHistorico}` : null,
      );
    } catch (e) {
      setErro(e.message ?? "Não foi possível compartilhar a tarefa.");
    } finally {
      setCompartilhando(false);
    }
  }

  async function descompartilhar(compartilhamento) {
    setErro(null);
    try {
      await removerCompartilhamento(
        compartilhamento,
        usuarioLogado?.id,
        nomePorId[compartilhamento.usuario_id],
      );
      setCompartilhamentos((lista) => lista.filter((c) => c.id !== compartilhamento.id));
      setRecargaHistorico((n) => n + 1);
    } catch (e) {
      setErro(e.message ?? "Não foi possível remover o compartilhamento.");
    }
  }

  const rodapeAprovacao = emAnalise && podeAprovar && (
    <div className="space-y-3">
      {devolvendo ? (
        <>
          <label className="block">
            <span className="text-xs font-medium text-[#0F2A44]/70">
              Motivo da devolução <span className="text-[#C9A227]">*</span>
            </span>
            <span className="block text-[11px] text-[#0F2A44]/45 mb-1">
              Obrigatório — fica no histórico e é enviado à responsável.
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Ex.: falta anexar o comprovante do pagamento."
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] placeholder:text-[#0F2A44]/30 resize-y bg-white"
            />
          </label>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setDevolvendo(false)}
              disabled={salvandoAval}
              className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={devolver}
              disabled={salvandoAval || !motivo.trim()}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#DC2626] text-white text-sm hover:bg-[#DC2626]/90 disabled:opacity-40"
            >
              <RotateCcw size={16} />
              {salvandoAval ? "Devolvendo..." : "Confirmar devolução"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => setDevolvendo(true)}
            disabled={salvandoAval}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-[#DC2626]/30 text-[#DC2626] text-sm hover:bg-[#FEF2F2] disabled:opacity-40"
          >
            <RotateCcw size={16} />
            Devolver para correção
          </button>
          <button
            type="button"
            onClick={aprovar}
            disabled={salvandoAval}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#15803D] text-white text-sm hover:bg-[#15803D]/90 disabled:opacity-40"
          >
            <ShieldCheck size={16} />
            {salvandoAval ? "Aprovando..." : "Aprovar"}
          </button>
        </div>
      )}
    </div>
  );

  const rodapeConclusao = !concluida && !emAnalise && podeEditar && (
    <div className="space-y-3">
      {confirmando ? (
        <>
          <label className="block">
            <span className="text-xs font-medium text-[#0F2A44]/70">Observação final</span>
            <span className="block text-[11px] text-[#0F2A44]/45 mb-1">
              Opcional — fica registrada na tarefa e no histórico.
            </span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Ex.: conferido e enviado ao setor responsável."
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] placeholder:text-[#0F2A44]/30 resize-y bg-white"
            />
          </label>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={concluindo}
              className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={concluir}
              disabled={concluindo}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#15803D] text-white text-sm hover:bg-[#15803D]/90 disabled:opacity-40"
            >
              <Check size={16} />
              {concluindo
                ? "Salvando..."
                : precisaAprovacao
                  ? "Concluir e enviar para aprovação"
                  : "Confirmar conclusão"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#15803D] text-white text-sm hover:bg-[#15803D]/90"
          >
            <Check size={16} />
            Concluir tarefa
          </button>
        </div>
      )}
    </div>
  );

  const rodape = rodapeAprovacao || rodapeConclusao;

  return (
    <ModalShell
      titulo={atual.titulo}
      subtitulo={`Criada em ${formatarDataHora(atual.criado_em)}`}
      onFechar={onFechar}
      largura="max-w-3xl"
      rodape={rodape || undefined}
    >
      <div className="space-y-6">
        {erro && <Alerta>{erro}</Alerta>}
        {aviso && (
          <div className="bg-[#FBF4DE] border border-[#C9A227]/40 text-[#8A7526] text-sm rounded-lg px-4 py-3">
            {aviso}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <BadgeStatus status={statusVisual(atual)} />
          <BadgePrioridade prioridade={atual.prioridade} />
          {atual.importante && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8A6100] bg-[#FEF6DF] px-2.5 py-1 rounded-full">
              <Star size={11} />
              Importante
            </span>
          )}
          {repeticao && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] bg-[#EAF1FF] px-2.5 py-1 rounded-full">
              <Repeat size={11} />
              {recorrenciaLabel(repeticao)}
            </span>
          )}
          {atual.status === "cancelada" && (
            <span className="text-[11px] text-[#0F2A44]/45">Status gravado: cancelada</span>
          )}
        </div>

        {emAnalise && (
          <div className="rounded-xl border border-[#F97316]/25 bg-[#FFF1E6] px-4 py-3 flex items-start gap-3">
            <ShieldCheck size={16} className="text-[#C2410C] mt-0.5 shrink-0" />
            <div className="text-xs text-[#C2410C] leading-relaxed">
              Concluída pela responsável e aguardando aprovação da gestora.
              {atual.observacao_final && (
                <span className="block mt-1 text-[#C2410C]/85">
                  Observação final: {atual.observacao_final}
                </span>
              )}
              {!podeAprovar && (
                <span className="block mt-1 text-[#C2410C]/70">
                  Você não tem permissão de aprovação neste módulo.
                </span>
              )}
            </div>
          </div>
        )}

        {concluida && (
          <div className="rounded-xl border border-[#16A34A]/25 bg-[#EAFBF0] px-4 py-3 flex items-start gap-3">
            <CheckCircle2 size={16} className="text-[#15803D] mt-0.5 shrink-0" />
            <div className="text-xs text-[#15803D] leading-relaxed">
              Concluída em {formatarDataHora(atual.concluida_em)}
              {atual.finalizador?.nome_completo ? ` por ${atual.finalizador.nome_completo}` : ""}.
              {atual.aprovada === true && (
                <span className="block mt-1">
                  Aprovada em {formatarDataHora(atual.aprovada_em)}
                  {nomePorId[atual.aprovada_por] ? ` por ${nomePorId[atual.aprovada_por]}` : ""}.
                </span>
              )}
              {atual.observacao_final && (
                <span className="block mt-1 text-[#15803D]/85">
                  Observação final: {atual.observacao_final}
                </span>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40 mb-1.5">Descrição</div>
          {atual.descricao ? (
            <p className="text-sm text-[#0F2A44]/80 leading-relaxed whitespace-pre-wrap">{atual.descricao}</p>
          ) : (
            <p className="text-sm text-[#0F2A44]/35">Sem descrição.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <Linha icone={UserRound} rotulo="Responsável">
            {atual.responsavel?.nome_completo ?? "Sem responsável definido"}
          </Linha>
          <Linha icone={CalendarClock} rotulo="Prazo">
            {formatarData(atual.prazo)}
            {hora && <span className="text-[#0F2A44]/55"> às {hora}</span>}
            {prazoAviso && <span className="block text-[11px] text-[#0F2A44]/45 mt-0.5">{prazoAviso}</span>}
          </Linha>
          <Linha icone={Tag} rotulo="Categoria">
            {categoriaLabel(atual.categoria)}
          </Linha>
          <Linha icone={Building2} rotulo="Secretaria relacionada">
            {atual.secretaria_relacionada || "--"}
          </Linha>
          {temColuna("recorrencia") && (
            <Linha icone={Repeat} rotulo="Repetição">
              {repeticao ? recorrenciaLabel(repeticao) : "Não repete"}
            </Linha>
          )}
          <Linha icone={Share2} rotulo="Compartilhada com">
            {compartilhamentos.length === 0
              ? "Ninguém além da responsável"
              : compartilhamentos
                  .map((c) => nomePorId[c.usuario_id] ?? "Usuário removido")
                  .join(", ")}
          </Linha>
        </div>

        {/* Delegação e compartilhamento — mesma regra de quem pode editar a tarefa. */}
        {podeEditar && (
          <div className="rounded-xl border border-black/10 p-4 space-y-4">
            <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
              Delegação e compartilhamento
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Campo label="Delegar para" dica="Troca a responsável pela tarefa e avisa quem recebeu.">
                  <select
                    value={novoResponsavel}
                    onChange={(e) => setNovoResponsavel(e.target.value)}
                    className={CLASSE_ENTRADA}
                  >
                    <option value="">Manter responsável atual</option>
                    {usuarios
                      .filter((u) => u.id !== atual.responsavel_id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome_completo}
                          {u.cargo ? ` — ${u.cargo}` : ""}
                        </option>
                      ))}
                  </select>
                </Campo>
                <button
                  type="button"
                  onClick={delegar}
                  disabled={!novoResponsavel || delegando}
                  className="mt-2 w-full sm:w-auto px-4 py-2 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
                >
                  {delegando ? "Delegando..." : "Delegar tarefa"}
                </button>
              </div>

              <div>
                <Campo
                  label="Compartilhar com"
                  dica="Seleção múltipla — segure Ctrl (ou Cmd) para escolher mais de uma pessoa."
                >
                  <select
                    multiple
                    value={selecionados}
                    onChange={(e) =>
                      setSelecionados([...e.target.selectedOptions].map((opcao) => opcao.value))
                    }
                    size={Math.min(5, Math.max(3, disponiveisParaCompartilhar.length))}
                    className={`${CLASSE_ENTRADA} h-auto py-2`}
                  >
                    {disponiveisParaCompartilhar.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome_completo}
                      </option>
                    ))}
                  </select>
                </Campo>
                <button
                  type="button"
                  onClick={compartilhar}
                  disabled={selecionados.length === 0 || compartilhando}
                  className="mt-2 w-full sm:w-auto px-4 py-2 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
                >
                  {compartilhando ? "Compartilhando..." : "Compartilhar"}
                </button>
              </div>
            </div>

            {compartilhamentos.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {compartilhamentos.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#0F2A44]/70 bg-[#F5F3EF] border border-black/5 rounded-full pl-3 pr-1.5 py-1"
                  >
                    {nomePorId[c.usuario_id] ?? "Usuário removido"}
                    <button
                      type="button"
                      title="Deixar de compartilhar"
                      onClick={() => descompartilhar(c)}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[#0F2A44]/35 hover:text-[#DC2626] hover:bg-white"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pt-1 text-xs text-[#0F2A44]/45 border-t border-black/5">
          <div className="mt-4">
            Criada por <strong className="font-medium text-[#0F2A44]/70">{atual.autor?.nome_completo ?? "--"}</strong>
          </div>
        </div>

        <div>
          <div className="flex gap-1 border-b border-black/5 -mx-1 px-1 overflow-x-auto">
            {ABAS.map((item) => {
              const Icone = item.icone;
              const ativa = aba === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAba(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
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

          <div className="pt-5">
            {aba === "checklist" && (
              <PainelChecklist tarefaId={atual.id} podeEditar={podeEditar} podeExcluir={podeExcluir} />
            )}
            {aba === "comentarios" && (
              <PainelComentarios
                tarefaId={atual.id}
                usuarioId={usuarioLogado?.id}
                tarefa={atual}
                nomeUsuario={usuarioLogado?.nome_completo}
              />
            )}
            {aba === "anexos" && (
              <PainelAnexos
                tarefaId={atual.id}
                usuarioId={usuarioLogado?.id}
                podeAnexar={Boolean(usuarioLogado?.id)}
                podeExcluir={podeExcluir}
              />
            )}
            {aba === "historico" && <PainelHistorico tarefaId={atual.id} recarga={recargaHistorico} />}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
