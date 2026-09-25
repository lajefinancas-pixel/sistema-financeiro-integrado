import { supabase } from "./supabaseClient";
export { diasAteValidade, situacaoContrato } from "./licitacoesContratosRegras.js";

export const BUCKET_LICITACOES = "licitacoes-contratos-anexos";
export const SITUACOES_CONTRATO = {
  vigente: { label: "Vigente", cor: "#15803D", fundo: "#EAFBF0" },
  vencendo: { label: "Vencendo em breve", cor: "#A16207", fundo: "#FEF7DF" },
  vencido: { label: "Vencido", cor: "#DC2626", fundo: "#FEF2F2" },
  encerrado: { label: "Encerrado", cor: "#475569", fundo: "#F1F5F9" },
};
export async function listarLicitacoes() {
  const { data, error } = await supabase.from("licitacoes_contratos").select(`
    id, fornecedor_id, tipo_id, numero, objeto, data_inicio, data_validade, valor,
    secretaria_id, observacoes, encerrado, criado_em,
    fornecedores(id, razao_social, nome_fantasia, cpf_cnpj),
    tipos_licitacao_contrato(id, nome), secretarias(id, nome),
    licitacoes_contratos_anexos(id, nome, arquivo_url, criado_em)
  `).order("data_validade", { ascending: true });
  if (error) throw error; return data ?? [];
}
export async function carregarApoioLicitacoes() {
  const [f, t, s] = await Promise.all([
    supabase.from("fornecedores").select("id, razao_social, nome_fantasia, cpf_cnpj").eq("ativo", true).order("razao_social"),
    supabase.from("tipos_licitacao_contrato").select("id, nome, ativo").eq("ativo", true).order("nome"),
    supabase.from("secretarias").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  if (f.error) throw f.error; if (t.error) throw t.error; if (s.error) throw s.error;
  return { fornecedores: f.data ?? [], tipos: t.data ?? [], secretarias: s.data ?? [] };
}
export async function salvarLicitacao(campos, id, usuarioId) {
  const linha = { fornecedor_id: campos.fornecedor_id, tipo_id: campos.tipo_id, numero: campos.numero.trim(), objeto: campos.objeto.trim(), data_inicio: campos.data_inicio, data_validade: campos.data_validade, valor: campos.valor || null, secretaria_id: campos.secretaria_id || null, observacoes: campos.observacoes.trim() || null, encerrado: campos.encerrado };
  if (!linha.fornecedor_id || !linha.tipo_id || !linha.numero || !linha.objeto || !linha.data_inicio || !linha.data_validade) throw new Error("Preencha todos os campos obrigatórios.");
  const consulta = id ? supabase.from("licitacoes_contratos").update(linha).eq("id", id) : supabase.from("licitacoes_contratos").insert({ ...linha, criado_por: usuarioId });
  const { data, error } = await consulta.select("id").single(); if (error) throw error; return data;
}
function nomeSeguro(nome) { return String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120); }
export async function anexarArquivos(registroId, arquivos) {
  for (const arquivo of arquivos) {
    const caminho = `${registroId}/${Date.now()}-${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
    const { error } = await supabase.storage.from(BUCKET_LICITACOES).upload(caminho, arquivo, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET_LICITACOES).getPublicUrl(caminho);
    const salvo = await supabase.from("licitacoes_contratos_anexos").insert({ licitacao_contrato_id: registroId, nome: arquivo.name, arquivo_url: data.publicUrl });
    if (salvo.error) throw salvo.error;
  }
}
export async function criarTipoLicitacao(nome) {
  const valor = nome.trim(); if (!valor) throw new Error("Informe o nome do tipo.");
  const { data, error } = await supabase.from("tipos_licitacao_contrato").insert({ nome: valor }).select("id, nome, ativo").single(); if (error) throw error; return data;
}
