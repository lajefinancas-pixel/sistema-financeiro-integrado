import React from "react";
import {
  complementoDoFornecedor,
  complementoDoPagamento,
  nomeExibicaoDoFornecedor,
  nomeExibicaoDoPagamento,
} from "../../lib/nomesFornecedor";

/**
 * Nome do fornecedor nas telas operacionais.
 *
 * Havendo apelido cadastrado (ou nome de exibição próprio da programação), ele
 * aparece em DESTAQUE e a razão social vira a informação secundária:
 *
 *   Zé Alimentos
 *   José da Silva Comércio de Alimentos Ltda.
 *
 * Não havendo, sai só o nome de sempre -- uma linha, exatamente como a tela já
 * era. A razão social continua sendo a usada nos documentos oficiais e fiscais:
 * este componente é apresentação, não altera nenhum cadastro.
 *
 * Recebe `fornecedor` (um cadastro) ou `pagamento` (um item de programação, que
 * pode ter nome de exibição próprio). Devolve duas linhas soltas, para o chamador
 * decidir o container.
 */
export default function NomeFornecedor({
  fornecedor = null,
  pagamento = null,
  classeDestaque = "",
  classeSecundaria = "",
}) {
  const destaque = pagamento ? nomeExibicaoDoPagamento(pagamento) : nomeExibicaoDoFornecedor(fornecedor);
  const secundaria = pagamento ? complementoDoPagamento(pagamento) : complementoDoFornecedor(fornecedor);

  return (
    <>
      <span className={`block truncate ${classeDestaque}`} title={destaque}>
        {destaque}
      </span>
      {secundaria !== "" && (
        <span
          className={`block truncate text-[11px] font-normal leading-tight opacity-60 ${classeSecundaria}`}
          title={secundaria}
        >
          {secundaria}
        </span>
      )}
    </>
  );
}
