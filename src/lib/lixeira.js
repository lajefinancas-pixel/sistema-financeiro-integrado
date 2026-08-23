import { supabase } from "./supabaseClient";
import { registrarEvento } from "./auditoria";
import { erroAmigavel } from "./erros";
import { suportaExclusaoLogica } from "./exclusaoRegistros";
import { formatBRL, paraNumeroMoeda } from "./moeda";

/**
 * Camada de dados da Lixeira (Configurações > Sistema > Lixeira).
 *
 * A Lixeira NÃO cria nenhuma forma nova de excluir: ela lê o que a exclusão
 * lógica já grava (`excluido_em` / `excluido_por` em fornecedores, certidões e
 * pagamentos) e oferece as duas saídas que faltavam para esses registros —
 * voltar às listagens ou sair do banco de vez.
 *
 * Duas permissões distintas comandam a tela, ambas no módulo 'administracao':
 *   * pode_editar   -> abrir a Lixeira e restaurar (ação reversível);
 *   * pode_excluir  -> excluir definitivamente, e apenas para o perfil
 *                      Administrador (ação irreversível).
 * O banco repete as duas checagens nas funções public.restaurar_registro e
 * public.excluir_definitivamente: a tela esconder o botão não é a tranca.
 */

export const MODULO = "administracao";

/** Quantos registros de cada tabela a Lixeira carrega por vez. */
const LIMITE_POR_TIPO = 300;

/** Janela, em minutos, para casar o registro excluído com o evento de auditoria. */
const JANELA_AUDITORIA_MIN = 30;

export const TIPOS = {
  fornecedores: { valor: "fornecedores", label: "Fornecedor", plural: "Fornecedores", modulo: "fornecedores" },
  certidoes: { valor: "certidoes", label: "Certidão", plural: "Certidões", modulo: "certidoes" },
  pagamentos: { valor: "pagamentos", label: "Pagamento", plural: "Pagamentos", modulo: "pagamentos" },
};

export const OPCOES_TIPO = Object.values(TIPOS).map((t) => ({ valor: t.valor, label: t.label }));

export function tipoInfo(valor) {
  return TIPOS[valor] ?? { valor, label: valor ?? "--", plural: valor ?? "--", modulo: valor };
}

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

export function ehAdministrador(usuario) {
  return /administrador/i.test(String(usuario?.perfis_acesso?.nome ?? ""));
}

/** Abrir a Lixeira e restaurar: permissão elevada no módulo Administração. */
export function podeGerenciarLixeira(permissao) {
  return permissao?.pode_editar === true;
}

/** Apagar de vez: permissão própria E perfil Administrador. */
export function podeExcluirDefinitivamente(permissao, usuario) {
  return permissao?.pode_excluir === true && ehAdministrador(usuario);
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export const FILTROS_VAZIOS = {
  tipo: "",
  usuarioId: "",
  dataInicial: "",
  dataFinal: "",
};

export function filtroPreenchido(filtros) {
  return Object.keys(FILTROS_VAZIOS).some((campo) => String(filtros?.[campo] ?? "").trim() !== "");
}

export function quantidadeDeFiltros(filtros) {
  return Object.keys(FILTROS_VAZIOS).filter((campo) => String(filtros?.[campo] ?? "").trim() !== "").length;
}

export function formatarDataHora(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "--";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatarData(iso) {
  if (!iso) return "--";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "--";
  return `${dia}/${mes}/${ano}`;
}

/** Aplica período e usuário sobre a lista já montada (os três tipos juntos). */
export function aplicarFiltros(itens, filtros) {
  const f = filtros ?? {};
  const de = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00`).getTime() : null;
  const ate = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999`).getTime() : null;

  return itens.filter((item) => {
    if (f.tipo && item.tipo !== f.tipo) return false;
    if (f.usuarioId && String(item.excluidoPor ?? "") !== String(f.usuarioId)) return false;
    if (de || ate) {
      const instante = item.excluidoEm ? new Date(item.excluidoEm).getTime() : null;
      if (instante === null || Number.isNaN(instante)) return false;
      if (de && instante < de) return false;
      if (ate && instante > ate) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Leitura dos registros excluídos
// ---------------------------------------------------------------------------

function nomeDoFornecedor(fornecedor) {
  return String(fornecedor?.razao_social || fornecedor?.nome_fantasia || "").trim() || "Fornecedor sem nome";
}

/**
 * Cada listagem devolve o mesmo formato, para a tela tratar os três tipos
 * igual: `rotulo` é a identificação principal e reproduz o texto gravado em
 * `registro_afetado` na auditoria da exclusão — é ele que reencontra o motivo.
 */
async function listarFornecedores() {
  const { data, error } = await supabase
    .from("fornecedores")
    .select("id, razao_social, nome_fantasia, cpf_cnpj, ativo, excluido_em, excluido_por, secretarias ( nome )")
    .not("excluido_em", "is", null)
    .order("excluido_em", { ascending: false })
    .limit(LIMITE_POR_TIPO);
  if (error) throw error;

  return (data ?? []).map((linha) => {
    const nome = nomeDoFornecedor(linha);
    return {
      chave: `fornecedores:${linha.id}`,
      tipo: "fornecedores",
      id: linha.id,
      titulo: nome,
      rotulo: linha.cpf_cnpj ? `${nome} (${linha.cpf_cnpj})` : nome,
      detalhes: [
        { rotulo: "CNPJ/CPF", valor: linha.cpf_cnpj || "--" },
        { rotulo: "Secretaria", valor: linha.secretarias?.nome || "--" },
        { rotulo: "Nome fantasia", valor: linha.nome_fantasia || "--" },
      ],
      excluidoEm: linha.excluido_em,
      excluidoPor: linha.excluido_por,
      situacao: null,
    };
  });
}

async function listarCertidoes() {
  const { data, error } = await supabase
    .from("certidoes")
    .select(
      "id, numero_documento, data_emissao, data_vencimento, situacao, excluido_em, excluido_por, " +
        "fornecedores ( razao_social, nome_fantasia ), tipos_certidao ( nome )",
    )
    .not("excluido_em", "is", null)
    .order("excluido_em", { ascending: false })
    .limit(LIMITE_POR_TIPO);
  if (error) throw error;

  return (data ?? []).map((linha) => {
    const tipo = linha.tipos_certidao?.nome ?? "Certidão";
    const fornecedor = nomeDoFornecedor(linha.fornecedores);
    return {
      chave: `certidoes:${linha.id}`,
      tipo: "certidoes",
      id: linha.id,
      titulo: `${tipo} — ${fornecedor}`,
      // descricaoParaAuditoria() grava exatamente este formato na exclusão.
      rotulo: `${tipo} — ${fornecedor}`,
      detalhes: [
        { rotulo: "Fornecedor", valor: fornecedor },
        { rotulo: "Número", valor: linha.numero_documento || "--" },
        { rotulo: "Emissão", valor: formatarData(linha.data_emissao) },
        { rotulo: "Vencimento", valor: linha.data_vencimento ? formatarData(linha.data_vencimento) : "--" },
      ],
      excluidoEm: linha.excluido_em,
      excluidoPor: linha.excluido_por,
      situacao: linha.situacao ?? null,
    };
  });
}

async function listarPagamentos() {
  const { data, error } = await supabase
    .from("pagamentos")
    .select(
      "id, valor_a_pagar, descricao, nome_avulso, situacao, excluido_em, excluido_por, " +
        "fornecedores ( razao_social ), valores_em_aberto ( numero_nota_fiscal )",
    )
    .not("excluido_em", "is", null)
    .order("excluido_em", { ascending: false })
    .limit(LIMITE_POR_TIPO);
  if (error) throw error;

  return (data ?? []).map((linha) => {
    const nome = linha.fornecedores?.razao_social || linha.nome_avulso || "Pagamento avulso";
    const nota = linha.valores_em_aberto?.numero_nota_fiscal ?? null;
    return {
      chave: `pagamentos:${linha.id}`,
      tipo: "pagamentos",
      id: linha.id,
      titulo: nome,
      // Mesmo rótulo montado na exclusão do pagamento.
      rotulo: nota ? `${nome} — NF ${nota}` : nome,
      detalhes: [
        { rotulo: "Fornecedor", valor: nome },
        { rotulo: "Nota fiscal", valor: nota ?? "--" },
        { rotulo: "Valor", valor: formatBRL(paraNumeroMoeda(linha.valor_a_pagar)) },
        { rotulo: "Descrição", valor: linha.descricao || "--" },
      ],
      excluidoEm: linha.excluido_em,
      excluidoPor: linha.excluido_por,
      situacao: linha.situacao ?? null,
    };
  });
}

const LISTAGENS = {
  fornecedores: listarFornecedores,
  certidoes: listarCertidoes,
  pagamentos: listarPagamentos,
};

/** Nome de quem excluiu, resolvido em uma consulta só para os três tipos. */
async function nomesDosUsuarios(itens) {
  const ids = [...new Set(itens.map((i) => i.excluidoPor).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabase.from("usuarios").select("id, nome_completo").in("id", ids);
    if (error) throw error;
    return new Map((data ?? []).map((u) => [String(u.id), u.nome_completo]));
  } catch {
    return new Map();
  }
}

/**
 * Motivo informado na exclusão.
 *
 * O motivo não fica no registro: ele foi gravado na trilha de auditoria, em
 * `valor_novo.motivo_exclusao` do evento 'excluiu'. O reencontro usa o par
 * (módulo, registro afetado) e o instante da exclusão — o evento é registrado
 * logo depois do UPDATE, então os dois horários ficam a segundos de distância.
 * Cada evento é consumido uma vez, para dois registros de mesmo nome não
 * herdarem o mesmo motivo. Sem permissão de leitura na auditoria, o motivo
 * simplesmente não aparece: a Lixeira continua funcionando.
 */
async function motivosDaExclusao(itens) {
  const motivos = new Map();
  if (itens.length === 0) return motivos;

  const instantes = itens
    .map((i) => (i.excluidoEm ? new Date(i.excluidoEm).getTime() : null))
    .filter((valor) => valor !== null && !Number.isNaN(valor));
  if (instantes.length === 0) return motivos;

  const desde = new Date(Math.min(...instantes) - JANELA_AUDITORIA_MIN * 60 * 1000).toISOString();

  let eventos = [];
  try {
    const { data, error } = await supabase
      .from("auditoria_eventos")
      .select("id, data_hora, modulo, registro_afetado, valor_novo")
      .eq("acao", "excluiu")
      .in("modulo", Object.keys(TIPOS))
      .gte("data_hora", desde)
      .order("data_hora", { ascending: false })
      .limit(1000);
    if (error) throw error;
    eventos = data ?? [];
  } catch {
    return motivos;
  }

  const usados = new Set();
  const janela = JANELA_AUDITORIA_MIN * 60 * 1000;

  for (const item of itens) {
    const instante = item.excluidoEm ? new Date(item.excluidoEm).getTime() : null;
    if (instante === null || Number.isNaN(instante)) continue;

    let escolhido = null;
    let melhor = null;
    for (const evento of eventos) {
      if (usados.has(evento.id)) continue;
      if (evento.modulo !== tipoInfo(item.tipo).modulo) continue;
      const distancia = Math.abs(new Date(evento.data_hora).getTime() - instante);
      if (Number.isNaN(distancia) || distancia > janela) continue;
      // O rótulo idêntico é o casamento certo; a proximidade no tempo é o
      // desempate quando o texto do evento não bate (registro renomeado, por
      // exemplo).
      const exato = String(evento.registro_afetado ?? "") === item.rotulo;
      const nota = (exato ? 0 : 1) * 1e12 + distancia;
      if (melhor === null || nota < melhor) {
        melhor = nota;
        escolhido = evento;
      }
    }

    if (escolhido) {
      usados.add(escolhido.id);
      const motivo = String(escolhido.valor_novo?.motivo_exclusao ?? "").trim();
      if (motivo) motivos.set(item.chave, motivo);
    }
  }

  return motivos;
}

/**
 * Tudo que está na Lixeira, do mais recente para o mais antigo.
 *
 * Um tipo que falhe (sem permissão de leitura no módulo, tabela ausente) não
 * derruba a tela: ele entra em `indisponiveis` e os demais continuam listados.
 *
 * @returns { itens, indisponiveis, semSuporte }
 */
export async function listarLixeira() {
  const tipos = Object.keys(TIPOS);

  const suportes = await Promise.all(tipos.map((tipo) => suportaExclusaoLogica(tipo)));
  const semSuporte = tipos.filter((_, i) => !suportes[i]);
  const disponiveis = tipos.filter((_, i) => suportes[i]);

  const resultados = await Promise.all(
    disponiveis.map((tipo) =>
      LISTAGENS[tipo]()
        .then((itens) => ({ tipo, itens }))
        .catch(() => ({ tipo, itens: null })),
    ),
  );

  const indisponiveis = resultados.filter((r) => r.itens === null).map((r) => r.tipo);
  const itens = resultados
    .filter((r) => r.itens !== null)
    .flatMap((r) => r.itens)
    .sort((a, b) => String(b.excluidoEm ?? "").localeCompare(String(a.excluidoEm ?? "")));

  const [nomes, motivos] = await Promise.all([nomesDosUsuarios(itens), motivosDaExclusao(itens)]);

  return {
    itens: itens.map((item) => ({
      ...item,
      excluidoPorNome: item.excluidoPor ? nomes.get(String(item.excluidoPor)) ?? null : null,
      motivo: motivos.get(item.chave) ?? null,
    })),
    indisponiveis,
    semSuporte,
  };
}

/** Quem aparece no filtro "excluído por" — só quem de fato excluiu algo. */
export function usuariosDaLixeira(itens) {
  const mapa = new Map();
  itens.forEach((item) => {
    if (!item.excluidoPor) return;
    const id = String(item.excluidoPor);
    if (!mapa.has(id)) mapa.set(id, item.excluidoPorNome || "Usuário não identificado");
  });
  return [...mapa.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Vínculos que impedem a exclusão definitiva
// ---------------------------------------------------------------------------

/**
 * Conta TODAS as linhas ligadas ao registro, inclusive as que já estão na
 * Lixeira: apagar a linha de vez deixaria a referência delas apontando para o
 * vazio, então elas bloqueiam do mesmo jeito.
 */
async function contarVinculo(tabela, coluna, id) {
  try {
    const { count, error } = await supabase
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .eq(coluna, id);
    if (error) throw error;
    return count ?? 0;
  } catch {
    // Sem leitura na tabela o vínculo não pode ser confirmado aqui; o banco
    // repete a checagem na exclusão definitiva e barra de qualquer forma.
    return 0;
  }
}

function frase(quantidade, singular, plural) {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`;
}

/**
 * Vínculos que impedem apagar o registro de vez.
 *
 * Mesma lógica do bloqueio já usado na exclusão lógica de fornecedores, com o
 * acréscimo dos valores em aberto (que também apontam para o cadastro) e dos
 * débitos em conta de um pagamento efetivado.
 *
 * @returns { total, texto } — `texto` é null quando nada impede.
 */
export async function vinculosDaExclusaoDefinitiva(item) {
  const partes = [];

  if (item.tipo === "fornecedores") {
    const [pagamentos, certidoes, valores] = await Promise.all([
      contarVinculo("pagamentos", "fornecedor_id", item.id),
      contarVinculo("certidoes", "fornecedor_id", item.id),
      contarVinculo("valores_em_aberto", "fornecedor_id", item.id),
    ]);
    if (pagamentos > 0) partes.push(frase(pagamentos, "pagamento", "pagamentos"));
    if (certidoes > 0) partes.push(frase(certidoes, "certidão", "certidões"));
    if (valores > 0) partes.push(frase(valores, "valor em aberto", "valores em aberto"));
  }

  if (item.tipo === "pagamentos") {
    const movimentacoes = await contarVinculo("pagamento_movimentacoes", "pagamento_id", item.id);
    if (movimentacoes > 0) {
      partes.push(`${frase(movimentacoes, "lançamento", "lançamentos")} de débito em conta`);
    }
  }

  return { total: partes.length, texto: partes.length ? partes.join(" e ") : null };
}

/** Frase completa do bloqueio, pronta para o modal. */
export function textoDoBloqueio(item, vinculos) {
  if (!vinculos?.texto) return null;
  const rotulo = tipoInfo(item.tipo).label.toLowerCase();
  return (
    `Este ${rotulo} ainda tem ${vinculos.texto} no sistema. Apagar o registro do banco ` +
    "deixaria esses lançamentos sem origem, então a exclusão definitiva está bloqueada. " +
    "Ele continua na Lixeira e pode ser restaurado."
  );
}

// ---------------------------------------------------------------------------
// Restaurar e excluir definitivamente
// ---------------------------------------------------------------------------

/** A função ainda não existe no banco (migration da Lixeira não aplicada). */
function funcaoAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["PGRST202", "PGRST302", "404", "42883"].includes(codigo)) return true;
  return /(function|rpc).*(does not exist|not found|schema cache)/i.test(String(erro?.message ?? ""));
}

const MENSAGENS_RPC = {
  sem_permissao: "Você não tem permissão para concluir esta ação.",
  tabela_invalida: "Este tipo de registro não é tratado pela Lixeira.",
  registro_nao_encontrado: "Este registro não está mais na Lixeira. Atualize a tela.",
  registro_vigente: "Este registro já foi restaurado e não pode ser apagado por aqui.",
  justificativa_obrigatoria: "Informe a justificativa da exclusão definitiva.",
};

function falharRpc(resposta, item) {
  if (resposta?.motivo === "possui_vinculos") {
    return erroAmigavel(textoDoBloqueio(item, { texto: resposta.vinculos }) ?? "Este registro tem vínculos no sistema.");
  }
  return erroAmigavel(MENSAGENS_RPC[resposta?.motivo] ?? "Não foi possível concluir esta ação.");
}

/**
 * Restaura o registro: limpa `excluido_em` e `excluido_por` e ele volta a
 * aparecer nas listagens normais. O fornecedor também volta a ficar ativo,
 * porque a exclusão o marcou como inativo junto.
 *
 * Registra 'restaurou' no módulo do registro — pela própria função do banco,
 * na mesma transação, ou pela tela quando a migration ainda não foi aplicada.
 */
export async function restaurarRegistro(item, { usuarioId = null } = {}) {
  const { data, error } = await supabase.rpc("restaurar_registro", {
    p_tabela: item.tipo,
    p_id: String(item.id),
    p_rotulo: item.rotulo,
  });

  if (error && !funcaoAusente(error)) throw error;

  if (!error) {
    if (data?.ok === false) throw falharRpc(data, item);
    // Já restaurado por outra pessoa: nada aconteceu agora, nada a auditar.
    if (data?.ja_restaurado) return { restaurado: false };
    if (data?.auditado) return { restaurado: true };
  } else {
    const campos = { excluido_em: null, excluido_por: null };
    if (item.tipo === "fornecedores") campos.ativo = true;
    const { error: erroUpdate } = await supabase.from(item.tipo).update(campos).eq("id", item.id);
    if (erroUpdate) throw erroUpdate;
  }

  await registrarEvento({
    modulo: tipoInfo(item.tipo).modulo,
    acao: "restaurou",
    registroAfetado: item.rotulo,
    valorAnterior: { situacao: "Excluído do sistema (exclusão lógica)", excluido_em: item.excluidoEm },
    valorNovo: { situacao: "Restaurado pela Lixeira do sistema" },
    nivel: "atencao",
    usuarioId,
  });

  return { restaurado: true };
}

/**
 * Apaga o registro do banco de verdade — não há volta.
 *
 * O trabalho é feito pela função public.excluir_definitivamente: ela confere a
 * permissão, a justificativa, se o registro está mesmo na Lixeira e os vínculos,
 * apaga a linha e grava o evento crítico 'excluiu_definitivamente' com a cópia
 * integral do registro na mesma transação — depois do DELETE, a trilha de
 * auditoria é o único lugar onde ele ainda existe.
 */
export async function excluirDefinitivamente(item, { motivo, usuarioId = null } = {}) {
  const justificativa = String(motivo ?? "").trim();
  if (justificativa.length < 5) {
    throw erroAmigavel("Informe a justificativa da exclusão definitiva (pelo menos 5 caracteres).");
  }

  const { data, error } = await supabase.rpc("excluir_definitivamente", {
    p_tabela: item.tipo,
    p_id: String(item.id),
    p_motivo: justificativa,
    p_rotulo: item.rotulo,
  });

  if (error && !funcaoAusente(error)) throw error;

  if (!error) {
    if (data?.ok === false) throw falharRpc(data, item);
    if (data?.auditado) return { excluido: true };
  } else {
    // Banco sem a migration da Lixeira: a tela confere os vínculos, apaga e
    // audita por conta própria.
    const vinculos = await vinculosDaExclusaoDefinitiva(item);
    if (vinculos.texto) throw erroAmigavel(textoDoBloqueio(item, vinculos));

    const { error: erroDelete } = await supabase.from(item.tipo).delete().eq("id", item.id);
    if (erroDelete) throw erroDelete;
  }

  await registrarEvento({
    modulo: tipoInfo(item.tipo).modulo,
    acao: "excluiu_definitivamente",
    registroAfetado: item.rotulo,
    valorAnterior: {
      registro: item.titulo,
      ...Object.fromEntries(item.detalhes.map((d) => [d.rotulo, d.valor])),
      excluido_em: item.excluidoEm,
    },
    valorNovo: {
      situacao: "Apagado permanentemente do banco de dados",
      motivo_exclusao: justificativa,
    },
    nivel: "critico",
    usuarioId,
  });

  return { excluido: true };
}
