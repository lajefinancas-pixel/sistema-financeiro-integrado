import React from "react";
import ModalConfirmarExclusao from "../comuns/ModalConfirmarExclusao";
import {
  MODULO,
  dadosParaAuditoria,
  descricaoParaAuditoria,
  excluirCertidao,
  formatarData,
  nomeFornecedor,
} from "../../lib/certidoes";
import { auditarExclusao } from "../../lib/exclusaoRegistros";

/**
 * Confirmação da exclusão de uma certidão.
 *
 * Certidão é registro sensível: além da confirmação padrão, o motivo da
 * exclusão é obrigatório e vai para a trilha de auditoria junto com o evento
 * 'excluiu'. A exclusão é lógica — a certidão sai da listagem, mas continua no
 * banco marcada com quem excluiu e quando.
 */
export default function ModalExcluirCertidao({ certidao, usuario, onFechar, onExcluida }) {
  const fornecedor = nomeFornecedor(certidao?.fornecedores);
  const tipo = certidao?.tipos_certidao?.nome ?? "Certidão";

  async function confirmar(motivo) {
    const { logica } = await excluirCertidao(certidao.id, { usuarioId: usuario?.id ?? null });

    auditarExclusao({
      modulo: MODULO,
      registroAfetado: descricaoParaAuditoria(certidao),
      motivo,
      valorAnterior: dadosParaAuditoria(certidao),
      logica,
      usuarioId: usuario?.id ?? null,
    });

    onExcluida(certidao.id);
    onFechar();
  }

  return (
    <ModalConfirmarExclusao
      subtitulo="Confirme antes de remover o documento do sistema."
      registro={`esta certidão de ${fornecedor} — ${tipo}`}
      aviso="O registro sai da listagem e os alertas de vencimento desta certidão deixam de ser gerados."
      exigirMotivo
      detalhes={[
        { rotulo: "Número", valor: certidao?.numero_documento ?? "" },
        { rotulo: "Emissão", valor: formatarData(certidao?.data_emissao) },
        {
          rotulo: "Vencimento",
          valor: certidao?.data_vencimento ? formatarData(certidao.data_vencimento) : "--",
        },
      ]}
      onCancelar={onFechar}
      onConfirmar={confirmar}
    />
  );
}
