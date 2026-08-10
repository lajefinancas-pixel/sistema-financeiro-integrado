import React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AlertTriangle, CalendarClock, GripVertical, UserRound } from "lucide-react";
import { BadgePrioridade } from "./badges";
import {
  COLUNAS_QUADRO,
  colunaDaTarefa,
  estaAtrasada,
  formatarData,
  formatarHora,
  statusInfo,
} from "../../lib/tarefas";

/** Conteúdo do card — usado na coluna e também na prévia que segue o cursor. */
function ConteudoCard({ tarefa, arrastavel, arrastando, salvando }) {
  const atrasada = estaAtrasada(tarefa);
  const hora = formatarHora(tarefa.horario_limite);

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm p-3 ${
        atrasada ? "border-[#DC2626]/30" : "border-black/5"
      } ${arrastando ? "shadow-lg rotate-1" : ""} ${salvando ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        {arrastavel && (
          <GripVertical size={14} className="text-[#0F2A44]/20 mt-0.5 shrink-0" aria-hidden="true" />
        )}
        <div className="text-sm font-medium text-[#0F2A44] leading-snug break-words min-w-0">
          {tarefa.titulo}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-2 text-xs text-[#0F2A44]/55">
        <UserRound size={13} className="text-[#0F2A44]/30 shrink-0" />
        <span className="truncate">{tarefa.responsavel?.nome_completo ?? "Sem responsável"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2.5 pt-2.5 border-t border-black/5">
        <BadgePrioridade prioridade={tarefa.prioridade} />
        <span className="flex items-center gap-1 text-[11px] text-[#0F2A44]/55">
          <CalendarClock size={12} className="text-[#0F2A44]/30" />
          {formatarData(tarefa.prazo)}
          {hora ? ` às ${hora}` : ""}
        </span>
        {atrasada && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#DC2626]">
            <AlertTriangle size={12} />
            Atrasada
          </span>
        )}
      </div>
    </div>
  );
}

/** Card arrastável. Sem permissão de mover, vira um card comum que só abre a tarefa. */
function CardTarefa({ tarefa, arrastavel, salvando, onAbrir }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tarefa.id,
    disabled: !arrastavel || salvando,
  });
  const inicioDoToque = React.useRef(null);

  // O clique só abre a tarefa quando o ponteiro praticamente não andou; assim
  // soltar um card no fim do arraste não abre o detalhe sem querer.
  function aoClicar(evento) {
    const inicio = inicioDoToque.current;
    inicioDoToque.current = null;
    if (inicio) {
      const distancia = Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y);
      if (distancia > 6) return;
    }
    onAbrir(tarefa);
  }

  return (
    <div
      ref={setNodeRef}
      {...(arrastavel ? listeners : {})}
      {...(arrastavel ? attributes : {})}
      onPointerDown={(evento) => {
        inicioDoToque.current = { x: evento.clientX, y: evento.clientY };
        if (arrastavel) listeners?.onPointerDown?.(evento);
      }}
      onClick={aoClicar}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") {
          evento.preventDefault();
          onAbrir(tarefa);
        }
      }}
      role="button"
      tabIndex={0}
      style={{ touchAction: "manipulation" }}
      className={`cursor-pointer outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-[#C9A227]/60 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <ConteudoCard tarefa={tarefa} arrastavel={arrastavel} salvando={salvando} />
    </div>
  );
}

function Coluna({ coluna, tarefas, arrastandoAlgo, tarefaSalvandoId, onAbrir, podeMover }) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.id });
  const info = statusInfo(coluna.id);

  return (
    <div className="flex flex-col min-w-[260px] flex-1">
      <div className="flex items-center gap-2 px-1 pb-2.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: info.ponto }} />
        <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[#0F2A44]/55">
          {coluna.titulo}
        </span>
        <span className="text-[11px] text-[#0F2A44]/35">{tarefas.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-2xl border p-2.5 space-y-2.5 min-h-[140px] transition-colors ${
          isOver
            ? "border-[#C9A227] bg-[#FBF4DE]/70"
            : "border-black/5 bg-[#F5F3EF]/70 border-dashed"
        }`}
      >
        {tarefas.length === 0 ? (
          <div className="text-[11px] text-[#0F2A44]/30 text-center py-6">
            {arrastandoAlgo ? "Solte a tarefa aqui" : "Nenhuma tarefa"}
          </div>
        ) : (
          tarefas.map((t) => (
            <CardTarefa
              key={t.id}
              tarefa={t}
              arrastavel={podeMover(t)}
              salvando={tarefaSalvandoId === t.id}
              onAbrir={onAbrir}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Quadro Kanban das tarefas. Soltar um card em outra coluna grava o novo status
 * em "tarefas" e registra a linha correspondente em "tarefas_historico" — quem
 * faz isso é o onMover recebido da página.
 *
 * Tarefas canceladas não pertencem a nenhuma das quatro colunas e ficam fora do
 * quadro; o rodapé avisa quantas são para elas não sumirem sem explicação.
 */
export default function QuadroTarefas({ tarefas, podeMover, tarefaSalvandoId, onAbrir, onMover }) {
  const [arrastando, setArrastando] = React.useState(null);

  // O arraste só começa depois de 6px de movimento: um clique curto continua
  // abrindo o detalhe da tarefa.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const porColuna = React.useMemo(() => {
    const mapa = Object.fromEntries(COLUNAS_QUADRO.map((c) => [c.id, []]));
    const foraDoQuadro = [];
    tarefas.forEach((t) => {
      const coluna = colunaDaTarefa(t);
      if (coluna) mapa[coluna].push(t);
      else foraDoQuadro.push(t);
    });
    return { mapa, foraDoQuadro };
  }, [tarefas]);

  const tarefaArrastada = arrastando ? tarefas.find((t) => t.id === arrastando) : null;

  function aoSoltar(evento) {
    setArrastando(null);
    const destinoId = evento.over?.id;
    if (!destinoId) return;

    const tarefa = tarefas.find((t) => t.id === evento.active.id);
    if (!tarefa || colunaDaTarefa(tarefa) === destinoId) return;

    const coluna = COLUNAS_QUADRO.find((c) => c.id === destinoId);
    if (coluna) onMover(tarefa, coluna.destino);
  }

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCorners}
      onDragStart={(evento) => setArrastando(evento.active.id)}
      onDragCancel={() => setArrastando(null)}
      onDragEnd={aoSoltar}
    >
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 items-stretch">
        {COLUNAS_QUADRO.map((coluna) => (
          <Coluna
            key={coluna.id}
            coluna={coluna}
            tarefas={porColuna.mapa[coluna.id]}
            arrastandoAlgo={Boolean(tarefaArrastada)}
            podeMover={podeMover}
            tarefaSalvandoId={tarefaSalvandoId}
            onAbrir={onAbrir}
          />
        ))}
      </div>

      {porColuna.foraDoQuadro.length > 0 && (
        <p className="text-[11px] text-[#0F2A44]/40 mt-3">
          {porColuna.foraDoQuadro.length}{" "}
          {porColuna.foraDoQuadro.length === 1 ? "tarefa está" : "tarefas estão"} com status fora destas quatro colunas
          (por exemplo, cancelada) e não {porColuna.foraDoQuadro.length === 1 ? "aparece" : "aparecem"} no quadro — use
          a visualização em lista para {porColuna.foraDoQuadro.length === 1 ? "vê-la" : "vê-las"}.
        </p>
      )}

      <DragOverlay dropAnimation={null}>
        {tarefaArrastada ? (
          <div className="w-[260px] cursor-grabbing">
            <ConteudoCard tarefa={tarefaArrastada} arrastavel arrastando />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
