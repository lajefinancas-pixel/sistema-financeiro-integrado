import React from "react";
import { FileText, History, Paperclip, RefreshCw, Upload } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { BadgeSituacao } from "./badges";
import {
  MODULO,
  dadosParaAuditoria,
  descricaoParaAuditoria,
  enviarArquivo,
  formatarData,
  hojeISO,
  nomeDoAnexo,
  nomeFornecedor,
  renovarCertidao,
  situacaoEfetiva,
  situacaoPorData,
  vencimentoSugerido,
} from "../../lib/certidoes";
import { registrarEvento } from "../../lib/auditoria";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Renovação de uma certidão.
 *
 * Renovar é emitir de novo o MESMO documento do MESMO fornecedor: por isso o
 * formulário não pergunta fornecedor nem tipo — pergunta a nova emissão.
 *
 * A emissão anterior não é apagada nem sobrescrita. Ela é marcada como
 * substituída pela nova e continua no sistema, visível na cadeia de versões do
 * detalhe da certidão. A nova passa a ser a vigente na listagem, nos alertas de
 * vencimento e na Vida do Fornecedor.
 *
 * O anexo é opcional: sem arquivo novo, a nova emissão reaproveita o documento
 * da anterior (é o comportamento mais comum quando só o prazo foi renovado sem
 * um PDF novo em mãos).
 */
export default function ModalRenovarCertidao({ certidao, tipos, usuario, onFechar, onRenovada }) {
  const tipo = React.useMemo(
    () => (tipos ?? []).find((t) => t.id === certidao?.tipo_certidao_id) ?? certidao?.tipos_certidao ?? null,
    [tipos, certidao?.tipo_certidao_id, certidao?.tipos_certidao],
  );

  const possuiVencimento = tipo ? tipo.possui_vencimento !== false : true;
  const emissaoInicial = hojeISO();

  const [campos, setCampos] = React.useState({
    numero_documento: "",
    data_emissao: emissaoInicial,
    data_vencimento: possuiVencimento
      ? vencimentoSugerido(emissaoInicial, tipo?.prazo_padrao_dias)
      : "",
    observacoes: "",
  });
  // Anexo: manter o da certidão anterior (padrão) ou subir um arquivo novo.
  const [arquivo, setArquivo] = React.useState(null);
  const [manterAnexo, setManterAnexo] = React.useState(Boolean(certidao?.arquivo_url));
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const inputArquivo = React.useRef(null);

  /** Nova emissão: o vencimento é reprojetado pelo prazo padrão do tipo. */
  function escolherEmissao(valor) {
    setCampos((atual) => {
      const sugerido = vencimentoSugerido(valor, tipo?.prazo_padrao_dias);
      return {
        ...atual,
        data_emissao: valor,
        data_vencimento: possuiVencimento ? sugerido || atual.data_vencimento : "",
      };
    });
  }

  function selecionarArquivo(selecionado) {
    setArquivo(selecionado);
    setManterAnexo(false);
  }

  async function confirmar(evento) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);

    try {
      let arquivoUrl = manterAnexo ? certidao?.arquivo_url ?? null : null;
      if (arquivo) arquivoUrl = await enviarArquivo(certidao?.fornecedor_id, arquivo);

      const nova = await renovarCertidao(
        certidao,
        {
          ...campos,
          // A nova emissão nasce pelas datas: quem quiser marcá-la como "em
          // renovação" faz isso na edição, depois.
          situacao: situacaoPorData(possuiVencimento ? campos.data_vencimento : null),
          arquivo_url: arquivoUrl,
        },
        tipo,
        usuario?.id ?? null,
      );

      registrarEvento({
        modulo: MODULO,
        acao: "renovou_certidao",
        registroAfetado: descricaoParaAuditoria(nova, certidao?.fornecedores),
        valorAnterior: dadosParaAuditoria(certidao),
        valorNovo: {
          ...dadosParaAuditoria(nova),
          certidao_anterior: `Emissão de ${formatarData(certidao?.data_emissao)} — preservada no histórico`,
        },
        nivel: "atencao",
        usuarioId: usuario?.id ?? null,
      });

      onRenovada?.(nova, certidao);
      onFechar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível renovar esta certidão."));
      setSalvando(false);
    }
  }

  const nomeAnexoNovo = arquivo?.name ?? (manterAnexo ? nomeDoAnexo(certidao?.arquivo_url) : null);

  return (
    <ModalShell
      titulo="Renovar certidão"
      subtitulo={`${tipo?.nome ?? "Certidão"} — ${nomeFornecedor(certidao?.fornecedores)}`}
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
            form="form-renovar-certidao"
            disabled={salvando}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            <RefreshCw size={15} className={salvando ? "animate-spin" : undefined} />
            {salvando ? "Renovando..." : "Confirmar renovação"}
          </button>
        </div>
      }
    >
      <form id="form-renovar-certidao" onSubmit={confirmar} className="space-y-5">
        {erro && <Alerta>{erro}</Alerta>}

        <div className="flex items-start gap-2.5 rounded-xl border border-black/10 bg-[#F5F3EF]/70 px-4 py-3">
          <History size={15} className="mt-0.5 shrink-0 text-[#C9A227]" />
          <div className="min-w-0">
            <p className="text-xs text-[#0F2A44]/70 leading-relaxed">
              A emissão atual não será apagada: ela fica guardada como versão anterior deste documento
              e pode ser consultada no histórico da certidão. A nova emissão passa a ser a vigente.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-[#0F2A44]/55">
              <BadgeSituacao situacao={situacaoEfetiva(certidao)} />
              <span>
                Emissão {formatarData(certidao?.data_emissao)} · Vencimento{" "}
                {certidao?.data_vencimento ? formatarData(certidao.data_vencimento) : "--"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Número / documento" dica="Opcional — número impresso na nova certidão.">
            <input
              type="text"
              value={campos.numero_documento}
              onChange={(e) => setCampos((atual) => ({ ...atual, numero_documento: e.target.value }))}
              maxLength={120}
              placeholder={certidao?.numero_documento ? `Anterior: ${certidao.numero_documento}` : undefined}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Campo label="Nova data de emissão" obrigatorio>
            <input
              type="date"
              value={campos.data_emissao}
              onChange={(e) => escolherEmissao(e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          {possuiVencimento ? (
            <Campo
              label="Novo vencimento"
              dica={
                tipo?.prazo_padrao_dias
                  ? `Sugerido pelo prazo padrão do tipo (${tipo.prazo_padrao_dias} dias).`
                  : undefined
              }
            >
              <input
                type="date"
                value={campos.data_vencimento ?? ""}
                min={campos.data_emissao || undefined}
                onChange={(e) => setCampos((atual) => ({ ...atual, data_vencimento: e.target.value }))}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          ) : (
            <Campo label="Novo vencimento" dica="Este tipo de documento não vence.">
              <input type="text" value="Não se aplica" disabled className={CLASSE_ENTRADA} />
            </Campo>
          )}
        </div>

        <Campo label="Observações" dica="Opcional — o que motivou a renovação ou o que ficou pendente.">
          <textarea
            value={campos.observacoes}
            onChange={(e) => setCampos((atual) => ({ ...atual, observacoes: e.target.value }))}
            rows={3}
            className={`${CLASSE_ENTRADA} resize-y`}
          />
        </Campo>

        <div>
          <span className="text-xs font-medium text-[#0F2A44]/70">Novo documento</span>
          <div className="mt-1 rounded-xl border border-dashed border-black/15 bg-[#F5F3EF]/50 px-4 py-3.5">
            <input
              ref={inputArquivo}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const selecionado = e.target.files?.[0] ?? null;
                if (selecionado) selecionarArquivo(selecionado);
                e.target.value = "";
              }}
            />

            {nomeAnexoNovo ? (
              <div className="flex flex-wrap items-center gap-3">
                <FileText size={18} className="text-[#C9A227] shrink-0" />
                <span className="text-sm text-[#0F2A44] break-all flex-1 min-w-0">
                  {nomeAnexoNovo}
                  {!arquivo && (
                    <span className="block text-[11px] text-[#0F2A44]/45">
                      Arquivo da emissão anterior, reaproveitado nesta renovação.
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => inputArquivo.current?.click()}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-white"
                >
                  <Upload size={14} />
                  {arquivo ? "Trocar" : "Anexar novo"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputArquivo.current?.click()}
                className="flex items-center gap-2 text-sm text-[#0F2A44]/70 hover:text-[#0F2A44]"
              >
                <Paperclip size={16} />
                Selecionar arquivo (PDF ou imagem)
              </button>
            )}
          </div>
          <span className="block text-[11px] text-[#0F2A44]/45 mt-1">
            {certidao?.arquivo_url
              ? "Opcional — sem arquivo novo, a nova emissão fica com o anexo da anterior."
              : "Opcional — a emissão anterior não tinha anexo."}
          </span>
        </div>
      </form>
    </ModalShell>
  );
}
