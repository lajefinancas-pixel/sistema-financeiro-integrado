import React from "react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { CATEGORIAS, PRIORIDADES, criarTarefa } from "../../lib/tarefas";

/** Formulário de cadastro de tarefa. Grava com status "nova" e registra o histórico. */
export default function ModalNovaTarefa({ usuarios, secretarias, usuarioId, onFechar, onCriada }) {
  const [campos, setCampos] = React.useState({
    titulo: "",
    descricao: "",
    responsavel_id: usuarioId ?? "",
    prazo: "",
    horario_limite: "",
    prioridade: "normal",
    categoria: "financeiro",
    secretaria_relacionada: "",
  });
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  function alterar(campo, valor) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    if (!campos.titulo.trim()) {
      setErro("Informe o título da tarefa.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const { tarefa, avisoHistorico } = await criarTarefa(campos, usuarioId);
      onCriada?.(tarefa, avisoHistorico);
      onFechar();
    } catch (e) {
      setErro(e.message ?? "Não foi possível criar a tarefa.");
      setSalvando(false);
    }
  }

  return (
    <ModalShell
      titulo="Nova tarefa"
      subtitulo="A tarefa é criada com o status Nova e fica registrada no histórico."
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-nova-tarefa"
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            {salvando ? "Criando..." : "Criar tarefa"}
          </button>
        </div>
      }
    >
      <form id="form-nova-tarefa" onSubmit={salvar} className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <Campo label="Título" obrigatorio>
          <input
            type="text"
            value={campos.titulo}
            onChange={(e) => alterar("titulo", e.target.value)}
            placeholder="Ex.: Conferir notas fiscais da folha"
            maxLength={180}
            autoFocus
            className={CLASSE_ENTRADA}
          />
        </Campo>

        <Campo label="Descrição" dica="Opcional — detalhe o que precisa ser feito.">
          <textarea
            value={campos.descricao}
            onChange={(e) => alterar("descricao", e.target.value)}
            rows={4}
            className={`${CLASSE_ENTRADA} resize-y`}
          />
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Responsável">
            <select
              value={campos.responsavel_id}
              onChange={(e) => alterar("responsavel_id", e.target.value)}
              className={CLASSE_ENTRADA}
            >
              <option value="">Sem responsável definido</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome_completo}
                  {u.cargo ? ` — ${u.cargo}` : ""}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Secretaria relacionada">
            <select
              value={campos.secretaria_relacionada}
              onChange={(e) => alterar("secretaria_relacionada", e.target.value)}
              className={CLASSE_ENTRADA}
            >
              <option value="">Nenhuma</option>
              {secretarias.map((s) => (
                <option key={s.id} value={s.nome}>
                  {s.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Prazo">
            <input
              type="date"
              value={campos.prazo}
              onChange={(e) => alterar("prazo", e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Campo label="Horário limite" dica="Opcional — hora do dia em que a tarefa vence.">
            <input
              type="time"
              value={campos.horario_limite}
              onChange={(e) => alterar("horario_limite", e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Campo label="Prioridade">
            <select
              value={campos.prioridade}
              onChange={(e) => alterar("prioridade", e.target.value)}
              className={CLASSE_ENTRADA}
            >
              {Object.entries(PRIORIDADES).map(([id, info]) => (
                <option key={id} value={id}>
                  {info.label}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Categoria">
            <select
              value={campos.categoria}
              onChange={(e) => alterar("categoria", e.target.value)}
              className={CLASSE_ENTRADA}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </form>
    </ModalShell>
  );
}
