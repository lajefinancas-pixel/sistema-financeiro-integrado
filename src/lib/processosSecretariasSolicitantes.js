// O cadastro das SECRETARIAS SOLICITANTES do módulo Processos.
//
// ⚠️ ESTE CADASTRO NÃO É O CADASTRO DE SECRETARIAS DO MÓDULO FINANCEIRO. São
// dois cadastros que passam a coexistir, cada um com a sua finalidade:
//
//   · `public.secretarias` continua sendo o cadastro FINANCEIRO, usado em contas
//     bancárias, fornecedores, Saldos, Pagamentos e relatórios. Nada aqui o
//     altera, o mescla ou o apaga.
//   · `public.processos_secretarias_solicitantes` é o cadastro DOCUMENTAL: quem
//     REQUISITA a diária. Quem requisita quase nunca é quem paga, e é por isso
//     que a lista é outra.
//
// Ele guarda também QUEM RESPONDE pela secretaria — secretário(a), CPF e cargo —
// porque é essa pessoa que assina a requisição. Escolher a secretaria no
// processo traz esses dados prontos para o documento.
//
// ⚠️ O CONGELAMENTO CONTINUA VALENDO. O processo grava dentro dele o nome da
// secretaria e os dados do secretário vigentes no momento; trocar o secretário
// depois NÃO reescreve documento antigo.
//
// Documental, não financeiro: nada aqui debita conta, dá baixa em NF, altera
// saldo ou cria pagamento.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

import { cpfFormatado, somenteDigitos } from "./processosServidores.js";

export const TABELA_SOLICITANTES = "processos_secretarias_solicitantes";

/** A migration que cria o cadastro. Rodada À MÃO no SQL Editor do Supabase. */
export const MIGRATION_SOLICITANTES = "20260911240000_processos_solicitantes_e_bancos.sql";

export const AVISO_MIGRATION_SOLICITANTES =
  `O cadastro de Secretarias Solicitantes ainda não existe neste banco. Rode a migration ${MIGRATION_SOLICITANTES} `
  + "no SQL Editor do Supabase e recarregue a página. Enquanto isso, os processos já criados continuam abrindo "
  + "normalmente com a secretaria que gravaram.";

export const SITUACOES_SOLICITANTE = [
  { id: "ativo", rotulo: "Ativo" },
  { id: "inativo", rotulo: "Inativo" },
];

/** Os campos de texto do cadastro, na ordem do formulário. */
export const CAMPOS_SOLICITANTE = ["nome", "nome_curto", "secretario", "secretario_cpf", "secretario_cargo"];

export const ROTULOS_SOLICITANTE = {
  nome: "Nome oficial",
  nome_curto: "Nome curto",
  secretario: "Secretário(a) responsável",
  secretario_cpf: "CPF do(a) secretário(a)",
  secretario_cargo: "Cargo/Função",
  situacao: "Situação",
};

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return texto(valor) === "";
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function solicitanteVazio() {
  const formulario = { id: null, situacao: "ativo" };
  CAMPOS_SOLICITANTE.forEach((campo) => {
    formulario[campo] = "";
  });
  return formulario;
}

export function solicitanteParaFormulario(solicitante) {
  const base = solicitante ?? {};
  const formulario = solicitanteVazio();
  formulario.id = base.id ?? null;
  formulario.situacao = texto(base.situacao) || "ativo";
  CAMPOS_SOLICITANTE.forEach((campo) => {
    formulario[campo] = texto(base[campo]);
  });
  return formulario;
}

export function solicitanteParaBanco(formulario) {
  const base = formulario ?? {};
  const linha = {};
  CAMPOS_SOLICITANTE.forEach((campo) => {
    linha[campo] = vazio(base[campo]) ? null : texto(base[campo]);
  });
  // O nome oficial é obrigatório; o resto entra como null quando em branco.
  linha.nome = texto(base.nome);
  if (linha.secretario_cpf) linha.secretario_cpf = cpfFormatado(linha.secretario_cpf);
  return linha;
}

/** O rótulo curto, para listas e filtros: "Educação" em vez do nome inteiro. */
export function rotuloDoSolicitante(solicitante) {
  return texto(solicitante?.nome_curto) || texto(solicitante?.nome);
}

/** O nome que vai IMPRESSO no documento: sempre o oficial. */
export function nomeOficialDoSolicitante(solicitante) {
  return texto(solicitante?.nome) || texto(solicitante?.nome_curto);
}

export function nomeEmUso(solicitantes = [], nome, { ignorarId = null } = {}) {
  const procurado = semAcento(nome);
  if (procurado === "") return null;
  return (solicitantes ?? []).find((s) => {
    if (ignorarId !== null && String(s?.id) === String(ignorarId)) return false;
    return semAcento(s?.nome) === procurado;
  }) ?? null;
}

export function validarSolicitante(formulario, { solicitantes = [] } = {}) {
  const base = formulario ?? {};
  const erros = {};

  if (vazio(base.nome)) erros.nome = "Informe o nome oficial da secretaria.";
  else if (nomeEmUso(solicitantes, base.nome, { ignorarId: base.id ?? null })) {
    erros.nome = "Já existe uma secretaria solicitante com este nome.";
  }

  const digitos = somenteDigitos(base.secretario_cpf);
  if (digitos !== "" && digitos.length !== 11) {
    erros.secretario_cpf = "O CPF do(a) secretário(a) precisa ter 11 dígitos.";
  }

  return erros;
}

export function solicitanteAtendeBusca(solicitante, termo) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;
  return [
    solicitante?.nome,
    solicitante?.nome_curto,
    solicitante?.secretario,
    solicitante?.secretario_cpf,
    solicitante?.secretario_cargo,
  ].some((campo) => semAcento(campo).includes(procurado));
}

export function ordenarSolicitantes(solicitantes = []) {
  return [...(solicitantes ?? [])].sort((a, b) =>
    semAcento(nomeOficialDoSolicitante(a)).localeCompare(semAcento(nomeOficialDoSolicitante(b))));
}

export function solicitantesAtivos(solicitantes = []) {
  return (solicitantes ?? []).filter((s) => texto(s?.situacao) !== "inativo");
}

export function filtrarSolicitantes(solicitantes = [], { busca = "", situacao = "" } = {}) {
  const situacaoProcurada = texto(situacao);
  return ordenarSolicitantes(
    (solicitantes ?? []).filter((s) => {
      if (situacaoProcurada !== "" && texto(s?.situacao) !== situacaoProcurada) return false;
      return solicitanteAtendeBusca(s, busca);
    }),
  );
}

/**
 * O que a escolha da secretaria solicitante leva para o documento.
 *
 * Nome oficial, secretário(a), CPF e cargo saem PRONTOS — é o que o comando
 * pede. Os quatro ficam GRAVADOS no processo: é o congelamento, e é ele que
 * garante que trocar o secretário amanhã não reescreva o documento de hoje.
 */
export function dadosDoSolicitanteParaDocumento(solicitante) {
  if (!solicitante) return { solicitante_id: null };
  return {
    solicitante_id: solicitante.id ?? null,
    solicitante_nome: nomeOficialDoSolicitante(solicitante),
    solicitante_secretario: texto(solicitante.secretario),
    solicitante_secretario_cpf: texto(solicitante.secretario_cpf),
    solicitante_secretario_cargo: texto(solicitante.secretario_cargo),
  };
}

/** As colunas que o processo grava com os dados congelados da solicitante. */
export const CAMPOS_SOLICITANTE_NO_PROCESSO = [
  "solicitante_nome",
  "solicitante_secretario",
  "solicitante_secretario_cpf",
  "solicitante_secretario_cargo",
];

export function encontrarSolicitante(solicitantes = [], id) {
  const procurado = String(id ?? "");
  if (procurado === "") return null;
  return (solicitantes ?? []).find((s) => String(s?.id) === procurado) ?? null;
}

/**
 * A lista única de secretarias que as telas usam para RESOLVER NOME e FILTRAR.
 *
 * As solicitantes vêm primeiro, porque são as do módulo. As financeiras entram
 * depois só para que processo ANTIGO — gravado antes deste cadastro existir —
 * continue mostrando a secretaria dele, como sempre mostrou. Nenhuma das duas
 * listas é alterada aqui: é leitura.
 */
export function listaDeSecretariasDoProcesso(solicitantes = [], secretariasFinanceiras = []) {
  const lista = [];
  const vistos = new Set();

  ordenarSolicitantes(solicitantes).forEach((s) => {
    const id = String(s?.id ?? "");
    if (id === "" || vistos.has(id)) return;
    vistos.add(id);
    lista.push({ id: s.id, nome: nomeOficialDoSolicitante(s), solicitante: true });
  });

  (secretariasFinanceiras ?? []).forEach((s) => {
    const id = String(s?.id ?? "");
    if (id === "" || vistos.has(id)) return;
    vistos.add(id);
    lista.push({ id: s.id, nome: texto(s?.nome), solicitante: false });
  });

  return lista;
}

export function diferencaDoSolicitante(anterior, novo) {
  const de = anterior ?? {};
  const para = novo ?? {};
  const antes = {};
  const depois = {};

  Object.keys(ROTULOS_SOLICITANTE).forEach((campo) => {
    const valorDe = texto(de[campo]);
    const valorPara = texto(para[campo]);
    if (valorDe === valorPara) return;
    antes[campo] = valorDe;
    depois[campo] = valorPara;
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}
