// Regras puras do cadastro de conta bancária: tipos aceitos, obrigatoriedade,
// duplicidade de número e a comparação "antes/depois" que vai para a auditoria.
//
// Vive separado de ./contasBancarias.js (que fala com o Supabase) só para poder
// ser testado direto, sem cliente de banco. Quem usa a tela importa tudo de
// ./contasBancarias.js, que reexporta este arquivo.

import { paraNumeroMoeda } from "./moeda.js";
import { campoPreenchido } from "./lancamentoSaldosRegras.js";

/** Tipos de conta aceitos no cadastro. */
export const TIPOS_CONTA = [
  { id: "corrente", label: "Conta corrente" },
  { id: "poupanca", label: "Poupança" },
  { id: "pagamento", label: "Conta de pagamento" },
  { id: "outra", label: "Outra" },
];

/**
 * Rótulo do tipo. Contas antigas podem ter qualquer texto na coluna (o campo
 * era livre): o valor gravado é mostrado como está, sem virar "--".
 */
export function tipoContaLabel(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "--";
  return TIPOS_CONTA.find((tipo) => tipo.id === texto)?.label ?? texto;
}

/** Rótulos usados nas mensagens e na trilha de auditoria. */
export const ROTULOS_CONTA = {
  secretaria: "Secretaria",
  banco: "Banco",
  agencia: "Agência",
  numero_conta: "Número da conta",
  nome_conta: "Nome da conta",
  tipo_conta: "Tipo de conta",
  fonte_recurso: "Fonte de recurso",
  possui_pix: "Possui PIX",
  pix_tipo_chave: "Tipo da chave PIX",
  pix_chave: "Chave PIX",
  pix_titular: "Titular do PIX",
  pix_documento_titular: "CPF/CNPJ do titular do PIX",
};

/**
 * Tipos de chave PIX aceitos no cadastro da conta bancária. Mesma lista usada
 * nos dados para pagamento do fornecedor, para que a leitura seja a mesma nas
 * duas telas.
 */
export const TIPOS_CHAVE_PIX = [
  { id: "cpf", label: "CPF" },
  { id: "cnpj", label: "CNPJ" },
  { id: "telefone", label: "Telefone" },
  { id: "email", label: "E-mail" },
  { id: "aleatoria", label: "Chave aleatória" },
];

/** Rótulo do tipo da chave; valor desconhecido é mostrado como está. */
export function tipoChavePixLabel(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "--";
  return TIPOS_CHAVE_PIX.find((tipo) => tipo.id === texto)?.label ?? texto;
}

/**
 * O CPF/CNPJ do titular é exigido? Só quando a própria chave é um CPF ou um
 * CNPJ -- nos outros tipos o campo continua na tela ("quando aplicável"), mas
 * em branco não impede o cadastro.
 */
export function documentoDoTitularObrigatorio(tipoChave) {
  return ["cpf", "cnpj"].includes(String(tipoChave ?? "").trim());
}

/** O formulário marcou "Possui PIX? Sim"? */
export function contaTemPix(valor) {
  if (typeof valor === "boolean") return valor;
  const texto = String(valor ?? "").trim().toLowerCase();
  return ["sim", "true", "1", "s", "y", "yes"].includes(texto);
}

/**
 * Validação da seção PIX do MESMO formulário da conta.
 *
 * PIX é opcional: "Não" (ou nada marcado) passa sem nenhuma exigência e a conta
 * salva normalmente. Marcado "Sim", tipo da chave, chave e titular passam a ser
 * obrigatórios, e o CPF/CNPJ do titular só quando a chave é CPF ou CNPJ.
 */
export function validarPixDaConta({
  possui_pix = false,
  pix_tipo_chave = "",
  pix_chave = "",
  pix_titular = "",
  pix_documento_titular = "",
} = {}) {
  const erros = {};
  if (!contaTemPix(possui_pix)) return erros;

  if (String(pix_tipo_chave).trim() === "") erros.pix_tipo_chave = "Escolha o tipo da chave PIX.";
  if (String(pix_chave).trim() === "") erros.pix_chave = "Informe a chave PIX.";
  if (String(pix_titular).trim() === "") erros.pix_titular = "Informe o titular do PIX.";
  if (documentoDoTitularObrigatorio(pix_tipo_chave) && String(pix_documento_titular).trim() === "") {
    erros.pix_documento_titular = "Informe o CPF/CNPJ do titular da chave.";
  }
  return erros;
}

/**
 * Dados de PIX prontos para gravar, em snake_case.
 *
 * "Não" grava tudo em branco: a conta fica sem PIX, sem sobra de chave antiga.
 * O PIX vive no MESMO registro da conta bancária -- não existe tabela, aba nem
 * cadastro separado.
 */
export function dadosPixParaGravar(dados = {}) {
  if (!contaTemPix(dados.possui_pix)) {
    return {
      possui_pix: false,
      pix_tipo_chave: null,
      pix_chave: null,
      pix_titular: null,
      pix_documento_titular: null,
    };
  }
  const texto = (valor) => {
    const limpo = String(valor ?? "").trim();
    return limpo === "" ? null : limpo;
  };
  return {
    possui_pix: true,
    pix_tipo_chave: texto(dados.pix_tipo_chave),
    pix_chave: texto(dados.pix_chave),
    pix_titular: texto(dados.pix_titular),
    pix_documento_titular: texto(dados.pix_documento_titular),
  };
}

/**
 * Número da conta reduzido ao que identifica a conta: só letras e dígitos, em
 * maiúsculas. "2.042-7", "2042-7" e "20427" são a mesma conta — é assim que a
 * duplicidade é detectada na tela e no índice de unicidade do banco.
 */
export function chaveDoNumero(numero) {
  return String(numero ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Validação do cadastro, igual para criar e para editar.
 *
 * Obrigatórios: banco, número da conta, nome da conta, tipo e secretaria.
 * Saldo inicial é opcional; quando informado precisa ser numérico e não
 * negativo. Fonte de recurso é opcional ("quando aplicável").
 *
 * @returns { valido, erros: { campo: mensagem }, mensagem }
 */
export function validarCadastroConta(dados = {}) {
  const {
    nova_secretaria = false,
    secretaria_id = "",
    secretaria_novo_nome = "",
    novo_banco = false,
    banco_id = "",
    banco_novo_nome = "",
    nome_conta = "",
    numero_conta = "",
    tipo_conta = "",
    saldo_inicial = "",
    exigirSaldoInicial = false,
  } = dados;
  const erros = {};

  const temSecretaria = nova_secretaria
    ? String(secretaria_novo_nome).trim() !== ""
    : String(secretaria_id).trim() !== "";
  if (!temSecretaria) erros.secretaria = "Informe a secretaria da conta.";

  const temBanco = novo_banco ? String(banco_novo_nome).trim() !== "" : String(banco_id).trim() !== "";
  if (!temBanco) erros.banco = "Informe o banco da conta.";

  if (String(numero_conta).trim() === "") erros.numero_conta = "Informe o número da conta.";
  if (String(nome_conta).trim() === "") erros.nome_conta = "Informe o nome da conta.";
  if (String(tipo_conta).trim() === "") erros.tipo_conta = "Escolha o tipo de conta.";

  if (campoPreenchido(saldo_inicial)) {
    const texto = typeof saldo_inicial === "number" ? String(saldo_inicial) : String(saldo_inicial);
    if (!/\d/.test(texto)) {
      erros.saldo_inicial = "Informe o saldo inicial como valor numérico.";
    } else if (paraNumeroMoeda(saldo_inicial) < 0) {
      erros.saldo_inicial = "O saldo inicial não pode ser negativo.";
    }
  } else if (exigirSaldoInicial) {
    erros.saldo_inicial = "Informe o saldo inicial.";
  }

  // Agência é opcional: conta sem agência informada continua salvando.
  // PIX também é opcional; quando marcado "Sim", os campos dele passam a ser
  // conferidos no MESMO envio do formulário.
  Object.assign(erros, validarPixDaConta(dados));

  const campos = Object.keys(erros);
  return {
    valido: campos.length === 0,
    erros,
    mensagem: campos.length === 0 ? null : erros[campos[0]],
  };
}

/** O saldo inicial foi informado? (zero conta como informado; branco, não.) */
export function saldoInicialInformado(valor) {
  return campoPreenchido(valor) && /\d/.test(String(valor));
}

/**
 * Conta já cadastrada com o mesmo número, no mesmo banco e na mesma secretaria.
 * Considera também as contas desativadas: nesse caso a tela oferece reativar em
 * vez de criar uma segunda conta com o mesmo número.
 *
 * @param ignorarId id da própria conta, na edição
 * @returns a conta em conflito, ou null
 */
export function contaDuplicada({ contas, secretariaId, bancoId, numeroConta, ignorarId = null } = {}) {
  const chave = chaveDoNumero(numeroConta);
  if (!chave) return null;
  return (
    (contas ?? []).find(
      (conta) =>
        String(conta.id) !== String(ignorarId ?? "") &&
        String(conta.secretaria_id) === String(secretariaId) &&
        String(conta.banco_id) === String(bancoId) &&
        chaveDoNumero(conta.numero_conta) === chave,
    ) ?? null
  );
}

/** Mensagem de bloqueio da duplicidade, já explicando o caminho de saída. */
export function mensagemDuplicidade(conta) {
  const numero = conta?.numero_conta ?? "";
  if (conta?.ativo === false) {
    return `A conta ${numero} já existe neste banco e nesta secretaria, atualmente desativada. Reative a conta na seção "Contas desativadas" em vez de cadastrá-la outra vez.`;
  }
  return `Já existe uma conta ${numero} neste banco e nesta secretaria. Confira o número informado.`;
}

/**
 * Campos do cadastro que realmente mudaram, com o valor anterior e o novo — é
 * o par "antes/depois" que vai para a auditoria. Campos iguais ficam de fora.
 *
 * @param antes  { secretaria, banco, numero_conta, nome_conta, tipo_conta, fonte_recurso }
 * @param depois mesma forma
 * @returns { alterados: { campo: { de, para } }, houveMudanca, resumo }
 */
export function alteracoesDoCadastro(antes, depois) {
  const alterados = {};
  for (const campo of Object.keys(ROTULOS_CONTA)) {
    const de = valorComparavel(antes?.[campo]);
    const para = valorComparavel(depois?.[campo]);
    if (de !== para) alterados[campo] = { de: antes?.[campo] ?? null, para: depois?.[campo] ?? null };
  }
  const campos = Object.keys(alterados);
  return {
    alterados,
    houveMudanca: campos.length > 0,
    resumo: campos.map((campo) => ROTULOS_CONTA[campo]).join(", "),
  };
}

function valorComparavel(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

/**
 * Cadastro inteiro pronto para a auditoria. As chaves são as mesmas que o
 * dicionário de campos da auditoria conhece (snake_case), e os valores já vêm
 * legíveis — é assim que a comparação "antes/depois" da tela de Auditoria
 * consegue rotular cada linha.
 */
export function retratoDoCadastro(conta) {
  const temPix = contaTemPix(conta?.possui_pix);
  return {
    secretaria: conta?.secretaria ?? "--",
    banco: conta?.banco ?? "--",
    agencia: conta?.agencia ?? "--",
    numero_conta: conta?.numero_conta ?? "--",
    nome_conta: conta?.nome_conta ?? "--",
    tipo_conta: tipoContaLabel(conta?.tipo_conta),
    fonte_recurso: conta?.fonte_recurso ?? "--",
    possui_pix: temPix ? "Sim" : "Não",
    pix_tipo_chave: temPix ? tipoChavePixLabel(conta?.pix_tipo_chave) : "--",
    pix_chave: temPix ? (conta?.pix_chave ?? "--") : "--",
    pix_titular: temPix ? (conta?.pix_titular ?? "--") : "--",
    pix_documento_titular: temPix ? (conta?.pix_documento_titular ?? "--") : "--",
  };
}

/**
 * Só os campos alterados, nos dois lados, prontos para a auditoria.
 *
 * @returns { anterior, novo } — objetos com as mesmas chaves, uma por campo
 *          que mudou de verdade
 */
export function retratoDasAlteracoes(alterados) {
  const anterior = {};
  const novo = {};
  for (const [campo, valores] of Object.entries(alterados ?? {})) {
    const legivel = (valor) => {
      if (campo === "tipo_conta") return tipoContaLabel(valor);
      if (campo === "pix_tipo_chave") return tipoChavePixLabel(valor);
      if (campo === "possui_pix") return contaTemPix(valor) ? "Sim" : "Não";
      return valor ?? "--";
    };
    anterior[campo] = legivel(valores?.de);
    novo[campo] = legivel(valores?.para);
  }
  return { anterior, novo };
}
