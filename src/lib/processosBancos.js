// O cadastro de BANCOS do módulo Processos: número e nome.
//
// Antes o banco era texto livre nos dados bancários do servidor, e cada pessoa
// escrevia de um jeito ("BB", "Banco do Brasil", "001"). Agora é uma LISTA com
// busca, e o documento sai no formato do modelo oficial: "001 — Banco do Brasil".
//
// O cadastro é do módulo Processos e é ADITIVO: novos bancos entram pela tela de
// Configurações → Processos, sem deploy. Ele NÃO é o card "Bancos utilizados" do
// módulo financeiro, que continua sendo o que é — uma leitura das contas
// bancárias cadastradas — e não é tocado aqui.
//
// ⚠️ O número e o nome são GRAVADOS no processo e no cadastro do servidor como
// texto. Não há chave estrangeira para cá: corrigir ou inativar um banco no
// cadastro nunca reescreve documento já emitido.
//
// Documental, não financeiro: nada aqui debita conta, dá baixa em NF, altera
// saldo ou cria pagamento.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

export const TABELA_BANCOS = "processos_bancos";

/** A migration que cria o cadastro. Rodada À MÃO no SQL Editor do Supabase. */
export const MIGRATION_BANCOS = "20260911240000_processos_solicitantes_e_bancos.sql";

export const AVISO_MIGRATION_BANCOS =
  `O cadastro de Bancos ainda não existe neste banco. Rode a migration ${MIGRATION_BANCOS} no SQL Editor do `
  + "Supabase e recarregue a página. Enquanto isso, o banco continua podendo ser digitado à mão, como antes.";

export const SITUACOES_BANCO = [
  { id: "ativo", rotulo: "Ativo" },
  { id: "inativo", rotulo: "Inativo" },
];

/**
 * Os bancos mais usados pela prefeitura, já semeados pela migration.
 *
 * A lista não é fechada: o cadastro aceita qualquer outro banco pela tela.
 */
export const BANCOS_INICIAIS = Object.freeze([
  { numero: "001", nome: "Banco do Brasil" },
  { numero: "104", nome: "Caixa Econômica Federal" },
  { numero: "237", nome: "Bradesco" },
  { numero: "341", nome: "Itaú" },
  { numero: "033", nome: "Santander" },
  { numero: "756", nome: "Sicoob" },
  { numero: "748", nome: "Sicredi" },
  { numero: "077", nome: "Banco Inter" },
  { numero: "260", nome: "Nu Pagamentos" },
  { numero: "336", nome: "Banco C6" },
]);

export const ROTULOS_BANCO = {
  numero: "Número do banco",
  nome: "Nome do banco",
  situacao: "Situação",
};

/** O separador entre número e nome no documento, como no modelo oficial. */
export const SEPARADOR_BANCO = " — ";

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return texto(valor) === "";
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function somenteDigitosDoBanco(valor) {
  return texto(valor).replace(/\D/g, "");
}

/**
 * O número do banco com os três dígitos do padrão bancário: 1 → "001", 33 → "033".
 *
 * Número com mais de três dígitos é preservado como está — alguns códigos de
 * instituição de pagamento passam de três.
 */
export function numeroDoBancoFormatado(valor) {
  const digitos = somenteDigitosDoBanco(valor);
  if (digitos === "") return "";
  return digitos.length >= 3 ? digitos : digitos.padStart(3, "0");
}

export function bancoVazio() {
  return { id: null, numero: "", nome: "", situacao: "ativo" };
}

export function bancoParaFormulario(banco) {
  const base = banco ?? {};
  return {
    id: base.id ?? null,
    numero: texto(base.numero),
    nome: texto(base.nome),
    situacao: texto(base.situacao) || "ativo",
  };
}

export function bancoParaBanco(formulario) {
  const base = formulario ?? {};
  return {
    numero: numeroDoBancoFormatado(base.numero),
    nome: texto(base.nome),
  };
}

export function numeroEmUso(bancos = [], numero, { ignorarId = null } = {}) {
  const procurado = numeroDoBancoFormatado(numero);
  if (procurado === "") return null;
  return (bancos ?? []).find((b) => {
    if (ignorarId !== null && String(b?.id) === String(ignorarId)) return false;
    return numeroDoBancoFormatado(b?.numero) === procurado;
  }) ?? null;
}

export function validarBanco(formulario, { bancos = [] } = {}) {
  const base = formulario ?? {};
  const erros = {};

  const digitos = somenteDigitosDoBanco(base.numero);
  if (digitos === "") erros.numero = "Informe o número do banco (por exemplo 001).";
  else if (digitos.length > 5) erros.numero = "O número do banco tem no máximo 5 dígitos.";
  else if (numeroEmUso(bancos, base.numero, { ignorarId: base.id ?? null })) {
    erros.numero = "Já existe um banco cadastrado com este número.";
  }

  if (vazio(base.nome)) erros.nome = "Informe o nome do banco.";

  return erros;
}

/** "001 — Banco do Brasil": o rótulo da lista e o que sai no documento. */
export function rotuloDoBanco(banco) {
  const numero = numeroDoBancoFormatado(banco?.numero);
  const nome = texto(banco?.nome);
  if (numero === "" && nome === "") return "";
  if (numero === "") return nome;
  if (nome === "") return numero;
  return `${numero}${SEPARADOR_BANCO}${nome}`;
}

/**
 * O banco IMPRESSO, lido do que o registro gravou.
 *
 * Registro antigo só tem o nome em texto livre e continua saindo com ele — sem
 * o número, porque ninguém escolheu um número naquela época.
 */
export function bancoDoDocumento(registro) {
  return rotuloDoBanco({ numero: registro?.banco_codigo, nome: registro?.banco });
}

export function bancoAtendeBusca(banco, termo) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;
  const digitos = somenteDigitosDoBanco(termo);
  if (digitos !== "" && numeroDoBancoFormatado(banco?.numero).includes(digitos)) return true;
  return [banco?.numero, banco?.nome, rotuloDoBanco(banco)]
    .some((campo) => semAcento(campo).includes(procurado));
}

export function ordenarBancos(bancos = []) {
  return [...(bancos ?? [])].sort((a, b) =>
    numeroDoBancoFormatado(a?.numero).localeCompare(numeroDoBancoFormatado(b?.numero)));
}

export function bancosAtivos(bancos = []) {
  return (bancos ?? []).filter((b) => texto(b?.situacao) !== "inativo");
}

/**
 * A lista da caixa de busca: só os ATIVOS, mais o que o registro já gravou.
 *
 * O banco que o servidor já tem gravado continua aparecendo mesmo depois de ser
 * inativado no cadastro — senão a tela pareceria ter perdido o dado.
 */
export function bancosParaEscolha(bancos = [], { manterCodigo = "" } = {}) {
  const manter = numeroDoBancoFormatado(manterCodigo);
  return ordenarBancos(
    (bancos ?? []).filter((b) =>
      texto(b?.situacao) !== "inativo"
      || (manter !== "" && numeroDoBancoFormatado(b?.numero) === manter)),
  );
}

export function filtrarBancos(bancos = [], { busca = "", situacao = "", limite = 0 } = {}) {
  const situacaoProcurada = texto(situacao);
  const encontrados = ordenarBancos(
    (bancos ?? []).filter((b) => {
      if (situacaoProcurada !== "" && texto(b?.situacao) !== situacaoProcurada) return false;
      return bancoAtendeBusca(b, busca);
    }),
  );
  return limite > 0 ? encontrados.slice(0, limite) : encontrados;
}

export function encontrarBanco(bancos = [], { id = null, codigo = "" } = {}) {
  const porId = String(id ?? "");
  if (porId !== "") {
    const achado = (bancos ?? []).find((b) => String(b?.id) === porId);
    if (achado) return achado;
  }
  const numero = numeroDoBancoFormatado(codigo);
  if (numero === "") return null;
  return (bancos ?? []).find((b) => numeroDoBancoFormatado(b?.numero) === numero) ?? null;
}

/** O que a escolha do banco grava: número e nome, como texto. */
export function dadosDoBancoParaDocumento(banco) {
  if (!banco) return { banco_codigo: null, banco: null };
  return { banco_codigo: numeroDoBancoFormatado(banco.numero), banco: texto(banco.nome) };
}

export function diferencaDoBanco(anterior, novo) {
  const de = anterior ?? {};
  const para = novo ?? {};
  const antes = {};
  const depois = {};

  Object.keys(ROTULOS_BANCO).forEach((campo) => {
    const valorDe = texto(de[campo]);
    const valorPara = texto(para[campo]);
    if (valorDe === valorPara) return;
    antes[campo] = valorDe;
    depois[campo] = valorPara;
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}
