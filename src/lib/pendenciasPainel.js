/**
 * O que o sino do Painel Principal mostra.
 *
 * NÃO HÁ CÁLCULO DE PENDÊNCIA AQUI. A lista do sino é a união das linhas que os
 * dois blocos do painel já renderizam:
 *
 *   "Precisa da Minha Atenção"  -> itensDeAtencao(), em lib/painelPessoal.js
 *   "Pendências e Alertas"      -> a lista montada em pages/Dashboard.jsx
 *
 * Isso é de propósito: o contador do sino é o tamanho DESTA lista, então um
 * número no sino que não corresponde ao que a tela mostra deixa de ser
 * possível. Nenhuma consulta nova, nenhuma regra nova, nenhuma releitura por
 * outro caminho — se um bloco deixar de mostrar uma linha (por permissão, por
 * RLS ou porque a pendência foi resolvida), ela sai do sino no mesmo instante.
 *
 * Permissão, pelo mesmo motivo, é herdada: quem não enxerga certidões não
 * recebe linha de certidão em "Precisa da Minha Atenção" e, portanto, também
 * não recebe no sino.
 */

/** Texto do painel quando não há nada pendente. */
export const TEXTO_SEM_PENDENCIA = "Nenhuma pendência no momento.";

/** A linha tem o mínimo para ser clicável e legível? */
function linhaUtil(item) {
  return Boolean(item && (item.texto || item.label));
}

/**
 * Normaliza uma linha dos blocos para o formato do sino. Os dois blocos usam
 * nomes diferentes para o rótulo (`texto` na seção pessoal, `label` nos
 * alertas) e é só isso que muda entre eles.
 */
function normalizar(item, prefixo, indice) {
  return {
    id: item.id ?? `${prefixo}-${indice}`,
    origem: prefixo,
    cor: item.cor ?? "#0F2A44",
    texto: item.texto ?? item.label,
    rota: item.rota ?? null,
  };
}

/**
 * Lista única do sino: primeiro o que é pessoal e mais urgente ("Precisa da
 * Minha Atenção"), depois os alertas gerais do painel ("Pendências e
 * Alertas"), na mesma ordem em que cada bloco já os mostra.
 *
 * Ids repetidos entram uma única vez — a mesma pendência não pode contar duas.
 */
export function unirPendencias({ atencao, alertas } = {}) {
  const lista = [
    ...(atencao ?? []).filter(linhaUtil).map((item, i) => normalizar(item, "atencao", i)),
    ...(alertas ?? []).filter(linhaUtil).map((item, i) => normalizar(item, "alerta", i)),
  ];

  const vistos = new Set();
  return lista.filter((item) => {
    if (vistos.has(item.id)) return false;
    vistos.add(item.id);
    return true;
  });
}

/**
 * Contador do sino. Delega para `unirPendencias` de propósito: o número é
 * sempre o tamanho da lista que o painel do sino exibe.
 */
export function contarPendencias(fontes) {
  return unirPendencias(fontes).length;
}
