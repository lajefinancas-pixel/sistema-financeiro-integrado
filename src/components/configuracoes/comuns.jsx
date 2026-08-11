import React from "react";
import { AlertTriangle, Clock3, ImageOff, Lock, Trash2, Upload, Wrench } from "lucide-react";
import { ModalShell } from "../equipe/comuns";

// Blocos visuais reaproveitados pelas categorias da tela de Configurações.
// Os campos de formulário (Campo, CLASSE_ENTRADA) e o aviso (Alerta) vêm de
// components/equipe/comuns.jsx para que os formulários do sistema continuem
// idênticos entre si.

/** Cartão branco de uma seção da categoria aberta. */
export function Cartao({ titulo, descricao, icone: Icone, children, rodape }) {
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-black/5 flex items-start gap-3">
        {Icone && (
          <div className="w-9 h-9 rounded-xl bg-[#0F2A44]/5 flex items-center justify-center shrink-0">
            <Icone size={17} className="text-[#0F2A44]" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#0F2A44]">{titulo}</h2>
          {descricao && <p className="text-xs text-[#0F2A44]/55 mt-0.5 leading-relaxed">{descricao}</p>}
        </div>
      </div>

      <div className="px-5 sm:px-6 py-5">{children}</div>

      {rodape && (
        <div className="px-5 sm:px-6 py-4 border-t border-black/5 bg-[#F5F3EF]/60">{rodape}</div>
      )}
    </section>
  );
}

/** Rodapé de um formulário: quando foi a última alteração + botão de salvar. */
export function RodapeFormulario({ ultimaAlteracao, podeEditar, salvando, alterado }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
      <div className="flex items-center gap-1.5 text-[11px] text-[#0F2A44]/45 min-w-0">
        {ultimaAlteracao && (
          <>
            <Clock3 size={13} className="shrink-0" />
            <span className="truncate">{ultimaAlteracao}</span>
          </>
        )}
      </div>
      <button
        type="submit"
        disabled={!podeEditar || salvando || !alterado}
        title={podeEditar ? undefined : "Você não tem permissão para alterar as configurações."}
        className="self-start sm:self-auto text-sm px-5 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40 disabled:hover:bg-[#0F2A44]"
      >
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
    </div>
  );
}

/** Faixa mostrada a quem pode abrir a tela, mas não pode alterar nada. */
export function AvisoSomenteLeitura() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
      <Lock size={15} className="mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed">
        Você está visualizando as configurações em modo somente leitura. Para alterar qualquer item é
        necessária permissão de edição no módulo Administração.
      </p>
    </div>
  );
}

/** Placeholder das categorias que ainda serão construídas. */
export function EmBreve({ titulo, descricao }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-black/10 px-6 py-14 text-center">
      <div className="w-14 h-14 rounded-full bg-[#F5F3EF] border border-[#C9A227]/30 flex items-center justify-center mx-auto mb-4">
        <Wrench size={22} className="text-[#C9A227]" />
      </div>
      <h2 className="text-base font-semibold text-[#0F2A44]">{titulo}</h2>
      <p className="text-sm text-[#0F2A44]/55 mt-1.5 max-w-md mx-auto leading-relaxed">
        {descricao}
      </p>
      <div className="w-12 h-px bg-[#C9A227] mx-auto my-5" />
      <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-[#0F2A44]/5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#0F2A44]/60">
        Em breve
      </span>
    </div>
  );
}

/**
 * Seletor da logomarca: mostra a prévia (arquivo escolhido agora ou a imagem já
 * salva) em moldura retangular, porque a logomarca da instituição não é redonda
 * como a foto de perfil da equipe.
 */
export function SeletorLogomarca({ urlAtual, arquivo, onSelecionar, onRemover, desabilitado, limiteMb }) {
  const inputRef = React.useRef(null);
  const [previaArquivo, setPreviaArquivo] = React.useState(null);

  React.useEffect(() => {
    if (!arquivo) {
      setPreviaArquivo(null);
      return undefined;
    }
    const url = URL.createObjectURL(arquivo);
    setPreviaArquivo(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const previa = previaArquivo ?? urlAtual ?? null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-full sm:w-36 h-24 rounded-xl border border-[#C9A227]/40 bg-[#F5F3EF] overflow-hidden flex items-center justify-center shrink-0">
        {previa ? (
          <img src={previa} alt="Logomarca da instituição" className="w-full h-full object-contain p-2" />
        ) : (
          <ImageOff size={22} className="text-[#0F2A44]/20" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(evento) => {
            const selecionado = evento.target.files?.[0] ?? null;
            if (selecionado) onSelecionar(selecionado);
            evento.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={desabilitado}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
        >
          <Upload size={14} />
          {previa ? "Trocar logomarca" : "Enviar logomarca"}
        </button>
        {previa && (
          <button
            type="button"
            disabled={desabilitado}
            onClick={onRemover}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50 hover:bg-black/5 disabled:opacity-40"
          >
            <Trash2 size={14} />
            Remover
          </button>
        )}
        <span className="text-[11px] text-[#0F2A44]/40 basis-full">
          Opcional — JPG, PNG ou SVG de até {limiteMb} MB. Será usada nos cabeçalhos de relatórios e
          impressões.
        </span>
      </div>
    </div>
  );
}

/**
 * Etiqueta de situação (Ativo / Inativo) usada nas listas das configurações.
 * Mesmas cores das demais telas do sistema: verde para ativo, cinza para inativo.
 */
export function BadgeAtivo({ ativo }) {
  const info = ativo
    ? { label: "Ativa", cor: "#16A34A", bg: "#EAFBF0" }
    : { label: "Inativa", cor: "#64748B", bg: "#F1F5F9" };
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.cor }} />
      {info.label}
    </span>
  );
}

/**
 * "Tem certeza?" — confirmação explícita antes de uma gravação sensível.
 *
 * `detalhes` recebe o que vai mudar ([{ label, antes, depois }]) e é mostrado
 * como um antes/depois, para que ninguém confirme sem ver o número que está
 * saindo e o que está entrando.
 */
export function ModalConfirmacao({
  titulo = "Tem certeza?",
  subtitulo,
  aviso,
  detalhes = [],
  confirmarLabel = "Confirmar",
  confirmandoLabel = "Salvando...",
  confirmando = false,
  onConfirmar,
  onCancelar,
}) {
  return (
    <ModalShell titulo={titulo} subtitulo={subtitulo} largura="max-w-lg" onFechar={onCancelar}>
      <div className="space-y-4">
        {aviso && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">{aviso}</p>
          </div>
        )}

        {detalhes.length > 0 && (
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
            {detalhes.map((item) => (
              <li key={item.label} className="px-4 py-3 bg-white">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[#0F2A44]/40">
                  {item.label}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <span className="text-[#0F2A44]/45 line-through">{item.antes}</span>
                  <span className="text-[#0F2A44]/30">→</span>
                  <span className="text-[#0F2A44] font-medium">{item.depois}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={onCancelar}
          disabled={confirmando}
          className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={confirmando}
          className="text-sm px-5 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
        >
          {confirmando ? confirmandoLabel : confirmarLabel}
        </button>
      </div>
    </ModalShell>
  );
}
