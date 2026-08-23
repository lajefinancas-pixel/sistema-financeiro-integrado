import { supabase } from "./supabaseClient";
import { erroAmigavel } from "./erros";

/**
 * Camada de dados da página "Certidões".
 *
 * Tabelas usadas (migration 20260823120000_certidoes_fornecedores.sql):
 *   tipos_certidao -> catálogo dos tipos de documento (Federal, FGTS, CNPJ...),
 *                     cada um dizendo se vence e em quantos dias;
 *   certidoes      -> a certidão de um fornecedor, com o anexo no bucket
 *                     "certidoes-anexos";
 *   fornecedores   -> opções do campo "Fornecedor" (somente leitura);
 *   usuarios       -> nome de quem cadastrou a certidão.
 *
 * A situação é gravada no cadastro, mas a tela reavalia pelas datas na hora de
 * exibir: uma certidão salva como "válida" não pode continuar válida depois de
 * a data de vencimento passar. Ver `situacaoEfetiva`.
 */

export const MODULO = "certidoes";

export const BUCKET_ANEXOS = "certidoes-anexos";

/** Dias antes do vencimento em que a certidão passa a ser exibida como "a vencer". */
export const DIAS_ALERTA_VENCIMENTO = 30;

export const SITUACOES = {
  valida: { label: "Válida", cor: "#15803D", bg: "#EAFBF0", ponto: "#16A34A" },
  a_vencer: { label: "A vencer", cor: "#A16207", bg: "#FEF7DF", ponto: "#CA8A04" },
  vencida: { label: "Vencida", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
  sem_vencimento: { label: "Sem vencimento", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" },
  em_renovacao: { label: "Em renovação", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
};

/**
 * Situações que a pessoa escolhe e o sistema respeita como estão. As demais
 * (válida, a vencer, vencida, sem vencimento) são consequência das datas e a
 * tela recalcula sozinha.
 */
const SITUACOES_MANUAIS = ["em_renovacao"];

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

/** Hoje no formato ISO (aaaa-mm-dd), no fuso local — o mesmo que o input date usa. */
export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Data ISO exibida como dd/mm/aaaa. Datas vazias viram "--". */
export function formatarData(iso) {
  if (!iso) return "--";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "--";
  return `${dia}/${mes}/${ano}`;
}

/** Diferença em dias entre hoje e a data informada (negativo = já passou). */
export function diasAte(iso) {
  if (!iso) return null;
  const umDia = 24 * 60 * 60 * 1000;
  const alvo = Date.parse(`${String(iso).slice(0, 10)}T00:00:00`);
  const hoje = Date.parse(`${hojeISO()}T00:00:00`);
  if (Number.isNaN(alvo) || Number.isNaN(hoje)) return null;
  return Math.round((alvo - hoje) / umDia);
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

/**
 * Situação que decorre das datas: sem vencimento quando o tipo não vence,
 * vencida quando a data já passou, a vencer na reta final e válida no resto.
 */
export function situacaoPorData(dataVencimento) {
  if (!dataVencimento) return "sem_vencimento";
  const dias = diasAte(dataVencimento);
  if (dias === null) return "sem_vencimento";
  if (dias < 0) return "vencida";
  if (dias <= DIAS_ALERTA_VENCIMENTO) return "a_vencer";
  return "valida";
}

/** Situação exibida na lista: a manual prevalece; o resto vem das datas. */
export function situacaoEfetiva(certidao) {
  if (SITUACOES_MANUAIS.includes(certidao?.situacao)) return certidao.situacao;
  return situacaoPorData(certidao?.data_vencimento);
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

export async function listarFornecedores() {
  // A secretaria vem junto porque a listagem de certidões filtra por ela — o
  // vínculo é o do cadastro do fornecedor, sem coluna nova em certidoes.
  const { data, error } = await supabase
    .from("fornecedores")
    .select("id, razao_social, nome_fantasia, cpf_cnpj, ativo, secretaria_id, secretarias ( id, nome )")
    .order("razao_social");
  if (error) throw error;
  return data ?? [];
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
  fornecedores ( id, razao_social, nome_fantasia, cpf_cnpj ),
  tipos_certidao ( id, nome, possui_vencimento, prazo_padrao_dias, obrigatorio ),
  usuarios ( id, nome_completo )
`;

export async function listarCertidoes() {
  const { data, error } = await supabase
    .from("certidoes")
    .select(COLUNAS_CERTIDAO)
    .order("data_vencimento", { ascending: true, nullsFirst: false })
    .order("criado_em", { ascending: false });
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
 * Apaga a certidão. A tela só oferece a ação a quem tem pode_excluir no módulo
 * e sempre depois de uma confirmação; o RLS de delete confere a permissão de
 * novo no banco.
 *
 * Os alertas de vencimento gerados para essa certidão saem junto: a coluna
 * notificacoes.certidao_id é "on delete cascade".
 */
export async function excluirCertidao(id) {
  const { error } = await supabase.from("certidoes").delete().eq("id", id);
  if (error) throw error;
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
