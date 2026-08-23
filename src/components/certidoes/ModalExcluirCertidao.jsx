import React from "react";
import { AlertTriangle } from "lucide-react";
import { Alerta, ModalShell } from "../equipe/comuns";
import { MODULO, excluirCertidao, formatarData, nomeFornecedor } from "../../lib/certidoes";
import { registrarEvento } from "../../lib/auditoria";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Confirmação da exclusão de uma certidão.
 *
 * Excluir é a única ação da tela que não tem volta, então ela nunca acontece
 * direto no clique da lista: a pessoa precisa ler de qual fornecedor e de qual
 * documento se trata e confirmar aqui.
 */
export default function ModalExcluirCertidao({ certidao, usuario, onFechar, onExcluida }) {
  const [excluindo, setExcluindo] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const fornecedor = nomeFornecedor(certidao?.fornecedores);
  const tipo = certidao?.tipos_certidao?.nome ?? "Certidão";

  async function confirmar() {
    setExcluindo(true);
    setErro(null);
    try {
      await excluirCertidao(certidao.id);

      registrarEvento({
        modulo: MODULO,
        acao: "excluiu",
        registroAfetado: `${tipo} — ${fornecedor}`,
        valorAnterior: {
          numero_documento: certidao.numero_documento,
          data_emissao: certidao.data_emissao,
          data_vencimento: certidao.data_vencimento,
          situacao: certidao.situacao,
        },
        nivel: "atencao",
        usuarioId: usuario?.id ?? null,
      });

      onExcluida(certidao.id);
      onFechar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível excluir esta certidão."));
      setExcluindo(false);
    }
  }

  return (
    <ModalShell
      titulo="Excluir certidão"
      subtitulo="Confirme antes de remover o documento do sistema."
      largura="max-w-md"
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={excluindo}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={excluindo}
            className="px-4 py-2.5 rounded-lg bg-[#DC2626] text-white text-sm hover:bg-[#DC2626]/90 disabled:opacity-40"
          >
            {excluindo ? "Excluindo..." : "Confirmar exclusão"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            Esta ação não pode ser desfeita. O registro sai da listagem e os alertas de vencimento
            desta certidão deixam de ser gerados.
          </p>
        </div>

        <p className="text-sm text-[#0F2A44]">
          Tem certeza que deseja excluir esta certidão de <strong>{fornecedor}</strong> —{" "}
          <strong>{tipo}</strong>?
        </p>

        <ul className="rounded-xl border border-black/5 divide-y divide-black/5 text-xs">
          {certidao?.numero_documento && (
            <li className="px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-[#0F2A44]/45">Número</span>
              <span className="text-[#0F2A44]">{certidao.numero_documento}</span>
            </li>
          )}
          <li className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-[#0F2A44]/45">Emissão</span>
            <span className="text-[#0F2A44]">{formatarData(certidao?.data_emissao)}</span>
          </li>
          <li className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-[#0F2A44]/45">Vencimento</span>
            <span className="text-[#0F2A44]">
              {certidao?.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
            </span>
          </li>
        </ul>
      </div>
    </ModalShell>
  );
}
