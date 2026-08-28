// Segregação por secretaria nas transferências entre contas próprias.
//
// A regra do sistema é: contas de secretarias DIFERENTES não se misturam. Existe
// uma única exceção legítima -- a Secretaria de Finanças pode transferir para
// contas da Saúde, da Educação e da Assistência Social. Nenhum outro par de
// secretarias diferentes é permitido.
//
// Por que a regra olha o NOME da secretaria: não existe no cadastro de
// secretarias nenhuma marca dizendo qual delas é Finanças, Saúde, Educação ou
// Assistência Social -- a tabela guarda id, nome e situação. Em vez de inventar
// uma classificação nova no cadastro (que ninguém pediu e que precisaria ser
// preenchida à mão em toda instalação), a regra reconhece a secretaria pelo
// nome, ignorando acento, caixa e as variações usuais de escrita
// ("FINANÇAS", "Sec. de Finanças", "Secretaria Municipal de Financas").
//
// O mesmo raciocínio está na função public.transferencia_entre_secretarias_permitida
// do banco, que é quem realmente barra a operação. Aqui a regra existe para a
// tela poder avisar ANTES de o usuário confirmar.

/** Nome comparável: sem acento, sem caixa, sem espaço sobrando. */
export function normalizarNomeSecretaria(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** É a Secretaria de Finanças (a única que pode transferir para fora)? */
export function ehFinancas(nome) {
  return normalizarNomeSecretaria(nome).includes("financ");
}

/** É um destino que Finanças pode alcançar: Saúde, Educação ou Assistência Social? */
export function ehDestinoPermitidoDeFinancas(nome) {
  const normalizado = normalizarNomeSecretaria(nome);
  return normalizado.includes("saude") || normalizado.includes("educac") || normalizado.includes("assist");
}

/**
 * A transferência entre estas duas contas é permitida?
 *
 * Mesma secretaria: sempre. Secretarias diferentes: só Finanças -> Saúde,
 * Educação ou Assistência Social.
 */
export function transferenciaPermitida(origem, destino) {
  if (!origem || !destino) return false;
  const mesmaSecretaria =
    origem.secretaria_id != null &&
    destino.secretaria_id != null &&
    String(origem.secretaria_id) === String(destino.secretaria_id);
  if (mesmaSecretaria) return true;
  return ehFinancas(origem.secretaria_nome) && ehDestinoPermitidoDeFinancas(destino.secretaria_nome);
}

/** Motivo do bloqueio, em texto de tela. `null` quando a transferência é permitida. */
export function motivoBloqueioTransferencia(origem, destino) {
  if (!origem || !destino) return "Escolha a conta de origem e a conta de destino.";
  if (String(origem.id) === String(destino.id)) return "A conta de origem e a de destino precisam ser diferentes.";
  if (transferenciaPermitida(origem, destino)) return null;
  return `Transferência entre secretarias diferentes não é permitida (${origem.secretaria_nome || "origem"} para ${
    destino.secretaria_nome || "destino"
  }). A única exceção é a Secretaria de Finanças para Saúde, Educação e Assistência Social.`;
}

/** Contas que podem receber de um destino escolhido, já com o motivo do bloqueio. */
export function classificarOrigensPossiveis(contas, destino) {
  return (contas ?? [])
    .filter((conta) => String(conta.id) !== String(destino?.id ?? ""))
    .map((conta) => ({ ...conta, bloqueio: motivoBloqueioTransferencia(conta, destino) }));
}

/**
 * Secretarias que podem trocar dinheiro com a secretaria da programação.
 *
 * A própria secretaria sempre. Finanças alcança Saúde, Educação e Assistência
 * Social; e essas três podem receber de Finanças -- por isso a conta de Finanças
 * também entra na lista quando a programação é de uma delas. Nenhum outro par.
 */
export function secretariasRelacionadas(secretariaAtual, secretarias = []) {
  const nomeAtual = secretariaAtual?.nome ?? "";
  const ids = new Set([String(secretariaAtual?.id ?? "")]);

  for (const secretaria of secretarias) {
    if (ehFinancas(nomeAtual) && ehDestinoPermitidoDeFinancas(secretaria.nome)) ids.add(String(secretaria.id));
    if (ehDestinoPermitidoDeFinancas(nomeAtual) && ehFinancas(secretaria.nome)) ids.add(String(secretaria.id));
  }

  return [...ids].filter(Boolean);
}
