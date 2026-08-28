// Paginação do documento da Programação Diária de Pagamentos, em milímetros de
// folha A4 retrato. Fica separada da geração de HTML e de PDF porque é a parte
// que decide quantas folhas saem e onde a relação de fornecedores quebra.
//
// As mesmas alturas declaradas aqui são aplicadas no CSS da impressão: o
// cálculo e o desenho usam um número só, então o total de páginas é exato e
// nada é cortado.
//
// O documento é enxuto de propósito: contas utilizadas, pagamentos propostos, o
// somatório do programado e o saldo restante em destaque. Não há linhas em
// branco para anotação nem linhas de assinatura -- o papel não é assinado -- e
// por isso a programação do dia normalmente cabe com folga em uma folha.

export const PAGINA = { altura: 297, largura: 210, margemTopo: 11, margemBase: 13, margemLado: 12 };
export const RESERVA = 3;
export const ALTURA_UTIL = PAGINA.altura - PAGINA.margemTopo - PAGINA.margemBase - RESERVA;

// Compactas nas duas tabelas: o documento é só de leitura, então a altura de
// linha é a mínima que ainda deixa o valor confortável de conferir.
export const ALTURA = {
  cabecalhoInicial: 27,
  cabecalhoContinuacao: 14,
  tituloBloco: 7,
  linhaCabecalho: 5.5,
  linhaConta: 5.5,
  totalContas: 6.5,
  linhaPagamento: 6,
  totalProgramado: 7.5,
  saldoRestante: 13,
  saldoRestanteComDiferenca: 18,
};

/**
 * Altura do quadro do saldo restante. Programação acima do disponível ganha uma
 * linha a mais, com a diferença escrita em texto normal.
 */
export function alturaDoSaldoRestante(dados) {
  return Number(dados?.restante) < 0 ? ALTURA.saldoRestanteComDiferenca : ALTURA.saldoRestante;
}

/**
 * Distribui os blocos do documento em folhas A4. Cada folha devolvida tem:
 * `inicial` (leva o cabeçalho completo ou o reduzido) e `blocos` na ordem em
 * que devem ser desenhados.
 */
export function montarPaginas(dados) {
  const contas = dados?.contas ?? [];
  const pagamentos = dados?.pagamentos ?? [];
  const paginas = [];
  let atual = null;
  let livre = 0;

  const abrirPagina = () => {
    atual = { inicial: paginas.length === 0, blocos: [] };
    livre = ALTURA_UTIL - (atual.inicial ? ALTURA.cabecalhoInicial : ALTURA.cabecalhoContinuacao);
    paginas.push(atual);
  };
  const cabe = (altura) => livre >= altura;
  const consumir = (altura) => { livre -= altura; };

  abrirPagina();

  // Tabela quebrada em fatias: cada fatia leva o título e a linha de colunas,
  // então a relação continua legível na folha seguinte.
  const empacotarTabela = (tipo, linhas, alturaLinha) => {
    const cabecalho = ALTURA.tituloBloco + ALTURA.linhaCabecalho;
    const pendentes = linhas.slice();
    let continuacao = false;
    do {
      if (!cabe(cabecalho + alturaLinha)) abrirPagina();
      consumir(cabecalho);
      const quantidade = Math.max(1, Math.floor(livre / alturaLinha));
      const fatia = pendentes.splice(0, quantidade);
      consumir(Math.max(1, fatia.length) * alturaLinha);
      atual.blocos.push({ tipo, linhas: fatia, continuacao });
      continuacao = true;
    } while (pendentes.length);
  };

  const empacotarBloco = (bloco, altura) => {
    if (!cabe(altura)) abrirPagina();
    consumir(altura);
    atual.blocos.push(bloco);
  };

  empacotarTabela("contas", contas, ALTURA.linhaConta);
  empacotarBloco({ tipo: "totalContas" }, ALTURA.totalContas);
  empacotarTabela("pagamentos", pagamentos, ALTURA.linhaPagamento);
  // O somatório e o saldo restante fecham a coluna de valores: se não couberem
  // na folha, vão juntos para a seguinte, nunca separados um do outro.
  const fechamento = ALTURA.totalProgramado + alturaDoSaldoRestante(dados);
  if (!cabe(fechamento)) abrirPagina();
  consumir(ALTURA.totalProgramado);
  atual.blocos.push({ tipo: "totalProgramado" });
  consumir(alturaDoSaldoRestante(dados));
  atual.blocos.push({ tipo: "saldoRestante" });

  return paginas;
}
