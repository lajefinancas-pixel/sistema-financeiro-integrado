import React from "react";
import { FileText, Paperclip, RefreshCw, Trash2, Upload } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import SeletorFornecedor from "./SeletorFornecedor";
import {
  MODULO,
  OPCOES_SITUACAO,
  atualizarCertidao,
  criarCertidao,
  dadosParaAuditoria,
  descricaoParaAuditoria,
  enviarArquivo,
  hojeISO,
  nomeDoAnexo,
  situacaoPorData,
  vencimentoSugerido,
} from "../../lib/certidoes";
import { registrarEvento } from "../../lib/auditoria";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Cadastro e edição de uma certidão.
 *
 * O campo "Fornecedor" é abastecido pela view de identificação dos fornecedores
 * (`fornecedoresIdentificacao`), liberada pela permissão do módulo Certidões —
 * quem cuida da regularidade documental escolhe o fornecedor por nome ou
 * CPF/CNPJ sem precisar de acesso ao módulo Fornecedores. A tela que abre o
 * modal (Certidões ou Vida do Fornecedor) passa a lista pronta em `fornecedores`.
 *
 * Duas regras guiam o formulário:
 *   * o tipo escolhido manda no vencimento — tipo sem vencimento esconde o
 *     campo e a situação vira "Sem vencimento";
 *   * a situação acompanha as datas enquanto a pessoa não escolher um estado
 *     manual ("Em renovação").
 */
export default function ModalCertidao({
  certidao,
  fornecedores,
  carregandoFornecedores = false,
  tipos,
  usuario,
  podeRenovar = false,
  onFechar,
  onSalva,
  onRenovar,
}) {
  const edicao = Boolean(certidao?.id);

  const [campos, setCampos] = React.useState({
    fornecedor_id: certidao?.fornecedor_id ?? "",
    tipo_certidao_id: certidao?.tipo_certidao_id ?? "",
    numero_documento: certidao?.numero_documento ?? "",
    data_emissao: certidao?.data_emissao ?? hojeISO(),
    data_vencimento: certidao?.data_vencimento ?? "",
    situacao: certidao?.situacao ?? "valida",
    observacoes: certidao?.observacoes ?? "",
    arquivo_url: certidao?.arquivo_url ?? null,
  });
  const [arquivo, setArquivo] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const inputArquivo = React.useRef(null);

  // Tipos ativos + o tipo já gravado na certidão (que pode ter sido desativado).
  const tiposDisponiveis = React.useMemo(() => {
    const ativos = tipos.filter((t) => t.ativo !== false);
    const atual = tipos.find((t) => t.id === certidao?.tipo_certidao_id);
    return atual && !ativos.some((t) => t.id === atual.id) ? [...ativos, atual] : ativos;
  }, [tipos, certidao?.tipo_certidao_id]);

  /**
   * Opções do seletor: a lista recebida mais o fornecedor já gravado na
   * certidão, caso ele não venha nela (cadastro inativado, por exemplo). Sem
   * isso a edição perderia de vista o fornecedor do próprio documento.
   */
  const fornecedoresDisponiveis = React.useMemo(() => {
    const lista = fornecedores ?? [];
    const atual = certidao?.fornecedores ?? null;
    const id = atual?.id ?? certidao?.fornecedor_id ?? null;
    if (!id || lista.some((f) => String(f.id) === String(id))) return lista;
    return atual ? [...lista, atual] : lista;
  }, [fornecedores, certidao?.fornecedores, certidao?.fornecedor_id]);

  const tipoEscolhido = tiposDisponiveis.find((t) => t.id === campos.tipo_certidao_id) ?? null;
  const possuiVencimento = tipoEscolhido ? tipoEscolhido.possui_vencimento !== false : true;
  const situacaoManual = campos.situacao === "em_renovacao";

  function alterar(campo, valor) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Troca de tipo: aplica o prazo padrão e zera o vencimento de quem não vence. */
  function escolherTipo(id) {
    const tipo = tiposDisponiveis.find((t) => t.id === id) ?? null;
    setCampos((atual) => {
      if (tipo && tipo.possui_vencimento === false) {
        return { ...atual, tipo_certidao_id: id, data_vencimento: "", situacao: "sem_vencimento" };
      }
      const sugerido = vencimentoSugerido(atual.data_emissao, tipo?.prazo_padrao_dias);
      const vencimento = atual.data_vencimento || sugerido;
      return {
        ...atual,
        tipo_certidao_id: id,
        data_vencimento: vencimento,
        situacao: atual.situacao === "em_renovacao" ? atual.situacao : situacaoPorData(vencimento),
      };
    });
  }

  /** Nova emissão: reprojeta o vencimento pelo prazo padrão do tipo. */
  function escolherEmissao(valor) {
    setCampos((atual) => {
      const sugerido = vencimentoSugerido(valor, tipoEscolhido?.prazo_padrao_dias);
      const vencimento = possuiVencimento ? sugerido || atual.data_vencimento : "";
      return {
        ...atual,
        data_emissao: valor,
        data_vencimento: vencimento,
        situacao: atual.situacao === "em_renovacao" ? atual.situacao : situacaoPorData(vencimento),
      };
    });
  }

  function escolherVencimento(valor) {
    setCampos((atual) => ({
      ...atual,
      data_vencimento: valor,
      situacao: atual.situacao === "em_renovacao" ? atual.situacao : situacaoPorData(valor),
    }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      let arquivoUrl = campos.arquivo_url ?? null;
      if (arquivo) arquivoUrl = await enviarArquivo(campos.fornecedor_id, arquivo);

      const valores = { ...campos, arquivo_url: arquivoUrl };
      const salva = edicao
        ? await atualizarCertidao(certidao.id, valores, tipoEscolhido)
        : await criarCertidao(valores, tipoEscolhido, usuario?.id ?? null);

      const fornecedor = fornecedoresDisponiveis.find(
        (f) => String(f.id) === String(salva.fornecedor_id),
      );
      registrarAuditoria(salva, fornecedor);

      onSalva?.(salva, edicao);
      onFechar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a certidão."));
      setSalvando(false);
    }
  }

  /**
   * Trilha de auditoria do que acabou de ser gravado.
   *
   * O cadastro gera um evento 'criou'. Na edição, a mudança de situação ganha
   * evento próprio ('alterou_situacao'): marcar um documento como "Em renovação"
   * é uma decisão de acompanhamento e precisa ser localizável na trilha sem se
   * perder no meio de uma alteração de datas. As demais mudanças continuam em um
   * evento 'alterou', sempre com o valor anterior e o novo.
   */
  function registrarAuditoria(salva, fornecedor) {
    const registroAfetado = descricaoParaAuditoria(
      { ...salva, tipos_certidao: salva.tipos_certidao ?? tipoEscolhido },
      fornecedor,
    );
    const depois = dadosParaAuditoria(salva);

    if (!edicao) {
      registrarEvento({
        modulo: MODULO,
        acao: "criou",
        registroAfetado,
        valorNovo: depois,
        usuarioId: usuario?.id ?? null,
      });
      return;
    }

    const antes = dadosParaAuditoria(certidao);
    const mudouSituacao = antes.situacao !== depois.situacao;
    const mudouOResto = Object.keys(depois).some(
      (campo) => campo !== "situacao" && antes[campo] !== depois[campo],
    );

    if (mudouSituacao) {
      registrarEvento({
        modulo: MODULO,
        acao: "alterou_situacao",
        registroAfetado,
        valorAnterior: { situacao: antes.situacao },
        valorNovo: { situacao: depois.situacao },
        usuarioId: usuario?.id ?? null,
      });
    }

    if (mudouOResto || !mudouSituacao) {
      registrarEvento({
        modulo: MODULO,
        acao: "alterou",
        registroAfetado,
        valorAnterior: antes,
        valorNovo: depois,
        usuarioId: usuario?.id ?? null,
      });
    }
  }

  const nomeAnexoAtual = arquivo?.name ?? nomeDoAnexo(campos.arquivo_url);

  return (
    <ModalShell
      titulo={edicao ? "Editar certidão" : "Cadastrar certidão"}
      subtitulo="Os campos marcados com * são obrigatórios."
      onFechar={onFechar}
      rodape={
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          {/* Atalho para a renovação: cadastra uma nova emissão e guarda a atual
              como histórico. Só na edição — uma certidão que ainda não existe
              não tem o que renovar. */}
          {edicao && podeRenovar && onRenovar && (
            <button
              type="button"
              onClick={() => onRenovar(certidao)}
              disabled={salvando}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-[#C9A227]/50 bg-[#FBF4DE] text-sm text-[#8A7526] hover:bg-[#F7EAC6] disabled:opacity-40 sm:mr-auto"
            >
              <RefreshCw size={15} />
              🔄 Renovar Certidão
            </button>
          )}
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
            form="form-certidao"
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            {salvando ? "Salvando..." : edicao ? "Salvar alterações" : "Cadastrar certidão"}
          </button>
        </div>
      }
    >
      <form id="form-certidao" onSubmit={salvar} className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SeletorFornecedor
            fornecedores={fornecedoresDisponiveis}
            valor={campos.fornecedor_id}
            aoEscolher={(id) => alterar("fornecedor_id", id)}
            carregando={carregandoFornecedores}
            desabilitado={salvando}
            obrigatorio
          />

          <Campo label="Tipo de certidão" obrigatorio>
            <select
              value={campos.tipo_certidao_id}
              onChange={(e) => escolherTipo(e.target.value)}
              className={CLASSE_ENTRADA}
            >
              <option value="">Selecione o tipo</option>
              {tiposDisponiveis.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.ativo === false ? " (inativo)" : ""}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Número / documento" dica="Opcional — número de controle impresso na certidão.">
            <input
              type="text"
              value={campos.numero_documento}
              onChange={(e) => alterar("numero_documento", e.target.value)}
              maxLength={120}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          <Campo label="Data de emissão" obrigatorio>
            <input
              type="date"
              value={campos.data_emissao}
              onChange={(e) => escolherEmissao(e.target.value)}
              className={CLASSE_ENTRADA}
            />
          </Campo>

          {possuiVencimento ? (
            <Campo
              label="Data de vencimento"
              dica={
                tipoEscolhido?.prazo_padrao_dias
                  ? `Sugerida pelo prazo padrão do tipo (${tipoEscolhido.prazo_padrao_dias} dias).`
                  : undefined
              }
            >
              <input
                type="date"
                value={campos.data_vencimento ?? ""}
                min={campos.data_emissao || undefined}
                onChange={(e) => escolherVencimento(e.target.value)}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          ) : (
            <Campo label="Data de vencimento" dica="Este tipo de documento não vence.">
              <input type="text" value="Não se aplica" disabled className={CLASSE_ENTRADA} />
            </Campo>
          )}

          <Campo
            label="Situação"
            dica={
              situacaoManual
                ? "Estado manual — não é recalculado pelas datas."
                : "Válida, A vencer, Vencida e Sem vencimento seguem as datas informadas."
            }
          >
            <select
              value={campos.situacao}
              onChange={(e) => alterar("situacao", e.target.value)}
              className={CLASSE_ENTRADA}
            >
              {OPCOES_SITUACAO.map((opcao) => (
                <option key={opcao.id} value={opcao.id}>
                  {opcao.label}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Responsável" dica="Preenchido com quem está cadastrando.">
            <input
              type="text"
              value={
                edicao
                  ? certidao?.usuarios?.nome_completo ?? usuario?.nome_completo ?? "--"
                  : usuario?.nome_completo ?? "--"
              }
              disabled
              className={CLASSE_ENTRADA}
            />
          </Campo>
        </div>

        <Campo label="Observações" dica="Opcional — pendências, restrições ou o que precisa ser acompanhado.">
          <textarea
            value={campos.observacoes}
            onChange={(e) => alterar("observacoes", e.target.value)}
            rows={3}
            className={`${CLASSE_ENTRADA} resize-y`}
          />
        </Campo>

        <div>
          <span className="text-xs font-medium text-[#0F2A44]/70">Anexar documento</span>
          <div className="mt-1 rounded-xl border border-dashed border-black/15 bg-[#F5F3EF]/50 px-4 py-3.5">
            <input
              ref={inputArquivo}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const selecionado = e.target.files?.[0] ?? null;
                if (selecionado) setArquivo(selecionado);
                e.target.value = "";
              }}
            />
            {nomeAnexoAtual ? (
              <div className="flex flex-wrap items-center gap-3">
                <FileText size={18} className="text-[#C9A227] shrink-0" />
                <span className="text-sm text-[#0F2A44] break-all flex-1 min-w-0">{nomeAnexoAtual}</span>
                <button
                  type="button"
                  onClick={() => inputArquivo.current?.click()}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-white"
                >
                  <Upload size={14} />
                  Trocar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setArquivo(null);
                    alterar("arquivo_url", null);
                  }}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50 hover:bg-white"
                >
                  <Trash2 size={14} />
                  Remover
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
            Opcional — o arquivo fica disponível para download na listagem.
          </span>
        </div>
      </form>
    </ModalShell>
  );
}
