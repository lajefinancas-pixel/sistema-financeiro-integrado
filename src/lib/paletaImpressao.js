// Tokens oficiais compartilhados por todas as saídas em papel e PDF.
// As duas representações evitam cores avulsas entre CSS (hex) e jsPDF (RGB).
export const COR_IMPRESSAO = Object.freeze({
  navy: "#0F2A44",
  ouro: "#C9A227",
  faixa: "#F5F3EC",
  linha: "#D8D5CC",
  apoio: "#5A6B7E",
  branco: "#FFFFFF",
  papel: "#FBFAF7",
});

export const TINTA_IMPRESSAO = Object.freeze({
  navy: [15, 42, 68],
  ouro: [201, 162, 39],
  faixa: [245, 243, 236],
  linha: [216, 213, 204],
  apoio: [90, 107, 126],
  branco: [255, 255, 255],
  papel: [251, 250, 247],
});
