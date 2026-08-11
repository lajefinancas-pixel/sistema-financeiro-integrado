import React from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Files, Layers, UserRound, Zap } from "lucide-react";
import { ModalShell } from "../equipe/comuns";
import {
  acaoLabel,
  comparacaoAntesDepois,
  eventoCritico,
  formatarDataHora,
  moduloLabel,
  nivelInfo,
  nomeDoAutor,
  resultadoLabel,
} from "../../lib/auditoria";

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

/** Um lado da comparação: cinza para o valor antigo, azul para o que ficou valendo. */
function Valor({ texto, destaque }) {
  return (
    <span
      className={`inline-block px-2 py-1 rounded-md text-sm break-words ${
        destaque ? "bg-[#EAF1FF] text-[#1D4ED8]" : "bg-black/[0.04] text-[#0F2A44]/60 line-through decoration-black/20"
      }`}
    >
      {texto}
    </span>
  );
}

/**
 * Detalhe de um evento da trilha: quem fez, quando, o que fez, onde, em qual
 * registro — e a comparação Antes/Depois.
 *
 * A comparação lista SOMENTE os campos gravados em valor_anterior/valor_novo que
 * realmente mudaram; campo igual nos dois lados não aparece.
 */
export default function ModalDetalheEvento({ evento, onFechar }) {
  if (!evento) return null;

  const nivel = nivelInfo(evento.nivel);
  const critico = eventoCritico(evento);
  const mudancas = comparacaoAntesDepois(evento);
  const falhou = evento.resultado === "falha";

  return (
    <ModalShell
      titulo="Detalhes da ação"
      subtitulo={`${acaoLabel(evento.acao)} · ${moduloLabel(evento.modulo)}`}
      onFechar={onFechar}
      rodape={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44] hover:bg-black/5"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            style={{ color: nivel.cor, backgroundColor: nivel.bg }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
          >
            {critico ? (
              <AlertTriangle size={12} />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: nivel.ponto }} />
            )}
            {nivel.label}
          </span>
          <span
            className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide ${
              falhou ? "bg-red-50 text-red-600" : "bg-[#EAFBF0] text-[#15803D]"
            }`}
          >
            {resultadoLabel(evento.resultado)}
          </span>
        </div>

        {critico && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              Evento crítico: mexe em dinheiro ou em acesso ao sistema. Confira se a alteração era esperada.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Linha icone={UserRound} rotulo="Usuário">
            {nomeDoAutor(evento)}
          </Linha>
          <Linha icone={CalendarClock} rotulo="Data e hora">
            {formatarDataHora(evento.data_hora)}
          </Linha>
          <Linha icone={Zap} rotulo="Ação">
            {acaoLabel(evento.acao)}
          </Linha>
          <Linha icone={Layers} rotulo="Módulo">
            {moduloLabel(evento.modulo)}
          </Linha>
        </div>

        <Linha icone={Files} rotulo="Registro afetado">
          {evento.registro_afetado || "Não informado"}
        </Linha>

        <div className="pt-4 border-t border-black/5">
          <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40 mb-2">Antes e depois</div>

          {mudancas.length === 0 ? (
            <p className="text-sm text-[#0F2A44]/45">
              Este evento não guardou comparação de valores — nenhum campo do registro mudou de conteúdo.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-black/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
                      <th className="py-2.5 px-4 font-medium">Campo</th>
                      <th className="py-2.5 px-4 font-medium">Antes</th>
                      <th className="py-2.5 px-4 font-medium">Depois</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mudancas.map((m) => (
                      <tr key={m.campo} className="border-t border-black/5 align-top">
                        <td className="py-2.5 px-4 font-medium text-[#0F2A44] whitespace-nowrap">{m.label}</td>
                        <td className="py-2.5 px-4">
                          {m.tinhaAntes ? (
                            <Valor texto={m.antes} />
                          ) : (
                            <span className="text-xs text-[#0F2A44]/35">não existia</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-start gap-1.5">
                            <ArrowRight size={13} className="text-[#0F2A44]/25 mt-2 shrink-0" />
                            {m.temDepois ? (
                              <Valor texto={m.depois} destaque />
                            ) : (
                              <span className="text-xs text-[#0F2A44]/35 mt-1">removido</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#0F2A44]/40 mt-2">
                A comparação mostra apenas os campos que mudaram nesta ação.
              </p>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
