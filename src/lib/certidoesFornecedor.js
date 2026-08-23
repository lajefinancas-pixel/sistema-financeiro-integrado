import { DIAS_ALERTA_VENCIMENTO, listarCertidoes, situacaoPorData } from "./certidoes";

/**
 * Certidões vistas do lado do fornecedor.
 *
 * A fonte é a MESMA tabela `certidoes` do módulo de Certidões — aqui só se lê e
 * se agrupa por fornecedor. Nada é duplicado e nenhuma tabela nova existe para
 * isso; quem não tem pode_visualizar no módulo recebe uma lista vazia do RLS, e
 * a tela de Fornecedores nem chega a pedir os dados.
 */

/** Certidões agrupadas por fornecedor: { [fornecedor_id]: [certidão, ...] }. */
export async function carregarCertidoesPorFornecedor() {
  const certidoes = await listarCertidoes();
  const porFornecedor = {};
  certidoes.forEach((certidao) => {
    const chave = String(certidao.fornecedor_id);
    (porFornecedor[chave] ??= []).push(certidao);
  });
  return porFornecedor;
}

function plural(quantidade, singular, plural_) {
  return quantidade === 1 ? singular : plural_;
}

/**
 * Situação documental do fornecedor, para o indicador discreto da listagem.
 *
 * A leitura é pela data (e não pela situação gravada), o mesmo critério dos
 * alertas de vencimento: uma certidão marcada como "Em renovação" que já passou
 * do prazo continua sendo uma pendência para quem confere a documentação.
 *
 * Vencida tem prioridade sobre "próxima do vencimento", e o fornecedor sem
 * nenhuma certidão fica em um estado próprio — chamar isso de "documentação
 * regular" esconderia justamente quem não tem documento nenhum.
 */
export function resumoDocumental(certidoes) {
  const lista = certidoes ?? [];

  if (lista.length === 0) {
    return {
      tom: "sem_cadastro",
      emoji: "⚪",
      texto: "Sem certidão cadastrada",
      total: 0,
      vencidas: 0,
      proximas: 0,
      cor: "#64748B",
      bg: "#F1F5F9",
    };
  }

  const situacoes = lista.map((c) => situacaoPorData(c.data_vencimento));
  const vencidas = situacoes.filter((s) => s === "vencida").length;
  const proximas = situacoes.filter((s) => s === "a_vencer").length;
  const base = { total: lista.length, vencidas, proximas };

  if (vencidas > 0) {
    return {
      ...base,
      tom: "vencida",
      emoji: "🔴",
      texto: `${vencidas} ${plural(vencidas, "certidão vencida", "certidões vencidas")}`,
      cor: "#DC2626",
      bg: "#FEF2F2",
    };
  }

  if (proximas > 0) {
    return {
      ...base,
      tom: "a_vencer",
      emoji: "🟡",
      texto: `${proximas} ${plural(
        proximas,
        "certidão próxima do vencimento",
        "certidões próximas do vencimento",
      )}`,
      cor: "#A16207",
      bg: "#FEF7DF",
    };
  }

  return {
    ...base,
    tom: "regular",
    emoji: "🟢",
    texto: "Documentação regular",
    cor: "#15803D",
    bg: "#EAFBF0",
  };
}

/** Texto de apoio do indicador (title), explicando o critério do amarelo. */
export function detalheDocumental(resumo) {
  if (!resumo) return "";
  if (resumo.tom === "sem_cadastro") return "Nenhuma certidão cadastrada para este fornecedor.";
  const total = `${resumo.total} ${plural(resumo.total, "certidão cadastrada", "certidões cadastradas")}`;
  if (resumo.tom === "vencida") return `${total} — ${resumo.texto}.`;
  if (resumo.tom === "a_vencer") {
    return `${total} — ${resumo.texto} (até ${DIAS_ALERTA_VENCIMENTO} dias).`;
  }
  return `${total} — nenhuma vencida ou perto de vencer.`;
}
