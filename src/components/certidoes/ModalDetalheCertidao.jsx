import React from "react";
import { Download, FileText, History, RefreshCw } from "lucide-react";
import { ModalShell } from "../equipe/comuns";
import { BadgeSituacao, Etiqueta } from "./badges";
import {
  diasAte,
  formatarData,
  listarHistoricoCertidao,
  nomeDoAnexo,
  nomeFornecedor,
  situacaoEfetiva,
  urlDeDownload,
} from "../../lib/certidoes";
import { mensagemAmigavel } from "../../lib/erros";

/** Visualização somente leitura de uma certidão, aberta pelo olho da listagem. */
export default function ModalDetalheCertidao({ certidao, podeRenovar = false, onFechar, onRenovar }) {
  const situacao = situacaoEfetiva(certidao);
  const dias = diasAte(certidao?.data_vencimento);

  // Cadeia de versões anteriores: só existe em certidões que já foram renovadas.
  const [historico, setHistorico] = React.useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = React.useState(true);
  const [erroHistorico, setErroHistorico] = React.useState(null);

  const certidaoId = certidao?.id;
  React.useEffect(() => {
    let ativo = true;
    setCarregandoHistorico(true);
    setErroHistorico(null);

    (async () => {
      try {
        const versoes = await listarHistoricoCertidao(certidao);
        if (ativo) setHistorico(versoes);
      } catch (e) {
        if (ativo) {
          setHistorico([]);
          setErroHistorico(mensagemAmigavel(e, "Não foi possível carregar o histórico desta certidão."));
        }
      } finally {
        if (ativo) setCarregandoHistorico(false);
      }
    })();

    return () => {
      ativo = false;
    };
    // A certidão aberta não muda de identidade enquanto o modal existe: o id
    // basta como dependência.
  }, [certidaoId]);

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
          {/* Renovar cadastra uma nova emissão e guarda esta como histórico.
              Aparece só para quem pode cadastrar e editar no módulo. */}
          {podeRenovar && onRenovar && (
            <button
              type="button"
              onClick={() => onRenovar(certidao)}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-[#C9A227]/50 bg-[#FBF4DE] text-sm text-[#8A7526] hover:bg-[#F7EAC6] sm:mr-auto"
            >
              <RefreshCw size={15} />
              🔄 Renovar Certidão
            </button>
          )}
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

        <HistoricoDaCertidao
          certidao={certidao}
          versoes={historico}
          carregando={carregandoHistorico}
          erro={erroHistorico}
        />
      </div>
    </ModalShell>
  );
}

/**
 * Cadeia de versões do documento, da emissão mais antiga para a mais recente,
 * terminando na certidão que está valendo hoje.
 *
 * Só aparece em documentos que já foram renovados: sem renovação não há cadeia,
 * e a seção some por completo em vez de mostrar uma lista de um item só.
 */
function HistoricoDaCertidao({ certidao, versoes, carregando, erro }) {
  if (erro) {
    return (
      <div className="border border-amber-200 bg-amber-50 text-amber-800 text-xs rounded-xl px-4 py-3">
        {erro}
      </div>
    );
  }

  if (carregando || versoes.length === 0) return null;

  const total = versoes.length + 1;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-[#0F2A44]/70">
        <History size={13} className="text-[#C9A227]" />
        Histórico de renovações
        <span className="font-normal text-[#0F2A44]/45">
          · {total} {total === 1 ? "emissão" : "emissões"}
        </span>
      </div>

      <ol className="mt-2 rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden">
        {versoes.map((versao, indice) => (
          <VersaoDaCertidao
            key={versao.id}
            versao={versao}
            ordem={indice + 1}
            situacao={situacaoEfetiva(versao)}
            complemento={
              versao.substituida_em
                ? `Substituída em ${formatarData(versao.substituida_em)}`
                : "Substituída por uma emissão mais recente"
            }
          />
        ))}

        <VersaoDaCertidao
          versao={certidao}
          ordem={total}
          situacao={situacaoEfetiva(certidao)}
          vigente
          complemento="Emissão em vigor"
        />
      </ol>
    </div>
  );
}

function VersaoDaCertidao({ versao, ordem, situacao, complemento, vigente = false }) {
  return (
    <li className={`px-4 py-3 ${vigente ? "bg-[#F5F3EF]/70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] tabular-nums text-[#0F2A44]/40">{ordem}ª</span>
          <span className="text-sm text-[#0F2A44]">
            Emissão {formatarData(versao?.data_emissao)}
          </span>
          {vigente ? <Etiqueta tom="dourado">Vigente</Etiqueta> : <Etiqueta>Histórico</Etiqueta>}
        </div>
        <BadgeSituacao situacao={situacao} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-[#0F2A44]/45">
        <span>
          Vencimento {versao?.data_vencimento ? formatarData(versao.data_vencimento) : "--"}
        </span>
        {versao?.numero_documento && <span>nº {versao.numero_documento}</span>}
        <span>{complemento}</span>
        {versao?.arquivo_url && (
          <a
            href={urlDeDownload(versao.arquivo_url)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#0F2A44]/55 underline underline-offset-2 hover:text-[#0F2A44]"
          >
            <Download size={11} />
            Anexo
          </a>
        )}
      </div>
    </li>
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
