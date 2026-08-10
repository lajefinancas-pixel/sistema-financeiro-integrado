import React from "react";
import {
  Archive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Presentation,
  Trash2,
  Upload,
} from "lucide-react";
import { Alerta } from "../equipe/comuns";
import { enviarAnexo, excluirAnexo, formatarDataHora, listarAnexos } from "../../lib/tarefas";

const ICONES = {
  imagem: FileImage,
  pdf: FileText,
  planilha: FileSpreadsheet,
  documento: FileText,
  apresentacao: Presentation,
  compactado: Archive,
};

const ROTULOS = {
  imagem: "Imagem",
  pdf: "PDF",
  planilha: "Planilha",
  documento: "Documento",
  apresentacao: "Apresentação",
  compactado: "Compactado",
  outro: "Arquivo",
};

/**
 * Anexos da tarefa. O arquivo vai para o bucket "tarefas-anexos" do Supabase
 * Storage e a linha em "tarefas_anexos" guarda tipo, nome e quem enviou.
 */
export default function PainelAnexos({ tarefaId, usuarioId, podeAnexar, podeExcluir }) {
  const [anexos, setAnexos] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [enviando, setEnviando] = React.useState(false);
  const entradaRef = React.useRef(null);

  React.useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarAnexos(tarefaId)
      .then((lista) => ativo && setAnexos(lista))
      .catch((e) => ativo && setErro(e.message ?? "Não foi possível carregar os anexos."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [tarefaId]);

  async function anexar(arquivo) {
    setEnviando(true);
    setErro(null);
    try {
      const anexo = await enviarAnexo(tarefaId, arquivo, usuarioId);
      setAnexos((atual) => [anexo, ...atual]);
    } catch (e) {
      setErro(e.message ?? "Não foi possível anexar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover(anexo) {
    setErro(null);
    try {
      await excluirAnexo(anexo);
      setAnexos((atual) => atual.filter((a) => a.id !== anexo.id));
    } catch (e) {
      setErro(e.message ?? "Não foi possível excluir o anexo.");
    }
  }

  if (carregando) return <div className="text-sm text-[#0F2A44]/45">Carregando anexos...</div>;

  return (
    <div className="space-y-4">
      {erro && <Alerta>{erro}</Alerta>}

      {anexos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/10 py-7 text-center">
          <Paperclip size={22} className="text-[#0F2A44]/20 mx-auto mb-2" />
          <p className="text-xs text-[#0F2A44]/40">Nenhum arquivo anexado.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {anexos.map((anexo) => {
            const Icone = ICONES[anexo.tipo] ?? Paperclip;
            return (
              <li
                key={anexo.id}
                className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-3 py-2.5 group"
              >
                <span className="w-9 h-9 rounded-lg bg-[#F5F3EF] flex items-center justify-center shrink-0">
                  <Icone size={16} className="text-[#0F2A44]/45" />
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={anexo.arquivo_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm font-medium text-[#0F2A44] hover:text-[#C9A227] truncate"
                  >
                    {anexo.nome_arquivo}
                  </a>
                  <div className="text-[11px] text-[#0F2A44]/45 mt-0.5">
                    {ROTULOS[anexo.tipo] ?? ROTULOS.outro} — Anexado por{" "}
                    {anexo.usuario?.nome_completo ?? "usuário removido"} em {formatarDataHora(anexo.criado_em)}
                  </div>
                </div>
                {podeExcluir && (
                  <button
                    type="button"
                    onClick={() => remover(anexo)}
                    title="Excluir anexo"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[#0F2A44]/25 hover:text-[#DC2626] hover:bg-black/5 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {podeAnexar && (
        <div className="pt-1">
          <input
            ref={entradaRef}
            type="file"
            className="hidden"
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0];
              if (arquivo) anexar(arquivo);
              evento.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={enviando}
            onClick={() => entradaRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44]/75 hover:bg-black/5 disabled:opacity-40"
          >
            <Upload size={15} />
            {enviando ? "Enviando arquivo..." : "Anexar arquivo"}
          </button>
        </div>
      )}
    </div>
  );
}
