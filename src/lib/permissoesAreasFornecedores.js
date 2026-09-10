import React from "react";
import { supabase } from "./supabaseClient.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import {
  AREAS,
  MODULOS_AREAS,
  PERMISSOES_AREA_NENHUMA,
  areasVisiveis,
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
 * Hook da página de área: `{ carregando, usuario, permissoes, erro }`.
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

/* -------------------------------------------------------------------------
 * As áreas no menu lateral
 * ---------------------------------------------------------------------- */

/**
 * O submenu de Fornecedores é montado em toda página (o menu lateral vive no
 * Layout, e cada tela monta o seu). Guardar as áreas liberadas na sessão evita
 * uma consulta a cada navegação e, principalmente, evita o submenu piscando
 * itens que aparecem só depois da resposta do banco.
 *
 * É cache de CONVENIÊNCIA de exibição, não de autorização: quem decide é a RLS
 * do banco, que confere `pode_em_area_fornecedor` antes de devolver qualquer
 * linha, e a própria rota da área, que barra quem não tem `visualizar`.
 */
const CHAVE_AREAS_NO_MENU = "sfi.menuLateral.areasVisiveis";

function lerAreasDoCache() {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_AREAS_NO_MENU);
    if (!bruto) return null;
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((id) => typeof id === "string") : null;
  } catch {
    return null;
  }
}

function gravarAreasNoCache(ids) {
  try {
    window.sessionStorage.setItem(CHAVE_AREAS_NO_MENU, JSON.stringify(ids));
  } catch {
    /* navegador sem armazenamento: o submenu apenas reconsulta a cada página */
  }
}

/**
 * As áreas que a pessoa pode ver no submenu de Fornecedores do menu lateral.
 *
 * Enquanto a primeira consulta da sessão não responde, nada é mostrado — o
 * submenu nunca exibe uma área que a pessoa talvez não possa abrir.
 */
export function useAreasVisiveisNoMenu() {
  const [ids, setIds] = React.useState(() => lerAreasDoCache() ?? []);

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return;

        const { data: usuarios } = await supabase
          .from("usuarios")
          .select("id")
          .eq("auth_id", auth.user.id)
          .limit(1);
        const usuario = usuarios?.[0];
        if (!usuario) return;

        const { data: linhas, error } = await supabase
          .from("permissoes_efetivas")
          .select("modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir")
          .eq("usuario_id", usuario.id)
          .in("modulo", [...MODULOS_AREAS, "fornecedores"]);
        if (error) throw error;

        const permissoes = resolverPermissoesAreas({ linhas: linhas ?? [] });
        const liberadas = areasVisiveis(permissoes).map((area) => area.id);
        gravarAreasNoCache(liberadas);
        if (ativo) setIds(liberadas);
      } catch (falha) {
        // Menu é conveniência: falha de consulta mantém o que já se sabia.
        console.error("[Áreas de Fornecedores] Não foi possível montar o submenu.", falha);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, []);

  return React.useMemo(() => AREAS.filter((area) => ids.includes(area.id)), [ids]);
}
