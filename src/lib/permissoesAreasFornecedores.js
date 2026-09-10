import React from "react";
import { supabase } from "./supabaseClient.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import {
  AREAS,
  MODULOS_AREAS,
  PERMISSOES_AREA_NENHUMA,
  resolverPermissoesAreas,
} from "./areasFornecedores.js";

/**
 * As permissões próprias das áreas Patrocínios, Aluguéis e Bandas, lidas do
 * banco para a tela.
 *
 * Cada área é um módulo próprio na Matriz de Permissões, com visualizar, criar,
 * editar e inativar. Os três módulos e o de 'fornecedores' vêm na MESMA consulta
 * — o de 'fornecedores' porque é dele que a permissão é herdada enquanto o
 * módulo da área ainda não tem linha (banco em que a migration desta parte não
 * foi rodada). A ordem de decisão é da função pura `resolverPermissoesAreas`,
 * em lib/areasFornecedores.js.
 *
 * Nenhuma permissão existente muda: isto só acrescenta módulos. E o que a tela
 * mostra ou esconde é conveniência — a recusa que vale é a do banco, onde a RLS
 * das seis tabelas confere `pode_em_area_fornecedor` antes de qualquer leitura
 * ou gravação.
 */

const NENHUMA = Object.freeze(
  Object.fromEntries(AREAS.map((area) => [area.id, PERMISSOES_AREA_NENHUMA])),
);

/**
 * Hook das subabas: `{ carregando, usuario, permissoes, erro }`.
 * `permissoes` tem uma chave por área, sempre com as quatro ações booleanas.
 */
export function usePermissoesAreasFornecedores() {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissoes: NENHUMA,
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
          if (ativo) setEstado({ carregando: false, usuario: null, permissoes: NENHUMA, erro: null });
          return;
        }

        const { data: linhas, error: erroModulos } = await supabase
          .from("permissoes_efetivas")
          .select("modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir")
          .eq("usuario_id", usuario.id)
          .in("modulo", [...MODULOS_AREAS, "fornecedores"]);
        if (erroModulos) throw erroModulos;

        const permissoes = resolverPermissoesAreas({ linhas: linhas ?? [] });
        if (ativo) setEstado({ carregando: false, usuario, permissoes, erro: null });
      } catch (falha) {
        console.error("[Áreas de Fornecedores] Não foi possível verificar as permissões.", falha);
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissoes: NENHUMA,
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
