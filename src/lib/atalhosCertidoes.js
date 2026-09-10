/**
 * Atalhos rápidos de prazo da listagem de Certidões e a ponte deles com a URL.
 *
 * Vive à parte de lib/filtrosCertidoes.js (que continua exportando `ATALHOS`,
 * para nada mudar em quem já o usava) porque quem só precisa montar um link
 * para a listagem — o Painel Principal, por exemplo — não deveria carregar o
 * módulo inteiro de filtros. Nenhuma regra de prazo mora aqui: a lista de
 * atalhos é a mesma de sempre, e quem interpreta cada uma é o filtro.
 */

/**
 * Atalhos rápidos. São excludentes entre si (não faz sentido pedir "vencidas" e
 * "vencendo em 7 dias" ao mesmo tempo), mas somam com os demais filtros.
 */
export const ATALHOS = [
  { id: "vencidas", label: "Vencidas" },
  { id: "vence_7", label: "Vencendo em 7 dias", dias: 7 },
  { id: "vence_15", label: "Vencendo em 15 dias", dias: 15 },
  { id: "vence_30", label: "Vencendo em 30 dias", dias: 30 },
  { id: "sem_documento", label: "Sem documento cadastrado" },
];

/**
 * Atalho pedido pela URL (`/certidoes?atalho=vencidas`), usado pelos atalhos do
 * Painel Principal para abrir a listagem já recortada. Valor desconhecido é
 * ignorado — a tela abre como sempre abriu.
 */
export function atalhoDaUrl(valor) {
  const pedido = String(valor ?? "").trim();
  return ATALHOS.some((a) => a.id === pedido) ? pedido : "";
}

/**
 * Rota da listagem de certidões já recortada pelo prazo de alerta. A janela é
 * configurável e só os prazos que existem como atalho podem ser recortados; nos
 * outros, a rota abre a listagem inteira, como antes.
 */
export function rotaCertidoesAVencer(janela) {
  const atalho = ATALHOS.find((a) => a.dias === Number(janela));
  return atalho ? `/certidoes?atalho=${atalho.id}` : "/certidoes";
}
