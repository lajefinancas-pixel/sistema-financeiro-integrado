import { supabase } from "./supabaseClient";
import { estruturaDeApelidoAusente } from "./nomesFornecedor.js";
import { erroAmigavel } from "./erros";
import { excluirRegistro, filtroVigentes } from "./exclusaoRegistros";
import { SITUACOES_MANUAIS, situacaoPorData } from "./certidoesRegras";

/**
 * Camada de dados da página "Certidões".
 *
 * Tabelas usadas (migration 20260823120000_certidoes_fornecedores.sql):
 *   tipos_certidao -> catálogo dos tipos de documento (Federal, FGTS, CNPJ...),
 *                     cada um dizendo se vence e em quantos dias;
 *   certidoes      -> a certidão de um fornecedor, com o anexo no bucket
 *                     "certidoes-anexos";
 *   fornecedores_identificacao -> opções seguras do campo "Fornecedor";
 *   usuarios       -> nome de quem cadastrou a certidão.
 *
 * A situação é gravada no cadastro, mas a tela reavalia pelas datas na hora de
 * exibir: uma certidão salva como "válida" não pode continuar válida depois de
 * a data de vencimento passar. Ver `situacaoEfetiva`.
 *
 * As regras de situação e de vigência ("quem vale por tipo") moram em
 * lib/certidoesRegras.js, um módulo puro compartilhado por todas as telas. Elas
 * são reexportadas aqui para que quem já importava daqui continue funcionando.
 */

export const MODULO = "certidoes";

export const BUCKET_ANEXOS = "certidoes-anexos";

export const SITUACOES = {
  valida: { label: "Válida", cor: "#15803D", bg: "#EAFBF0", ponto: "#16A34A" },
  a_vencer: { label: "A vencer", cor: "#A16207", bg: "#FEF7DF", ponto: "#CA8A04" },
  vencida: { label: "Vencida", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
  sem_vencimento: { label: "Sem vencimento", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" },
  em_renovacao: { label: "Em renovação", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
};

/**
 * Situação usada só na exibição: o fornecedor que ainda não tem nenhuma
 * certidão registrada. Não é um valor gravável em certidoes.situacao — o banco
 * aceita apenas os cinco de SITUACOES —, por isso fica fora do catálogo e não
 * aparece no cadastro; serve aos filtros e à listagem.
 */
export const SITUACAO_NAO_CADASTRADA = "nao_cadastrada";

const SITUACOES_EXIBICAO = {
  ...SITUACOES,
  [SITUACAO_NAO_CADASTRADA]: {
    label: "Não cadastrada",
    cor: "#7C3AED",
    bg: "#F3EDFF",
    ponto: "#7C3AED",
  },
};

export function situacaoInfo(valor) {
  return (
    SITUACOES_EXIBICAO[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" }
  );
}

/** Opções do select de situação no cadastro. */
export const OPCOES_SITUACAO = Object.entries(SITUACOES).map(([id, info]) => ({ id, label: info.label }));

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/**
 * Datas, situação por data e vigência por tipo vêm do módulo puro de regras.
 * Reexportadas para não mudar nenhum import existente.
 */
export {
  DIAS_ALERTA_VENCIMENTO,
  anotarVigencia,
  chaveDoDocumento,
  contarRegularidade,
  diasAte,
  ehVigenteNoTipo,
  hojeISO,
  situacaoEfetiva,
  situacaoPorData,
  somenteAnteriores,
  somenteVigentes,
  temVencimento,
} from "./certidoesRegras";

/** Data ISO exibida como dd/mm/aaaa. Datas vazias viram "--". */
export function formatarData(iso) {
  if (!iso) return "--";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "--";
  return `${dia}/${mes}/${ano}`;
}

/** Emissão + prazo padrão do tipo = vencimento sugerido no cadastro. */
export function vencimentoSugerido(dataEmissao, prazoDias) {
  if (!dataEmissao || !prazoDias) return "";
  const base = new Date(`${String(dataEmissao).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + Number(prazoDias));
  // Montado campo a campo (e não por toISOString) para não escorregar um dia
  // por causa do fuso horário.
  const mes = String(base.getMonth() + 1).padStart(2, "0");
  const dia = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${mes}-${dia}`;
}

// ---------------------------------------------------------------------------
// Tipos de certidão
// ---------------------------------------------------------------------------

const COLUNAS_TIPO =
  "id, nome, descricao, possui_vencimento, prazo_padrao_dias, obrigatorio, ativo, criado_em";

export async function listarTipos() {
  const { data, error } = await supabase.from("tipos_certidao").select(COLUNAS_TIPO).order("nome");
  if (error) throw error;
  return data ?? [];
}

/** Normaliza o formulário de tipo antes de gravar (nome obrigatório, prazo só quando vence). */
function prepararTipo(campos) {
  const nome = String(campos.nome ?? "").trim();
  if (!nome) throw erroAmigavel("Informe o nome do tipo de documento.");

  const possuiVencimento = campos.possui_vencimento !== false;
  const prazo = Number(campos.prazo_padrao_dias);

  return {
    nome,
    descricao: String(campos.descricao ?? "").trim() || null,
    possui_vencimento: possuiVencimento,
    prazo_padrao_dias: possuiVencimento && Number.isFinite(prazo) && prazo > 0 ? Math.trunc(prazo) : null,
    obrigatorio: campos.obrigatorio === true,
    ativo: campos.ativo !== false,
  };
}

export async function criarTipo(campos) {
  const { data, error } = await supabase
    .from("tipos_certidao")
    .insert(prepararTipo(campos))
    .select(COLUNAS_TIPO)
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarTipo(id, campos) {
  const { data, error } = await supabase
    .from("tipos_certidao")
    .update(prepararTipo(campos))
    .eq("id", id)
    .select(COLUNAS_TIPO)
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Fornecedores (somente leitura — o cadastro continua na tela de Fornecedores)
// ---------------------------------------------------------------------------

const COLUNAS_IDENTIFICACAO = "id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, ativo";

export async function listarFornecedores() {
  // O apelido entra na consulta para a busca de fornecedor encontrá-lo também
  // aqui. Enquanto a migration do apelido não rodar, a lista vem como sempre.
  const consultar = (colunas) =>
    supabase
      .from("fornecedores_identificacao")
      .select(colunas)
      .order("razao_social", { nullsFirst: false });

  let { data, error } = await consultar(`${COLUNAS_IDENTIFICACAO}, apelido`);
  if (error && estruturaDeApelidoAusente(error)) {
    ({ data, error } = await consultar(COLUNAS_IDENTIFICACAO));
  }
  if (error) throw error;

  const fornecedores = data ?? [];
  const idsSecretarias = [...new Set(fornecedores.map((item) => item.secretaria_id).filter(Boolean))];
  if (idsSecretarias.length === 0) return fornecedores;

  const { data: secretarias, error: erroSecretarias } = await supabase
    .from("secretarias")
    .select("id, nome")
    .in("id", idsSecretarias);

  if (erroSecretarias) {
    console.error("[Certidões] Não foi possível carregar os nomes das secretarias.", erroSecretarias);
    return fornecedores;
  }

  const secretariaPorId = new Map((secretarias ?? []).map((item) => [String(item.id), item]));
  return fornecedores.map((fornecedor) => ({
    ...fornecedor,
    secretarias: fornecedor.secretaria_id
      ? secretariaPorId.get(String(fornecedor.secretaria_id)) ?? null
      : null,
  }));
}

export function nomeFornecedor(fornecedor) {
  return String(fornecedor?.razao_social || fornecedor?.nome_fantasia || "").trim() || "Fornecedor sem nome";
}

/** Nome da secretaria vinculada ao fornecedor (vazio quando não há vínculo). */
export function nomeSecretaria(fornecedor) {
  return String(fornecedor?.secretarias?.nome ?? "").trim();
}

/** Lista de secretarias distintas presentes nos fornecedores, para o filtro. */
export function secretariasDosFornecedores(fornecedores) {
  const porId = new Map();
  (fornecedores ?? []).forEach((f) => {
    const id = f?.secretaria_id;
    const nome = nomeSecretaria(f);
    if (!id || !nome || porId.has(String(id))) return;
    porId.set(String(id), { id: String(id), nome });
  });
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Certidões
// ---------------------------------------------------------------------------

const COLUNAS_CERTIDAO = `
  id, fornecedor_id, tipo_certidao_id, numero_documento, data_emissao, data_vencimento,
  situacao, observacoes, arquivo_url, responsavel_id, criado_em, atualizado_em,
  substituida_por, substituida_em,
  fornecedores ( id, razao_social, nome_fantasia, cpf_cnpj ),
  tipos_certidao ( id, nome, possui_vencimento, prazo_padrao_dias, obrigatorio ),
  usuarios:usuarios!certidoes_responsavel_id_fkey ( id, nome_completo )
`;

/**
 * Certidão que já foi renovada: continua no banco, mas só para consulta de
 * histórico. Quem vale é a que a substituiu.
 */
export function ehHistorica(certidao) {
  return Boolean(certidao?.substituida_por);
}

/**
 * As certidões VIGENTES — as versões antigas de um documento renovado ficam de
 * fora. É a lista da tela do módulo, do card do Painel Principal e da Vida do
 * Fornecedor: em nenhuma delas uma emissão substituída deveria contar como
 * documento do fornecedor.
 */
export async function listarCertidoes() {
  // As excluídas (exclusão lógica) também ficam de fora — continuam no banco,
  // mas não são mais documento do fornecedor.
  const vigentes = await filtroVigentes("certidoes");
  const { data, error } = await vigentes(
    supabase
      .from("certidoes")
      .select(COLUNAS_CERTIDAO)
      .is("substituida_por", null)
      .order("data_vencimento", { ascending: true, nullsFirst: false })
      .order("criado_em", { ascending: false }),
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * Monta a linha da certidão a partir do formulário.
 * O tipo manda no vencimento: tipo sem vencimento grava data nula e situação
 * "sem vencimento", independentemente do que estiver na tela.
 */
function prepararCertidao(campos, tipo) {
  if (!campos.fornecedor_id) throw erroAmigavel("Selecione o fornecedor.");
  if (!campos.tipo_certidao_id) throw erroAmigavel("Selecione o tipo de certidão.");
  if (!campos.data_emissao) throw erroAmigavel("Informe a data de emissão.");

  const possuiVencimento = tipo?.possui_vencimento !== false;
  const dataVencimento = possuiVencimento ? campos.data_vencimento || null : null;

  if (dataVencimento && dataVencimento < campos.data_emissao) {
    throw erroAmigavel("A data de vencimento não pode ser anterior à data de emissão.");
  }

  const situacaoEscolhida = SITUACOES[campos.situacao] ? campos.situacao : null;
  const situacao = SITUACOES_MANUAIS.includes(situacaoEscolhida)
    ? situacaoEscolhida
    : situacaoPorData(dataVencimento);

  return {
    fornecedor_id: campos.fornecedor_id,
    tipo_certidao_id: campos.tipo_certidao_id,
    numero_documento: String(campos.numero_documento ?? "").trim() || null,
    data_emissao: campos.data_emissao,
    data_vencimento: dataVencimento,
    situacao,
    observacoes: String(campos.observacoes ?? "").trim() || null,
  };
}

export async function criarCertidao(campos, tipo, responsavelId) {
  const linha = {
    ...prepararCertidao(campos, tipo),
    arquivo_url: campos.arquivo_url ?? null,
    responsavel_id: responsavelId ?? null,
  };

  const { data, error } = await supabase.from("certidoes").insert(linha).select(COLUNAS_CERTIDAO).single();
  if (error) throw error;
  return data;
}

export async function atualizarCertidao(id, campos, tipo) {
  const linha = { ...prepararCertidao(campos, tipo), arquivo_url: campos.arquivo_url ?? null };

  const { data, error } = await supabase
    .from("certidoes")
    .update(linha)
    .eq("id", id)
    .select(COLUNAS_CERTIDAO)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Exclui a certidão. A tela só oferece a ação a quem tem pode_excluir no módulo,
 * sempre depois da confirmação padrão e com o motivo preenchido; o RLS confere a
 * permissão de novo no banco.
 *
 * A exclusão é LÓGICA: a linha continua no banco com `excluido_em` e
 * `excluido_por` gravados e some das listagens. No banco que ainda não recebeu a
 * migration a exclusão volta a ser física — e aí os alertas de vencimento saem
 * junto, porque notificacoes.certidao_id é "on delete cascade".
 *
 * @returns { logica: boolean } — se a linha foi marcada ou realmente apagada.
 */
export async function excluirCertidao(id, { usuarioId = null } = {}) {
  return excluirRegistro({ tabela: "certidoes", id, usuarioId });
}

// ---------------------------------------------------------------------------
// Renovação (com histórico preservado)
// ---------------------------------------------------------------------------

/**
 * Renova uma certidão: cadastra a nova emissão e marca a anterior como
 * substituída por ela.
 *
 * A anterior NÃO é apagada nem sobrescrita — ela sai da listagem (que só pede
 * as vigentes) e passa a existir apenas como versão de histórico. O fornecedor
 * e o tipo são sempre os da certidão original: renovar é emitir de novo o mesmo
 * documento, não trocar de documento.
 *
 * Sem arquivo novo, a nova emissão reaproveita o anexo da anterior — quem
 * chama decide isso ao montar `campos.arquivo_url`.
 *
 * O vínculo é feito logo depois do insert. Se ele falhar, a nova emissão é
 * desfeita: o fornecedor não pode terminar a operação com duas certidões
 * vigentes do mesmo documento.
 */
export async function renovarCertidao(anterior, campos, tipo, responsavelId) {
  if (!anterior?.id) throw erroAmigavel("Não foi possível identificar a certidão que será renovada.");
  if (ehHistorica(anterior)) {
    throw erroAmigavel("Esta certidão já foi renovada. Abra a versão vigente para renová-la de novo.");
  }

  const linha = {
    ...prepararCertidao(
      {
        ...campos,
        fornecedor_id: anterior.fornecedor_id,
        tipo_certidao_id: anterior.tipo_certidao_id,
      },
      tipo,
    ),
    arquivo_url: campos.arquivo_url ?? null,
    responsavel_id: responsavelId ?? null,
  };

  const { data: nova, error } = await supabase
    .from("certidoes")
    .insert(linha)
    .select(COLUNAS_CERTIDAO)
    .single();
  if (error) throw error;

  // A condição "ainda vigente" evita que duas renovações simultâneas quebrem a
  // cadeia de versões: a segunda não encontra linha para atualizar.
  const { data: vinculada, error: erroVinculo } = await supabase
    .from("certidoes")
    .update({ substituida_por: nova.id, substituida_em: new Date().toISOString() })
    .eq("id", anterior.id)
    .is("substituida_por", null)
    .select("id");

  if (erroVinculo || !vinculada?.length) {
    await supabase.from("certidoes").delete().eq("id", nova.id);
    throw (
      erroVinculo ??
      erroAmigavel("A certidão anterior não pôde ser marcada como substituída. Nada foi alterado.")
    );
  }

  return nova;
}

/**
 * As versões anteriores de uma certidão, da mais antiga para a mais recente.
 *
 * A cadeia é montada a partir das certidões substituídas do mesmo fornecedor,
 * seguindo os vínculos `substituida_por` para trás desde a versão vigente.
 * Devolve lista vazia quando o documento nunca foi renovado.
 */
export async function listarHistoricoCertidao(certidao) {
  if (!certidao?.id || !certidao?.fornecedor_id) return [];

  const vigentes = await filtroVigentes("certidoes");
  const { data, error } = await vigentes(
    supabase
      .from("certidoes")
      .select(COLUNAS_CERTIDAO)
      .eq("fornecedor_id", certidao.fornecedor_id)
      .not("substituida_por", "is", null),
  );
  if (error) throw error;

  const anteriorDe = new Map((data ?? []).map((linha) => [String(linha.substituida_por), linha]));
  const cadeia = [];
  const visitados = new Set();
  let alvo = String(certidao.id);

  while (anteriorDe.has(alvo) && !visitados.has(alvo)) {
    visitados.add(alvo);
    const anterior = anteriorDe.get(alvo);
    cadeia.unshift(anterior);
    alvo = String(anterior.id);
  }

  return cadeia;
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Como a certidão é identificada na trilha de auditoria: "Certidão Federal —
 * XYZ LTDA". `fornecedor` só é usado quando a linha veio sem o cadastro junto.
 */
export function descricaoParaAuditoria(certidao, fornecedor = null) {
  const tipo = certidao?.tipos_certidao?.nome ?? "Certidão";
  return `${tipo} — ${nomeFornecedor(certidao?.fornecedores ?? fornecedor)}`;
}

/**
 * Foto da certidão nos campos que interessam à trilha (o antes/depois da tela
 * de Auditoria compara exatamente estas chaves).
 */
export function dadosParaAuditoria(certidao) {
  return {
    numero_documento: certidao?.numero_documento ?? null,
    data_emissao: certidao?.data_emissao ?? null,
    data_vencimento: certidao?.data_vencimento ?? null,
    situacao: certidao?.situacao ?? null,
    observacoes: certidao?.observacoes ?? null,
    arquivo: nomeDoAnexo(certidao?.arquivo_url),
  };
}

// ---------------------------------------------------------------------------
// Anexo
// ---------------------------------------------------------------------------

/** Nome seguro para o caminho no Storage (sem acento, espaço ou símbolo). */
function nomeNoStorage(nomeArquivo) {
  const semAcento = String(nomeArquivo ?? "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const limpo = semAcento.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
  return limpo.slice(-120) || "documento";
}

/** Sobe o arquivo para o bucket e devolve a URL pública gravada em arquivo_url. */
export async function enviarArquivo(fornecedorId, arquivo) {
  const caminho = `${fornecedorId ?? "sem-fornecedor"}/${Date.now()}-${nomeNoStorage(arquivo.name)}`;

  const { error } = await supabase.storage
    .from(BUCKET_ANEXOS)
    .upload(caminho, arquivo, { cacheControl: "3600", upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET_ANEXOS).getPublicUrl(caminho);
  return data?.publicUrl ?? null;
}

/**
 * URL que força o download em vez de abrir o arquivo no navegador. O Storage do
 * Supabase entende o parâmetro "download" e devolve o arquivo já com o nome.
 */
export function urlDeDownload(arquivoUrl) {
  if (!arquivoUrl) return null;
  const nome = nomeDoAnexo(arquivoUrl);
  const separador = String(arquivoUrl).includes("?") ? "&" : "?";
  return `${arquivoUrl}${separador}download=${encodeURIComponent(nome ?? "documento")}`;
}

/** Nome do arquivo mostrado na tela, extraído do fim da URL pública. */
export function nomeDoAnexo(arquivoUrl) {
  if (!arquivoUrl) return null;
  const ultimo = decodeURIComponent(String(arquivoUrl).split("/").pop() ?? "");
  // O caminho começa com o carimbo de tempo usado para não colidir nomes.
  return ultimo.replace(/^\d{10,}-/, "") || "documento";
}
