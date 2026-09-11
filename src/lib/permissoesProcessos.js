import React from "react";
import { supabase } from "./supabaseClient.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import {
  MODULOS_PROCESSOS,
  PERMISSOES_DIARIAS_NENHUMA,
  podeVerDiarias,
  resolverPermissoesDiarias,
} from "./processosDiarias.js";

/**
 * As permissões próprias do módulo PROCESSOS, lidas do banco para a tela.
 *
 * São sete ações -- visualizar, criar, editar, finalizar, imprimir, duplicar e
 * cancelar -- sobre as cinco colunas que a Matriz de Permissões tem, então o
 * módulo aparece nela como DUAS linhas, no mesmo recurso que 'baixas' e
 * 'backup' já usam para renomear as ações:
 *
 *   processos_diarias         visualizar | criar | editar | FINALIZAR | CANCELAR
 *   processos_diarias_saida   IMPRIMIR   | DUPLICAR
 *
 * A ordem de decisão é da função pura `resolverPermissoesDiarias`, em
 * lib/processosDiarias.js. Nenhuma permissão existente muda: isto só acrescenta
 * módulos, e o perfil + exceções individuais continua sendo o mesmo modelo.
 *
 * O que a tela mostra ou esconde é conveniência. A recusa que vale é a do
 * banco: a RLS das tabelas do módulo confere `pode_em_processos` antes de
 * devolver ou gravar qualquer linha, e o gatilho de alteração separa editar de
 * finalizar e de cancelar.
 */

const COLUNAS_PERMISSAO =
  "modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar";

/**
 * As permissões de Diárias do usuário logado: `{ usuario, permissoes }`.
 *
 * Vive fora do hook porque o menu lateral e a página precisam da MESMA
 * resposta. Sem usuário na sessão, `permissoes` nega tudo.
 */
export async function carregarPermissoesDeProcessos() {
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
  if (!usuario) return { usuario: null, permissoes: PERMISSOES_DIARIAS_NENHUMA };

  const { data: linhas, error: erroModulos } = await supabase
    .from("permissoes_efetivas")
    .select(COLUNAS_PERMISSAO)
    .eq("usuario_id", usuario.id)
    .in("modulo", MODULOS_PROCESSOS);
  if (erroModulos) throw erroModulos;

  return { usuario, permissoes: resolverPermissoesDiarias({ linhas: linhas ?? [] }) };
}

/**
 * Hook da página de Diárias: `{ carregando, usuario, permissoes, erro }`.
 * `permissoes` traz sempre as sete ações booleanas.
 */
export function usePermissoesProcessos() {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissoes: PERMISSOES_DIARIAS_NENHUMA,
    erro: null,
  });

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { usuario, permissoes } = await carregarPermissoesDeProcessos();
        if (ativo) setEstado({ carregando: false, usuario, permissoes, erro: null });
      } catch (falha) {
        console.error("[Processos] Não foi possível verificar as permissões.", falha);
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissoes: PERMISSOES_DIARIAS_NENHUMA,
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
 * PROCESSOS no menu lateral
 * ---------------------------------------------------------------------- */

/**
 * O menu lateral vive no Layout e cada tela monta o seu, então a resposta é
 * guardada na sessão: evita uma consulta a cada navegação e, principalmente,
 * evita o item PROCESSOS piscando na tela de quem não pode abri-lo.
 *
 * Cache de CONVENIÊNCIA de exibição, não de autorização.
 */
const CHAVE_PROCESSOS_NO_MENU = "sfi.menuLateral.processosVisivel";

function lerCache() {
  try {
    return window.sessionStorage.getItem(CHAVE_PROCESSOS_NO_MENU) === "1";
  } catch {
    return false;
  }
}

function gravarCache(visivel) {
  try {
    window.sessionStorage.setItem(CHAVE_PROCESSOS_NO_MENU, visivel ? "1" : "0");
  } catch {
    /* navegador sem armazenamento: o menu apenas reconsulta a cada página */
  }
}

/**
 * As áreas de PROCESSOS que a pessoa pode ver no menu lateral.
 *
 * Neste envio existe só Diárias; Serviços/Materiais e Arquivo entram nos envios
 * próprios deles. Enquanto a primeira consulta da sessão não responde, nada é
 * mostrado -- o menu nunca exibe uma área que a pessoa talvez não possa abrir.
 */
export function useAreasDeProcessosNoMenu() {
  const [visivel, setVisivel] = React.useState(lerCache);

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
          .select(COLUNAS_PERMISSAO)
          .eq("usuario_id", usuario.id)
          .in("modulo", MODULOS_PROCESSOS);
        if (error) throw error;

        const liberado = podeVerDiarias(resolverPermissoesDiarias({ linhas: linhas ?? [] }));
        gravarCache(liberado);
        if (ativo) setVisivel(liberado);
      } catch (falha) {
        // Menu é conveniência: falha de consulta mantém o que já se sabia.
        console.error("[Processos] Não foi possível montar o menu.", falha);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, []);

  return React.useMemo(
    () => (visivel ? [{ id: "diarias", rotulo: "Diárias", to: "/processos/diarias" }] : []),
    [visivel],
  );
}
