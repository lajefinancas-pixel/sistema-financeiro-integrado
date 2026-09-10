import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import { COLUNA_APELIDO, estruturaDeApelidoAusente } from "./nomesFornecedor.js";
import {
  AREAS,
  diferencaParaAuditoria,
  identificacaoDoRegistro,
  registroParaBanco,
} from "./areasFornecedores.js";

/**
 * Camada de dados das áreas Patrocínios, Aluguéis e Bandas
 * (tabelas criadas pela migration
 * 20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql).
 *
 * O que este arquivo NÃO faz, e não é esquecimento:
 *
 * - Não cadastra fornecedor. Todo registro aponta para um fornecedor que já
 *   existe, pelo id. É por isso que o mesmo fornecedor pode ter dois
 *   patrocínios, um aluguel e três bandas continuando a ser um cadastro só.
 * - Não grava valor pago em lugar nenhum. Pago e Saldo são calculados a partir
 *   das baixas das NFs vinculadas ao registro; as tabelas destas áreas não têm
 *   coluna de valor pago.
 * - Não registra, não valida e não estorna baixa. A baixa continua sendo
 *   exclusivamente por NF/processo, na aba de Baixas. Aqui a NF só é VINCULADA
 *   a um registro, e a leitura da nota é somente-leitura.
 * - Não cria NF. Vincular exige uma NF/processo que já exista para aquele
 *   fornecedor, e vincular nunca é obrigatório.
 * - Não apaga registro. "Inativar" é a exclusão lógica desta área (`ativo`),
 *   como manda o padrão do sistema.
 *
 * Desvincular uma NF apaga apenas a linha do vínculo. A nota, o valor em aberto
 * e as baixas dela seguem intactos.
 */

/** Colunas da NF lidas para calcular Pago e Saldo (as mesmas da aba de Baixas). */
const COLUNAS_NOTA =
  "id,fornecedor_id,numero_processo,numero_empenho,numero_nota_fiscal,data_nota_fiscal,parcela,valor,valor_pago,data_vencimento,situacao";

const COLUNAS_FORNECEDOR = "id,razao_social,nome_fantasia,cpf_cnpj,secretaria_id";

/** Situações em que a NF ainda tem valor em aberto (espelha SITUACOES_COM_SALDO). */
const SITUACOES_COM_SALDO = ["em_aberto", "programado", "parcialmente_pago", "suspenso"];

/**
 * A falha significa "as tabelas destas áreas ainda não existem neste banco"
 * (migration não rodada no SQL Editor)? Mesmo critério do resto do sistema:
 * estrutura ausente não é erro de uso — a tela mostra o recado da migration em
 * vez de um erro de banco, e todo o resto do sistema continua funcionando.
 */
export function estruturaDeAreasAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) {
    return true;
  }
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return AREAS.some(
    (area) => mensagem.includes(area.tabela) || mensagem.includes(area.tabelaNotas),
  );
}

/** A falha é "a tabela não existe" (e não "a coluna não existe")? */
function tabelaAusente(erro) {
  return ["42P01", "PGRST205"].includes(String(erro?.code ?? ""));
}

/**
 * A falha é a permissão do banco recusando (RLS ou o gatilho de alteração)? A
 * mensagem do gatilho é preservada, porque ela explica exatamente o que a
 * pessoa pode fazer ("apenas inativar ou reativar").
 */
export function semPermissaoNoBanco(erro) {
  const codigo = String(erro?.code ?? "");
  if (codigo === "42501" || codigo === "P0001") return true;
  return /row-level security|permissão|permissao/i.test(String(erro?.message ?? ""));
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

function selecaoDaArea(area, comApelido) {
  const fornecedor = comApelido ? `${COLUNAS_FORNECEDOR},${COLUNA_APELIDO}` : COLUNAS_FORNECEDOR;
  return [
    "id",
    "fornecedor_id",
    "secretaria_id",
    "valor",
    "observacoes",
    "situacao",
    "ativo",
    "criado_em",
    "criado_por",
    "atualizado_em",
    "atualizado_por",
    area.colunasProprias,
    `fornecedores(${fornecedor})`,
    "secretarias(nome)",
  ].join(",");
}

/**
 * Registros de uma área, já com o fornecedor, a secretaria e as NFs vinculadas.
 *
 * As notas vêm em uma segunda consulta (e não no mesmo select) porque o vínculo
 * é uma tabela à parte e o id de `valores_em_aberto` varia de banco para banco.
 * Elas voltam em `registro.notas` e alimentam o cálculo de Pago e Saldo.
 *
 * Somente registros ativos: inativado não aparece na listagem.
 */
export async function carregarRegistrosDaArea(areaId, { incluirInativos = false } = {}) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const consultar = (comApelido) => {
    let consulta = supabase.from(area.tabela).select(selecaoDaArea(area, comApelido));
    if (!incluirInativos) consulta = consulta.eq("ativo", true);
    return consulta.order("criado_em", { ascending: false });
  };

  let resposta = await consultar(true);
  // Apelido ainda não criado neste banco: repete sem a coluna, como as outras
  // telas. Tabela inteira faltando é outra história (a migration desta parte
  // não foi rodada) e sobe como erro, para a tela mostrar o recado da migration.
  if (resposta.error && !tabelaAusente(resposta.error) && estruturaDeApelidoAusente(resposta.error)) {
    resposta = await consultar(false);
  }
  if (resposta.error) throw resposta.error;

  const registros = resposta.data ?? [];
  const notasPorRegistro = await carregarNotasVinculadas(area, registros.map((r) => r.id));
  return registros.map((registro) => ({
    ...registro,
    area: area.id,
    notas: notasPorRegistro.get(String(registro.id)) ?? [],
  }));
}

/**
 * As NFs vinculadas a um conjunto de registros, em duas idas ao banco: os
 * vínculos e depois as notas. É esta leitura que faz Pago e Saldo saírem das
 * baixas das notas, e não de um valor gravado no registro.
 */
async function carregarNotasVinculadas(area, registroIds) {
  const mapa = new Map();
  if (!registroIds.length) return mapa;

  const { data: vinculos, error } = await supabase
    .from(area.tabelaNotas)
    .select(`id,${area.colunaRegistro},valor_em_aberto_id`)
    .in(area.colunaRegistro, registroIds);
  if (error) throw error;
  if (!vinculos?.length) return mapa;

  const notaIds = [...new Set(vinculos.map((v) => v.valor_em_aberto_id))];
  const { data: notas, error: erroNotas } = await supabase
    .from("valores_em_aberto")
    .select(COLUNAS_NOTA)
    .in("id", notaIds);
  if (erroNotas) throw erroNotas;

  const porId = new Map((notas ?? []).map((nota) => [String(nota.id), nota]));
  vinculos.forEach((vinculo) => {
    const nota = porId.get(String(vinculo.valor_em_aberto_id));
    if (!nota) return;
    const chave = String(vinculo[area.colunaRegistro]);
    const lista = mapa.get(chave) ?? [];
    lista.push({ ...nota, vinculo_id: vinculo.id });
    mapa.set(chave, lista);
  });
  return mapa;
}

/**
 * NFs/processos do fornecedor que podem ser vinculados a um registro.
 *
 * Somente-leitura: nenhuma nota é criada, alterada ou baixada aqui. Traz também
 * as já quitadas, porque uma NF paga é justamente a que explica o Pago do
 * registro — e `jaVinculadas` marca as que já estão neste registro.
 */
export async function carregarNotasDoFornecedor(fornecedorId, { somenteComSaldo = false } = {}) {
  if (!fornecedorId) return [];
  let consulta = supabase
    .from("valores_em_aberto")
    .select(COLUNAS_NOTA)
    .eq("fornecedor_id", fornecedorId)
    .order("data_vencimento", { ascending: true, nullsFirst: false });
  if (somenteComSaldo) consulta = consulta.in("situacao", SITUACOES_COM_SALDO);

  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

/** Secretarias para o campo e para o filtro (as mesmas da aba "Todos"). */
export async function carregarSecretariasDasAreas() {
  const { data, error } = await supabase.from("secretarias").select("id,nome").order("nome");
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

async function usuarioAtualId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

/**
 * Cria o registro da área para um fornecedor QUE JÁ EXISTE.
 *
 * Nenhum cadastro de fornecedor é criado ou alterado: o formulário guarda o id
 * do fornecedor escolhido na busca. Vincular NF é um passo separado e opcional.
 */
export async function criarRegistro(areaId, formulario) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const autor = await usuarioAtualId();
  const linha = { ...registroParaBanco(area, formulario), criado_por: autor };

  const { data, error } = await supabase.from(area.tabela).insert(linha).select("id").single();
  if (error) throw error;

  await registrarEvento({
    modulo: area.modulo,
    acao: "criou",
    registroAfetado: identificacaoDoRegistro(area, { ...formulario, fornecedores: formulario.fornecedor }),
    valorNovo: linha,
    usuarioId: autor,
  });
  return data;
}

/**
 * Altera o registro. A auditoria guarda somente o que mudou, com o antes e o
 * depois — inclusive quando o que mudou foi o valor ou a situação.
 */
export async function atualizarRegistro(areaId, registroAnterior, formulario) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const autor = await usuarioAtualId();
  const linha = {
    ...registroParaBanco(area, formulario),
    atualizado_em: new Date().toISOString(),
    atualizado_por: autor,
  };

  const { error } = await supabase.from(area.tabela).update(linha).eq("id", registroAnterior.id);
  if (error) throw error;

  const diferenca = diferencaParaAuditoria(area, registroAnterior, linha);
  if (diferenca) {
    const mudouDinheiroOuSituacao =
      Object.prototype.hasOwnProperty.call(diferenca.antes, "valor") ||
      Object.prototype.hasOwnProperty.call(diferenca.antes, "situacao");
    await registrarEvento({
      modulo: area.modulo,
      acao: mudouDinheiroOuSituacao ? "alterou_valor_situacao" : "alterou",
      registroAfetado: identificacaoDoRegistro(area, registroAnterior),
      valorAnterior: diferenca.antes,
      valorNovo: diferenca.depois,
      usuarioId: autor,
    });
  }
  return diferenca;
}

/**
 * Inativa ou reativa o registro — a exclusão desta área é lógica, a linha
 * continua no banco com o histórico e os vínculos dela.
 */
export async function definirAtivoRegistro(areaId, registro, ativo) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();
  const linha = ativo
    ? { ativo: true, inativado_em: null, inativado_por: null, atualizado_em: agora, atualizado_por: autor }
    : { ativo: false, inativado_em: agora, inativado_por: autor, atualizado_em: agora, atualizado_por: autor };

  const { error } = await supabase.from(area.tabela).update(linha).eq("id", registro.id);
  if (error) throw error;

  await registrarEvento({
    modulo: area.modulo,
    acao: ativo ? "reativou" : "inativou",
    registroAfetado: identificacaoDoRegistro(area, registro),
    valorAnterior: { ativo: !ativo },
    valorNovo: { ativo },
    nivel: ativo ? "informacao" : "atencao",
    usuarioId: autor,
  });
}

/**
 * Vincula ao registro uma NF/processo QUE JÁ EXISTE do fornecedor.
 *
 * A NF não é criada nem alterada: só nasce a linha do vínculo. É por esse
 * vínculo que as baixas daquela NF passam a contar no Pago do registro.
 */
export async function vincularNota(areaId, registro, nota) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const autor = await usuarioAtualId();
  const { error } = await supabase.from(area.tabelaNotas).insert({
    [area.colunaRegistro]: registro.id,
    valor_em_aberto_id: nota.id,
    criado_por: autor,
  });
  if (error) throw error;

  await registrarEvento({
    modulo: area.modulo,
    acao: "vinculou_nota",
    registroAfetado: identificacaoDoRegistro(area, registro),
    valorNovo: {
      valor_em_aberto_id: nota.id,
      numero_nota_fiscal: nota.numero_nota_fiscal ?? null,
      numero_processo: nota.numero_processo ?? null,
    },
    usuarioId: autor,
  });
}

/**
 * Desfaz o vínculo. Apaga somente a linha do vínculo: a NF, o valor em aberto e
 * as baixas dela continuam exatamente como estavam — o que muda é que aquela
 * nota deixa de contar no Pago deste registro.
 */
export async function desvincularNota(areaId, registro, nota) {
  const area = AREAS.find((a) => a.id === areaId);
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);

  const autor = await usuarioAtualId();
  const { error } = await supabase
    .from(area.tabelaNotas)
    .delete()
    .eq(area.colunaRegistro, registro.id)
    .eq("valor_em_aberto_id", nota.id);
  if (error) throw error;

  await registrarEvento({
    modulo: area.modulo,
    acao: "desvinculou_nota",
    registroAfetado: identificacaoDoRegistro(area, registro),
    valorAnterior: {
      valor_em_aberto_id: nota.id,
      numero_nota_fiscal: nota.numero_nota_fiscal ?? null,
      numero_processo: nota.numero_processo ?? null,
    },
    usuarioId: autor,
  });
}
