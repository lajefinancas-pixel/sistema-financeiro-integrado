// A TABELA DE DIÁRIAS: as faixas, as categorias, o pernoite e a memória do
// cálculo -- sem banco e sem tela.
//
// A tabela é um PARÂMETRO do módulo Processos, não um lançamento financeiro.
// Nada neste arquivo -- e nada no módulo -- debita conta, dá baixa em NF, altera
// saldo, marca fornecedor como pago, cria pagamento ou toca na Programação
// Diária. Ela só diz qual valor unitário o formulário sugere para a Requisição.
//
// A TABELA É VERSIONADA, E VERSÃO ANTIGA NÃO É APAGADA. Cada atualização grava
// uma VERSÃO NOVA e passa a ser a vigente; as anteriores continuam no banco
// para consulta, porque processos antigos foram calculados por elas.
//
// PROCESSO JÁ CRIADO NÃO É RECALCULADO. O valor unitário mora na linha do
// processo desde que foi escolhido: a tabela é lida uma vez, na hora de
// preencher, e nunca mais. Ao finalizar, o processo ainda guarda a faixa, a
// categoria, o percentual de pernoite e a identificação da versão usada --
// atualizar a tabela depois não muda nenhum documento já emitido.
//
// Este arquivo é carregado direto pelos testes, sem o resolvedor de módulos do
// Vite: só funções puras, nada de React e nada de supabase.

import { formatBRL, paraNumeroMoeda } from "./moeda.js";

/* -------------------------------------------------------------------------
 * Identificação
 * ---------------------------------------------------------------------- */

export const TABELA_DIARIAS = "processos_diarias_tabela";

/**
 * A migration da tabela de diárias, da identidade visual e do congelamento.
 *
 * Precisa ser rodada À MÃO no SQL Editor do Supabase, como as outras do módulo.
 */
export const MIGRATION_TABELA_DIARIAS = "20260911210000_processos_diarias_tabela_e_identidade.sql";

export const AVISO_MIGRATION_TABELA =
  `A Tabela de Diárias ainda não existe neste banco. Rode a migration ${MIGRATION_TABELA_DIARIAS} `
  + "no SQL Editor do Supabase para liberar o cadastro. Enquanto isso o valor unitário continua "
  + "sendo digitado à mão, e nenhum outro módulo é afetado.";

/* -------------------------------------------------------------------------
 * As linhas e as colunas da tabela
 * ---------------------------------------------------------------------- */

/** FAIXA DE DISTÂNCIA -- as linhas da tabela, na ordem do documento oficial. */
export const FAIXAS_DISTANCIA = [
  { id: "al_ate_100", rotulo: "Estado de AL até 100 km" },
  { id: "al_acima_100", rotulo: "Estado de AL acima de 100 km" },
  { id: "nordeste", rotulo: "Outros Estados do NE" },
  { id: "demais_regioes", rotulo: "Estados do N, S, SUD e C. Oeste" },
];

/** CATEGORIA DO CARGO -- as colunas da tabela, na ordem do documento oficial. */
export const CATEGORIAS_CARGO = [
  { id: "prefeito_vice", rotulo: "Prefeito e Vice" },
  { id: "secretarios", rotulo: "Secretários" },
  { id: "auditor_procurador", rotulo: "Auditor e Procurador Geral" },
  { id: "comissionados", rotulo: "Demais Cargos Comissionados" },
  { id: "outros_agentes", rotulo: "Outros Agentes" },
];

/**
 * O acréscimo do PERNOITE, em percentual.
 *
 * Os valores da tabela são SEM pernoite. Com pernoite, o valor unitário sobe
 * este percentual. Ele é CONFIGURÁVEL junto com a tabela -- fica gravado em
 * cada versão, e não escrito no código -- para que uma mudança de regra não
 * exija alteração de sistema. Este número é só o ponto de partida.
 */
export const PERNOITE_PADRAO = 30;

/** A memória do cálculo da atualização vigente na entrega desta tela. */
export const MEMORIA_CALCULO_PADRAO =
  "Variação do índice IGP-M entre 31-maio-2024 e 28-fevereiro-2026. "
  + "Em percentual: 5,716740%. Em fator de multiplicação: 1,05716740.";

/**
 * A tabela vigente informada pela prefeitura, atualizada em 23/03/2026.
 *
 * Os valores são SEM pernoite, na ordem das categorias acima. Ela é só o
 * PADRÃO: o cadastro em Configurações → Processos grava a versão de verdade no
 * banco, e é ela que o formulário passa a ler.
 */
export const TABELA_PADRAO = Object.freeze({
  titulo: "Tabela de Diárias",
  atualizada_em: "2026-03-23",
  pernoite_percentual: PERNOITE_PADRAO,
  memoria_calculo: MEMORIA_CALCULO_PADRAO,
  valores: {
    al_ate_100: { prefeito_vice: 597.7, secretarios: 271.67, auditor_procurador: 271.67, comissionados: 115.91, outros_agentes: 97.78 },
    al_acima_100: { prefeito_vice: 670.14, secretarios: 289.77, auditor_procurador: 289.77, comissionados: 159.37, outros_agentes: 119.54 },
    nordeste: { prefeito_vice: 796.84, secretarios: 398.48, auditor_procurador: 398.48, comissionados: 191.98, outros_agentes: 137.64 },
    demais_regioes: { prefeito_vice: 869.37, secretarios: 507.12, auditor_procurador: 507.12, comissionados: 326.03, outros_agentes: 217.33 },
  },
});

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

function texto(valor) {
  return String(valor ?? "").trim();
}

export function faixaInfo(id) {
  return FAIXAS_DISTANCIA.find((f) => f.id === texto(id)) ?? null;
}

export function categoriaInfo(id) {
  return CATEGORIAS_CARGO.find((c) => c.id === texto(id)) ?? null;
}

export function rotuloDaFaixa(id) {
  return faixaInfo(id)?.rotulo ?? "";
}

export function rotuloDaCategoria(id) {
  return categoriaInfo(id)?.rotulo ?? "";
}

/**
 * Uma tabela completa a partir do que veio do banco (ou de nada).
 *
 * Faixa ou categoria que o banco não tenha entra como 0: a tela mostra a célula
 * vazia para ser preenchida, em vez de quebrar. Campo desconhecido é ignorado --
 * a tabela tem as linhas e as colunas que o documento oficial tem.
 */
export function normalizarTabela(bruta) {
  const origem = bruta && typeof bruta === "object" ? bruta : {};
  const valoresBrutos = origem.valores && typeof origem.valores === "object" ? origem.valores : {};

  const valores = {};
  FAIXAS_DISTANCIA.forEach((faixa) => {
    const linha = valoresBrutos[faixa.id] ?? {};
    valores[faixa.id] = {};
    CATEGORIAS_CARGO.forEach((categoria) => {
      valores[faixa.id][categoria.id] = arredondar(paraNumeroMoeda(linha?.[categoria.id]));
    });
  });

  const percentual = Number(origem.pernoite_percentual);
  return {
    id: origem.id ?? null,
    titulo: texto(origem.titulo) || TABELA_PADRAO.titulo,
    atualizada_em: texto(origem.atualizada_em) || "",
    pernoite_percentual: Number.isFinite(percentual) && percentual >= 0 ? percentual : PERNOITE_PADRAO,
    memoria_calculo: texto(origem.memoria_calculo),
    valores,
  };
}

function arredondar(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 100) / 100;
}

/** O valor de uma célula da tabela, SEM pernoite. */
export function valorDaCelula(tabela, faixa, categoria) {
  const pronta = normalizarTabela(tabela);
  return arredondar(pronta.valores?.[texto(faixa)]?.[texto(categoria)] ?? 0);
}

/** O percentual de pernoite gravado na tabela (nunca escrito no código). */
export function percentualDePernoite(tabela) {
  return normalizarTabela(tabela).pernoite_percentual;
}

/**
 * O VALOR UNITÁRIO que a tabela dá para a escolha feita no formulário.
 *
 * Sem faixa ou sem categoria não há sugestão: devolve null, e o campo continua
 * como estava (digitado à mão, ou em branco). Com pernoite, o valor sobe o
 * percentual gravado NA TABELA -- não um número fixo aqui dentro.
 */
export function valorUnitarioDaTabela(tabela, { faixa, categoria, pernoite = false } = {}) {
  if (texto(faixa) === "" || texto(categoria) === "") return null;
  if (!faixaInfo(faixa) || !categoriaInfo(categoria)) return null;

  const base = valorDaCelula(tabela, faixa, categoria);
  if (!pernoite) return base;
  return arredondar(base * (1 + percentualDePernoite(tabela) / 100));
}

/**
 * O "Tipo de Diária" do documento impresso, composto pelas escolhas.
 *
 * "Estado de AL até 100 km — Outros Agentes — com pernoite".
 */
export function tipoDiariaComposto({ faixa, categoria, pernoite = false } = {}) {
  const partes = [rotuloDaFaixa(faixa), rotuloDaCategoria(categoria)].filter((p) => p !== "");
  if (partes.length === 0) return "";
  partes.push(pernoite ? "com pernoite" : "sem pernoite");
  return partes.join(" — ");
}

/* -------------------------------------------------------------------------
 * A identificação da versão
 * ---------------------------------------------------------------------- */

/** "23/03/2026" a partir de "2026-03-23" (ou o que estiver escrito). */
export function dataDaTabelaBR(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(valor));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : texto(valor);
}

/** "Tabela de Diárias — atualizada em 23/03/2026" (o título da tela e do cadastro). */
export function tituloDaTabela(tabela) {
  const pronta = normalizarTabela(tabela);
  const data = dataDaTabelaBR(pronta.atualizada_em);
  return data === "" ? pronta.titulo : `${pronta.titulo} — atualizada em ${data}`;
}

/**
 * A IDENTIFICAÇÃO DA VERSÃO que fica gravada dentro do processo.
 *
 * Leva a data da atualização e o id da linha no banco: é o que permite, anos
 * depois, dizer por qual versão da tabela aquele documento foi calculado --
 * mesmo que a tabela já tenha sido atualizada várias vezes desde então.
 */
export function identificacaoDaVersao(tabela) {
  const pronta = normalizarTabela(tabela);
  if (!pronta.atualizada_em && !pronta.id) return "";
  const titulo = tituloDaTabela(pronta);
  return pronta.id ? `${titulo} (versão ${String(pronta.id).slice(0, 8)})` : titulo;
}

/* -------------------------------------------------------------------------
 * Uso no processo
 * ---------------------------------------------------------------------- */

/**
 * Aplica a tabela ao formulário: valor unitário e "Tipo de Diária".
 *
 * Chamada quando a pessoa escolhe a faixa, a categoria ou o pernoite. O valor
 * unitário é preenchido a partir da tabela e o Tipo de Diária é recomposto --
 * as duas coisas que o item 5 pede.
 *
 * O VALOR UNITÁRIO CONTINUA EDITÁVEL À MÃO: quem digitar um valor próprio marca
 * `valor_unitario_manual`, e daí em diante a tabela não sobrescreve mais (a
 * alteração vai para a auditoria). Escolher outra faixa ou outra categoria é
 * uma decisão explícita: aí o valor da tabela volta a valer.
 */
export function aplicarTabelaDeDiarias(formulario, tabela, { forcarValor = false } = {}) {
  const base = { ...(formulario ?? {}) };
  const escolha = {
    faixa: base.diaria_faixa,
    categoria: base.diaria_categoria,
    pernoite: base.diaria_pernoite === true,
  };

  const composto = tipoDiariaComposto(escolha);
  if (composto !== "") base.tipo_diaria = composto;

  const sugerido = valorUnitarioDaTabela(tabela, escolha);
  if (sugerido === null) return base;
  if (base.valor_unitario_manual === true && !forcarValor) return base;

  base.valor_unitario = sugerido;
  base.valor_unitario_manual = false;
  return base;
}

/** O valor que a tabela daria para o formulário atual (para o aviso da tela). */
export function valorDaTabelaParaFormulario(formulario, tabela) {
  return valorUnitarioDaTabela(tabela, {
    faixa: formulario?.diaria_faixa,
    categoria: formulario?.diaria_categoria,
    pernoite: formulario?.diaria_pernoite === true,
  });
}

/** true quando o valor unitário digitado à mão discorda da tabela. */
export function unitarioDivergeDaTabela(formulario, tabela) {
  if (formulario?.valor_unitario_manual !== true) return false;
  const daTabela = valorDaTabelaParaFormulario(formulario, tabela);
  if (daTabela === null) return false;
  return paraNumeroMoeda(formulario?.valor_unitario) !== daTabela;
}

/**
 * ⚠️ O CONGELAMENTO: o que fica gravado DENTRO do processo ao finalizar.
 *
 * Valor unitário utilizado, faixa, categoria, percentual de pernoite e a
 * identificação da versão da tabela vigente NAQUELE momento. É isto que faz com
 * que atualizar a tabela depois não altere -- e não possa alterar -- nenhum
 * processo já criado ou finalizado: o documento não consulta mais a tabela, ele
 * consulta o que está dentro dele.
 */
export function congelarTabelaNoProcesso(formulario, tabela) {
  const pronta = normalizarTabela(tabela);
  return {
    diaria_valor_unitario: paraNumeroMoeda(formulario?.valor_unitario),
    diaria_faixa: texto(formulario?.diaria_faixa) || null,
    diaria_categoria: texto(formulario?.diaria_categoria) || null,
    diaria_pernoite: formulario?.diaria_pernoite === true,
    diaria_pernoite_percentual: pronta.pernoite_percentual,
    diaria_tabela_versao: identificacaoDaVersao(pronta) || null,
    diaria_tabela_id: pronta.id ?? null,
  };
}

/** true quando o processo já carrega a tabela congelada dentro dele. */
export function temTabelaCongelada(processo) {
  return texto(processo?.diaria_tabela_versao) !== "" || processo?.diaria_valor_unitario != null;
}

/**
 * A frase que a tela mostra sobre a origem do valor de um processo congelado.
 *
 * Existe para que ninguém precise adivinhar por que um processo de 2025 tem um
 * valor diferente do que a tabela de hoje daria.
 */
export function textoDaOrigemDoValor(processo) {
  if (!temTabelaCongelada(processo)) return "";
  const partes = [];
  const faixa = rotuloDaFaixa(processo?.diaria_faixa);
  const categoria = rotuloDaCategoria(processo?.diaria_categoria);
  if (faixa) partes.push(faixa);
  if (categoria) partes.push(categoria);
  partes.push(processo?.diaria_pernoite === true
    ? `com pernoite (+${textoPercentual(processo?.diaria_pernoite_percentual)})`
    : "sem pernoite");

  const valor = formatBRL(paraNumeroMoeda(processo?.diaria_valor_unitario ?? processo?.valor_unitario));
  const versao = texto(processo?.diaria_tabela_versao);
  const fim = versao === "" ? "" : ` — ${versao}`;
  return `Valor unitário ${valor}: ${partes.join(" · ")}${fim}`;
}

/** "30%" ou "27,5%" -- o percentual como o brasileiro escreve. */
export function textoPercentual(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "";
  const texto = numero.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return `${texto}%`;
}

/* -------------------------------------------------------------------------
 * Edição da tabela
 * ---------------------------------------------------------------------- */

export const LIMITE_PERNOITE = { minimo: 0, maximo: 200 };
export const LIMITE_VALOR_DIARIA = 100000;

/**
 * Confere a tabela antes de gravar uma versão nova.
 *
 * Valor negativo e percentual fora da faixa são recusados: a tabela é o
 * parâmetro que sugere valores de pagamento, e não pode virar um número
 * impossível por um erro de digitação.
 */
export function validarTabela(tabela) {
  const erros = {};
  const pronta = normalizarTabela(tabela);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pronta.atualizada_em)) {
    erros.atualizada_em = "Informe a data desta atualização da tabela.";
  }
  if (pronta.titulo === "") erros.titulo = "Informe o título da tabela.";

  const percentual = Number(tabela?.pernoite_percentual);
  if (!Number.isFinite(percentual) || percentual < LIMITE_PERNOITE.minimo || percentual > LIMITE_PERNOITE.maximo) {
    erros.pernoite_percentual =
      `O acréscimo do pernoite deve ficar entre ${LIMITE_PERNOITE.minimo}% e ${LIMITE_PERNOITE.maximo}%.`;
  }

  FAIXAS_DISTANCIA.forEach((faixa) => {
    CATEGORIAS_CARGO.forEach((categoria) => {
      const valor = pronta.valores[faixa.id][categoria.id];
      if (valor < 0 || valor > LIMITE_VALOR_DIARIA) {
        erros[`${faixa.id}.${categoria.id}`] =
          `${faixa.rotulo} · ${categoria.rotulo}: valor fora do razoável.`;
      }
    });
  });

  return erros;
}

export function primeiroErroDaTabela(erros) {
  const chaves = Object.keys(erros ?? {});
  return chaves.length === 0 ? null : erros[chaves[0]];
}

/**
 * O que mudou entre duas versões, para a auditoria gravar o ANTES e o DEPOIS.
 *
 * Devolve `{ anterior, novo }` no formato que a comparação da tela de Auditoria
 * já sabe ler -- célula a célula, mais o percentual, a data e a memória.
 */
export function diferencaDaTabela(anterior, nova) {
  const de = normalizarTabela(anterior);
  const para = normalizarTabela(nova);
  const antes = {};
  const depois = {};

  ["titulo", "atualizada_em", "pernoite_percentual", "memoria_calculo"].forEach((campo) => {
    if (de[campo] === para[campo]) return;
    antes[campo] = de[campo];
    depois[campo] = para[campo];
  });

  FAIXAS_DISTANCIA.forEach((faixa) => {
    CATEGORIAS_CARGO.forEach((categoria) => {
      const valorDe = de.valores[faixa.id][categoria.id];
      const valorPara = para.valores[faixa.id][categoria.id];
      if (valorDe === valorPara) return;
      const chave = `${faixa.rotulo} · ${categoria.rotulo}`;
      antes[chave] = formatBRL(valorDe);
      depois[chave] = formatBRL(valorPara);
    });
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}

/**
 * A tabela em linhas prontas para a tela: faixa × categoria, com e sem pernoite.
 *
 * Todo dinheiro sai por `formatBRL`, o mesmo utilitário do resto do sistema --
 * R$ 1.234,56, sem formatação própria desta tela.
 */
export function linhasDaTabela(tabela) {
  const pronta = normalizarTabela(tabela);
  return FAIXAS_DISTANCIA.map((faixa) => ({
    faixa: faixa.id,
    rotulo: faixa.rotulo,
    celulas: CATEGORIAS_CARGO.map((categoria) => {
      const base = pronta.valores[faixa.id][categoria.id];
      const comPernoite = arredondar(base * (1 + pronta.pernoite_percentual / 100));
      return {
        categoria: categoria.id,
        rotulo: categoria.rotulo,
        valor: base,
        texto: formatBRL(base),
        valorComPernoite: comPernoite,
        textoComPernoite: formatBRL(comPernoite),
      };
    }),
  }));
}
