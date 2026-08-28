// Paginação do documento da Programação Diária de Pagamentos, em milímetros de
// folha A4 retrato. Fica separada da geração de HTML e de PDF porque é a parte
// que decide quantas folhas saem, onde a relação de fornecedores quebra e
// quantas linhas em branco sobram para o gestor escrever à mão.
//
// As mesmas alturas declaradas aqui são aplicadas no CSS da impressão: o
// cálculo e o desenho usam um número só, então o total de páginas é exato e
// nada é cortado.

export const PAGINA = { altura: 297, largura: 210, margemTopo: 11, margemBase: 13, margemLado: 12 };
export const RESERVA = 3;
export const ALTURA_UTIL = PAGINA.altura - PAGINA.margemTopo - PAGINA.margemBase - RESERVA;

// Compactas nas contas (só leitura) e generosas nos pagamentos, porque é ao
// lado de cada fornecedor que o gestor anota a decisão.
export const ALTURA = {
  cabecalhoInicial: 25,
  cabecalhoContinuacao: 12,
  tituloBloco: 6,
  linhaCabecalho: 5.5,
  linhaConta: 6,
  totalContas: 7.5,
  linhaPagamento: 10,
  totais: 18,
  totaisComDiferenca: 24,
  tituloObservacoes: 6,
  linhaObservacao: 9,
  assinaturas: 23,
};

export const MINIMO_OBSERVACOES = 3;
export const MAXIMO_OBSERVACOES = 10;

export function alturaDosTotais(dados) {
  return Number(dados?.restante) < 0 ? ALTURA.totaisComDiferenca : ALTURA.totais;
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
  empacotarBloco({ tipo: "totais" }, alturaDosTotais(dados));

  // Observações e assinaturas fecham o documento juntas: as linhas em branco
  // ocupam a folga que sobrou da folha, sem empurrar a assinatura para outra.
  const minimo = ALTURA.tituloObservacoes + ALTURA.linhaObservacao * MINIMO_OBSERVACOES + ALTURA.assinaturas;
  if (!cabe(minimo)) abrirPagina();
  const folga = livre - ALTURA.assinaturas - ALTURA.tituloObservacoes;
  const quantidade = Math.min(MAXIMO_OBSERVACOES, Math.max(MINIMO_OBSERVACOES, Math.floor(folga / ALTURA.linhaObservacao)));
  consumir(ALTURA.tituloObservacoes + quantidade * ALTURA.linhaObservacao);
  atual.blocos.push({ tipo: "observacoes", quantidade });
  consumir(ALTURA.assinaturas);
  atual.blocos.push({ tipo: "assinaturas" });

  return paginas;
}
