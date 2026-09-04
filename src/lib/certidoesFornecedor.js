import { listarCertidoes } from "./certidoes";
import { anotarVigencia } from "./certidoesRegras";

/**
 * Certidões vistas do lado do fornecedor.
 *
 * A fonte é a MESMA tabela `certidoes` do módulo de Certidões — aqui só se lê e
 * se agrupa por fornecedor. Nada é duplicado e nenhuma tabela nova existe para
 * isso; quem não tem pode_visualizar no módulo recebe uma lista vazia do RLS, e
 * a tela de Fornecedores nem chega a pedir os dados.
 */

/**
 * Certidões agrupadas por fornecedor: { [fornecedor_id]: [certidão, ...] }.
 *
 * Cada linha vai anotada com a vigência por tipo (`vigenteNoTipo`), calculada
 * sobre a lista completa. TODAS as certidões continuam no grupo — inclusive as
 * emissões anteriores do mesmo tipo, que a ficha do fornecedor mostra marcadas
 * como anteriores.
 */
export async function carregarCertidoesPorFornecedor() {
  const certidoes = anotarVigencia(await listarCertidoes());
  const porFornecedor = {};
  certidoes.forEach((certidao) => {
    const chave = String(certidao.fornecedor_id);
    (porFornecedor[chave] ??= []).push(certidao);
  });
  return porFornecedor;
}

/**
 * O indicador documental do fornecedor vive na regra compartilhada (módulo puro,
 * sem Supabase, testável direto): a listagem de Fornecedores e a ficha continuam
 * importando daqui.
 */
export { detalheDocumental, resumoDocumental } from "./certidoesRegras";
