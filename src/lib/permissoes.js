import React from "react";
import { supabase } from "./supabaseClient";

/**
 * Carrega o usuário logado (tabela "usuarios", ligada ao auth pelo auth_id)
 * e a permissão efetiva dele no módulo informado (view "permissoes_efetivas").
 *
 * Retorna:
 *   carregando  -> true enquanto consulta o Supabase
 *   usuario     -> { id, nome_completo, cargo, foto_url, perfil }
 *   permissao   -> { pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar }
 *   erro        -> mensagem de falha na consulta (null quando tudo certo)
 */
export function usePermissaoModulo(modulo) {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissao: null,
    erro: null,
  });

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { data: auth, error: erroAuth } = await supabase.auth.getUser();
        if (erroAuth) throw erroAuth;
        if (!auth?.user) throw new Error("Sessão não encontrada.");

        const { data: usuarios, error: erroUsuario } = await supabase
          .from("usuarios")
          .select("id, nome_completo, cargo, foto_url, status, perfis_acesso ( id, nome )")
          .eq("auth_id", auth.user.id)
          .limit(1);
        if (erroUsuario) throw erroUsuario;

        const usuario = usuarios?.[0] ?? null;
        if (!usuario) {
          if (ativo) setEstado({ carregando: false, usuario: null, permissao: null, erro: null });
          return;
        }

        const { data: permissoes, error: erroPermissao } = await supabase
          .from("permissoes_efetivas")
          .select("modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar")
          .eq("usuario_id", usuario.id)
          .eq("modulo", modulo)
          .limit(1);
        if (erroPermissao) throw erroPermissao;

        if (ativo) {
          setEstado({
            carregando: false,
            usuario,
            permissao: permissoes?.[0] ?? null,
            erro: null,
          });
        }
      } catch (e) {
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissao: null,
            erro: e.message ?? "Não foi possível verificar suas permissões.",
          });
        }
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [modulo]);

  return estado;
}
