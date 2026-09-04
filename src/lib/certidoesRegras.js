/**
 * Regras de situação e de vigência das certidões.
 *
 * Módulo PURO: nenhuma consulta, nenhum import de Supabase. É a fonte única da
 * conta de regularidade — a listagem de Fornecedores, a ficha do fornecedor, os
 * filtros do módulo Certidões, o card do Painel Principal, os alertas de
 * vencimento, os relatórios e as exportações chamam daqui, para que nunca
 * mostrem números diferentes entre si.
 *
 * A regra que sustenta tudo:
 *
 *   A situação de regularidade do fornecedor é determinada apenas pela certidão
 *   MAIS RECENTE de cada tipo (a de maior data de vencimento; havendo empate, a
 *   de emissão mais recente). As emissões anteriores do mesmo tipo continuam
 *   cadastradas e visíveis, mas não entram no cálculo nem geram alerta.
 *
 * Nada é apagado, sobrescrito ou movido por causa disso: a vigência é um
 * cálculo em cima da lista que já veio do banco (`vigenteNoTipo`), não uma
 * coluna nova nem uma exclusão.
 *
 * O texto do indicador do fornecedor ("1 certidão vencida", "Documentação
 * regular") também sai daqui, para que o aviso da listagem, o rodapé da ficha e
 * o card do Painel Principal digam sempre a mesma coisa.
 */

/** Dias antes do vencimento em que a certidão passa a ser exibida como "a vencer". */
export const DIAS_ALERTA_VENCIMENTO = 30;

/**
 * Situações que a pessoa escolhe e o sistema respeita como estão. As demais
 * (válida, a vencer, vencida, sem vencimento) são consequência das datas e a
 * tela recalcula sozinha.
 */
export const SITUACOES_MANUAIS = ["em_renovacao"];

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/** Hoje no formato ISO (aaaa-mm-dd), no fuso local — o mesmo que o input date usa. */
export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Diferença em dias entre hoje e a data informada (negativo = já passou). */
export function diasAte(iso) {
  if (!iso) return null;
  const umDia = 24 * 60 * 60 * 1000;
  const alvo = Date.parse(`${String(iso).slice(0, 10)}T00:00:00`);
  const hoje = Date.parse(`${hojeISO()}T00:00:00`);
  if (Number.isNaN(alvo) || Number.isNaN(hoje)) return null;
  return Math.round((alvo - hoje) / umDia);
}

/**
 * Situação que decorre das datas: sem vencimento quando o tipo não vence,
 * vencida quando a data já passou, a vencer na reta final e válida no resto.
 */
export function situacaoPorData(dataVencimento) {
  if (!dataVencimento) return "sem_vencimento";
  const dias = diasAte(dataVencimento);
  if (dias === null) return "sem_vencimento";
  if (dias < 0) return "vencida";
  if (dias <= DIAS_ALERTA_VENCIMENTO) return "a_vencer";
  return "valida";
}

/** Situação exibida na lista: a manual prevalece; o resto vem das datas. */
export function situacaoEfetiva(certidao) {
  if (SITUACOES_MANUAIS.includes(certidao?.situacao)) return certidao.situacao;
  return situacaoPorData(certidao?.data_vencimento);
}

// ---------------------------------------------------------------------------
// Vigência: a certidão mais recente de cada tipo
// ---------------------------------------------------------------------------

function soData(valor) {
  return valor ? String(valor).slice(0, 10) : "";
}

/**
 * O que conta como "o mesmo documento": o mesmo tipo de certidão do mesmo
 * fornecedor. Duas emissões de FGTS do fornecedor X disputam a vigência; o FGTS
 * do fornecedor Y não entra nessa disputa.
 */
export function chaveDoDocumento(certidao) {
  const fornecedor = String(certidao?.fornecedor_id ?? "");
  const tipo = String(certidao?.tipo_certidao_id ?? certidao?.tipos_certidao?.id ?? "");
  return `${fornecedor}::${tipo}`;
}

/**
 * Certidão com data de vencimento. As sem vencimento (Cartão CNPJ, Simples
 * Nacional) ficam fora da disputa de vigência: elas não vencem, então nenhuma
 * emissão supera a outra e todas continuam valendo como estão hoje.
 */
export function temVencimento(certidao) {
  return Boolean(soData(certidao?.data_vencimento));
}

/**
 * Qual das duas emissões é a mais recente: positivo quando `a` vence depois de
 * `b`. O critério da regra é o vencimento; no empate vale a emissão mais
 * recente, e depois o cadastro mais novo — só para o resultado ser sempre o
 * mesmo, independentemente da ordem em que a lista chegou.
 */
export function compararRecencia(a, b) {
  const va = soData(a?.data_vencimento);
  const vb = soData(b?.data_vencimento);
  if (va !== vb) return va > vb ? 1 : -1;

  const ea = soData(a?.data_emissao);
  const eb = soData(b?.data_emissao);
  if (ea !== eb) return ea > eb ? 1 : -1;

  const ca = String(a?.criado_em ?? "");
  const cb = String(b?.criado_em ?? "");
  if (ca !== cb) return ca > cb ? 1 : -1;

  const ia = String(a?.id ?? "");
  const ib = String(b?.id ?? "");
  if (ia !== ib) return ia > ib ? 1 : -1;
  return 0;
}

function ehMesmaCertidao(a, b) {
  if (a === b) return true;
  if (a?.id === undefined || a?.id === null) return false;
  return String(a.id) === String(b?.id);
}

/**
 * Quem vale por tipo, para cada documento presente na lista.
 * Devolve Map<chaveDoDocumento, { vigente, emissoes }>.
 */
export function vigentesPorDocumento(certidoes) {
  const documentos = new Map();
  (certidoes ?? []).forEach((certidao) => {
    if (!temVencimento(certidao)) return;
    const chave = chaveDoDocumento(certidao);
    const atual = documentos.get(chave);
    if (!atual) {
      documentos.set(chave, { vigente: certidao, emissoes: 1 });
      return;
    }
    atual.emissoes += 1;
    if (compararRecencia(certidao, atual.vigente) > 0) atual.vigente = certidao;
  });
  return documentos;
}

/**
 * A lista inteira, na mesma ordem, com a vigência anotada em cada linha:
 *
 *   vigenteNoTipo          -> entra no cálculo da situação do fornecedor;
 *   emissoesNoTipo         -> quantas emissões do mesmo documento existem;
 *   superadaPorId          -> id da emissão mais nova que a superou;
 *   superadaPorVencimento  -> vencimento dessa emissão mais nova.
 *
 * `emissoesNoTipo` é o que permite à tela marcar "Vigente" / "Anterior" apenas
 * onde a distinção existe: com uma única emissão do tipo não há o que explicar.
 *
 * Nenhuma linha é removida, reordenada ou alterada nos campos do cadastro: a
 * anotação é apenas informação a mais para a tela e para as contagens. Chamar
 * duas vezes dá o mesmo resultado.
 */
export function anotarVigencia(certidoes) {
  const lista = certidoes ?? [];
  const documentos = vigentesPorDocumento(lista);

  return lista.map((certidao) => {
    if (!temVencimento(certidao)) {
      return {
        ...certidao,
        vigenteNoTipo: true,
        emissoesNoTipo: 1,
        superadaPorId: null,
        superadaPorVencimento: null,
      };
    }
    const documento = documentos.get(chaveDoDocumento(certidao)) ?? null;
    const vigente = documento?.vigente ?? null;
    const ehVigente = vigente ? ehMesmaCertidao(certidao, vigente) : true;
    return {
      ...certidao,
      vigenteNoTipo: ehVigente,
      emissoesNoTipo: documento?.emissoes ?? 1,
      superadaPorId: ehVigente ? null : vigente?.id ?? null,
      superadaPorVencimento: ehVigente ? null : vigente?.data_vencimento ?? null,
    };
  });
}

/** A linha entra no cálculo da situação? Anotada ou não, a resposta é a mesma. */
export function ehVigenteNoTipo(certidao) {
  return certidao?.vigenteNoTipo !== false;
}

/**
 * Vale a pena dizer na tela se a linha é vigente ou anterior? Só quando o
 * fornecedor tem mais de uma emissão daquele documento — é aí que a distinção
 * explica a conta da regularidade.
 */
export function temEmissoesConcorrentes(certidao) {
  return Number(certidao?.emissoesNoTipo ?? 1) > 1;
}

/**
 * Só as certidões que determinam a regularidade: a mais recente de cada tipo,
 * mais as que não vencem. As emissões anteriores continuam na lista de origem —
 * aqui elas apenas não são contadas.
 */
export function somenteVigentes(certidoes) {
  return anotarVigencia(certidoes).filter(ehVigenteNoTipo);
}

/** As emissões superadas por uma mais nova do mesmo tipo. */
export function somenteAnteriores(certidoes) {
  return anotarVigencia(certidoes).filter((c) => !ehVigenteNoTipo(c));
}

// ---------------------------------------------------------------------------
// Contagem de regularidade
// ---------------------------------------------------------------------------

/**
 * A conta de regularidade que todas as telas usam.
 *
 * `janelaDias` é o quanto antes do vencimento a certidão já conta como próxima
 * do vencimento (30 dias na listagem de Fornecedores; nos alertas, o maior
 * prazo configurado).
 *
 * `total` é a lista inteira — o fornecedor continua com todas as certidões
 * cadastradas —, enquanto `vencidas` e `aVencer` olham só as vigentes.
 */
export function contarRegularidade(certidoes, janelaDias = DIAS_ALERTA_VENCIMENTO) {
  const lista = certidoes ?? [];
  const vigentes = somenteVigentes(lista);

  let vencidas = 0;
  let aVencer = 0;

  vigentes.forEach((certidao) => {
    const dias = diasAte(certidao?.data_vencimento);
    if (dias === null) return;
    if (dias < 0) vencidas += 1;
    else if (dias <= janelaDias) aVencer += 1;
  });

  return {
    total: lista.length,
    vigentes: vigentes.length,
    anteriores: lista.length - vigentes.length,
    vencidas,
    aVencer,
    janela: janelaDias,
    regular: vencidas === 0 && aVencer === 0,
  };
}

// ---------------------------------------------------------------------------
// Indicador do fornecedor
// ---------------------------------------------------------------------------

function plural(quantidade, singular, plural_) {
  return quantidade === 1 ? singular : plural_;
}

/**
 * Situação documental do fornecedor, para o indicador discreto da listagem e
 * para o rodapé da ficha.
 *
 * Só a certidão MAIS RECENTE de cada tipo entra na conta (regra única em
 * lib/certidoesRegras.js): um FGTS vencido em 02/09 substituído por outro que
 * vence em 28/09 não deixa o fornecedor irregular. As emissões anteriores
 * continuam cadastradas, visíveis e contadas no total — elas apenas não geram
 * alerta.
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
      vigentes: 0,
      anteriores: 0,
      vencidas: 0,
      proximas: 0,
      cor: "#64748B",
      bg: "#F1F5F9",
    };
  }

  const conta = contarRegularidade(lista, DIAS_ALERTA_VENCIMENTO);
  const vencidas = conta.vencidas;
  const proximas = conta.aVencer;
  const base = {
    total: conta.total,
    vigentes: conta.vigentes,
    anteriores: conta.anteriores,
    vencidas,
    proximas,
  };

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

/**
 * Texto de apoio do indicador (title), explicando o critério do amarelo e
 * quantas emissões anteriores ficaram fora da conta.
 */
export function detalheDocumental(resumo) {
  if (!resumo) return "";
  if (resumo.tom === "sem_cadastro") return "Nenhuma certidão cadastrada para este fornecedor.";

  const total = `${resumo.total} ${plural(resumo.total, "certidão cadastrada", "certidões cadastradas")}`;
  const anteriores = resumo.anteriores > 0
    ? ` ${resumo.anteriores} ${plural(
        resumo.anteriores,
        "emissão anterior não entra na conta",
        "emissões anteriores não entram na conta",
      )} (vale a mais recente de cada tipo).`
    : "";

  if (resumo.tom === "vencida") return `${total} — ${resumo.texto}.${anteriores}`;
  if (resumo.tom === "a_vencer") {
    return `${total} — ${resumo.texto} (até ${DIAS_ALERTA_VENCIMENTO} dias).${anteriores}`;
  }
  return `${total} — nenhuma vencida ou perto de vencer.${anteriores}`;
}
