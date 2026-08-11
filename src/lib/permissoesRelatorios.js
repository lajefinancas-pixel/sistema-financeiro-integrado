import React from "react";
import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";

/**
 * Gate de acesso da Central de Relatórios.
 *
 * A rota só carrega para quem tem pode_visualizar = true no módulo "relatorios"
 * (view permissoes_efetivas). Enquanto esse módulo não estiver configurado em
 * perfis_permissoes -- bancos que ainda não receberam a linha --, "auditoria" vale
 * como equivalente temporário, para que a tela não fique inacessível a quem já
 * tem acesso à área de conferência.
 *
 * Retorna:
 *   carregando -> true enquanto consulta o Supabase
 *   usuario    -> { id, nome_completo, cargo, ... } do usuário logado
 *   permissao  -> linha de permissões efetivas do módulo em uso
 *   modulo     -> "relatorios" ou "auditoria" (o equivalente que acabou valendo)
 *   erro       -> mensagem de falha na consulta (null quando tudo certo)
 */

export const MODULO_RELATORIOS = "relatorios";
export const MODULO_EQUIVALENTE = "auditoria";

const CAMPOS = "modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar";

/** true quando o módulo "relatorios" já existe no cadastro de permissões dos perfis. */
async function moduloJaConfigurado() {
  const { data, error } = await supabase
    .from("perfis_permissoes")
    .select("modulo")
    .eq("modulo", MODULO_RELATORIOS)
    .limit(1);
  // Sem conseguir ler o cadastro de perfis, o equivalente temporário assume.
  if (error) return false;
  return (data ?? []).length > 0;
}

export function usePermissaoRelatorios() {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissao: null,
    modulo: MODULO_RELATORIOS,
    erro: null,
  });

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { data: auth, error: erroAuth } = await supabase.auth.getUser();
        if (erroAuth) throw erroAuth;
        if (!auth?.user) throw erroAmigavel("Sessão não encontrada.");

        const { data: usuarios, error: erroUsuario } = await supabase
          .from("usuarios")
          .select("id, nome_completo, cargo, foto_url, status, perfis_acesso ( id, nome )")
          .eq("auth_id", auth.user.id)
          .limit(1);
        if (erroUsuario) throw erroUsuario;

        const usuario = usuarios?.[0] ?? null;
        if (!usuario) {
          if (ativo) {
            setEstado({
              carregando: false,
              usuario: null,
              permissao: null,
              modulo: MODULO_RELATORIOS,
              erro: null,
            });
          }
          return;
        }

        const { data: efetivas, error: erroPermissao } = await supabase
          .from("permissoes_efetivas")
          .select(CAMPOS)
          .eq("usuario_id", usuario.id)
          .in("modulo", [MODULO_RELATORIOS, MODULO_EQUIVALENTE]);
        if (erroPermissao) throw erroPermissao;

        const doRelatorios = (efetivas ?? []).find((p) => p.modulo === MODULO_RELATORIOS) ?? null;
        const daAuditoria = (efetivas ?? []).find((p) => p.modulo === MODULO_EQUIVALENTE) ?? null;

        let permissao = doRelatorios;
        let modulo = MODULO_RELATORIOS;

        // Sem linha de "relatorios" para este usuário: só cai no equivalente se o
        // módulo realmente ainda não existir nos perfis. Se ele existe e o perfil
        // não o recebeu, o acesso continua negado -- como deve ser.
        if (!doRelatorios && !(await moduloJaConfigurado())) {
          permissao = daAuditoria;
          modulo = MODULO_EQUIVALENTE;
        }

        if (ativo) setEstado({ carregando: false, usuario, permissao, modulo, erro: null });
      } catch (e) {
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissao: null,
            modulo: MODULO_RELATORIOS,
            erro: mensagemAmigavel(e, "Não foi possível verificar suas permissões."),
          });
        }
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, []);

  return estado;
}
