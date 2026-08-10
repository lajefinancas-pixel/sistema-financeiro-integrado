import React from "react";
import { Check, Copy, KeyRound, Trash2, Upload, UserRound, X } from "lucide-react";

export const CLASSE_ENTRADA =
  "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] " +
  "outline-none focus:border-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/50";

/** Moldura padrão dos modais desta área: cabeçalho fixo, corpo rolável e rodapé. */
export function ModalShell({ titulo, subtitulo, onFechar, largura = "max-w-2xl", children, rodape }) {
  React.useEffect(() => {
    function aoTeclar(evento) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0F2A44]/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onFechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`bg-white w-full ${largura} rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[88vh]`}
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-black/5">
          <div>
            <h2 className="text-lg font-semibold text-[#0F2A44]">{titulo}</h2>
            {subtitulo && <p className="text-xs text-[#0F2A44]/55 mt-0.5">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="w-9 h-9 -mr-1.5 rounded-lg flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1">{children}</div>

        {rodape && (
          <div className="px-5 sm:px-6 py-4 border-t border-black/5 bg-[#F5F3EF]/60 rounded-b-2xl">{rodape}</div>
        )}
      </div>
    </div>
  );
}

export function Campo({ label, obrigatorio, dica, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[#0F2A44]/70">
        {label}
        {obrigatorio && <span className="text-[#C9A227]"> *</span>}
      </span>
      {children}
      {dica && <span className="block text-[11px] text-[#0F2A44]/45 mt-1">{dica}</span>}
    </label>
  );
}

export function Alerta({ tipo = "erro", children }) {
  if (!children) return null;
  const estilos =
    tipo === "erro"
      ? "bg-red-50 border-red-200 text-red-700"
      : "bg-[#EAFBF0] border-[#16A34A]/25 text-[#15803D]";
  return <div className={`border text-sm rounded-lg px-4 py-3 ${estilos}`}>{children}</div>;
}

/** Seletor de foto: mostra a prévia (arquivo novo ou URL já salva) e permite remover. */
export function SeletorFoto({ urlAtual, arquivo, onSelecionar, onRemover, desabilitado }) {
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
    <div className="flex items-center gap-4">
      <div className="w-16 h-16 rounded-full border border-[#C9A227]/40 bg-[#F5F3EF] overflow-hidden flex items-center justify-center shrink-0">
        {previa ? (
          <img src={previa} alt="Foto do usuário" className="w-full h-full object-cover" />
        ) : (
          <UserRound size={24} className="text-[#0F2A44]/25" />
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
          {previa ? "Trocar foto" : "Enviar foto"}
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
        <span className="text-[11px] text-[#0F2A44]/40 basis-full">Opcional — JPG ou PNG.</span>
      </div>
    </div>
  );
}

/** Painel que exibe a senha provisória gerada, com botão de copiar. */
export function PainelSenha({ senha, email, titulo = "Senha provisória gerada" }) {
  const [copiado, setCopiado] = React.useState(false);

  React.useEffect(() => {
    setCopiado(false);
  }, [senha]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#C9A227]/40 bg-[#FBF4DE] p-4">
      <div className="flex items-center gap-2 text-[#8A7526]">
        <KeyRound size={16} />
        <span className="text-sm font-semibold">{titulo}</span>
      </div>
      <p className="text-xs text-[#8A7526]/85 mt-1.5">
        Anote ou copie agora e entregue {email ? <strong className="break-all">{email}</strong> : "ao usuário"} por um
        canal seguro. Ela não será exibida novamente depois que esta tela for fechada.
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <code className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-[#C9A227]/30 text-sm font-mono tracking-wide text-[#0F2A44] break-all">
          {senha}
        </code>
        <button
          type="button"
          onClick={copiar}
          className="flex items-center gap-1.5 text-xs px-3 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 whitespace-nowrap"
        >
          {copiado ? <Check size={14} /> : <Copy size={14} />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
