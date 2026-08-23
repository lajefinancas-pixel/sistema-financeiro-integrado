import React from "react";
import { Download, FileText } from "lucide-react";
import { ModalShell } from "../equipe/comuns";
import { BadgeSituacao } from "./badges";
import {
  diasAte,
  formatarData,
  nomeDoAnexo,
  nomeFornecedor,
  situacaoEfetiva,
  urlDeDownload,
} from "../../lib/certidoes";

/** Visualização somente leitura de uma certidão, aberta pelo olho da listagem. */
export default function ModalDetalheCertidao({ certidao, onFechar }) {
  const situacao = situacaoEfetiva(certidao);
  const dias = diasAte(certidao?.data_vencimento);

  const textoPrazo =
    dias === null
      ? "Documento sem data de vencimento."
      : dias < 0
        ? `Vencida há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}.`
        : dias === 0
          ? "Vence hoje."
          : `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}.`;

  return (
    <ModalShell
      titulo={certidao?.tipos_certidao?.nome ?? "Certidão"}
      subtitulo={nomeFornecedor(certidao?.fornecedores)}
      largura="max-w-xl"
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          {certidao?.arquivo_url && (
            <a
              href={urlDeDownload(certidao.arquivo_url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Download size={15} />
              Baixar anexo
            </a>
          )}
          <button
            type="button"
            onClick={onFechar}
            className="px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <BadgeSituacao situacao={situacao} />
          <span className="text-xs text-[#0F2A44]/55">{textoPrazo}</span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <Linha rotulo="Número / documento" valor={certidao?.numero_documento} />
          <Linha rotulo="CPF / CNPJ do fornecedor" valor={certidao?.fornecedores?.cpf_cnpj} />
          <Linha rotulo="Data de emissão" valor={formatarData(certidao?.data_emissao)} />
          <Linha
            rotulo="Data de vencimento"
            valor={certidao?.data_vencimento ? formatarData(certidao.data_vencimento) : "Não se aplica"}
          />
          <Linha rotulo="Responsável" valor={certidao?.usuarios?.nome_completo} />
          <Linha rotulo="Cadastrada em" valor={formatarData(certidao?.criado_em)} />
        </dl>

        {certidao?.observacoes && (
          <div>
            <div className="text-xs font-medium text-[#0F2A44]/70">Observações</div>
            <p className="text-sm text-[#0F2A44]/75 mt-1 whitespace-pre-wrap leading-relaxed">
              {certidao.observacoes}
            </p>
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-[#0F2A44]/70">Documento anexado</div>
          {certidao?.arquivo_url ? (
            <a
              href={certidao.arquivo_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-black/10 px-4 py-3 hover:bg-black/[0.02]"
            >
              <FileText size={18} className="text-[#C9A227] shrink-0" />
              <span className="text-sm text-[#0F2A44] break-all">{nomeDoAnexo(certidao.arquivo_url)}</span>
            </a>
          ) : (
            <p className="text-sm text-[#0F2A44]/45 mt-1">Nenhum arquivo anexado a esta certidão.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function Linha({ rotulo, valor }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[#0F2A44]/70">{rotulo}</dt>
      <dd className="text-sm text-[#0F2A44] mt-0.5 break-words">{valor || "--"}</dd>
    </div>
  );
}
