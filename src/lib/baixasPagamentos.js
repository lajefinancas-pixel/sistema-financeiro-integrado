import { supabase } from "./supabaseClient";
import { paraNumeroMoeda } from "./moeda";
import { filtroVigentes } from "./exclusaoRegistros";
import { buscarPaginado, carregarSaldosDasContas } from "./saldosContasDados";
import { COLUNA_APELIDO, estruturaDeApelidoAusente } from "./nomesFornecedor.js";
export {
  resumoBaixas,
  situacaoPagamento,
  validarValorBaixa,
  validarBaixaDeNota,
  validarEstorno,
} from "./regrasBaixas";

/**
 * Camada de dados da aba "Baixas de Pagamentos".
 *
 * A baixa é a confirmação de que o pagamento saiu de fato no banco. Ela é
 * independente da Programação Diária e NÃO DEBITA O SALDO DA CONTA: quem grava
 * é `public.registrar_baixa_nota`, que registra o pagamento e abate o valor em
 * aberto da nota -- e nada mais. Nenhuma consulta deste arquivo lê ou escreve
 * saldo; o saldo continua sendo movimentado exclusivamente pelos fluxos que já
 * existiam (lançamento do saldo do dia e transferência entre contas).
 *
 * As funções antigas (`registrarBaixa`, `estornarBaixa`, `editarBaixa`,
 * `listarBaixas`) continuam aqui como estavam, porque outros pontos do sistema
 * ainda as usam.
 */

/**
 * Situações em que a nota ainda pode receber baixa.
 *
 * A baixa grava apenas 'em_aberto' (parcial) e 'pago' (quitada), nunca
 * 'parcialmente_pago'. A lista continua aceitando as demais situações porque a
 * tela de Fornecedores permite marcá-las à mão, e uma nota marcada assim
 * precisa continuar aparecendo aqui enquanto tiver valor em aberto.
 */
export const SITUACOES_COM_SALDO = ["em_aberto", "programado", "parcialmente_pago", "suspenso"];

const COLUNAS_NOTA =
  "id,fornecedor_id,numero_processo,numero_empenho,numero_nota_fiscal,data_nota_fiscal,parcela,valor_bruto,valor,valor_pago,data_vencimento,situacao,created_at";

const COLUNAS_BAIXA =
  "id,chave_idempotencia,fornecedor_id,valor_em_aberto_id,pagamento_id,valor_total_referencia,valor_pago,data_pagamento,conta_id,documento,observacao,status,situacao_anterior,usuario_id,criado_em,estornada_em,estornada_por,motivo_estorno";

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

/**
 * Registra a baixa de UMA NOTA do fornecedor -- parcial ou integral.
 *
 * A chave de idempotência é obrigatória: é ela que faz a confirmação repetida
 * (duplo clique, F5, reenvio) não registrar duas baixas. O identificador da
 * nota vai como texto porque o id de `valores_em_aberto` pode ser inteiro ou
 * uuid dependendo do banco.
 */
export async function registrarBaixaDeNota(campos) {
  const { data, error } = await supabase.rpc("registrar_baixa_nota", {
    p_chave_idempotencia: campos.chaveIdempotencia,
    p_valor_em_aberto_id: String(campos.valorEmAbertoId ?? ""),
    p_valor: paraNumeroMoeda(campos.valor),
    p_data_pagamento: campos.dataPagamento,
    p_conta_id: campos.contaId ? Number(campos.contaId) : null,
    p_observacao: campos.observacao?.trim() || null,
  });
  if (error) throw error;
  return data;
}

/**
 * Estorna uma baixa: devolve o valor para "em aberto" e PRESERVA o registro
 * original com o motivo. Baixa nunca é apagada.
 */
export async function estornarBaixaDeNota(baixaId, motivo) {
  const { data, error } = await supabase.rpc("estornar_baixa_nota", {
    p_baixa_id: String(baixaId ?? ""),
    p_motivo: String(motivo ?? "").trim(),
  });
  if (error) throw error;
  return data;
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

const COLUNAS_FORNECEDOR_BAIXA = "id,razao_social,nome_fantasia,cpf_cnpj,secretaria_id,ativo,secretarias(nome)";

/**
 * Fornecedores para a busca do primeiro passo da tela: nome, razão social,
 * nome fantasia, APELIDO e CNPJ/CPF. Fornecedor excluído (Lixeira) não aparece.
 *
 * O apelido entra na consulta quando a coluna já existe no banco; sem ela
 * (migration 20260905120000 ainda não rodada) a lista vem igual ao que era, só
 * sem a busca pelo apelido -- a tela não quebra por causa de uma coluna nova.
 */
export async function carregarFornecedoresDaBaixa() {
  const vigentes = await filtroVigentes("fornecedores");
  const consultar = async (colunas) =>
    vigentes(
      supabase
        .from("fornecedores")
        .select(colunas)
        .eq("ativo", true)
        .order("razao_social", { nullsFirst: false }),
    );

  let resposta = await consultar(`${COLUNAS_FORNECEDOR_BAIXA},${COLUNA_APELIDO}`);
  if (resposta.error && estruturaDeApelidoAusente(resposta.error)) {
    resposta = await consultar(COLUNAS_FORNECEDOR_BAIXA);
  }
  if (resposta.error) throw resposta.error;
  return resposta.data ?? [];
}

const COLUNAS_CONTA_BAIXA = "id,nome_conta,numero_conta,banco_id,secretaria_id,bancos(nome),secretarias(nome)";

/**
 * Contas bancárias disponíveis para informar em qual conta o pagamento saiu.
 *
 * Volta com banco, secretaria e saldo já resolvidos, porque é assim que a lista
 * de contas mostra e busca cada conta (banco, número, nome, agência e
 * secretaria). A agência entra quando a coluna já existe no banco.
 *
 * O saldo aqui é INFORMATIVO. A baixa não debita o saldo da conta: ela registra
 * o pagamento (valor, data e conta utilizada) e abate o valor em aberto da nota.
 * A conta é o registro de qual conta pagou, não movimentação de saldo.
 */
export async function carregarContasDaBaixa() {
  const consultar = (colunas) =>
    supabase.from("contas_bancarias").select(colunas).eq("ativo", true).order("nome_conta");

  let resposta = await consultar(`${COLUNAS_CONTA_BAIXA},agencia`);
  // Coluna de agência ainda não criada neste banco: segue sem ela.
  if (resposta.error) resposta = await consultar(COLUNAS_CONTA_BAIXA);
  if (resposta.error) throw resposta.error;

  const contas = (resposta.data ?? []).map((conta) => ({
    ...conta,
    banco: conta.bancos?.nome ?? "",
    secretaria: conta.secretarias?.nome ?? "",
    agencia: conta.agencia ?? "",
  }));

  // O saldo é só exibição: se a consulta de saldos falhar, a lista de contas
  // continua servindo para registrar a baixa.
  try {
    const { contas: comSaldo } = await carregarSaldosDasContas({ contas, comReservas: false });
    return comSaldo;
  } catch {
    return contas;
  }
}

/** Nome de quem registrou cada baixa, para o histórico da nota. */
export async function carregarUsuariosDaBaixa() {
  const { data, error } = await supabase.from("usuarios").select("id,nome_completo");
  if (error) throw error;
  return data ?? [];
}

/**
 * Notas de um fornecedor que ainda têm valor em aberto.
 *
 * O filtro de situação exclui apenas o que está encerrado (`pago`,
 * `cancelado`); o corte final por valor em aberto é feito pelas regras puras,
 * porque é a mesma conta que as outras telas já fazem (`valor - valor_pago`).
 */
export async function listarNotasDoFornecedor(fornecedorId, { incluirQuitadas = false } = {}) {
  if (!fornecedorId) return [];

  let consulta = supabase
    .from("valores_em_aberto")
    .select(COLUNAS_NOTA)
    .eq("fornecedor_id", fornecedorId)
    .order("data_vencimento", { ascending: true, nullsFirst: false });

  if (!incluirQuitadas) consulta = consulta.in("situacao", SITUACOES_COM_SALDO);

  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

/**
 * Baixas de um fornecedor, incluindo as estornadas (o histórico mostra as
 * duas). São os MESMOS registros que a Vida do Fornecedor e os Relatórios leem.
 */
export async function listarBaixasDoFornecedor(fornecedorId) {
  if (!fornecedorId) return [];
  const { data, error } = await supabase
    .from("pagamentos_baixas")
    .select(COLUNAS_BAIXA)
    .eq("fornecedor_id", fornecedorId)
    .order("data_pagamento", { ascending: false })
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Todas as baixas por nota, para os relatórios e a exportação da tela. */
export async function listarBaixasPorNota(filtros = {}) {
  const registros = await buscarPaginado(() => {
    let consulta = supabase
      .from("pagamentos_baixas")
      .select(COLUNAS_BAIXA)
      .not("valor_em_aberto_id", "is", null)
      .order("id", { ascending: true });
    if (filtros.inicio) consulta = consulta.gte("data_pagamento", filtros.inicio);
    if (filtros.fim) consulta = consulta.lte("data_pagamento", filtros.fim);
    if (filtros.fornecedorId) consulta = consulta.eq("fornecedor_id", filtros.fornecedorId);
    if (filtros.contaId) consulta = consulta.eq("conta_id", filtros.contaId);
    return consulta;
  });
  return registros;
}

/**
 * Tudo que a tela precisa para começar: fornecedores, contas e usuários.
 * As três consultas são independentes e vão juntas.
 */
export async function carregarBaseDaTelaDeBaixas() {
  const [fornecedores, contas, usuarios] = await Promise.all([
    carregarFornecedoresDaBaixa(),
    carregarContasDaBaixa(),
    carregarUsuariosDaBaixa().catch(() => []),
  ]);
  return { fornecedores, contas, usuarios };
}

/**
 * Notas e baixas de um fornecedor, na mesma ida ao banco.
 *
 * `incluirQuitadas` traz também as notas já pagas: a listagem da tela continua
 * mostrando só as que têm valor em aberto, mas o histórico e os documentos
 * precisam da nota que a última baixa quitou.
 */
export async function carregarNotasEBaixas(fornecedorId, { incluirQuitadas = false } = {}) {
  const [notas, baixas] = await Promise.all([
    listarNotasDoFornecedor(fornecedorId, { incluirQuitadas }),
    listarBaixasDoFornecedor(fornecedorId),
  ]);
  return { notas, baixas };
}

/* -------------------------------------------------------------------------
 * Funções já existentes (mantidas como estavam)
 * ---------------------------------------------------------------------- */

export async function registrarBaixa(campos) {
  const { data, error } = await supabase.rpc("registrar_baixa_pagamento", {
    p_chave_idempotencia: campos.chaveIdempotencia,
    p_fornecedor_id: Number(campos.fornecedorId),
    p_valor: paraNumeroMoeda(campos.valor),
    p_data_pagamento: campos.dataPagamento,
    p_conta_id: campos.contaId,
    p_pagamento_id: campos.pagamentoId ? Number(campos.pagamentoId) : null,
    p_documento: campos.documento || null,
    p_observacao: campos.observacao || null,
  });
  if (error) throw error;
  return data;
}

export async function estornarBaixa(baixaId, motivo, chaveIdempotencia = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("estornar_baixa_pagamento", {
    p_baixa_id: baixaId,
    p_motivo: motivo,
    p_chave_idempotencia: chaveIdempotencia,
  });
  if (error) throw error;
  return data;
}

export async function editarBaixa(baixaId, documento, observacao) {
  const { data, error } = await supabase.rpc("editar_baixa_pagamento", {
    p_baixa_id: baixaId,
    p_documento: documento || null,
    p_observacao: observacao || null,
  });
  if (error) throw error;
  return data;
}

export async function listarBaixas(filtros = {}) {
  let consulta = supabase
    .from("pagamentos_baixas")
    .select("id,chave_idempotencia,fornecedor_id,pagamento_id,valor_total_referencia,valor_pago,data_pagamento,conta_id,documento,observacao,status,saldo_antes,saldo_depois,usuario_id,criado_em,estornada_em,estornada_por,motivo_estorno")
    .order("data_pagamento", { ascending: false })
    .order("criado_em", { ascending: false });
  if (filtros.inicio) consulta = consulta.gte("data_pagamento", filtros.inicio);
  if (filtros.fim) consulta = consulta.lte("data_pagamento", filtros.fim);
  if (filtros.fornecedorId) consulta = consulta.eq("fornecedor_id", String(filtros.fornecedorId));
  if (filtros.contaId) consulta = consulta.eq("conta_id", filtros.contaId);
  if (filtros.pagamentoId) consulta = consulta.eq("pagamento_id", String(filtros.pagamentoId));
  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}
