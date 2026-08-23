import React from "react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { atualizarTipo, criarTipo } from "../../lib/certidoes";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Cadastro e edição de um tipo de documento (Certidão Federal, Cartão de CNPJ...).
 * O prazo padrão só existe quando o tipo possui vencimento: desmarcar a opção
 * esconde o campo e grava o prazo como vazio.
 */
export default function ModalTipoCertidao({ tipo, onFechar, onSalvo }) {
  const edicao = Boolean(tipo?.id);

  const [campos, setCampos] = React.useState({
    nome: tipo?.nome ?? "",
    descricao: tipo?.descricao ?? "",
    possui_vencimento: tipo?.possui_vencimento !== false,
    prazo_padrao_dias: tipo?.prazo_padrao_dias ?? "",
    obrigatorio: tipo?.obrigatorio === true,
    ativo: tipo?.ativo !== false,
  });
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  function alterar(campo, valor) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const salvo = edicao ? await atualizarTipo(tipo.id, campos) : await criarTipo(campos);
      onSalvo?.(salvo, edicao);
      onFechar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar o tipo de documento."));
      setSalvando(false);
    }
  }

  return (
    <ModalShell
      titulo={edicao ? "Editar tipo de documento" : "Novo tipo de documento"}
      subtitulo="Os tipos alimentam o campo “Tipo de certidão” do cadastro."
      largura="max-w-xl"
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
            form="form-tipo-certidao"
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            {salvando ? "Salvando..." : edicao ? "Salvar alterações" : "Cadastrar tipo"}
          </button>
        </div>
      }
    >
      <form id="form-tipo-certidao" onSubmit={salvar} className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <Campo label="Nome" obrigatorio>
          <input
            type="text"
            value={campos.nome}
            onChange={(e) => alterar("nome", e.target.value)}
            placeholder="Ex.: Certidão Federal"
            maxLength={120}
            autoFocus
            className={CLASSE_ENTRADA}
          />
        </Campo>

        <Campo label="Descrição" dica="Opcional — ajuda a equipe a saber qual documento anexar.">
          <textarea
            value={campos.descricao}
            onChange={(e) => alterar("descricao", e.target.value)}
            rows={3}
            className={`${CLASSE_ENTRADA} resize-y`}
          />
        </Campo>

        <div className="rounded-xl border border-black/10 divide-y divide-black/5">
          <Opcao
            titulo="Possui vencimento?"
            descricao="Desmarque para documentos que não expiram, como o Cartão de CNPJ."
            marcado={campos.possui_vencimento}
            onMudar={(valor) => alterar("possui_vencimento", valor)}
          />
          <Opcao
            titulo="Obrigatório?"
            descricao="Documentos obrigatórios são cobrados de todo fornecedor."
            marcado={campos.obrigatorio}
            onMudar={(valor) => alterar("obrigatorio", valor)}
          />
          <Opcao
            titulo="Ativo"
            descricao="Tipos inativos deixam de aparecer no cadastro de certidões."
            marcado={campos.ativo}
            onMudar={(valor) => alterar("ativo", valor)}
          />
        </div>

        {campos.possui_vencimento && (
          <Campo
            label="Prazo padrão de validade (dias)"
            dica="Opcional — usado para sugerir a data de vencimento a partir da emissão."
          >
            <input
              type="number"
              min={1}
              max={3650}
              value={campos.prazo_padrao_dias}
              onChange={(e) => alterar("prazo_padrao_dias", e.target.value)}
              placeholder="Ex.: 180"
              className={CLASSE_ENTRADA}
            />
          </Campo>
        )}
      </form>
    </ModalShell>
  );
}

function Opcao({ titulo, descricao, marcado, onMudar }) {
  return (
    <label className="flex items-start gap-3 px-4 py-3 cursor-pointer">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onMudar(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-[#0F2A44]"
      />
      <span className="min-w-0">
        <span className="block text-sm text-[#0F2A44]">{titulo}</span>
        <span className="block text-[11px] text-[#0F2A44]/45 mt-0.5">{descricao}</span>
      </span>
    </label>
  );
}
