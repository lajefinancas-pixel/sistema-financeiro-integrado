// O ENCAMINHAMENTO DA PREFEITA: "À SECRETARIA MUNICIPAL DE ______".
//
// É o campo do despacho da prefeita, no fim da Requisição e da
// Liquidação/Solicitação de Pagamento: a secretaria a quem ela ENCAMINHA o
// processo para as providências. Ele não pode sair em branco no papel, e é
// sempre uma das secretarias que TÊM FINANCEIRO -- Finanças, Saúde, Assistência
// Social, Educação --, porque é lá que o processo continua.
//
// ⚠️ ESTA NÃO É A SECRETARIA SOLICITANTE. Quem SOLICITA vem do cadastro próprio
// do módulo Processos (`processos_secretarias_solicitantes`) e pode ser qualquer
// secretaria do município; quem recebe o encaminhamento é uma das que têm
// financeiro. Uma pede, a outra providencia -- e quase nunca são a mesma.
//
// ⚠️ APENAS LEITURA DO CADASTRO DO FINANCEIRO. As secretarias oferecidas são as
// de `public.secretarias`, o MESMO cadastro que Saldos das Contas e Pagamentos
// Diários usam. Nada aqui cria, altera ou apaga secretaria nenhuma: o módulo
// Processos só consulta a lista. Ler do cadastro é também o que garante que uma
// secretaria com financeiro criada amanhã apareça sozinha na escolha, sem
// ninguém mexer em código.
//
// ⚠️ O CONGELAMENTO CONTINUA VALENDO. O processo grava dentro dele o NOME da
// secretaria escolhida (`encaminhar_secretaria_nome`), e é esse nome que o
// documento imprime. Renomear a secretaria no cadastro financeiro amanhã não
// reescreve o documento emitido hoje.
//
// Documental, não financeiro: nada aqui debita conta, dá baixa em NF, altera
// saldo, cria pagamento ou toca na Programação Diária.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

/** As colunas que o processo grava com o encaminhamento escolhido. */
export const CAMPOS_ENCAMINHAMENTO = ["encaminhar_secretaria_id", "encaminhar_secretaria_nome"];

/**
 * A secretaria sugerida quando a solicitante NÃO tem financeiro.
 *
 * É Finanças que recebe o processo nesse caso -- e é ela que o modelo oficial da
 * Liquidação já traz impresso ("À SECRETARIA DE FINANÇAS").
 */
export const ENCAMINHAMENTO_PADRAO = "Finanças";

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return texto(valor) === "";
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * O NÚCLEO do nome da secretaria: "Educação", e não "Secretaria Municipal de
 * Educação".
 *
 * A frase do despacho já diz "À SECRETARIA MUNICIPAL DE", então o que entra
 * depois dela é só o complemento. Sem isto o papel sairia "À SECRETARIA
 * MUNICIPAL DE SECRETARIA MUNICIPAL DE EDUCAÇÃO".
 */
export function nucleoDaSecretaria(nome) {
  return texto(nome)
    .replace(/^secretaria\s+municipal\s+d[eoa]s?\s+/i, "")
    .replace(/^secretaria\s+d[eoa]s?\s+/i, "")
    .replace(/^secretaria\s+municipal\s+/i, "")
    .replace(/^secretaria\s+/i, "")
    .trim();
}

/** A chave de comparação de duas secretarias: núcleo, sem acento e sem caixa. */
export function chaveDaSecretaria(nome) {
  return semAcento(nucleoDaSecretaria(nome));
}

/**
 * A lista que a escolha oferece: as secretarias do cadastro FINANCEIRO.
 *
 * Vem em ordem de nome, sem repetição e sem as inativas -- é a mesma leitura que
 * Saldos das Contas e Pagamentos Diários fazem. Cada item traz o `nucleo`, que é
 * o que vai impresso depois de "À SECRETARIA MUNICIPAL DE".
 */
export function secretariasParaEncaminhamento(secretariasFinanceiras = []) {
  const vistas = new Set();
  return (secretariasFinanceiras ?? [])
    .filter((s) => {
      if (s?.ativo === false) return false;
      const nome = texto(s?.nome);
      if (nome === "") return false;
      const chave = chaveDaSecretaria(nome);
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    })
    .map((s) => ({ id: s.id ?? null, nome: texto(s.nome), nucleo: nucleoDaSecretaria(s.nome) }))
    .sort((a, b) => semAcento(a.nome).localeCompare(semAcento(b.nome)));
}

/** A secretaria da lista que tem este id (ou nada, quando o id não está lá). */
export function encontrarEncaminhamento(secretarias = [], id) {
  const procurado = String(id ?? "");
  if (procurado === "") return null;
  return secretariasParaEncaminhamento(secretarias).find((s) => String(s.id) === procurado) ?? null;
}

/** A secretaria da lista cujo nome bate com o procurado (Saúde = SECRETARIA DE SAÚDE). */
export function encaminhamentoPeloNome(secretarias = [], nome) {
  const chave = chaveDaSecretaria(nome);
  if (chave === "") return null;
  return secretariasParaEncaminhamento(secretarias).find((s) => chaveDaSecretaria(s.nome) === chave) ?? null;
}

/**
 * O que a escolha leva GRAVADO para o processo: o id e o nome.
 *
 * O nome é o congelamento -- é ele que o documento imprime. O id fica para a
 * tela remarcar a opção quando o processo é reaberto, e é gravado SEM chave
 * estrangeira: o cadastro financeiro não é travado nem alterado por causa disto.
 */
export function dadosDoEncaminhamentoParaDocumento(secretaria) {
  if (!secretaria) return { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: "" };
  return {
    encaminhar_secretaria_id: secretaria.id ?? null,
    encaminhar_secretaria_nome: texto(secretaria.nome),
  };
}

/**
 * A SUGESTÃO da criação: a solicitante quando ela tem financeiro, Finanças quando não.
 *
 * É só sugestão: o campo continua editável até a finalização, e o processo
 * finalizado guarda a secretaria que foi escolhida no momento.
 */
export function sugerirEncaminhamento({ secretariasFinanceiras = [], nomeDaSolicitante = "" } = {}) {
  const lista = secretariasParaEncaminhamento(secretariasFinanceiras);
  const solicitante = encaminhamentoPeloNome(lista, nomeDaSolicitante);
  if (solicitante) return dadosDoEncaminhamentoParaDocumento(solicitante);

  const financas = encaminhamentoPeloNome(lista, ENCAMINHAMENTO_PADRAO);
  if (financas) return dadosDoEncaminhamentoParaDocumento(financas);

  // Cadastro financeiro ainda não lido (ou vazio): o papel sai com Finanças
  // escrito, que é o destino de sempre, e sem id nenhum gravado.
  return { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: ENCAMINHAMENTO_PADRAO };
}

/**
 * O COMPLEMENTO impresso depois de "À SECRETARIA MUNICIPAL DE ___".
 *
 * A ordem é a do congelamento, e é ela que faz processo antigo continuar
 * imprimindo o que sempre imprimiu:
 *
 *   1. a secretaria de encaminhamento GRAVADA no processo;
 *   2. o texto que foi escrito à mão no campo antigo do despacho -- processo
 *      criado antes deste campo existir tem só isto;
 *   3. a secretaria solicitante, como o documento fazia antes;
 *   4. Finanças, para o campo NUNCA sair em branco no papel.
 */
export function complementoDoEncaminhamento(processo, nomeDaSolicitante = "") {
  const gravado = nucleoDaSecretaria(processo?.encaminhar_secretaria_nome);
  if (gravado !== "") return gravado;

  const escrito = texto(processo?.despacho_secretaria);
  if (escrito !== "") return escrito;

  const solicitante = nucleoDaSecretaria(nomeDaSolicitante);
  if (solicitante !== "") return solicitante;

  return ENCAMINHAMENTO_PADRAO;
}

/**
 * O destino impresso na autorização da LIQUIDAÇÃO: "SECRETARIA DE FINANÇAS".
 *
 * O modelo oficial já vem com Finanças, e Finanças continua sendo o padrão: sem
 * escolha gravada, o documento sai palavra por palavra como sempre saiu. Com
 * escolha gravada, sai a secretaria escolhida.
 */
export function destinoDaLiquidacao(processo) {
  const gravado = nucleoDaSecretaria(processo?.encaminhar_secretaria_nome);
  const nucleo = gravado === "" ? ENCAMINHAMENTO_PADRAO : gravado;
  return `SECRETARIA DE ${nucleo}`.toUpperCase();
}

/**
 * O destino escrito como as DIÁRIAS o escrevem: "Secretaria Municipal de Finanças".
 *
 * A folha da liquidação de diárias traz a frase inteira ("À Secretaria Municipal
 * de Finanças, para as providências de pagamento."), em caixa normal -- e não em
 * maiúsculas como a de serviços. Finanças continua sendo o padrão: sem escolha
 * gravada, a frase sai palavra por palavra como sempre saiu.
 */
export function secretariaMunicipalDoEncaminhamento(processo) {
  const gravado = nucleoDaSecretaria(processo?.encaminhar_secretaria_nome);
  return `Secretaria Municipal de ${gravado === "" ? ENCAMINHAMENTO_PADRAO : gravado}`;
}

/** O rótulo que a tela mostra para o encaminhamento gravado no processo. */
export function rotuloDoEncaminhamento(processo) {
  const gravado = texto(processo?.encaminhar_secretaria_nome);
  return gravado === "" ? "" : gravado;
}
