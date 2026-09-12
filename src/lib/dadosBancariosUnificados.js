// O FORMULÁRIO ÚNICO dos dados bancários do fornecedor: conta E PIX juntos.
//
// Antes a Vida do Fornecedor tinha DOIS botões -- "+ Adicionar PIX" e
// "+ Adicionar Conta Bancária" -- e quem cadastrava os dados de pagamento de uma
// mesma pessoa precisava abrir dois formulários, digitando o titular duas vezes.
// Agora há UM botão e UM formulário com as duas partes.
//
// ⚠️ O QUE JÁ ESTÁ CADASTRADO NÃO É CONVERTIDO, MOVIDO OU APAGADO. Por baixo, a
// gravação continua sendo a de sempre: cada parte preenchida vira (ou atualiza)
// UM registro de forma de pagamento, com o mesmo `kind` de antes -- "bank" para
// a conta, "pix" para a chave. É isso que mantém intactas as permissões
// separadas (visualizar/cadastrar/editar PIX x dados bancários), a auditoria por
// registro e cada conta e cada PIX que já existiam, que continuam aparecendo na
// lista e abrindo para edição.
//
// Preencher SÓ a conta, SÓ o PIX ou OS DOIS é decisão de quem cadastra: uma
// parte vazia simplesmente não gera registro.
//
// Cadastro de referência: nada aqui debita conta, dá baixa em nota, altera saldo,
// cria pagamento ou toca em programação.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de
// supabase.

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return texto(valor) === "";
}

/** O tipo de chave PIX sugerido quando o formulário abre em branco. */
export const TIPO_PIX_PADRAO = "cnpj";

/** O tipo de conta sugerido quando o formulário abre em branco. */
export const TIPO_CONTA_PADRAO = "corrente";

export const TIPOS_DE_CHAVE_PIX = Object.freeze([
  { id: "cpf", rotulo: "CPF" },
  { id: "cnpj", rotulo: "CNPJ" },
  { id: "email", rotulo: "E-mail" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "aleatoria", rotulo: "Chave aleatória" },
]);

export const TIPOS_DE_CONTA = Object.freeze([
  { id: "corrente", rotulo: "Corrente" },
  { id: "poupanca", rotulo: "Poupança" },
  { id: "pagamento", rotulo: "Pagamento" },
  { id: "outra", rotulo: "Outra" },
]);

/** O formulário único em branco: uma parte de conta e uma parte de PIX. */
export function dadosBancariosVazios() {
  return {
    // Os dois ids: qual registro de conta e qual registro de PIX este
    // formulário está editando. Em branco, a parte preenchida nasce nova.
    contaId: null,
    pixId: null,
    // CONTA BANCÁRIA
    bankCode: "",
    bankName: "",
    agency: "",
    account: "",
    accountDigit: "",
    accountType: TIPO_CONTA_PADRAO,
    holderName: "",
    holderDocument: "",
    // PIX
    pixKeyType: TIPO_PIX_PADRAO,
    pixKey: "",
    pixHolderName: "",
    // Comum às duas partes
    isPrimary: false,
  };
}

/**
 * Abre um registro JÁ CADASTRADO no formulário único.
 *
 * Registro de conta cai na parte da conta; registro de PIX, na parte do PIX --
 * cada um levando o SEU id, para a gravação atualizar aquele registro e não
 * criar um segundo. A outra parte fica em branco: quem quiser pode completá-la
 * ali mesmo, e ela nasce como um registro novo, sem tocar no primeiro.
 */
export function dadosBancariosDaForma(forma) {
  const base = dadosBancariosVazios();
  if (!forma) return base;

  if (forma.kind === "pix") {
    return {
      ...base,
      pixId: forma.id ?? null,
      pixKeyType: texto(forma.pixKeyType) || TIPO_PIX_PADRAO,
      pixKey: texto(forma.pixKey),
      pixHolderName: texto(forma.holderName),
      holderDocument: texto(forma.holderDocument),
      isPrimary: forma.isPrimary === true,
    };
  }

  return {
    ...base,
    contaId: forma.id ?? null,
    bankCode: texto(forma.bankCode),
    bankName: texto(forma.bankName),
    agency: texto(forma.agency),
    account: texto(forma.account),
    accountDigit: texto(forma.accountDigit),
    accountType: texto(forma.accountType) || TIPO_CONTA_PADRAO,
    holderName: texto(forma.holderName),
    holderDocument: texto(forma.holderDocument),
    isPrimary: forma.isPrimary === true,
  };
}

/** A parte da CONTA está em uso? (ou preenchida, ou aberta para edição) */
export function temParteDeConta(formulario) {
  const base = formulario ?? {};
  if (texto(base.contaId) !== "") return true;
  return ["bankName", "bankCode", "agency", "account", "accountDigit"].some((campo) => !vazio(base[campo]));
}

/** A parte do PIX está em uso? (ou preenchida, ou aberta para edição) */
export function temPartePix(formulario) {
  const base = formulario ?? {};
  if (texto(base.pixId) !== "") return true;
  return !vazio(base.pixKey);
}

/**
 * Quais partes do formulário aparecem, dadas as permissões de sempre.
 *
 * As permissões continuam SEPARADAS: quem pode cadastrar PIX e não pode
 * cadastrar dados bancários vê o formulário único só com a parte do PIX. O botão
 * é um; o que ele abre respeita quem está usando.
 */
export function partesPermitidas(formulario, permissoes = {}) {
  const base = formulario ?? {};
  const editandoConta = texto(base.contaId) !== "";
  const editandoPix = texto(base.pixId) !== "";
  return {
    conta: editandoConta
      ? permissoes.editar_dados_bancarios === true
      : permissoes.cadastrar_dados_bancarios === true,
    pix: editandoPix ? permissoes.editar_pix === true : permissoes.cadastrar_pix === true,
  };
}

/** O botão único aparece para quem pode cadastrar pelo menos uma das partes. */
export function podeAbrirDadosBancarios(permissoes = {}) {
  return permissoes.cadastrar_dados_bancarios === true || permissoes.cadastrar_pix === true;
}

/**
 * O que falta para gravar -- a mensagem, ou `null` quando está tudo certo.
 *
 * A regra é a do comando: conta, PIX, ou os dois. O que se exige é apenas o
 * essencial DA PARTE PREENCHIDA, e continua sendo o mesmo que se exigia nos dois
 * formulários antigos (banco e conta na conta; chave no PIX; titular sempre).
 */
export function validarDadosBancarios(formulario) {
  const base = formulario ?? {};
  const comConta = temParteDeConta(base);
  const comPix = temPartePix(base);

  if (!comConta && !comPix) {
    return "Preencha a conta bancária, a chave PIX, ou as duas. Uma das duas já basta para salvar.";
  }

  if (comConta) {
    if (vazio(base.bankName)) return "Escolha o banco da conta na lista.";
    if (vazio(base.account)) return "Informe o número da conta.";
    if (vazio(base.holderName)) return "Informe o nome do titular da conta.";
  }

  if (comPix) {
    if (vazio(base.pixKey)) return "Informe a chave PIX.";
    if (vazio(base.pixHolderName) && vazio(base.holderName)) return "Informe o titular do PIX.";
  }

  return null;
}

/**
 * O formulário único virando os registros que a gravação envia.
 *
 * Um envio por parte preenchida, na MESMA forma de antes -- o campo `kind`
 * continua "bank" e "pix", e o `id` vai só quando aquela parte está editando um
 * registro que já existe. Parte vazia não vira registro nenhum.
 *
 * O titular do PIX, quando não é informado, é o titular da conta: é a mesma
 * pessoa na esmagadora maioria dos cadastros, e o registro de PIX não pode
 * ficar sem titular. O CPF/CNPJ do titular acompanha as duas partes, porque é o
 * documento de quem recebe.
 */
export function partesDeDadosBancarios(formulario) {
  const base = formulario ?? {};
  const partes = [];
  const principal = base.isPrimary === true;
  const documento = texto(base.holderDocument);

  if (temParteDeConta(base)) {
    partes.push({
      id: base.contaId ?? null,
      kind: "bank",
      bankName: texto(base.bankName),
      bankCode: texto(base.bankCode),
      agency: texto(base.agency),
      account: texto(base.account),
      accountDigit: texto(base.accountDigit),
      accountType: texto(base.accountType) || TIPO_CONTA_PADRAO,
      holderName: texto(base.holderName),
      holderDocument: documento,
      isPrimary: principal,
    });
  }

  if (temPartePix(base)) {
    partes.push({
      id: base.pixId ?? null,
      kind: "pix",
      pixKeyType: texto(base.pixKeyType) || TIPO_PIX_PADRAO,
      pixKey: texto(base.pixKey),
      holderName: texto(base.pixHolderName) || texto(base.holderName),
      holderDocument: documento,
      isPrimary: principal,
    });
  }

  return partes;
}

/** O que o rodapé do formulário diz que vai ser gravado. */
export function resumoDoQueSeraGravado(formulario) {
  const partes = partesDeDadosBancarios(formulario);
  if (partes.length === 0) return "Nada a gravar ainda.";
  const nomes = partes.map((parte) => (parte.kind === "pix" ? "PIX" : "conta bancária"));
  const acao = partes.every((parte) => texto(parte.id) !== "") ? "Atualiza" : "Salva";
  return `${acao} ${nomes.join(" e ")} deste fornecedor.`;
}
