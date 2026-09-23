import { supabase } from "./supabaseClient";

// Fonte única da organização visual usada em Saldos das Contas e em todos os
// seletores de conta. A posição na lista oficial define a cor; a preferência
// do usuário define apenas a ordem de exibição dos grupos.
export const CORES_SECRETARIAS = [
  "#2563EB", "#16A34A", "#EA9A1E", "#7C3AED",
  "#DB2777", "#0EA5E9", "#059669", "#D97706",
];

export const COR_NEUTRA_SECRETARIA = "#64748B";
export const TABELA_ORDEM_SECRETARIAS = "preferencias_ordem_secretarias";
export const CHAVE_ORDEM_SECRETARIAS_LOCAL = "saldos:ordem-secretarias";

export function ordenarSecretariasPorPreferencia(lista, ordem) {
  const posicao = new Map((ordem ?? []).map((id, i) => [String(id), i]));
  return [...(lista ?? [])].sort((a, b) => {
    const pa = posicao.has(String(a.id)) ? posicao.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const pb = posicao.has(String(b.id)) ? posicao.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

export function corDaSecretaria(secretariaId, secretariasOficiais = []) {
  const indice = secretariasOficiais.findIndex((sec) => String(sec.id) === String(secretariaId));
  return indice < 0 ? COR_NEUTRA_SECRETARIA : CORES_SECRETARIAS[indice % CORES_SECRETARIAS.length];
}

export function mapaDeCoresDasSecretarias(secretariasOficiais = []) {
  return new Map(secretariasOficiais.map((sec, indice) => [
    String(sec.id),
    CORES_SECRETARIAS[indice % CORES_SECRETARIAS.length],
  ]));
}

export async function carregarOrganizacaoSecretarias() {
  const [{ data: dadosUsuario }, { data: secretarias }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("secretarias").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const usuarioId = dadosUsuario?.user?.id ?? null;
  let ordem = [];

  if (usuarioId) {
    try {
      const local = localStorage.getItem(`${CHAVE_ORDEM_SECRETARIAS_LOCAL}:${usuarioId}`);
      const salva = local ? JSON.parse(local) : [];
      if (Array.isArray(salva)) ordem = salva;
    } catch {
      // Cache local indisponível ou inválido: a preferência remota prevalece.
    }

    const { data } = await supabase
      .from(TABELA_ORDEM_SECRETARIAS)
      .select("ordem")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    if (Array.isArray(data?.ordem)) ordem = data.ordem;
  }

  return { usuarioId, ordem, secretarias: secretarias ?? [] };
}
