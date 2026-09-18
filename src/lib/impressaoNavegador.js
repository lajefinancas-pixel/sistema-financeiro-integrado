// Impressão de um documento próprio, em uma janela escondida.
//
// Todo documento impresso do sistema sai por aqui: o HTML é escrito em um
// iframe invisível e a impressão é disparada nele, não na página. É isso que
// garante que a folha tenha o layout do documento -- com o @page, as margens e a
// numeração dele -- e não uma captura da tela, e que o CSS de impressão de uma
// tela nunca afete o documento de outra.
//
// Mora em um arquivo separado porque é usada tanto pelos relatórios completos
// quanto pela relação de valores, e um deles chama o outro.

/**
 * Abre o HTML em um iframe escondido, manda imprimir e limpa depois.
 *
 * O quadro é removido quando a janela de impressão fecha (`onafterprint`) e,
 * como rede de segurança para os navegadores que não disparam esse evento,
 * também por tempo.
 */
export function prepararImpressaoDocumentoHtml() {
  const quadro = document.createElement("iframe");
  quadro.setAttribute("aria-hidden", "true");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(quadro);

  return quadro;
}

export function imprimirDocumentoHtml(html, quadroPreparado = null) {
  if (!html) return;

  // Quando a montagem do documento depende de leituras assíncronas (logomarca,
  // identidade etc.), o iframe é criado ainda no clique do usuário. Isso
  // preserva a ativação exigida por navegadores que bloqueiam print() iniciado
  // somente depois de um await.
  const quadro = quadroPreparado ?? prepararImpressaoDocumentoHtml();

  const remover = () => {
    if (quadro.parentNode) quadro.parentNode.removeChild(quadro);
  };

  const doc = quadro.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const janela = quadro.contentWindow;
  janela.onafterprint = () => setTimeout(remover, 300);
  setTimeout(() => {
    janela.focus();
    janela.print();
  }, 120);
  setTimeout(remover, 60000); // rede de segurança caso o navegador não dispare onafterprint
}
