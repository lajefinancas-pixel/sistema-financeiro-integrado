import React from "react";
import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";
import { ACOES_BAIXAS, PERMISSOES_BAIXAS_NENHUMA, resolverPermissoesBaixas } from "./regrasBaixas";

/**
 * As cinco permissões próprias do módulo de Baixas de Pagamentos, lidas do
 * banco para a tela.
 *
 * O mapa das ações e a ordem de decisão são de lib/regrasBaixas.js (função
 * pura, testada); aqui só acontece a leitura. O que a tela mostra ou esconde
 * segue essas permissões, mas a recusa que vale é a do banco:
 * `registrar_baixa_nota` e `estornar_baixa_nota` conferem `pode_em_baixas`
 * antes de gravar qualquer coisa.
 */

export const MODULO_BAIXAS = "baixas";

export { ACOES_BAIXAS, resolverPermissoesBaixas };

/**
 * Hook da tela: `{ carregando, usuario, permissoes, erro }`.
 * `permissoes` tem as cinco chaves de ACOES_BAIXAS, sempre booleanas.
 */
export function usePermissoesBaixas() {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissoes: PERMISSOES_BAIXAS_NENHUMA,
    erro: null,
  });

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { data: auth, error: erroAuth } = await supabase.auth.getUser();
        if (erroAuth) throw erroAuth;
        if (!auth?.user) throw erroAmigavel("Sessão não encontrada. Entre novamente para continuar.");

        const { data: usuarios, error: erroUsuario } = await supabase
          .from("usuarios")
          .select("id, nome_completo, cargo, foto_url, status, perfis_acesso ( id, nome )")
          .eq("auth_id", auth.user.id)
          .limit(1);
        if (erroUsuario) throw erroUsuario;

        const usuario = usuarios?.[0] ?? null;
        if (!usuario) {
          if (ativo) {
            setEstado({ carregando: false, usuario: null, permissoes: PERMISSOES_BAIXAS_NENHUMA, erro: null });
          }
          return;
        }

        const { data: modulos, error: erroModulos } = await supabase
          .from("permissoes_efetivas")
          .select("modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar")
          .eq("usuario_id", usuario.id)
          .in("modulo", [MODULO_BAIXAS, "pagamentos"]);
        if (erroModulos) throw erroModulos;

        // A concessão avulsa é enriquecimento: se a consulta falhar, a Matriz
        // de Permissões continua valendo sozinha.
        const { data: linhasEspeciais } = await supabase
          .from("permissoes_especiais")
          .select("acao, permitido")
          .eq("usuario_id", usuario.id);

        const especiais = Object.fromEntries(
          (linhasEspeciais ?? []).map((linha) => [linha.acao, linha.permitido === true]),
        );

        const permissoes = resolverPermissoesBaixas({
          baixas: (modulos ?? []).find((linha) => linha.modulo === MODULO_BAIXAS) ?? null,
          pagamentos: (modulos ?? []).find((linha) => linha.modulo === "pagamentos") ?? null,
          especiais,
        });

        if (ativo) setEstado({ carregando: false, usuario, permissoes, erro: null });
      } catch (falha) {
        console.error("[Baixas] Não foi possível verificar as permissões.", falha);
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissoes: PERMISSOES_BAIXAS_NENHUMA,
            erro: mensagemAmigavel(falha, "Não foi possível verificar suas permissões."),
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
