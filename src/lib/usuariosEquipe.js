import { supabase } from "./supabaseClient";

// Bucket público das fotos de perfil da equipe (criado pela migration
// 20260810130000_usuarios_telefone_e_bucket_avatares.sql).
export const BUCKET_FOTOS = "avatares";

export const STATUS_USUARIO = [
  { valor: "ativo", label: "Ativo" },
  { valor: "inativo", label: "Inativo" },
  { valor: "bloqueado", label: "Bloqueado" },
];

export function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email ?? "").trim());
}

/** Envia a foto para o Storage e devolve a URL pública. */
export async function enviarFotoUsuario(arquivo) {
  const extensao = (arquivo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aleatorio = Math.random().toString(36).slice(2, 8);
  const caminho = `usuarios/${Date.now()}-${aleatorio}.${extensao || "jpg"}`;

  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(caminho, arquivo, {
    cacheControl: "3600",
    upsert: false,
    contentType: arquivo.type || undefined,
  });
  if (error) throw new Error(`Não foi possível enviar a foto: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(caminho);
  return data.publicUrl;
}

/**
 * Pede à Netlify Function uma nova senha provisória para o usuário informado.
 * A função valida a sessão e a permissão de edição em "administracao" antes de
 * trocar a senha, porque essa operação exige a chave de serviço do Supabase.
 */
export async function redefinirSenhaDeUsuario(usuarioId) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente para redefinir a senha.");

  const resposta = await fetch("/api/equipe/redefinir-senha", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ usuario_id: usuarioId }),
  });

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || "Não foi possível redefinir a senha.");
  return corpo.senha;
}
