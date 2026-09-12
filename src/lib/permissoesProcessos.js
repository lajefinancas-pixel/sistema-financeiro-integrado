import React from "react";
import { supabase } from "./supabaseClient.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import {
  MODULOS_PROCESSOS,
  PERMISSOES_DIARIAS_NENHUMA,
  podeVerDiarias,
  resolverPermissoesDiarias,
} from "./processosDiarias.js";
import {
  MODULO_SERVIDORES,
  PERMISSOES_SERVIDORES_NENHUMA,
  podeVerServidores,
  resolverPermissoesServidores,
} from "./processosServidores.js";
import {
  MODULOS_PROCESSOS_SERVICOS,
  PERMISSOES_SERVICOS_NENHUMA,
  podeVerServicos,
  resolverPermissoesServicos,
} from "./processosServicos.js";
import {
  MODULO_PREFEITA,
  PERMISSOES_PREFEITA_NENHUMA,
  resolverPermissoesPrefeita,
} from "./processosPrefeita.js";

/**
 * As permissões próprias do módulo PROCESSOS, lidas do banco para a tela.
 *
 * São oito ações -- visualizar, criar, editar, finalizar, cancelar, imprimir,
 * duplicar e editar a Tabela de Diárias -- sobre as cinco colunas que a Matriz
 * de Permissões tem, então o módulo aparece nela como TRÊS linhas, no mesmo
 * recurso que 'baixas' e 'backup' já usam para renomear as ações:
 *
 *   processos_diarias          visualizar | criar | editar | FINALIZAR | CANCELAR
 *   processos_diarias_saida    IMPRIMIR   | DUPLICAR
 *   processos_diarias_tabela   EDITAR A TABELA DE DIÁRIAS
 *
 * A terceira linha é restrita de propósito: a Tabela de Diárias é o parâmetro
 * que define quanto vale cada diária, e quem edita um processo não passa a
 * poder mexer nela. Consultar a tabela, sim, acompanha quem vê o módulo.
 *
 * A subaba SERVIÇOS/MATERIAIS tem AS SUAS PRÓPRIAS DUAS linhas, pelo mesmo
 * motivo -- sete ações sobre cinco colunas:
 *
 *   processos_servicos         visualizar | criar | editar | FINALIZAR | CANCELAR
 *   processos_servicos_saida   IMPRIMIR   | DUPLICAR
 *
 * ⚠️ As permissões de Diárias e de Serviços/Materiais são SEPARADAS: quem
 * preenche uma diária não passa a poder criar processo de serviço, e nada do que
 * já existia foi alterado para isto -- são linhas NOVAS na Matriz.
 *
 * A subaba SERVIDORES tem a sua linha, e também é de propósito:
 *
 *   processos_servidores       visualizar | criar | editar | INATIVAR
 *
 * É um CADASTRO, não é um processo: quem preenche uma diária não passa a poder
 * criar, editar ou inativar servidores do município. Escolher um servidor já
 * cadastrado ao montar o documento exige só a permissão de visualizar.
 *
 * O cadastro da PREFEITA tem a sua linha, e é RESTRITA:
 *
 *   processos_prefeita         visualizar | EDITAR o cadastro
 *
 * É quem AUTORIZA os documentos. Consultar acompanha quem vê o módulo, porque o
 * documento imprime o nome; editar não se herda de nenhuma outra permissão.
 *
 * A ordem de decisão é das funções puras `resolverPermissoesDiarias` e
 * `resolverPermissoesServidores`, em lib/processosDiarias.js e
 * lib/processosServidores.js. Nenhuma permissão existente muda: isto só
 * acrescenta módulos, e o perfil + exceções individuais continua sendo o mesmo
 * modelo.
 *
 * O que a tela mostra ou esconde é conveniência. A recusa que vale é a do
 * banco: a RLS das tabelas do módulo confere `pode_em_processos` antes de
 * devolver ou gravar qualquer linha, e os gatilhos separam editar de finalizar,
 * de cancelar e de inativar.
 */

const COLUNAS_PERMISSAO =
  "modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar";

/** Todos os módulos do menu PROCESSOS, consultados de uma vez. */
const MODULOS_DO_MENU = [
  ...MODULOS_PROCESSOS,
  ...MODULOS_PROCESSOS_SERVICOS,
  MODULO_SERVIDORES,
  // O cadastro da PREFEITA não é subaba do menu: entra na consulta porque as
  // páginas precisam saber se quem está na tela pode editá-lo.
  MODULO_PREFEITA,
];

/**
 * As permissões de Processos do usuário logado:
 * `{ usuario, permissoes, permissoesServicos, permissoesServidores }`.
 *
 * Vive fora do hook porque o menu lateral e as páginas precisam da MESMA
 * resposta. Sem usuário na sessão, as permissões negam tudo.
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
  if (!usuario) {
    return {
      usuario: null,
      permissoes: PERMISSOES_DIARIAS_NENHUMA,
      permissoesServicos: PERMISSOES_SERVICOS_NENHUMA,
      permissoesServidores: PERMISSOES_SERVIDORES_NENHUMA,
      permissoesPrefeita: PERMISSOES_PREFEITA_NENHUMA,
    };
  }

  const { data: linhas, error: erroModulos } = await supabase
    .from("permissoes_efetivas")
    .select(COLUNAS_PERMISSAO)
    .eq("usuario_id", usuario.id)
    .in("modulo", MODULOS_DO_MENU);
  if (erroModulos) throw erroModulos;

  return {
    usuario,
    permissoes: resolverPermissoesDiarias({ linhas: linhas ?? [] }),
    permissoesServicos: resolverPermissoesServicos({ linhas: linhas ?? [] }),
    permissoesServidores: resolverPermissoesServidores({ linhas: linhas ?? [] }),
    permissoesPrefeita: resolverPermissoesPrefeita({ linhas: linhas ?? [] }),
  };
}

/**
 * Hook das páginas de Processos:
 * `{ carregando, usuario, permissoes, permissoesServicos, permissoesServidores, erro }`.
 * `permissoes` traz sempre as oito ações de Diárias, `permissoesServicos` as
 * sete de Serviços/Materiais e `permissoesServidores` as quatro do cadastro,
 * todas booleanas.
 */
export function usePermissoesProcessos() {
  const [estado, setEstado] = React.useState({
    carregando: true,
    usuario: null,
    permissoes: PERMISSOES_DIARIAS_NENHUMA,
    permissoesServicos: PERMISSOES_SERVICOS_NENHUMA,
    permissoesServidores: PERMISSOES_SERVIDORES_NENHUMA,
    permissoesPrefeita: PERMISSOES_PREFEITA_NENHUMA,
    erro: null,
  });

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const { usuario, permissoes, permissoesServicos, permissoesServidores, permissoesPrefeita } =
          await carregarPermissoesDeProcessos();
        if (ativo) {
          setEstado({
            carregando: false,
            usuario,
            permissoes,
            permissoesServicos,
            permissoesServidores,
            permissoesPrefeita,
            erro: null,
          });
        }
      } catch (falha) {
        console.error("[Processos] Não foi possível verificar as permissões.", falha);
        if (ativo) {
          setEstado({
            carregando: false,
            usuario: null,
            permissoes: PERMISSOES_DIARIAS_NENHUMA,
            permissoesServicos: PERMISSOES_SERVICOS_NENHUMA,
            permissoesServidores: PERMISSOES_SERVIDORES_NENHUMA,
            permissoesPrefeita: PERMISSOES_PREFEITA_NENHUMA,
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
const CHAVE_PROCESSOS_NO_MENU = "sfi.menuLateral.processosAreas";

/** As subabas do módulo, na ordem em que aparecem no submenu. */
const AREAS = [
  { id: "diarias", rotulo: "Diárias", to: "/processos/diarias" },
  { id: "servicos", rotulo: "Serviços/Materiais", to: "/processos/servicos" },
  { id: "servidores", rotulo: "Servidores", to: "/processos/servidores" },
];

function lerCache() {
  try {
    const guardado = window.sessionStorage.getItem(CHAVE_PROCESSOS_NO_MENU);
    if (guardado === null) return [];
    return guardado.split(",").filter((id) => AREAS.some((area) => area.id === id));
  } catch {
    return [];
  }
}

function gravarCache(ids) {
  try {
    window.sessionStorage.setItem(CHAVE_PROCESSOS_NO_MENU, ids.join(","));
  } catch {
    /* navegador sem armazenamento: o menu apenas reconsulta a cada página */
  }
}

/**
 * As áreas de PROCESSOS que a pessoa pode ver no menu lateral.
 *
 * Neste envio existem três: Diárias, Serviços/Materiais e Servidores. O arquivo
 * permanente entra no envio próprio dele. Cada subaba aparece só para quem tem a
 * permissão de visualizar DELA -- quem vê Diárias não passa a ver
 * Serviços/Materiais nem Servidores, e vice-versa. Enquanto a primeira consulta
 * da sessão não responde, nada é mostrado: o menu nunca exibe uma área que a
 * pessoa talvez não possa abrir.
 */
export function useAreasDeProcessosNoMenu() {
  const [liberadas, setLiberadas] = React.useState(lerCache);

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
          .in("modulo", MODULOS_DO_MENU);
        if (error) throw error;

        const ids = [];
        if (podeVerDiarias(resolverPermissoesDiarias({ linhas: linhas ?? [] }))) ids.push("diarias");
        if (podeVerServicos(resolverPermissoesServicos({ linhas: linhas ?? [] }))) ids.push("servicos");
        if (podeVerServidores(resolverPermissoesServidores({ linhas: linhas ?? [] }))) ids.push("servidores");

        gravarCache(ids);
        if (ativo) setLiberadas(ids);
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

  return React.useMemo(() => AREAS.filter((area) => liberadas.includes(area.id)), [liberadas]);
}
