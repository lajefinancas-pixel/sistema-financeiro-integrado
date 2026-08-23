import React from "react";
import { Eraser, Filter, X } from "lucide-react";
import {
  OPCOES_ACAO,
  OPCOES_MODULO,
  OPCOES_NIVEL,
  OPCOES_RESULTADO,
  acaoLabel,
  formatarDataHora,
  moduloLabel,
  quantidadeDeFiltros,
} from "../../lib/auditoria";
import PainelFiltros from "../comuns/PainelFiltros";

const CLASSE_CAMPO = "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44]";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#0F2A44]/70">{label}</label>
      {children}
    </div>
  );
}

/** Data ISO no formato de leitura da tela; vazio vira reticências no chip. */
function dataBR(valor) {
  if (!valor) return "...";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function rotuloDaOpcao(opcoes, valor) {
  return opcoes.find((o) => o.valor === valor)?.label ?? valor;
}

/**
 * Chips do recorte que está de fato valendo na consulta (os filtros APLICADOS,
 * não o que ainda está sendo digitado no formulário). Só monta rótulos: nenhum
 * critério é criado, removido ou reinterpretado aqui.
 */
function montarChips({ aplicados, usuarios, onRemover }) {
  const f = aplicados ?? {};
  const chips = [];
  const remover = (alteracao) => (onRemover ? () => onRemover(alteracao) : undefined);

  if (String(f.busca ?? "").trim()) {
    chips.push({ chave: "busca", rotulo: `Busca: ${f.busca.trim()}`, remover: remover({ busca: "" }) });
  }
  if (f.dataInicial || f.dataFinal) {
    chips.push({
      chave: "periodo",
      rotulo: `Período: ${dataBR(f.dataInicial)} a ${dataBR(f.dataFinal)}`,
      remover: remover({ dataInicial: "", dataFinal: "" }),
    });
  }
  if (f.usuarioId) {
    const nome = usuarios.find((u) => String(u.id) === String(f.usuarioId))?.nome_completo ?? "Usuário";
    chips.push({ chave: "usuario", rotulo: nome, remover: remover({ usuarioId: "" }) });
  }
  if (f.modulo) {
    chips.push({ chave: "modulo", rotulo: moduloLabel(f.modulo), remover: remover({ modulo: "" }) });
  }
  if (f.acao) {
    chips.push({ chave: "acao", rotulo: acaoLabel(f.acao), remover: remover({ acao: "" }) });
  }
  if (f.nivel) {
    chips.push({
      chave: "nivel",
      rotulo: rotuloDaOpcao(OPCOES_NIVEL, f.nivel),
      remover: remover({ nivel: "" }),
    });
  }
  if (f.resultado) {
    chips.push({
      chave: "resultado",
      rotulo: rotuloDaOpcao(OPCOES_RESULTADO, f.resultado),
      remover: remover({ resultado: "" }),
    });
  }
  // "desde" não existe no formulário: quem preenche é o atalho do alerta de
  // ações críticas. O chip é a única forma de enxergar (e desfazer) essa janela.
  if (f.desde) {
    chips.push({
      chave: "desde",
      rotulo: `A partir de ${formatarDataHora(f.desde)}`,
      remover: remover({ desde: "" }),
    });
  }
  return chips;
}

/**
 * Área de consulta da trilha de auditoria: a busca livre (que vale na hora) e os
 * filtros do período/usuário/módulo/ação/nível/resultado, aplicados juntos ao
 * clicar em "Aplicar Filtros" — a mesma convenção da tela de Fornecedores.
 *
 * A área fica dentro do PainelFiltros compartilhado: os campos abrem e fecham
 * sem perder nada do formulário e, com o painel fechado, o recorte aplicado
 * aparece em chips removíveis. A busca continua sempre à vista, no topo.
 *
 * O componente só cuida do formulário; quem consulta o banco é a página.
 */
export default function FiltrosAuditoria({
  filtros,
  onAlterar,
  onAplicar,
  onLimpar,
  onRemover,
  usuarios = [],
  erroUsuarios = null,
  aplicados,
  resumo = null,
}) {
  const chips = React.useMemo(
    () => montarChips({ aplicados, usuarios, onRemover }),
    [aplicados, usuarios, onRemover],
  );

  function alterar(campo, valor) {
    onAlterar({ ...filtros, [campo]: valor });
  }

  return (
    <PainelFiltros
      className="mb-5"
      chips={chips}
      // O número no botão continua sendo o mesmo contador de antes: cada campo
      // preenchido conta um, inclusive as duas pontas do período.
      totalAtivos={quantidadeDeFiltros(aplicados)}
      onLimpar={onLimpar}
      resumo={resumo}
      topo={
        <>
          <div className="relative">
            <input
              type="text"
              value={filtros.busca}
              onChange={(e) => alterar("busca", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAplicar();
                }
              }}
              placeholder="🔎 Pesquisar na auditoria"
              aria-label="Pesquisar na auditoria"
              className="w-full px-3 py-2.5 pr-9 rounded-lg border border-black/10 text-sm text-[#0F2A44]"
            />
            {filtros.busca && (
              <button
                type="button"
                onClick={() => alterar("busca", "")}
                title="Limpar a pesquisa"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <p className="text-[11px] text-[#0F2A44]/40 mt-1.5">
            A pesquisa procura ao mesmo tempo no nome de quem fez a ação e no registro afetado, por
            parte do texto.
          </p>
        </>
      }
    >
      <div className="space-y-4 pt-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Campo label="Data inicial">
            <input
              type="date"
              value={filtros.dataInicial}
              onChange={(e) => alterar("dataInicial", e.target.value)}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <Campo label="Data final">
            <input
              type="date"
              value={filtros.dataFinal}
              onChange={(e) => alterar("dataFinal", e.target.value)}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <Campo label="Usuário">
            <select
              value={filtros.usuarioId}
              onChange={(e) => alterar("usuarioId", e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Todos os usuários</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome_completo}
                </option>
              ))}
            </select>
            {erroUsuarios && (
              <span className="block text-[10px] text-[#0F2A44]/45 mt-1">
                A lista de usuários não pôde ser carregada; os demais filtros continuam valendo.
              </span>
            )}
          </Campo>
          <Campo label="Módulo">
            <select
              value={filtros.modulo}
              onChange={(e) => alterar("modulo", e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Todos os módulos</option>
              {OPCOES_MODULO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Tipo de ação">
            <select
              value={filtros.acao}
              onChange={(e) => alterar("acao", e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Todas as ações</option>
              {OPCOES_ACAO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Nível">
            <select
              value={filtros.nivel}
              onChange={(e) => alterar("nivel", e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Todos os níveis</option>
              {OPCOES_NIVEL.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Resultado">
            <select
              value={filtros.resultado}
              onChange={(e) => alterar("resultado", e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Sucesso e falha</option>
              {OPCOES_RESULTADO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onAplicar}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
          >
            <Filter size={15} /> Aplicar Filtros
          </button>
          <button
            type="button"
            onClick={onLimpar}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
          >
            <Eraser size={15} /> Limpar Filtros
          </button>
        </div>
        <p className="text-[10px] text-[#0F2A44]/40">
          Os filtros se somam: o resultado atende a todas as condições escolhidas ao mesmo tempo.
        </p>
      </div>
    </PainelFiltros>
  );
}
