import React from "react";
import { supabase } from "./supabaseClient";
import { usePermissaoModulo } from "./permissoes";
import { MODULO as MODULO_TAREFAS, estaAtrasada, hojeISO } from "./tarefas";
import { listarCertidoes } from "./certidoes";
import { prazosDeAlerta, resumoCertidoes } from "./alertasCertidoes";

/**
 * Dados das duas seções pessoais do Painel Principal: "Minhas tarefas" e
 * "Precisa da minha atenção".
 *
 * Nada aqui reimplementa regra de Tarefas ou de Certidões — a consulta traz as
 * linhas que já existem e a interpretação delas continua vindo dos módulos:
 *   estaAtrasada / hojeISO / statusVisual  -> lib/tarefas.js
 *   resumoCertidoes / prazosDeAlerta       -> lib/alertasCertidoes.js
 *
 * Permissão: a lista de tarefas é consultada só quando a pessoa tem
 * "visualizar" no módulo tarefas (a mesma checagem da tela /tarefas) e o RLS do
 * banco continua sendo a palavra final. As certidões seguem o desenho do card
 * que já existe no painel: sem permissão o RLS devolve zero linhas e a parte de
 * certidões simplesmente não aparece.
 *
 * Atualização: os dados são lidos toda vez que o painel monta e de novo quando
 * a aba volta a ficar visível, então uma tarefa criada, delegada, concluída ou
 * cancelada aparece na próxima abertura do painel. Não há cache local.
 */

/** Quantas linhas a lista compacta mostra antes do "Ver todas". */
export const LIMITE_LISTA = 5;

/** Teto de segurança da consulta — muito acima do que uma pessoa acumula. */
const TETO_CONSULTA = 500;

const COLUNAS_MINHAS = "id, titulo, status, prioridade, prazo, horario_limite";

// Mesma ordem de urgência usada nos filtros da tela de Tarefas.
const PESO_PRIORIDADE = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

/**
 * Tarefas em aberto atribuídas à pessoa logada (responsavel_id). Tarefas
 * concluídas e canceladas ficam de fora: o painel mostra o que ainda pesa.
 */
export async function listarMinhasTarefasAbertas(usuarioId) {
  if (!usuarioId) return [];
  const { data, error } = await supabase
    .from("tarefas")
    .select(COLUNAS_MINHAS)
    .eq("responsavel_id", usuarioId)
    .not("status", "in", '("concluida","cancelada")')
    .order("prazo", { ascending: true, nullsFirst: false })
    .limit(TETO_CONSULTA);
  if (error) throw error;
  return data ?? [];
}

/** "X pendentes, Y vence hoje, Z atrasadas" — os números do topo da seção. */
export function resumoMinhasTarefas(tarefas) {
  const hoje = hojeISO();
  const lista = tarefas ?? [];
  const atrasadas = lista.filter((t) => estaAtrasada(t)).length;
  const venceHoje = lista.filter((t) => t.prazo === hoje).length;
  return { pendentes: lista.length, venceHoje, atrasadas };
}

/**
 * Da mais urgente para a menos urgente: prazo mais próximo primeiro (o que já
 * venceu vem antes por consequência), tarefas sem prazo por último, e a
 * prioridade desempata.
 */
export function ordenarPorUrgencia(tarefas) {
  return [...(tarefas ?? [])].sort((a, b) => {
    if (a.prazo !== b.prazo) {
      if (!a.prazo) return 1;
      if (!b.prazo) return -1;
      return a.prazo.localeCompare(b.prazo);
    }
    return (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9);
  });
}

function plural(quantidade, singular, pluralTexto) {
  return quantidade === 1 ? singular : pluralTexto;
}

/**
 * Linhas de "Precisa da minha atenção": certidões vencidas ou perto do
 * vencimento (contagem vinda do mesmo resumo do card de Certidões), tarefas
 * atrasadas e tarefas vencendo hoje. Cada linha leva ao módulo de origem.
 */
export function itensDeAtencao({ certidoes, tarefas }) {
  const itens = [];

  if (certidoes?.vencidas > 0) {
    itens.push({
      id: "certidoes-vencidas",
      cor: "#DC2626",
      texto: `${certidoes.vencidas} ${plural(certidoes.vencidas, "certidão vencida", "certidões vencidas")}`,
      rota: "/certidoes?filtro=pendencias",
    });
  }
  if (tarefas?.atrasadas > 0) {
    itens.push({
      id: "tarefas-atrasadas",
      cor: "#DC2626",
      texto: `${tarefas.atrasadas} ${plural(tarefas.atrasadas, "tarefa atrasada", "tarefas atrasadas")}`,
      rota: "/tarefas",
    });
  }
  if (certidoes?.aVencer > 0) {
    itens.push({
      id: "certidoes-a-vencer",
      cor: "#CA8A04",
      texto: `${certidoes.aVencer} ${plural(
        certidoes.aVencer,
        "certidão vence",
        "certidões vencem",
      )} em até ${certidoes.janela} dias`,
      rota: "/certidoes?filtro=pendencias",
    });
  }
  if (tarefas?.venceHoje > 0) {
    itens.push({
      id: "tarefas-hoje",
      cor: "#EA9A1E",
      texto: `${tarefas.venceHoje} ${plural(tarefas.venceHoje, "tarefa vence", "tarefas vencem")} hoje`,
      rota: "/tarefas",
    });
  }

  return itens;
}

/**
 * Carrega, de uma vez só, o que as duas seções precisam — as duas leem o mesmo
 * conjunto de tarefas, então a consulta acontece uma vez por carregamento do
 * painel.
 *
 * Devolve:
 *   carregando     -> true enquanto consulta
 *   podeVerTarefas -> permissão de visualizar no módulo tarefas
 *   tarefas        -> tarefas em aberto da pessoa logada, da mais urgente
 *   resumoTarefas  -> { pendentes, venceHoje, atrasadas }
 *   certidoes      -> resumo do módulo Certidões (null quando não há o que ver)
 *   atencao        -> linhas da seção "Precisa da minha atenção"
 */
export function usePainelPessoal() {
  const { carregando: verificando, usuario, permissao } = usePermissaoModulo(MODULO_TAREFAS);
  const podeVerTarefas = permissao?.pode_visualizar === true;

  const [carregando, setCarregando] = React.useState(true);
  const [tarefas, setTarefas] = React.useState([]);
  const [certidoes, setCertidoes] = React.useState(null);
  const [recarga, setRecarga] = React.useState(0);

  // A aba voltando a ficar visível refaz a leitura: quem deixou o painel aberto
  // não fica olhando um retrato antigo das tarefas.
  React.useEffect(() => {
    function aoVoltar() {
      if (document.visibilityState === "visible") setRecarga((n) => n + 1);
    }
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, []);

  React.useEffect(() => {
    if (verificando) return undefined;
    let ativo = true;

    (async () => {
      setCarregando(true);

      const [minhas, resumo] = await Promise.all([
        podeVerTarefas && usuario?.id
          ? listarMinhasTarefasAbertas(usuario.id).catch(() => [])
          : Promise.resolve([]),
        // Leitura própria das certidões: o card de Certidões do painel é um
        // componente fechado e não expõe o resumo que ele já calculou. O
        // cálculo, esse sim, é o mesmo — resumoCertidoes com os prazos
        // configurados. O painel não pode quebrar por causa disso: sem dados
        // (inclusive sem permissão, quando o RLS devolve zero linhas), a parte
        // de certidões some da seção.
        Promise.all([listarCertidoes(), prazosDeAlerta()])
          .then(([lista, prazos]) => resumoCertidoes(lista, prazos))
          .catch(() => null),
      ]);

      if (!ativo) return;
      setTarefas(ordenarPorUrgencia(minhas));
      setCertidoes(resumo && resumo.total > 0 ? resumo : null);
      setCarregando(false);
    })();

    return () => {
      ativo = false;
    };
  }, [verificando, podeVerTarefas, usuario?.id, recarga]);

  const resumoTarefas = React.useMemo(() => resumoMinhasTarefas(tarefas), [tarefas]);
  const atencao = React.useMemo(
    () => itensDeAtencao({ certidoes, tarefas: podeVerTarefas ? resumoTarefas : null }),
    [certidoes, podeVerTarefas, resumoTarefas],
  );

  return {
    carregando: verificando || carregando,
    podeVerTarefas,
    temCertidoes: certidoes !== null,
    tarefas,
    resumoTarefas,
    certidoes,
    atencao,
  };
}
