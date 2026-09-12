// O cadastro da CHEFE DO PODER EXECUTIVO — a PREFEITA — do módulo Processos.
//
// POR QUE EXISTE: os documentos do módulo identificam quem AUTORIZA. A área
// "Autorização da prefeita — CIENTE/AUTORIZO" e a identificação embaixo da
// linha de assinatura (Nome, CPF, Cargo) eram preenchidas à mão, processo por
// processo. Com o cadastro, elas saem prontas do documento, sem redigitação.
//
// ⚠️ O CONGELAMENTO VALE AQUI COMO VALE PARA O SECRETÁRIO. Ao FINALIZAR, o
// processo grava dentro de si o nome, o CPF e o cargo da prefeita vigentes
// NAQUELE momento (coluna `prefeita`). Trocar o cadastro depois -- mudança de
// gestão, inclusive -- NÃO altera, e não consegue alterar, nenhum documento já
// finalizado: o gatilho do banco recusa a reescrita do que foi congelado.
//
// ⚠️ PERMISSÃO PRÓPRIA E RESTRITA: editar este cadastro é o módulo
// 'processos_prefeita', ação editar. Quem preenche um processo NÃO passa a poder
// trocar quem autoriza os documentos do município. Visualizar acompanha quem vê
// o módulo Processos, porque o documento precisa do nome para imprimir.
//
// Documental, como todo o módulo: nada aqui debita conta, dá baixa em NF, altera
// saldo, marca fornecedor como pago, cria pagamento ou mexe na Programação Diária.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

import { cpfFormatado, somenteDigitos } from "./processosServidores.js";

export const TABELA_PREFEITA = "processos_prefeita";

/** A migration que cria o cadastro. Rodada À MÃO no SQL Editor do Supabase. */
export const MIGRATION_PREFEITA = "20260912140000_processos_prefeita.sql";

export const AVISO_MIGRATION_PREFEITA =
  `O cadastro da prefeita ainda não existe neste banco. Rode a migration ${MIGRATION_PREFEITA} `
  + "no SQL Editor do Supabase e recarregue a página. Enquanto isso, os documentos continuam saindo "
  + "com a linha de assinatura em branco, como saíam antes.";

/** O cargo que o cadastro sugere; editável, porque quem assina pode ser outro. */
export const CARGO_PADRAO_PREFEITA = "Prefeita Municipal";

/** Módulo de permissão PRÓPRIO do cadastro. */
export const MODULO_PREFEITA = "processos_prefeita";

export const SITUACOES_PREFEITA = [
  { id: "ativo", rotulo: "Ativo" },
  { id: "inativo", rotulo: "Inativo" },
];

/** Os campos do cadastro, na ordem do formulário. */
export const CAMPOS_PREFEITA = ["nome", "cpf", "cargo", "vigencia_inicio", "vigencia_fim"];

export const ROTULOS_PREFEITA = {
  nome: "Nome completo",
  cpf: "CPF",
  cargo: "Cargo",
  vigencia_inicio: "Início da vigência",
  vigencia_fim: "Fim da vigência",
  situacao: "Situação",
};

/** O tamanho máximo dos textos, para que caibam na linha do documento. */
export const LIMITE_TEXTO_PREFEITA = 120;

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return texto(valor) === "";
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** "2026-09-12" a partir de Date ou de texto ISO. Vazio quando não há data. */
function diaISO(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }
  const bruto = texto(valor);
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  return partes ? `${partes[1]}-${partes[2]}-${partes[3]}` : "";
}

/** "12/09/2026" para a tela. Vazio quando não há data. */
export function dataDaVigenciaBR(valor) {
  const iso = diaISO(valor);
  if (iso === "") return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function prefeitaVazia() {
  const formulario = { id: null, situacao: "ativo" };
  CAMPOS_PREFEITA.forEach((campo) => {
    formulario[campo] = "";
  });
  formulario.cargo = CARGO_PADRAO_PREFEITA;
  return formulario;
}

export function prefeitaParaFormulario(prefeita) {
  const base = prefeita ?? {};
  const formulario = prefeitaVazia();
  if (!prefeita) return formulario;
  formulario.id = base.id ?? null;
  formulario.situacao = texto(base.situacao) || "ativo";
  formulario.nome = texto(base.nome);
  formulario.cpf = texto(base.cpf);
  formulario.cargo = texto(base.cargo) || CARGO_PADRAO_PREFEITA;
  formulario.vigencia_inicio = diaISO(base.vigencia_inicio);
  formulario.vigencia_fim = diaISO(base.vigencia_fim);
  return formulario;
}

export function prefeitaParaBanco(formulario) {
  const base = formulario ?? {};
  return {
    nome: texto(base.nome),
    cpf: vazio(base.cpf) ? null : cpfFormatado(base.cpf),
    cargo: texto(base.cargo) || CARGO_PADRAO_PREFEITA,
    // Vigência é OPCIONAL nos dois lados: em branco significa "sem data
    // definida", e o cadastro continua valendo enquanto estiver ativo.
    vigencia_inicio: vazio(base.vigencia_inicio) ? null : diaISO(base.vigencia_inicio),
    vigencia_fim: vazio(base.vigencia_fim) ? null : diaISO(base.vigencia_fim),
    situacao: texto(base.situacao) === "inativo" ? "inativo" : "ativo",
  };
}

export function validarPrefeita(formulario) {
  const base = formulario ?? {};
  const erros = {};

  if (vazio(base.nome)) erros.nome = "Informe o nome completo de quem chefia o Poder Executivo.";
  else if (texto(base.nome).length > LIMITE_TEXTO_PREFEITA) {
    erros.nome = `Este nome passa de ${LIMITE_TEXTO_PREFEITA} caracteres e não caberia na folha.`;
  }

  const digitos = somenteDigitos(base.cpf);
  if (digitos === "") erros.cpf = "Informe o CPF: ele sai impresso na identificação do documento.";
  else if (digitos.length !== 11) erros.cpf = "O CPF precisa ter 11 dígitos.";

  if (vazio(base.cargo)) erros.cargo = "Informe o cargo (por exemplo, Prefeita Municipal).";
  else if (texto(base.cargo).length > LIMITE_TEXTO_PREFEITA) {
    erros.cargo = `Este cargo passa de ${LIMITE_TEXTO_PREFEITA} caracteres e não caberia na folha.`;
  }

  const inicio = diaISO(base.vigencia_inicio);
  const fim = diaISO(base.vigencia_fim);
  if (!vazio(base.vigencia_inicio) && inicio === "") {
    erros.vigencia_inicio = "Informe uma data válida para o início da vigência.";
  }
  if (!vazio(base.vigencia_fim) && fim === "") {
    erros.vigencia_fim = "Informe uma data válida para o fim da vigência.";
  }
  if (inicio !== "" && fim !== "" && fim < inicio) {
    erros.vigencia_fim = "O fim da vigência não pode ser anterior ao início.";
  }

  return erros;
}

export function primeiroErroDaPrefeita(formulario) {
  const erros = validarPrefeita(formulario);
  const campo = ["nome", "cpf", "cargo", "vigencia_inicio", "vigencia_fim"].find((c) => erros[c]);
  return campo ? erros[campo] : null;
}

/** O cadastro está dentro da vigência na data informada? Sem datas, está. */
export function dentroDaVigencia(prefeita, { hoje = new Date() } = {}) {
  const dia = diaISO(hoje) || diaISO(new Date());
  const inicio = diaISO(prefeita?.vigencia_inicio);
  const fim = diaISO(prefeita?.vigencia_fim);
  if (inicio !== "" && dia < inicio) return false;
  if (fim !== "" && dia > fim) return false;
  return true;
}

export function prefeitaAtiva(prefeita) {
  return texto(prefeita?.situacao) !== "inativo";
}

/**
 * A prefeita VIGENTE: a ativa que está dentro da vigência hoje.
 *
 * Havendo mais de uma (mudança de gestão cadastrada com antecedência, por
 * exemplo), vence a de início MAIS RECENTE -- é a posse mais nova. Cadastro
 * inativo nunca é vigente, e cadastro fora do período também não: o documento
 * prefere sair com a linha em branco a sair com quem não estava no cargo.
 */
export function prefeitaVigente(prefeitas = [], { hoje = new Date() } = {}) {
  const candidatas = (prefeitas ?? [])
    .filter(Boolean)
    .filter((p) => prefeitaAtiva(p) && dentroDaVigencia(p, { hoje }));
  if (candidatas.length === 0) return null;

  return [...candidatas].sort((a, b) => {
    const inicioA = diaISO(a?.vigencia_inicio);
    const inicioB = diaISO(b?.vigencia_inicio);
    if (inicioA !== inicioB) return inicioB.localeCompare(inicioA);
    // Empate de início: a cadastrada por último, que é a informação mais nova.
    return texto(b?.criado_em).localeCompare(texto(a?.criado_em));
  })[0];
}

export function ordenarPrefeitas(prefeitas = []) {
  return [...(prefeitas ?? [])].filter(Boolean).sort((a, b) => {
    const ativaA = prefeitaAtiva(a) ? 0 : 1;
    const ativaB = prefeitaAtiva(b) ? 0 : 1;
    if (ativaA !== ativaB) return ativaA - ativaB;
    const inicioA = diaISO(a?.vigencia_inicio);
    const inicioB = diaISO(b?.vigencia_inicio);
    if (inicioA !== inicioB) return inicioB.localeCompare(inicioA);
    return semAcento(a?.nome).localeCompare(semAcento(b?.nome));
  });
}

/** O período em texto, para a tela: "de 01/01/2025 até 31/12/2028". */
export function textoDaVigencia(prefeita) {
  const inicio = dataDaVigenciaBR(prefeita?.vigencia_inicio);
  const fim = dataDaVigenciaBR(prefeita?.vigencia_fim);
  if (inicio === "" && fim === "") return "Sem período definido";
  if (inicio !== "" && fim === "") return `A partir de ${inicio}`;
  if (inicio === "" && fim !== "") return `Até ${fim}`;
  return `De ${inicio} até ${fim}`;
}

/* -------------------------------------------------------------------------
 * ⚠️ O congelamento
 * ---------------------------------------------------------------------- */

/**
 * O que o DOCUMENTO recebe: nome, CPF e cargo, prontos para imprimir.
 *
 * Sem cadastro vigente, os três voltam vazios e a folha sai como saía antes --
 * com a linha de assinatura e a identificação em branco, para preencher à mão.
 */
export function dadosDaPrefeitaParaDocumento(prefeita) {
  if (!prefeita) return { nome: "", cpf: "", cargo: "" };
  return {
    nome: texto(prefeita.nome),
    cpf: texto(prefeita.cpf) === "" ? "" : cpfFormatado(prefeita.cpf),
    cargo: texto(prefeita.cargo),
  };
}

/**
 * O que é gravado DENTRO do processo ao finalizar.
 *
 * Só os três campos que o papel imprime. A vigência e a situação não entram: o
 * documento não os mostra, e o que importa guardar é a identificação que saiu
 * impressa naquele dia.
 */
export function congelarPrefeitaNoProcesso(prefeita) {
  const dados = dadosDaPrefeitaParaDocumento(prefeita);
  if (dados.nome === "" && dados.cpf === "" && dados.cargo === "") return {};
  return { prefeita: dados };
}

/** true quando o processo já carrega a prefeita congelada. */
export function temPrefeitaCongelada(processo) {
  const congelada = processo?.prefeita;
  return Boolean(congelada && typeof congelada === "object" && texto(congelada.nome) !== "");
}

/**
 * A prefeita que um processo IMPRIME.
 *
 * Processo com a prefeita congelada imprime a CONGELADA, sempre -- é o que
 * garante que a mudança de gestão não reescreva o documento assinado na gestão
 * anterior. Processo ainda sem congelamento (rascunho, ou anterior a esta
 * entrega) imprime a vigente do cadastro.
 */
export function prefeitaDoProcesso(processo, prefeitaAtual) {
  if (temPrefeitaCongelada(processo)) return dadosDaPrefeitaParaDocumento(processo.prefeita);
  return dadosDaPrefeitaParaDocumento(prefeitaAtual);
}

export function diferencaDaPrefeita(anterior, novo) {
  const de = anterior ?? {};
  const para = novo ?? {};
  const antes = {};
  const depois = {};

  Object.keys(ROTULOS_PREFEITA).forEach((campo) => {
    const valorDe = texto(de[campo]);
    const valorPara = texto(para[campo]);
    if (valorDe === valorPara) return;
    antes[campo] = valorDe;
    depois[campo] = valorPara;
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}

/* -------------------------------------------------------------------------
 * Permissão
 * ---------------------------------------------------------------------- */

export const ACOES_PREFEITA = [
  { chave: "visualizar", coluna: "pode_visualizar", rotulo: "Consultar o cadastro" },
  { chave: "editar", coluna: "pode_editar", rotulo: "Editar o cadastro da prefeita" },
];

export const PERMISSOES_PREFEITA_NENHUMA = Object.freeze(
  Object.fromEntries(ACOES_PREFEITA.map((acao) => [acao.chave, false])),
);

/**
 * As permissões do cadastro a partir das linhas de `permissoes_efetivas`.
 *
 * EDITAR NÃO SE HERDA: sem a linha do módulo próprio, ninguém edita. É o mesmo
 * desenho da Tabela de Diárias, e pelo mesmo motivo -- trocar quem autoriza os
 * documentos do município não acompanha quem preenche processo.
 */
export function resolverPermissoesPrefeita({ linhas = [] } = {}) {
  const linha = (linhas ?? []).filter(Boolean).find((l) => String(l.modulo) === MODULO_PREFEITA) ?? null;
  if (!linha) return { ...PERMISSOES_PREFEITA_NENHUMA };
  const resultado = {};
  ACOES_PREFEITA.forEach((acao) => {
    resultado[acao.chave] = linha[acao.coluna] === true;
  });
  return resultado;
}

/** Ver o cadastro acompanha quem vê o módulo Processos. */
export function podeVerPrefeita(permissoes) {
  return permissoes?.visualizar === true;
}

/** Editar exige a permissão restrita do módulo próprio. */
export function podeEditarPrefeita(permissoes) {
  return permissoes?.editar === true;
}
