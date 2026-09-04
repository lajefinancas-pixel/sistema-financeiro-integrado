// Organização e busca das contas bancárias JÁ CADASTRADAS.
//
// Regras puras (sem banco e sem React) usadas por toda tela que lista ou
// seleciona conta: o agrupamento visual por Secretaria, a contagem de contas de
// cada grupo, o recolhimento dos grupos e a busca da conta.
//
// Três garantias que o resto do sistema depende:
//
//   1. Nada aqui cria, altera, apaga ou movimenta conta e saldo. Agrupar,
//      recolher e buscar são apresentação — a conta selecionada continua sendo
//      apenas o registro de qual conta foi escolhida.
//   2. A busca encontra SOMENTE conta já cadastrada. Não existe função nenhuma
//      neste arquivo que produza conta avulsa, temporária ou "cadastro rápido":
//      o que não está na lista recebida não aparece.
//   3. Recolher um grupo não muda seleção nenhuma. `alternarGrupo` mexe apenas
//      no conjunto de grupos recolhidos; os ids selecionados ficam onde estão.

/** Texto mostrado quando a busca não encontra nenhuma conta cadastrada. */
export const MENSAGEM_SEM_RESULTADO = "Nenhuma conta cadastrada encontrada.";

/** Texto comparável: sem acento, sem caixa e sem espaço sobrando. */
export function textoComparavel(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Número da conta reduzido ao que identifica a conta: só letras e dígitos.
 * É o que faz "2.042-7", "2042-7" e "20427" acharem a mesma conta, e o que
 * permite buscar por PARTE do número ("042").
 */
export function digitosDoNumero(valor) {
  return String(valor ?? "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
}

// As telas trazem a conta em formatos um pouco diferentes (algumas já com
// `banco` e `secretaria` resolvidos, outras com o relacionamento do PostgREST).
// Estas funções leem os dois formatos, para que a busca funcione em qualquer um.

export function bancoDaConta(conta) {
  return conta?.banco ?? conta?.bancos?.nome ?? "";
}

export function secretariaDaConta(conta) {
  return conta?.secretaria ?? conta?.secretaria_nome ?? conta?.secretarias?.nome ?? "";
}

export function agenciaDaConta(conta) {
  return conta?.agencia ?? "";
}

export function saldoDaConta(conta) {
  const valor = conta?.saldoHoje ?? conta?.saldo ?? null;
  return valor == null ? null : Number(valor);
}

/**
 * Campos em que a busca procura: número da conta, nome da conta, banco,
 * agência e secretaria. Nada além disso — a busca localiza conta, não cria
 * nem filtra por saldo.
 */
export function camposDeBuscaDaConta(conta) {
  return [
    conta?.numero_conta,
    conta?.nome_conta,
    bancoDaConta(conta),
    agenciaDaConta(conta),
    secretariaDaConta(conta),
  ];
}

/** A conta atende ao termo digitado? (parte do número também vale.) */
export function contaAtendeBusca(conta, termo) {
  const alvo = textoComparavel(termo);
  if (alvo === "") return true;

  if (camposDeBuscaDaConta(conta).some((campo) => textoComparavel(campo).includes(alvo))) return true;

  // "2.042-7" digitado com pontuação, ou só um pedaço do número.
  const digitos = digitosDoNumero(termo);
  if (digitos !== "" && digitosDoNumero(conta?.numero_conta).includes(digitos)) return true;
  return false;
}

/**
 * Contas que atendem à busca, na ordem em que chegaram.
 *
 * A busca é GLOBAL: percorre todas as contas recebidas, de todas as
 * secretarias, independentemente de qual grupo está aberto na tela.
 */
export function filtrarContasCadastradas(contas, termo) {
  const lista = contas ?? [];
  if (textoComparavel(termo) === "" && digitosDoNumero(termo) === "") return [...lista];
  return lista.filter((conta) => contaAtendeBusca(conta, termo));
}

/** Chave estável do grupo: o id da secretaria quando existe, senão o nome. */
export function chaveDaSecretaria(conta) {
  const id = conta?.secretaria_id;
  if (id != null && String(id) !== "") return String(id);
  const nome = textoComparavel(secretariaDaConta(conta));
  return nome === "" ? "sem-secretaria" : `nome:${nome}`;
}

/**
 * Contas agrupadas por Secretaria, preservando o vínculo de cada conta com a
 * sua secretaria.
 *
 * @param contas lista já cadastrada
 * @param ordem  ids de secretaria na ordem preferida do usuário; as que não
 *               estiverem na lista entram depois, em ordem alfabética
 * @returns [{ chave, nome, secretariaId, contas, quantidade }]
 */
export function agruparContasPorSecretaria(contas, { ordem = [] } = {}) {
  const grupos = new Map();
  for (const conta of contas ?? []) {
    const chave = chaveDaSecretaria(conta);
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        secretariaId: conta?.secretaria_id ?? null,
        nome: String(secretariaDaConta(conta) || "Sem secretaria"),
        contas: [],
      });
    }
    grupos.get(chave).contas.push(conta);
  }

  const posicao = new Map((ordem ?? []).map((id, i) => [String(id), i]));
  return [...grupos.values()]
    .map((grupo) => ({ ...grupo, quantidade: grupo.contas.length }))
    .sort((a, b) => {
      const pa = posicao.has(String(a.secretariaId)) ? posicao.get(String(a.secretariaId)) : Number.MAX_SAFE_INTEGER;
      const pb = posicao.has(String(b.secretariaId)) ? posicao.get(String(b.secretariaId)) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
}

/** Cabeçalho do grupo: "SAÚDE — 12 contas". */
export function rotuloDoGrupo(grupo) {
  const quantidade = grupo?.quantidade ?? (grupo?.contas ?? []).length;
  return `${String(grupo?.nome ?? "").toUpperCase()} — ${quantidade} ${quantidade === 1 ? "conta" : "contas"}`;
}

/** O grupo está recolhido? */
export function grupoRecolhido(recolhidos, chave) {
  return (recolhidos instanceof Set ? recolhidos : new Set(recolhidos ?? [])).has(String(chave));
}

/**
 * Abre ou fecha UM grupo, sem tocar nos outros e sem tocar em seleção alguma:
 * a função recebe e devolve apenas o conjunto de grupos recolhidos.
 */
export function alternarGrupo(recolhidos, chave) {
  const proximo = new Set(recolhidos instanceof Set ? recolhidos : (recolhidos ?? []));
  const alvo = String(chave);
  if (proximo.has(alvo)) proximo.delete(alvo);
  else proximo.add(alvo);
  return proximo;
}

/** Quantas contas deste grupo estão selecionadas (some ao recolher, nunca perde). */
export function selecionadasNoGrupo(grupo, selecionadas) {
  const marcadas = new Set([...(selecionadas ?? [])].map(String));
  return (grupo?.contas ?? []).filter((conta) => marcadas.has(String(conta.id))).length;
}

/**
 * Uma linha de resultado: Banco | Nº da Conta | Nome da Conta | Secretaria |
 * Saldo. A Secretaria vai sempre, inclusive na busca global.
 */
export function linhaDaConta(conta) {
  return {
    id: conta?.id,
    banco: bancoDaConta(conta) || "--",
    numero_conta: conta?.numero_conta || "--",
    nome_conta: conta?.nome_conta || "--",
    secretaria: secretariaDaConta(conta) || "--",
    agencia: agenciaDaConta(conta) || "",
    saldo: saldoDaConta(conta),
  };
}
