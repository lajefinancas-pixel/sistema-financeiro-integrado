import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, FileDown, FileSpreadsheet, Pencil, Plus, Printer, Search, Trash2, Unlock, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { formatBRL } from "../lib/moeda";
import { textoDoMotivo } from "../lib/rateioPagamentos";
import { mensagemAmigavel } from "../lib/erros";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { usePermissaoModulo } from "../lib/permissoes";
import { agoraBR, exportarExcelProgramacao, gerarPdfProgramacao, imprimirProgramacao } from "../lib/programacaoDocumento";
import { alternarSelecao, calcularRestante, chavesDeExibicaoDosPagamentos, definirValorProgramado, selecionarTodosVisiveis, somarContasSelecionadas, somarPagamentos, valorPlanejamento } from "../lib/planejamentoPagamentos";
import {
  TEXTO_SEM_REGISTRO,
  aplicarSaldosCongelados,
  avisoSaldoCongelado,
  contasSemSaldoCongelado,
  mapaSaldosCongelados,
  saldoParaGravar,
  semRegistroDeSaldoCongelado,
  somarSaldosCongelados,
  usaSaldoCongelado,
} from "../lib/saldoCongeladoProgramacao";
import { FUNCOES_FASE_1, classificarFalhaFase1, detalheDoBanco, verificarEstruturaFase1 } from "../lib/estruturaPagamentosFase1";
import { verificarEstruturaFase2 } from "../lib/estruturaPagamentosFase2";
import { STATUS_APROVADA, aplicarContaEmPagamentos, emExecucao, emRevisaoPosAnalise, impedimentosParaAprovar, podeReabrirProgramacao, podeRevisarProposta, resumoAprovacao, statusLabelExecucao } from "../lib/execucaoProgramacao";
import { aprovarProgramacao, carregarContasParaTransferencia, carregarPermissoesFase2, carregarTransferenciasDaProgramacao, carregarVinculosDaProgramacao, definirContaDePagamentos, definirNomeExibicaoDoPagamento, estruturaFase2Ausente, reabrirProgramacao } from "../lib/execucaoProgramacaoDados";
import ModalAprovacaoProgramacao from "../components/pagamentos/ModalAprovacaoProgramacao";
import ModalReaberturaProgramacao from "../components/pagamentos/ModalReaberturaProgramacao";
import ModalDuplicarProgramacao from "../components/pagamentos/ModalDuplicarProgramacao";
import LinhasExecucaoProgramacao from "../components/pagamentos/LinhasExecucaoProgramacao";
import SeletorContas from "../components/comuns/SeletorContas";
import { contasSelecionadasDaLista, filtrarContasCadastradas, rotuloContasSelecionadas } from "../lib/contasBancariasBusca";
import { estruturaDePixAusente } from "../lib/contasBancarias";
import NomeFornecedor from "../components/comuns/NomeFornecedor";
import ModalConfirmarExclusao from "../components/comuns/ModalConfirmarExclusao";
import { cancelarProgramacao, excluirProgramacao, verificarExclusaoProgramacao } from "../lib/programacoesExclusao";
import {
  AVISO_MIGRATION_ORIGEM,
  aplicarEnvioNosPagamentos,
  avisoDeEnvioPendente,
  itemTemOrigem,
  lerEnvio,
  limparEnvio,
  rotuloDaOrigem,
} from "../lib/programacaoDeAreas";
import {
  LIMITE_NOME_EXIBICAO,
  estruturaDeApelidoAusente,
  filtrarFornecedoresPorTermo,
  nomeExibicaoDoPagamento,
  normalizarNomeExibicao,
  ordenarFornecedoresPorNome,
  ordenarPagamentosPorNome,
} from "../lib/nomesFornecedor";

const hojeISO = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
};
const numero = (valor) => valorPlanejamento(valor);
const dataBR = (valor) => new Date(`${valor}T00:00:00`).toLocaleDateString("pt-BR");
const nomeAutomatico = (data) => `PROGRAMAÇÃO DIÁRIA — ${dataBR(data)}`;
const COLUNAS_CONTA_PROGRAMACAO = "id, nome_conta, numero_conta, secretaria_id, bancos(nome)";

/**
 * Contas ATIVAS da secretaria da programação — as mesmas de sempre, e apenas
 * elas: a programação continua trabalhando dentro da própria secretaria.
 *
 * A agência entra na consulta quando a coluna já existe no banco; sem ela, a
 * lista vem igual, só sem a busca por agência.
 */
async function contasAtivasDaSecretaria(secretariaId) {
  const consultar = (colunas) =>
    supabase.from("contas_bancarias").select(colunas).eq("secretaria_id", secretariaId).eq("ativo", true);

  const comAgencia = await consultar(`${COLUNAS_CONTA_PROGRAMACAO}, agencia`);
  if (!comAgencia.error) return comAgencia;
  if (!estruturaDePixAusente(comAgencia.error)) return comAgencia;
  return consultar(COLUNAS_CONTA_PROGRAMACAO);
}
const COLUNAS_FORNECEDOR_PROGRAMACAO = "id, razao_social, nome_fantasia, cpf_cnpj";
const COLUNAS_PAGAMENTO_PROGRAMACAO = "id, fornecedor_id, valor_a_pagar, nome_avulso, cadastrar_fornecedor_posteriormente, situacao";

/**
 * Fornecedores ativos da secretaria, com o APELIDO quando a coluna já existe.
 *
 * O apelido entra na consulta para a busca encontrar "Zé Alimentos" e para a
 * tela mostrá-lo em destaque. Enquanto a migration do apelido não rodar, a lista
 * vem igual à de sempre -- só sem apelido.
 */
async function fornecedoresAtivosDaSecretaria(secretariaId) {
  const consultar = (colunas) =>
    supabase
      .from("fornecedores")
      .select(colunas)
      .eq("secretaria_id", secretariaId)
      .eq("ativo", true)
      .order("razao_social");

  const comApelido = await consultar(`${COLUNAS_FORNECEDOR_PROGRAMACAO}, apelido`);
  if (!comApelido.error) return comApelido;
  if (!estruturaDeApelidoAusente(comApelido.error)) return comApelido;
  return consultar(COLUNAS_FORNECEDOR_PROGRAMACAO);
}

/**
 * Itens da programação, com o nome de exibição próprio do item e o apelido do
 * fornecedor vinculado quando as colunas já existem. Sem elas, os itens vêm
 * exatamente como vinham, com a razão social.
 */
async function itensDaProgramacao(programacaoId) {
  const consultar = (colunas) =>
    supabase
      .from("pagamentos")
      .select(colunas)
      .eq("programacao_id", programacaoId)
      .is("excluido_em", null)
      .order("id");

  // A origem (patrocínio, aluguel ou banda) é informação ADICIONAL do item: ela
  // não substitui o fornecedor_id em nada e a maioria dos itens não tem origem
  // nenhuma. Enquanto a migration da origem não rodar, a consulta cai para a
  // versão sem essas colunas e a tela funciona exatamente como antes.
  const comOrigem = await consultar(
    `${COLUNAS_PAGAMENTO_PROGRAMACAO}, nome_exibicao_programacao, origem_tipo, origem_id, fornecedores(razao_social, apelido)`,
  );
  if (!comOrigem.error) return comOrigem;
  if (!estruturaDeApelidoAusente(comOrigem.error)) return comOrigem;

  const comApelido = await consultar(
    `${COLUNAS_PAGAMENTO_PROGRAMACAO}, nome_exibicao_programacao, fornecedores(razao_social, apelido)`,
  );
  // Deu certo sem as colunas de origem: elas ainda não existem no banco, e o
  // aviso da migration é mostrado só para quem veio de uma área.
  if (!comApelido.error) return { ...comApelido, semColunasDeOrigem: true };
  if (!estruturaDeApelidoAusente(comApelido.error)) return comApelido;
  return consultar(`${COLUNAS_PAGAMENTO_PROGRAMACAO}, fornecedores(razao_social)`);
}

const COLUNAS_PROGRAMACAO = "id, nome_programacao, data_programacao, status, fechado, responsavel_id";

/**
 * Cabeçalho da programação, com o SALDO CONSIDERADO que ficou gravado nela.
 *
 * É o total que estava na mesa no dia em que a programação foi montada. Vem na
 * consulta para a tela poder afirmar que uma programação antiga tem (ou não
 * tem) o saldo daquele dia registrado -- e nunca para recalcular valor nenhum.
 * Enquanto a coluna não existir no banco, a programação abre igual, só sem essa
 * informação.
 */
async function cabecalhoDaProgramacao(programacaoId) {
  const consultar = (colunas) =>
    supabase.from("programacoes_pagamento").select(colunas).eq("id", programacaoId).is("excluido_em", null).single();

  const comSaldo = await consultar(`${COLUNAS_PROGRAMACAO}, saldo_considerado`);
  if (!comSaldo.error) return comSaldo;
  if (classificarFalhaFase1(comSaldo.error).tipo !== "estrutura") return comSaldo;
  return consultar(COLUNAS_PROGRAMACAO);
}

const MIGRATION_FASE_1 = "supabase/migrations/20260827000000_consolidar_fluxo_pagamentos_diarios.sql";
const MIGRATION_REPARO_FASE_1 = "supabase/migrations/20260827130000_reaplicar_estrutura_pagamentos_fase_1.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const MIGRATION_CORRECAO_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_REABERTURA = "supabase/migrations/20260910120000_reabrir_programacao_aprovada.sql";
const MIGRATION_CORRECAO_FORNECEDORES = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";
const MIGRATION_PADRONIZACAO_USUARIO = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const MIGRATION_APELIDO = "supabase/migrations/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql";
const MIGRATION_BLINDAGEM_TIPOS = "supabase/migrations/20260911120000_blindar_tipos_legados_pagamentos.sql";

// Recusa de tipo (22P02) não tem UM arquivo só: cada operação da tela é atendida
// por uma função de banco diferente, e cada função nasceu numa migration
// diferente. Enquanto isto era ignorado, qualquer 22P02 mandava rodar a
// migration da aprovação -- e quem já a tinha rodado ficava sem saída, olhando
// um aviso que apontava o arquivo errado. O mapa abaixo diz, por operação, qual
// arquivo refaz a função que falhou. Operação fora do mapa não ganha palpite:
// nenhum arquivo é citado -- é o caso da transferência e do estorno, que avisam
// pela mensagem geral do sistema (src/lib/erros.js), a qual já explica o 22P02
// sem apontar arquivo nenhum.
const MIGRATION_DE_TIPO_POR_OPERACAO = {
  salvar: MIGRATION_CORRECAO_APROVACAO,
  em_analise: MIGRATION_CORRECAO_APROVACAO,
  aprovar: MIGRATION_CORRECAO_APROVACAO,
  reabrir: MIGRATION_REABERTURA,
  definir_conta: MIGRATION_BLINDAGEM_TIPOS,
  nome_exibicao: MIGRATION_BLINDAGEM_TIPOS,
};

// Ausência de id: nulo, indefinido, texto vazio ou zero. Nenhum deles é um id
// de registro, e nenhum deles pode chegar ao banco como se fosse -- em coluna
// com vínculo o banco recusaria a gravação inteira.
function vazio(valor) {
  return valor == null || valor === "" || Number(valor) === 0;
}

function idInteiro(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    const erro = new Error(`${campo} inválido.`);
    erro.amigavel = true;
    throw erro;
  }
  return id;
}

// Todo erro da Fase 1 vai inteiro para o console: o objeto original do Supabase
// (code, message, details, hint) mais o contexto da chamada, a classificação que
// a tela usou para escolher a mensagem e os campos estruturados que o banco
// mandou no DETAIL (etapa, constraint, tabela, coluna). Nenhuma falha fica só
// como texto, e nenhuma chave estrangeira fica sem nome.
function registrarErroFase1(operacao, falha, contexto = {}) {
  if (typeof console === "undefined") return;
  console.error(`[Pagamentos Fase 1] ${operacao}`, {
    ...contexto,
    code: falha?.code,
    message: falha?.message,
    details: falha?.details,
    hint: falha?.hint,
    status: falha?.status,
    banco: detalheDoBanco(falha),
    classificacao: classificarFalhaFase1(falha),
    erroOriginal: falha,
  });
}

function listaLegivel(itens) {
  return itens.join(", ");
}

function mensagemEstruturaAusente(objetos) {
  const detalhe = objetos.length ? ` Falta no banco: ${listaLegivel(objetos)}.` : "";
  return `A estrutura da Fase 1 não está disponível no banco conectado a esta tela.${detalhe} Execute ${MIGRATION_FASE_1} e ${MIGRATION_REPARO_FASE_1} no mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo do banco está no console (F12).`;
}

// A tela só afirma "falta estrutura" quando o próprio banco disse que o objeto
// não existe (42P01/42703/42883/PGRST200/PGRST202/PGRST204/PGRST205). Permissão
// e sessão têm mensagem própria; o resto continua com a mensagem do contexto.
function mensagemFalhaFase1(falha, mensagemPadrao, operacao) {
  const classificacao = classificarFalhaFase1(falha);

  if (classificacao.tipo === "estrutura") {
    const objeto = classificacao.objeto;
    if (classificacao.alvo === "funcao") {
      const esperada = FUNCOES_FASE_1.find((funcao) => String(objeto ?? "").includes(funcao.nome));
      const assinatura = esperada ? ` A tela chama ${esperada.nome}${esperada.assinatura}.` : "";
      return `${mensagemEstruturaAusente(objeto ? [objeto] : [])} A função pode existir com outra assinatura de tipos.${assinatura}`;
    }
    return mensagemEstruturaAusente(objeto ? [objeto] : []);
  }

  if (classificacao.tipo === "permissao") {
    return "Seu usuário não tem permissão para esta operação nos Pagamentos Diários (ou a sessão expirou). Isto não é falta de estrutura no banco: o erro completo está no console (F12).";
  }

  // 22P02 vindo daqui não é valor mal digitado: a tela só envia número, e o
  // aviso antigo ("formato inválido") mandava conferir valores que estavam
  // certos. O que existe por trás é comparação entre tipos incompatíveis dentro
  // da função do banco -- texto contra enum, texto contra boolean -- e a
  // correção é rodar a migration que refaz A FUNÇÃO DAQUELA OPERAÇÃO.
  //
  // Sem saber qual operação falhou, a tela não chuta arquivo: diz o que houve e
  // manda ler o console. Apontar um arquivo sem relação -- já rodado, e de outra
  // função -- é pior do que não apontar nenhum, porque faz rodar de novo algo
  // que não muda nada e esconde a causa real.
  if (String(falha?.code ?? "") === "22P02") {
    const arquivo = MIGRATION_DE_TIPO_POR_OPERACAO[String(operacao ?? "")];
    const oQueFazer = arquivo
      ? `Execute ${arquivo} no SQL Editor do mesmo projeto Supabase usado pela aplicação e tente novamente.`
      : "Nenhum saldo foi movimentado.";
    return `O banco recusou a operação por incompatibilidade de tipo entre um valor e a coluna correspondente. Não é o valor digitado na tela. ${oQueFazer} O erro completo do banco, com a etapa e o tipo real de cada coluna, está no console (F12).`;
  }

  // 23503 é recusa de vínculo entre registros. A mensagem geral do sistema
  // ("este registro está ligado a outros lançamentos") descreve o caso oposto --
  // aqui o problema é um id que NÃO existe no destino, não um registro em uso.
  // Depois da migration de correção o próprio banco explica qual vínculo caiu;
  // enquanto ela não roda, a tela diz o que executar.
  if (String(falha?.code ?? "") === "23503") {
    const banco = detalheDoBanco(falha);
    const vinculo = banco.constraint || banco.coluna ? " O vínculo exato está no console (F12)." : "";
    return `O banco recusou um vínculo entre registros: algum item escolhido aponta para um cadastro que não existe mais. Recarregue a página, refaça a escolha dos fornecedores e das contas e salve. Se continuar, execute ${MIGRATION_CORRECAO_FORNECEDORES} e ${MIGRATION_PADRONIZACAO_USUARIO} no SQL Editor do mesmo projeto Supabase usado pela aplicação.${vinculo}`;
  }

  return mensagemAmigavel(falha, mensagemPadrao);
}

// A execução financeira tem migration própria, e ela roda à mão no SQL Editor.
// Enquanto não rodar, a tela não pode quebrar: a Fase 1 inteira continua de pé e
// só a aprovação, a execução e a transferência ficam indisponíveis, com o aviso
// dizendo qual arquivo executar.
function mensagemFalhaFase2(falha, mensagemPadrao, operacao) {
  if (estruturaFase2Ausente(falha)) {
    return `A estrutura da Fase 2 (execução financeira) não está no banco conectado a esta tela. Execute ${MIGRATION_FASE_2} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo do banco está no console (F12).`;
  }
  return mensagemFalhaFase1(falha, mensagemPadrao, operacao);
}

// Reabrir tem migration própria, também rodada à mão no SQL Editor. Enquanto ela
// não rodar, a função não existe -- e o aviso precisa dizer QUAL arquivo
// executar, em vez de mandar rodar a migration da Fase 2, que não cria esta
// função.
function mensagemFalhaReabertura(falha) {
  if (estruturaFase2Ausente(falha)) {
    return `A ação de reabrir programação ainda não está no banco conectado a esta tela. Execute ${MIGRATION_REABERTURA} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo do banco está no console (F12).`;
  }
  return mensagemFalhaFase2(falha, "Não foi possível reabrir a programação.", "reabrir");
}

function registrarErroFase2(operacao, falha, contexto = {}) {
  if (typeof console === "undefined") return;
  console.error(`[Pagamentos Fase 2] ${operacao}`, {
    ...contexto,
    code: falha?.code,
    message: falha?.message,
    details: falha?.details,
    hint: falha?.hint,
    status: falha?.status,
    banco: detalheDoBanco(falha),
    classificacao: classificarFalhaFase1(falha),
    erroOriginal: falha,
  });
}

/**
 * Nome do item como a tela e o papel o mostram:
 * nome de exibição da programação -> apelido do cadastro -> razão social.
 *
 * É a mesma função usada na impressão, no PDF, no Excel e no painel de execução,
 * para que o papel não divirja da tela. Nenhuma delas altera cadastro nenhum: o
 * vínculo do item continua sendo o `fornecedor_id`.
 */
function nomePagamento(pagamento) {
  return nomeExibicaoDoPagamento(pagamento);
}

function statusLabel(status, fechado = false) {
  // "APROVADA / AGUARDANDO EXECUÇÃO" entra aqui: aprovado não é pago, e o
  // rótulo diz isso ao usuário sem depender de nenhuma outra tela.
  return statusLabelExecucao(status, fechado);
}

export default function PagamentosRedesenhado() {
  const { permissao, usuario } = usePermissaoModulo("pagamentos");
  const podeEditar = permissao?.pode_editar !== false;
  const podeExcluir = permissao?.pode_excluir === true;
  const [carregando, setCarregando] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState("");
  const [mensagem, setMensagem] = React.useState("");
  const [secretarias, setSecretarias] = React.useState([]);
  const [secretariaId, setSecretariaId] = React.useState("");
  const [data, setData] = React.useState(hojeISO());
  const [programacoes, setProgramacoes] = React.useState([]);
  const [programacaoId, setProgramacaoId] = React.useState("");
  const [programacao, setProgramacao] = React.useState(null);
  const [exclusaoProgramacao, setExclusaoProgramacao] = React.useState(null);
  const [duplicacao, setDuplicacao] = React.useState(null);
  const [contas, setContas] = React.useState([]);
  const [contasSelecionadas, setContasSelecionadas] = React.useState(new Set());
  const [buscaConta, setBuscaConta] = React.useState("");
  // Saldo CONGELADO da programação aberta: o valor que cada conta tinha quando
  // a programação foi montada, lido de programacao_contas.saldo_considerado.
  // Programação de data anterior, aprovada ou fechada é documento -- mostra
  // estes valores, e não o saldo de hoje.
  const [saldosCongelados, setSaldosCongelados] = React.useState(() => new Map());
  const [semRegistroCongelado, setSemRegistroCongelado] = React.useState(false);
  // Conferência das contas marcadas, fora da área com rolagem: só mostra ou
  // esconde a lista do que já está selecionado. Não marca, não desmarca e não
  // encosta no saldo da programação.
  const [verSelecionadas, setVerSelecionadas] = React.useState(false);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [pagamentos, setPagamentos] = React.useState([]);
  const [mostrarAvulso, setMostrarAvulso] = React.useState(false);
  const [avulso, setAvulso] = React.useState({ nome: "", valor: 0, cadastrarDepois: false });
  const [estrutura, setEstrutura] = React.useState(null);
  // Recolhimento dos blocos: organização visual da tela, nada mais. Confirmar
  // não grava, não movimenta saldo e não muda nenhum cálculo -- apenas esconde
  // a lista completa para sobrar na tela (e no papel) o que foi escolhido.
  const [contasConfirmadas, setContasConfirmadas] = React.useState(false);
  const [fornecedoresConfirmados, setFornecedoresConfirmados] = React.useState(false);
  // Etapa de execução (Fase 2). Nada aqui movimenta saldo, com uma única
  // exceção: a transferência entre contas confirmada.
  const [estruturaFase2, setEstruturaFase2] = React.useState(null);
  const [permissoesFase2, setPermissoesFase2] = React.useState(null);
  const [transferencias, setTransferencias] = React.useState([]);
  const [contasTransferencia, setContasTransferencia] = React.useState([]);
  const [mostrarAprovacao, setMostrarAprovacao] = React.useState(false);
  // Reabrir é AÇÃO DE EXCEÇÃO: desfaz a aprovação e devolve a programação para
  // elaboração. Não desfaz dado nenhum -- os vínculos abaixo existem só para o
  // aviso mostrado antes de confirmar.
  const [mostrarReabertura, setMostrarReabertura] = React.useState(false);
  const [vinculosReabertura, setVinculosReabertura] = React.useState({ baixas: 0, transferencias: 0 });
  const [mostrarTransferencia, setMostrarTransferencia] = React.useState(false);
  const [estornoAlvo, setEstornoAlvo] = React.useState(null);
  // Aprovada trava a proposta: o que muda depois disso é a execução, não o
  // planejamento. Retirar fornecedor, alterar valor e mexer nas contas valem
  // enquanto a programação está em elaboração ou em análise.
  const podeEditarProgramacao = podeEditar && programacao?.fechado !== true && programacao?.status !== STATUS_APROVADA;
  // O nome mostrado é rótulo, não dinheiro: pode ser ajustado enquanto a
  // programação não estiver fechada, inclusive depois de aprovada. Renomear a
  // exibição não altera valor, conta, vínculo nem cadastro. Programação fechada
  // é histórico -- o banco recusa a alteração.
  const podeRenomearExibicao = podeEditar && programacao?.fechado !== true;
  const [nomeExibicaoEditando, setNomeExibicaoEditando] = React.useState(null);
  // Registro de uma área (Patrocínios, Aluguéis ou Bandas) mandado para cá.
  // É PROPOSTA: traz só o fornecedor e o valor a programar, e entra na lista
  // pelo mesmo caminho de qualquer outro fornecedor. Nada é pago por isso.
  const [envioPendente, setEnvioPendente] = React.useState(() => lerEnvio());
  const envioAplicado = React.useRef(null);
  const [semColunasDeOrigem, setSemColunasDeOrigem] = React.useState(false);
  const [envioAnotado, setEnvioAnotado] = React.useState(false);
  // Item que acabou de entrar na programação. A lista reordena na hora, então a
  // tela leva a pessoa até onde o item caiu -- e só quando ele ficou fora da
  // área visível.
  const [itemAdicionado, setItemAdicionado] = React.useState(null);

  // ORDEM DA PROGRAMAÇÃO, UMA SÓ: alfabética pelo nome exibido. Esta lista
  // alimenta os escolhidos, os valores, a tabela de contas da execução, a
  // impressão, o PDF e a planilha -- é o que garante que o papel saia na mesma
  // ordem da tela. `pagamentos` continua sendo a lista de verdade (ordem de
  // inclusão), e é ela que é gravada: reordenar é só exibição.
  const pagamentosOrdenados = React.useMemo(() => ordenarPagamentosPorNome(pagamentos), [pagamentos]);
  // A identidade de cada linha, para o React reconhecer a mesma linha depois de
  // a lista reordenar: o valor sendo digitado e a renomeação aberta continuam
  // onde estavam quando um fornecedor novo entra no meio da lista.
  const chavesPagamentos = React.useMemo(() => chavesDeExibicaoDosPagamentos(pagamentos), [pagamentos]);

  const avisoPendente = envioPendente
    ? avisoDeEnvioPendente(envioPendente, { programacao, podeEditarProgramacao })
    : "";

  function cancelarEnvioPendente() {
    limparEnvio();
    setEnvioPendente(null);
  }

  React.useEffect(() => {
    carregarSecretarias();
    conferirEstrutura();
  }, []);

  // O envio entra na lista assim que existir uma programação que aceite item
  // novo. Programação aprovada, fechada ou inexistente não recebe nada: o item
  // fica esperando, com aviso na tela, e o usuário segue pelo caminho de sempre
  // (criar programação, escolher outra data ou reabrir).
  React.useEffect(() => {
    if (!envioPendente || envioAplicado.current === envioPendente.chave) return;
    if (!programacao || !podeEditarProgramacao) return;

    const aplicado = aplicarEnvioNosPagamentos(pagamentos, envioPendente);
    if (aplicado.resultado === "invalido") {
      limparEnvio();
      setEnvioPendente(null);
      return;
    }
    envioAplicado.current = envioPendente.chave;
    setEnvioAnotado(true);
    setPagamentos(aplicado.pagamentos);
    if (aplicado.resultado === "adicionado") setItemAdicionado(aplicado.pagamentos[aplicado.pagamentos.length - 1]);
    setFornecedoresConfirmados(false);
    setMensagem(aplicado.mensagem);
    limparEnvio();
    setEnvioPendente(null);
  }, [envioPendente, programacao, podeEditarProgramacao, pagamentos]);

  React.useEffect(() => {
    if (!secretariaId) return;
    carregarBase();
    carregarProgramacoes();
  }, [secretariaId, data]);

  // Fornecedor acrescentado entra na posição alfabética dele, que pode ser
  // acima do que está na tela. `block: "nearest"` rola o mínimo necessário e
  // não faz nada quando a linha já está visível: a rolagem de quem está
  // conferindo a lista não se perde. Só exibição -- nada é alterado aqui.
  React.useEffect(() => {
    if (!itemAdicionado) return;
    const chave = chavesPagamentos.get(itemAdicionado);
    setItemAdicionado(null);
    if (!chave || typeof document === "undefined") return;
    const seletor = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(chave) : chave.replace(/["\\]/g, "\\$&");
    // A mesma linha existe na lista dos escolhidos e na de valores; uma das
    // duas está escondida por CSS, e a escondida não tem caixa de layout.
    const linhas = [...document.querySelectorAll(`[data-item-programacao="${seletor}"]`)];
    linhas.find((linha) => linha.offsetParent !== null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [itemAdicionado, chavesPagamentos]);

  React.useEffect(() => {
    if (programacaoId) carregarProgramacao(programacaoId);
    else limparEdicao();
  }, [programacaoId]);

  React.useEffect(() => {
    let ativo = true;
    carregarPermissoesFase2(permissao).then((valores) => {
      if (ativo) setPermissoesFase2(valores);
    });
    return () => { ativo = false; };
  }, [permissao]);

  // Conferência ativa, feita ao abrir a tela: diz exatamente quais colunas
  // faltam, em vez de esperar uma ação falhar e adivinhar o motivo. `limit(0)`
  // não traz linha nenhuma, então policy de RLS restritiva não é confundida
  // com estrutura ausente.
  async function conferirEstrutura() {
    const [resultado, resultadoFase2] = await Promise.all([
      verificarEstruturaFase1(supabase),
      verificarEstruturaFase2(supabase),
    ]);
    setEstrutura(resultado);
    setEstruturaFase2(resultadoFase2);
    if (typeof console !== "undefined" && resultado.falhas.length) {
      console.error("[Pagamentos Fase 1] Verificação de estrutura", {
        faltando: resultado.faltando,
        naoVerificado: resultado.naoVerificado,
        funcoesEsperadas: FUNCOES_FASE_1,
        falhas: resultado.falhas,
      });
    }
    if (typeof console !== "undefined" && resultadoFase2.falhas.length) {
      console.error("[Pagamentos Fase 2] Verificação de estrutura", {
        faltando: resultadoFase2.faltando,
        naoVerificado: resultadoFase2.naoVerificado,
        falhas: resultadoFase2.falhas,
      });
    }
  }

  async function carregarSecretarias() {
    try {
      const { data: itens, error } = await supabase.from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      setSecretarias(itens ?? []);
      // Quem chegou de uma área abre já na secretaria do fornecedor daquele
      // registro, quando ela está entre as que a pessoa vê. Sem envio, ou fora
      // da lista, a primeira secretaria continua sendo a escolhida.
      const daArea = (itens ?? []).find(
        (item) => String(item.id) === String(envioPendente?.secretaria_id ?? ""),
      );
      setSecretariaId(daArea?.id || itens?.[0]?.id || "");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as secretarias."));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarBase() {
    setErro("");
    try {
      const [{ data: contasBrutas, error: erroContas }, { data: fornecedoresAtivos, error: erroFornecedores }] = await Promise.all([
        contasAtivasDaSecretaria(secretariaId),
        fornecedoresAtivosDaSecretaria(secretariaId),
      ]);
      if (erroContas) throw erroContas;
      if (erroFornecedores) throw erroFornecedores;

      const nomeSecretaria = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "--";
      const { contas: contasComSaldo } = await carregarSaldosDasContas({
        contas: (contasBrutas ?? []).map((conta) => ({
          id: conta.id,
          nome_conta: conta.nome_conta,
          numero_conta: conta.numero_conta,
          agencia: conta.agencia ?? "",
          banco: conta.bancos?.nome || "--",
          secretaria: nomeSecretaria,
          secretaria_id: conta.secretaria_id,
        })),
        comReservas: false,
      });
      setContas(contasComSaldo);

      const ids = (fornecedoresAtivos ?? []).map((item) => item.id);
      const { data: abertos, error: erroAbertos } = ids.length
        ? await supabase.from("valores_em_aberto").select("fornecedor_id, valor, valor_pago, situacao").in("fornecedor_id", ids).in("situacao", ["em_aberto", "programado", "parcialmente_pago"])
        : { data: [], error: null };
      if (erroAbertos) throw erroAbertos;
      const totais = (abertos ?? []).reduce((mapa, item) => {
        const chave = String(item.fornecedor_id);
        mapa[chave] = numero(mapa[chave]) + Math.max(0, numero(item.valor) - numero(item.valor_pago));
        return mapa;
      }, {});
      // ORDEM ALFABÉTICA PELO NOME EXIBIDO -- o mesmo nome que a pessoa lê na
      // linha (apelido quando existe, senão a razão social). O valor em aberto
      // continua sendo mostrado ao lado de cada fornecedor; ele só não manda
      // mais na posição da lista.
      setFornecedores(ordenarFornecedoresPorNome((fornecedoresAtivos ?? []).map((fornecedor) => ({
        ...fornecedor,
        valor_em_aberto: numero(totais[String(fornecedor.id)]),
      }))));
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar contas e fornecedores."));
    }
  }

  async function carregarProgramacoes(preferidaId = "") {
    try {
      const { data: itens, error } = await supabase.from("programacoes_pagamento")
        .select("id, nome_programacao, status, fechado")
        .eq("secretaria_id", idInteiro(secretariaId, "Secretaria"))
        .eq("data_programacao", data)
        .is("excluido_em", null)
        .order("id", { ascending: false });
      if (error) throw error;
      setProgramacoes(itens ?? []);
      const alvo = preferidaId || programacaoId;
      setProgramacaoId((itens ?? []).some((item) => String(item.id) === String(alvo)) ? alvo : itens?.[0]?.id || "");
    } catch (falha) {
      registrarErroFase1("Falha ao carregar programações", falha, { secretariaId, dataProgramacao: data });
      setErro(mensagemFalhaFase1(falha, "Não foi possível carregar as programações."));
    }
  }

  function limparEdicao() {
    setProgramacao(null);
    setTransferencias([]);
    setSaldosCongelados(new Map());
    setSemRegistroCongelado(false);
    setContasSelecionadas(new Set());
    setPagamentos([]);
    setContasConfirmadas(false);
    setFornecedoresConfirmados(false);
  }

  async function carregarProgramacao(id, { manterRecolhimento = false } = {}) {
    setErro("");
    try {
      const idProgramacao = idInteiro(id, "Programação");
      const [{ data: programa, error: erroPrograma }, { data: vinculadas, error: erroContas }, resultadoItens] = await Promise.all([
        cabecalhoDaProgramacao(idProgramacao),
        supabase.from("programacao_contas").select("conta_id, saldo_considerado, ordem").eq("programacao_id", idProgramacao).eq("ativa", true).order("ordem"),
        itensDaProgramacao(idProgramacao),
      ]);
      const { data: itens, error: erroPagamentos } = resultadoItens;
      // A migration da origem ainda não rodou: a tela segue inteira, e o aviso
      // só aparece para quem acabou de mandar um registro de área para cá.
      setSemColunasDeOrigem(Boolean(resultadoItens.semColunasDeOrigem));
      if (erroPrograma) throw erroPrograma;
      if (erroContas) throw erroContas;
      if (erroPagamentos) throw erroPagamentos;
      const { data: responsavel } = programa?.responsavel_id
        ? await supabase.from("usuarios").select("nome_completo").eq("id", programa.responsavel_id).maybeSingle()
        : { data: null };
      const contaPorPagamento = await contasDefinidasDosPagamentos(idProgramacao);
      setProgramacao({ ...programa, responsavel });
      // O saldo congelado é apenas LIDO daqui para a frente: a tela passa a
      // exibir o que está gravado, sem consultar saldo atual e sem recalcular.
      setSaldosCongelados(mapaSaldosCongelados(vinculadas));
      setSemRegistroCongelado(semRegistroDeSaldoCongelado({
        linhas: vinculadas,
        saldoCabecalho: programa?.saldo_considerado,
      }));
      setContasSelecionadas(new Set((vinculadas ?? []).map((item) => item.conta_id)));
      setPagamentos((itens ?? []).map((item) => ({
        ...item,
        valor_a_pagar: numero(item.valor_a_pagar),
        conta_origem_id: contaPorPagamento.get(String(item.id)) ?? null,
      })));
      if (programa?.status === STATUS_APROVADA) await atualizarTransferencias(idProgramacao);
      else setTransferencias([]);
      // Programação que já tem escolha feita abre recolhida; vazia abre com as
      // listas visíveis para a seleção começar. Recarga feita depois de salvar
      // mantém a tela como o usuário deixou -- salvar não recolhe nem reabre.
      if (!manterRecolhimento) {
        setContasConfirmadas((vinculadas ?? []).length > 0);
        setFornecedoresConfirmados((itens ?? []).length > 0);
      }
    } catch (falha) {
      registrarErroFase1("Falha ao abrir programação", falha, { programacaoId: id });
      setErro(mensagemFalhaFase1(falha, "Não foi possível abrir a programação."));
    }
  }

  async function criarProgramacao() {
    if (!secretariaId || !podeEditar) return;
    setSalvando(true);
    setErro("");
    try {
      const { data: auth, error: erroAuth } = await supabase.auth.getUser();
      if (erroAuth) throw erroAuth;
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const secretariaIdInteiro = idInteiro(secretariaId, "Secretaria");
      const { data: criada, error } = await supabase.from("programacoes_pagamento").insert({
        secretaria_id: secretariaIdInteiro,
        data_programacao: data,
        responsavel_id: auth.user.id,
        nome_programacao: nomeAutomatico(data),
      }).select("id, data_programacao").single();
      if (error) throw error;
      setData(criada.data_programacao);
      setProgramacaoId(criada.id);
      await carregarProgramacoes(criada.id);
      setMensagem("Programação criada em elaboração.");
    } catch (falha) {
      registrarErroFase1("Falha ao criar programação", falha, { secretariaId, dataProgramacao: data });
      setErro(mensagemFalhaFase1(falha, "Não foi possível criar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  async function verificarDestinoDuplicacao(dataDestino) {
    if (!programacao || !dataDestino || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      const { count, error } = await supabase.from("programacoes_pagamento")
        .select("id", { count: "exact", head: true })
        .eq("secretaria_id", idInteiro(secretariaId, "Secretaria"))
        .eq("data_programacao", dataDestino)
        .is("excluido_em", null);
      if (error) throw error;
      if ((count ?? 0) > 0) {
        setDuplicacao({ conflito: count });
        return;
      }
      await confirmarDuplicacao(dataDestino);
    } catch (falha) {
      registrarErroFase1("Falha ao conferir data da duplicação", falha, { programacaoId: programacao.id, dataDestino });
      setErro(mensagemFalhaFase1(falha, "Não foi possível conferir a data de destino."));
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarDuplicacao(dataDestino) {
    if (!programacao || !dataDestino) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const origemId = idInteiro(programacao.id, "Programação");
      const { data: novaId, error } = await supabase.rpc("duplicar_programacao_diaria", {
        p_programacao_origem_id: origemId,
        p_data_destino: dataDestino,
      });
      if (error) throw error;
      setDuplicacao(null);
      setData(dataDestino);
      setProgramacaoId(novaId);
      setMensagem("Programação duplicada em montagem. Escolha as contas de trabalho e ajuste a Proposta antes de salvar.");
    } catch (falha) {
      registrarErroFase1("Falha ao duplicar programação", falha, { programacaoId: programacao.id, dataDestino });
      setErro(mensagemFalhaFase1(falha, "Não foi possível duplicar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  async function abrirExclusao(item) {
    setErro("");
    try {
      const verificacao = await verificarExclusaoProgramacao(item.id);
      setExclusaoProgramacao({ programacao: item, temPagamentoPago: verificacao.tem_pagamento_pago === true });
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível conferir esta programação."));
    }
  }

  async function concluirExclusao(motivo) {
    await excluirProgramacao(exclusaoProgramacao.programacao.id, motivo);
    const idExcluido = exclusaoProgramacao.programacao.id;
    setExclusaoProgramacao(null);
    if (String(programacaoId) === String(idExcluido)) limparEdicao();
    await carregarProgramacoes();
    setMensagem("Programação excluída e enviada à Lixeira. Nenhum saldo de conta foi alterado.");
  }

  async function concluirCancelamento(motivo) {
    if (String(motivo ?? "").trim().length < 5) throw new Error("Informe o motivo do cancelamento (mínimo 5 caracteres).");
    await cancelarProgramacao(exclusaoProgramacao.programacao.id, motivo);
    setExclusaoProgramacao(null);
    await carregarProgramacao(programacaoId, { manterRecolhimento: true });
    await carregarProgramacoes(programacaoId);
    setMensagem("Programação cancelada. As marcações foram preservadas e nenhum saldo de conta foi alterado.");
  }

  // Confirmar/reabrir um bloco é só apresentação: não grava, não movimenta
  // saldo e não recalcula nada -- os totalizadores do topo continuam saindo das
  // mesmas contas selecionadas e dos mesmos valores propostos.
  function confirmarContas() {
    setContasConfirmadas(true);
  }

  function alterarContas() {
    setContasConfirmadas(false);
  }

  function confirmarFornecedores() {
    setFornecedoresConfirmados(true);
  }

  function alterarFornecedores() {
    setFornecedoresConfirmados(false);
  }

  function alternarConta(contaId) {
    if (!programacao || !podeEditarProgramacao) return;
    setContasSelecionadas((atual) => alternarSelecao(atual, contaId));
  }

  function selecionarTodas() {
    if (!programacao || !podeEditarProgramacao) return;
    const idsVisiveis = contasFiltradas.map((conta) => conta.id);
    setContasSelecionadas((atual) => selecionarTodosVisiveis(atual, idsVisiveis));
  }

  function alternarFornecedor(fornecedor) {
    if (!programacao || !podeEditar) return;
    const existente = pagamentos.find((item) => String(item.fornecedor_id) === String(fornecedor.id));
    if (existente) {
      setPagamentos((itens) => itens.filter((item) => item !== existente));
      return;
    }
    setPagamentos((itens) => [...itens, {
      id: null,
      fornecedor_id: fornecedor.id,
      // O item guarda o cadastro só para MOSTRAR o nome; o vínculo é o id acima.
      fornecedores: { razao_social: fornecedor.razao_social, apelido: fornecedor.apelido ?? null },
      nome_exibicao_programacao: null,
      valor_a_pagar: numero(fornecedor.valor_em_aberto),
      nome_avulso: null,
      cadastrar_fornecedor_posteriormente: false,
    }]);
  }

  /**
   * Identifica o item na tela: pelo id quando já gravado, senão pelo que o item
   * É (fornecedor vinculado ou nome do avulso). NÃO é a posição: a lista está em
   * ordem alfabética e reordena quando um fornecedor entra, e chave de posição
   * faria a linha ser remontada -- fechando a renomeação aberta e tirando o foco
   * do valor sendo digitado. A posição fica só como último recurso.
   */
  function chaveDoPagamento(pagamento, indice) {
    return chavesPagamentos.get(pagamento) ?? (vazio(pagamento.id) ? `pos:${indice}` : `id:${pagamento.id}`);
  }

  function abrirNomeExibicao(pagamento, indice) {
    if (!podeRenomearExibicao) return;
    setErro("");
    setNomeExibicaoEditando({
      chave: chaveDoPagamento(pagamento, indice),
      texto: pagamento.nome_exibicao_programacao ?? "",
    });
  }

  /**
   * Salva o nome mostrado deste item, sem sair da tela.
   *
   * Muda SÓ o rótulo do item da programação. Razão social, nome fantasia,
   * CNPJ/CPF, apelido cadastrado, dados para pagamento, NFs, processos e
   * histórico do fornecedor continuam como estão, e o item segue vinculado ao MESMO
   * fornecedor_id -- que o banco devolve na resposta, como prova.
   */
  async function salvarNomeExibicao(pagamento, indice) {
    if (!nomeExibicaoEditando) return;
    const nome = normalizarNomeExibicao(nomeExibicaoEditando.texto);

    // Item ainda não gravado: o nome fica na tela e vai junto no "Salvar
    // programação", que é quando o item passa a existir no banco.
    if (vazio(pagamento.id)) {
      setPagamentos((itens) => itens.map((item) => (item === pagamento ? { ...item, nome_exibicao_programacao: nome } : item)));
      setNomeExibicaoEditando(null);
      return;
    }

    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const resposta = await definirNomeExibicaoDoPagamento({
        pagamentoId: idInteiro(pagamento.id, "Pagamento"),
        nome,
      });
      setPagamentos((itens) => itens.map((item) => (item === pagamento
        ? { ...item, nome_exibicao_programacao: resposta?.nome_exibicao_programacao ?? nome }
        : item)));
      setNomeExibicaoEditando(null);
      setMensagem(nome
        ? "Nome de exibição salvo nesta programação. O cadastro do fornecedor não foi alterado."
        : "Nome de exibição removido: o item volta a mostrar o nome do cadastro.");
    } catch (falha) {
      if (estruturaDeApelidoAusente(falha)) {
        setErro(`O nome de exibição por programação ainda não existe neste banco. Execute ${MIGRATION_APELIDO} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página.`);
      } else {
        setErro(mensagemFalhaFase1(falha, "Não foi possível salvar o nome de exibição deste fornecedor.", "nome_exibicao"));
      }
    } finally {
      setSalvando(false);
    }
  }

  function editarValor(chave, valor) {
    setPagamentos((itens) => definirValorProgramado(itens, chave, valor));
  }

  function adicionarAvulso() {
    if (!avulso.nome.trim() || numero(avulso.valor) <= 0) {
      setErro("Informe o nome e um valor maior que zero para o fornecedor avulso.");
      return;
    }
    // O avulso entra na MESMA ordem alfabética, pelo nome digitado nele -- pode
    // cair no meio da lista, então a tela leva a pessoa até a linha nova.
    const novo = {
      id: null,
      fornecedor_id: null,
      fornecedores: null,
      nome_avulso: avulso.nome.trim(),
      valor_a_pagar: numero(avulso.valor),
      cadastrar_fornecedor_posteriormente: avulso.cadastrarDepois,
    };
    setPagamentos((itens) => [...itens, novo]);
    setItemAdicionado(novo);
    setAvulso({ nome: "", valor: 0, cadastrarDepois: false });
    setMostrarAvulso(false);
    setErro("");
  }

  async function salvarProgramacao() {
    if (!programacao || !podeEditarProgramacao) return false;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const { data: auth, error: erroAuth } = await supabase.auth.getUser();
      if (erroAuth) throw erroAuth;
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const selecionadas = contasDaProgramacao.filter((conta) => contasSelecionadas.has(conta.id));
      // O saldo considerado de cada conta: o saldo atual enquanto a programação
      // está sendo montada hoje, e o MESMO valor já gravado quando ela é
      // documento -- salvar uma programação antiga não troca os saldos dela
      // pelos de hoje. Conta acrescentada agora, que ainda não tem registro,
      // grava o saldo considerado no momento em que entrou.
      const payloadContas = selecionadas.map((conta, indice) => ({
        conta_id: idInteiro(conta.id, "Conta"),
        saldo_considerado: numero(saldoParaGravar({ conta, modoCongelado: modoSaldoCongelado })),
        ordem: indice + 1,
      }));
      // Cabeçalho igual à soma das contas gravadas, sempre.
      const saldoConsideradoDoCabecalho = modoSaldoCongelado
        ? numero(payloadContas.reduce((total, conta) => total + numero(conta.saldo_considerado), 0))
        : totalDisponivel;
      // Fornecedor avulso não tem fornecedor_id: o campo vai NULO e o nome vai
      // em nome_avulso. Campo vazio ou zero é ausência de fornecedor, não id --
      // mandá-lo como id faria o banco recusar o vínculo (23503). O que sai daqui
      // é id inteiro válido ou nulo, nunca "" e nunca 0.
      const payloadPagamentos = pagamentos.map((item) => ({
        id: vazio(item.id) ? null : idInteiro(item.id, "Pagamento"),
        fornecedor_id: vazio(item.fornecedor_id) ? null : idInteiro(item.fornecedor_id, "Fornecedor"),
        nome_avulso: typeof item.nome_avulso === "string" ? item.nome_avulso.trim() || null : null,
        // Nome de exibição do ITEM: rótulo da tela e do papel. Não substitui o
        // fornecedor_id acima nem altera nada do cadastro.
        nome_exibicao_programacao: normalizarNomeExibicao(item.nome_exibicao_programacao),
        valor_a_pagar: numero(item.valor_a_pagar),
        cadastrar_fornecedor_posteriormente: Boolean(item.cadastrar_fornecedor_posteriormente),
        // Origem do item, quando ele veio de uma área de Fornecedores. É
        // informação ADICIONAL: o vínculo do pagamento com o fornecedor
        // continua sendo o fornecedor_id acima, e item sem origem -- o caso
        // normal -- manda os dois campos nulos, como sempre.
        origem_tipo: itemTemOrigem(item) ? item.origem_tipo : null,
        origem_id: itemTemOrigem(item) ? item.origem_id : null,
      }));
      const programacaoIdInteiro = idInteiro(programacao.id, "Programação");
      const argumentos = {
        p_programacao_id: programacaoIdInteiro,
        p_contas: payloadContas,
        p_pagamentos: payloadPagamentos,
        p_saldo_considerado: saldoConsideradoDoCabecalho,
        p_total_programado: totalProgramado,
        p_restante: restante,
      };
      // A tela salva antes de aprovar, então uma recusa aqui aparece como falha
      // de aprovação. Registrar os argumentos exatos separa os dois casos na
      // investigação, sem depender da mensagem exibida.
      if (typeof console !== "undefined") {
        console.info("[Pagamentos Fase 1] rpc salvar_planejamento_programacao", argumentos);
      }
      const { error } = await supabase.rpc("salvar_planejamento_programacao", argumentos);
      if (error) throw error;
      setMensagem("Programação salva com contas, fornecedores e valores preservados.");
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      await carregarProgramacoes(programacao.id);
      return true;
    } catch (falha) {
      registrarErroFase1("Falha ao salvar programação", falha, { programacaoId: programacao?.id });
      setErro(mensagemFalhaFase1(falha, "Não foi possível salvar a programação.", "salvar"));
    } finally {
      setSalvando(false);
    }
    return false;
  }

  async function marcarEmAnalise() {
    if (!programacao || !podeEditarProgramacao) return;
    const salvo = await salvarProgramacao();
    if (!salvo) return;
    const { error } = await supabase.rpc("marcar_programacao_em_analise", { p_programacao_id: idInteiro(programacao.id, "Programação") });
    if (error) {
      registrarErroFase1("Falha ao marcar programação em análise", error, { programacaoId: programacao.id });
      return setErro(mensagemFalhaFase1(error, "Não foi possível marcar como em análise.", "em_analise"));
    }
    setProgramacao((atual) => ({ ...atual, status: "em_analise" }));
    setMensagem("Programação marcada como em análise. Nenhum saldo foi movimentado.");
    await carregarProgramacoes(programacao.id);
  }

  // A conta de cada pagamento é lida em consulta própria e tolerante a falha:
  // se a migration da Fase 2 ainda não rodou, a coluna não existe, a
  // programação abre normalmente sem a informação e o aviso do topo explica o
  // que executar. Sem isto a tela inteira quebraria por causa de uma coluna.
  async function contasDefinidasDosPagamentos(idProgramacao) {
    const { data: itens, error } = await supabase
      .from("pagamentos")
      .select("id, conta_origem_id")
      .eq("programacao_id", idProgramacao)
      .is("excluido_em", null);
    if (error) {
      registrarErroFase2("Falha ao ler a conta definida de cada pagamento", error, { programacaoId: idProgramacao });
      return new Map();
    }
    return new Map((itens ?? []).map((item) => [String(item.id), item.conta_origem_id ?? null]));
  }

  async function atualizarTransferencias(id) {
    try {
      setTransferencias(await carregarTransferenciasDaProgramacao(idInteiro(id, "Programação")));
    } catch (falha) {
      registrarErroFase2("Falha ao carregar as transferências da programação", falha, { programacaoId: id });
      setTransferencias([]);
    }
  }

  // APROVAR NÃO É PAGAR: a aprovação grava a proposta como ela está na tela,
  // troca o status e registra a conferência. Não debita conta, não dá baixa em
  // nota, não altera saldo de fornecedor e não marca nota como paga.
  async function confirmarAprovacao() {
    if (!programacao) return;
    const salvo = await salvarProgramacao();
    if (!salvo) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      await aprovarProgramacao({
        programacaoId: idInteiro(programacao.id, "Programação"),
        saldoConsiderado: totalDisponivel,
        totalProgramado,
        restante,
      });
      setMostrarAprovacao(false);
      setMensagem("Programação aprovada e aguardando execução. Nenhuma conta foi debitada: aprovar não é pagar.");
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      await carregarProgramacoes(programacao.id);
    } catch (falha) {
      registrarErroFase2("Falha ao aprovar programação", falha, { programacaoId: programacao.id });
      setErro(mensagemFalhaFase2(falha, "Não foi possível aprovar a programação.", "aprovar"));
    } finally {
      setSalvando(false);
    }
  }

  // REABRIR NÃO DESFAZ DADOS: devolve o status para "em elaboração" e limpa os
  // campos da aprovação. Contas, fornecedores, valores, conta de cada pagamento,
  // saldos congelados, baixas, transferências e saldos reais das contas
  // continuam exatamente como estão -- e a aprovação anterior segue registrada
  // na Auditoria como fato ocorrido.
  async function abrirReabertura() {
    if (!programacao) return;
    // A contagem alimenta o AVISO do modal. Falha aqui não impede reabrir: os
    // vínculos voltam como desconhecidos e o próprio aviso diz isso.
    setVinculosReabertura(await carregarVinculosDaProgramacao(idInteiro(programacao.id, "Programação")));
    setMostrarReabertura(true);
  }

  async function confirmarReabertura(justificativa) {
    if (!programacao) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const resposta = await reabrirProgramacao({
        programacaoId: idInteiro(programacao.id, "Programação"),
        justificativa,
      });
      setMostrarReabertura(false);
      setMensagem(
        resposta?.ja_em_elaboracao
          ? "Esta programação já estava em elaboração: nada foi alterado."
          : "Programação reaberta e editável outra vez. Nenhum dado foi desfeito: contas, fornecedores, valores, saldos congelados, baixas e transferências continuam como estavam. A justificativa ficou registrada na Auditoria."
      );
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      await carregarProgramacoes(programacao.id);
    } catch (falha) {
      registrarErroFase2("Falha ao reabrir programação", falha, { programacaoId: programacao.id });
      setErro(mensagemFalhaReabertura(falha));
    } finally {
      setSalvando(false);
    }
  }

  // ATRIBUIR CONTA NÃO DEBITA CONTA: o vínculo é o roteiro do pagamento. O
  // mesmo caminho atende um pagamento, os marcados e todos -- e depois de
  // aplicar em lote a troca individual continua possível.
  // Define a conta dos pagamentos e DEVOLVE a resposta para quem clicou, para o
  // painel de execução poder mostrá-la ao lado do botão. Antes o resultado só
  // aparecia no aviso do topo da página -- fora da tela de quem está trabalhando
  // na seção de execução, o que fazia a recusa parecer "o botão não faz nada".
  //
  // DEFINIR CONTA NÃO DEBITA CONTA: aqui só se grava o vínculo. O débito é da
  // baixa, e nada nesta função escreve saldo.
  async function gravarContaDosPagamentos(ids, contaId) {
    if (!programacao) {
      const semProgramacao = "Abra uma programação para definir a conta dos pagamentos.";
      setErro(semProgramacao);
      return { ok: false, mensagem: semProgramacao };
    }
    const alvos = (ids ?? []).filter((id) => id != null).map((id) => idInteiro(id, "Pagamento"));
    if (!alvos.length) {
      const semAlvos = "Salve a programação antes de definir a conta destes pagamentos.";
      setErro(semAlvos);
      return { ok: false, mensagem: semAlvos };
    }
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const conta = contaId ? idInteiro(contaId, "Conta") : null;
      const idProgramacao = idInteiro(programacao.id, "Programação");
      await definirContaDePagamentos({
        programacaoId: idProgramacao,
        pagamentoIds: alvos,
        contaId: conta,
      });
      // Conferência no BANCO, e não só na tela: o que a lista passa a mostrar é
      // o que ficou gravado em pagamentos.conta_origem_id. Assim o contador
      // "com conta definida" nunca afirma uma gravação que não aconteceu, e
      // recarregar a página mostra exatamente o mesmo.
      const gravadas = await contasDefinidasDosPagamentos(idProgramacao);
      if (gravadas.size > 0) {
        setPagamentos((itens) => itens.map((item) => (gravadas.has(String(item.id))
          ? { ...item, conta_origem_id: gravadas.get(String(item.id)) }
          : item)));
      } else {
        setPagamentos((itens) => aplicarContaEmPagamentos(itens, alvos, conta));
      }
      const naoConfirmados = gravadas.size > 0
        ? alvos.filter((id) => String(gravadas.get(String(id)) ?? "") !== String(conta ?? ""))
        : [];
      if (naoConfirmados.length) {
        const parcial = `O banco não confirmou a conta em ${naoConfirmados.length} de ${alvos.length} pagamentos. Recarregue a página e tente de novo. Nenhum saldo foi movimentado.`;
        setErro(parcial);
        return { ok: false, mensagem: parcial };
      }
      // A resposta diz que JÁ ESTÁ GRAVADO, e não só o que aconteceu: esta seção
      // não tem botão de salvar porque cada escolha vai ao banco no clique, e a
      // linha acima acabou de reler do banco o que ficou lá. Sem essa frase, a
      // tela contava a ação e deixava a dúvida "preciso salvar isto?" de pé.
      const feito = conta == null
        ? `Conta retirada de ${alvos.length} ${alvos.length === 1 ? "pagamento" : "pagamentos"}. A retirada já está gravada no banco: não é preciso salvar. Nenhum saldo foi movimentado.`
        : alvos.length === 1
          ? "Conta do pagamento definida e já gravada no banco: não é preciso salvar. Definir conta não debita conta."
          : `Conta definida em ${alvos.length} pagamentos e já gravada no banco: não é preciso salvar. Definir conta não debita conta.`;
      setMensagem(feito);
      return { ok: true, mensagem: feito };
    } catch (falha) {
      registrarErroFase2("Falha ao definir a conta do pagamento", falha, { programacaoId: programacao.id, pagamentos: alvos });
      const recusa = mensagemFalhaFase2(falha, "Não foi possível definir a conta destes pagamentos.", "definir_conta");
      setErro(recusa);
      return { ok: false, mensagem: recusa };
    } finally {
      setSalvando(false);
    }
  }

  async function marcarSituacao(pagamento, situacao) {
    setErro("");
    const argumentos = {
      p_pagamento_id: String(pagamento.id),
      p_situacao: situacao,
    };
    try {
      const { data: resultado, error } = await supabase.rpc("marcar_situacao_programacao", argumentos);
      if (error) throw error;
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      setMensagem("Marcação atualizada. A programação não movimentou saldo de conta.");
      return { ok: true };
    } catch (falha) {
      if (typeof console !== "undefined") {
        console.error("[Pagamentos Diários] Falha ao atualizar marcação", {
          argumentos,
          code: falha?.code,
          message: falha?.message,
          details: falha?.details,
          hint: falha?.hint,
        });
      }
      const texto = mensagemAmigavel(falha, "Não foi possível atualizar a marcação.");
      setErro(texto);
      return { ok: false, mensagem: texto };
    }
  }

  async function definirAdiamento(pagamento, adiar) {
    const { error } = await supabase.from("pagamentos").update({ situacao: adiar ? "suspenso" : "programado" }).eq("id", pagamento.id);
    if (error) return setErro(mensagemAmigavel(error, "Não foi possível atualizar a decisão deste fornecedor."));
    setPagamentos((itens) => itens.map((item) => item.id === pagamento.id ? { ...item, situacao: adiar ? "suspenso" : "programado" } : item));
  }

  async function garantirContasDeTransferencia() {
    const carregadas = await carregarContasParaTransferencia({ secretariaId, secretarias });
    setContasTransferencia(carregadas);
    return carregadas;
  }

  async function abrirTransferencia() {
    setErro("");
    try {
      await garantirContasDeTransferencia();
      setMostrarTransferencia(true);
    } catch (falha) {
      registrarErroFase2("Falha ao carregar as contas para transferência", falha, { secretariaId });
      setErro(mensagemFalhaFase2(falha, "Não foi possível carregar as contas para a transferência."));
    }
  }

  async function abrirEstorno(transferencia) {
    setErro("");
    if (contasTransferencia.length === 0) {
      try {
        await garantirContasDeTransferencia();
      } catch (falha) {
        registrarErroFase2("Falha ao carregar contas para o estorno", falha, { secretariaId });
      }
    }
    setEstornoAlvo(transferencia);
  }

  // Depois de uma transferência confirmada ou estornada o saldo mudou de
  // verdade: as contas são recarregadas da mesma fonte que alimenta a aba
  // Saldos das Contas, então as duas telas mostram o novo saldo na hora.
  async function aposMovimentoDeSaldo(aviso) {
    await carregarBase();
    if (programacao) await atualizarTransferencias(programacao.id);
    setMensagem(aviso);
  }

  // O documento leva só o que foi escolhido: contas selecionadas e fornecedores
  // propostos. Os pagamentos vão em duas colunas -- fornecedor e valor -- e é a
  // mesma carga usada na impressão, no PDF e na planilha.
  function dadosDocumento() {
    return {
      titulo: "PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS",
      secretaria: nomeSecretariaSelecionada,
      data: dataBR(programacao.data_programacao),
      emissao: agoraBR(),
      nome: programacao.nome_programacao,
      responsavel: programacao.responsavel?.nome_completo || usuario?.nome || usuario?.email || "--",
      // Os MESMOS valores da tela, inclusive a ausência: conta sem saldo
      // congelado gravado vai com saldo nulo e o papel imprime "--", nunca o
      // saldo de hoje e nunca zero no lugar do que não foi gravado.
      contas: contasSelecionadasComSaldo.map((conta) => ({ banco: conta.banco, conta: conta.numero_conta, saldo: conta.saldo ?? null, nome: conta.nome_conta })),
      // A MESMA ordem da tela: o papel sai na sequência que a pessoa leu.
      pagamentos: pagamentosOrdenados.map((item) => ({ fornecedor: nomePagamento(item), valor: numero(item.valor_a_pagar) })),
      totalContas: saldoDaProgramacaoIndisponivel ? null : totalDisponivel,
      totalProgramado,
      restante: saldoDaProgramacaoIndisponivel ? null : restante,
    };
  }

  async function registrarImpressao() {
    if (!programacao) return;
    await supabase.from("programacoes_pagamento").update({ ultima_impressao_em: new Date().toISOString() }).eq("id", programacao.id);
  }

  async function imprimir() {
    imprimirProgramacao(dadosDocumento());
    await registrarImpressao();
  }

  async function gerarPdf() {
    await registrarImpressao();
    gerarPdfProgramacao(dadosDocumento());
  }

  function exportarExcel() {
    exportarExcelProgramacao(dadosDocumento());
  }

  // PROGRAMAÇÃO É DOCUMENTO: de data anterior, aprovada ou fechada, ela mostra o
  // saldo CONGELADO -- o que foi considerado quando ela foi montada, gravado em
  // programacao_contas.saldo_considerado. Programação do dia, ainda em
  // elaboração, continua com o saldo atual, porque está sendo montada agora.
  const modoSaldoCongelado = usaSaldoCongelado({ programacao, hoje: hojeISO() });
  const contasDaProgramacao = React.useMemo(
    () => (modoSaldoCongelado
      ? aplicarSaldosCongelados(contas, { saldos: saldosCongelados, semRegistro: semRegistroCongelado })
      : contas),
    [modoSaldoCongelado, contas, saldosCongelados, semRegistroCongelado],
  );
  const contasFiltradas = filtrarContasCadastradas(contasDaProgramacao, buscaConta);
  // Da lista completa, não do que está visível: recolher um grupo ou filtrar
  // pela busca não tira conta nenhuma da seleção nem do saldo.
  const contasSelecionadasComSaldo = contasSelecionadasDaLista(contasDaProgramacao, contasSelecionadas);
  // O Saldo da Programação é sempre a soma do que está exibido: no documento, a
  // soma dos saldos congelados das contas mostradas; na programação do dia, a
  // soma dos saldos atuais das contas marcadas.
  const totalDisponivel = modoSaldoCongelado
    ? somarSaldosCongelados(contasSelecionadasComSaldo)
    : somarContasSelecionadas(contas, contasSelecionadas);
  // Conta sem saldo congelado gravado aparece como "--" e não entra na soma:
  // nada é recalculado e nada é inventado no lugar do valor que falta.
  const contasSemCongelado = modoSaldoCongelado ? contasSemSaldoCongelado(contasSelecionadasComSaldo) : 0;
  const avisoCongelado = modoSaldoCongelado
    ? avisoSaldoCongelado({
      dataFormatada: dataBR(programacao.data_programacao),
      semRegistro: semRegistroCongelado,
      quantidadeSemRegistro: contasSemCongelado,
    })
    : "";
  const totalProgramado = somarPagamentos(pagamentos);
  const totalPago = pagamentos.reduce((total, item) => total + (item.situacao === "pago" ? numero(item.valor_a_pagar) : 0), 0);
  const totalNaoPago = pagamentos.reduce((total, item) => total + (["cancelado", "suspenso"].includes(item.situacao) ? numero(item.valor_a_pagar) : 0), 0);
  // O restante é parte do planejamento e não muda com uma marcação de execução.
  const restante = calcularRestante(totalDisponivel, totalProgramado);
  // "--" onde o saldo daquele dia não foi gravado. A tela não põe o saldo de
  // hoje no lugar do valor que falta, e não estima nada.
  const saldoDaLinha = (conta) => (conta.saldo == null ? TEXTO_SEM_REGISTRO : formatBRL(conta.saldo));
  // Programação antiga sem registro nenhum de saldo congelado: o Saldo da
  // Programação também é desconhecido, então sai "--" em vez de R$ 0,00 -- e o
  // aviso de "acima do saldo" não aparece, porque não há saldo para comparar.
  const saldoDaProgramacaoIndisponivel = modoSaldoCongelado && semRegistroCongelado && contasSelecionadas.size > 0;
  const textoSaldoDaProgramacao = saldoDaProgramacaoIndisponivel ? TEXTO_SEM_REGISTRO : formatBRL(totalDisponivel);
  const textoRestante = saldoDaProgramacaoIndisponivel ? TEXTO_SEM_REGISTRO : formatBRL(restante);
  const acimaDoSaldo = !saldoDaProgramacaoIndisponivel && restante < 0;
  const idsSelecionados = new Set(pagamentos.filter((item) => item.fornecedor_id).map((item) => String(item.fornecedor_id)));
  // A busca considera razão social, nome, nome fantasia, APELIDO e CPF/CNPJ --
  // a mesma regra da tela de Baixas. Digitar "Zé" encontra "Zé Alimentos".
  const fornecedoresFiltrados = filtrarFornecedoresPorTermo(fornecedores, buscaFornecedor);
  const todasVisiveisMarcadas = contasFiltradas.length > 0 && contasFiltradas.every((conta) => contasSelecionadas.has(conta.id));
  const nomeSecretariaSelecionada = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "--";
  const emEtapaDeExecucao = emExecucao(programacao);
  const emRevisao = emRevisaoPosAnalise(programacao);
  const resumoDaAprovacao = resumoAprovacao({ contasSelecionadas: contasSelecionadasComSaldo, pagamentos });
  const impedimentosDaAprovacao = impedimentosParaAprovar({ programacao, contasSelecionadas: contasSelecionadasComSaldo, pagamentos });
  const fase2Indisponivel = estruturaFase2 != null && estruturaFase2.ok === false;
  const nomeDaConta = (id) => [...contas, ...contasTransferencia].find((item) => String(item.id) === String(id))?.nome_conta || `Conta ${id ?? "--"}`;

  /**
   * O nome do item na lista de escolhidos: em destaque o nome mostrado (nome de
   * exibição da programação -> apelido -> razão social), embaixo a razão social
   * quando ela não é a que está em destaque, e ao lado o lápis que renomeia a
   * exibição sem sair da tela.
   *
   * É função, não componente, para o campo de edição não perder o foco a cada
   * tecla digitada.
   */
  function nomeDoItem(pagamento, indice) {
    const chave = chaveDoPagamento(pagamento, indice);

    if (nomeExibicaoEditando?.chave === chave) {
      return (
        <>
        {/* Imprimir com a edição aberta não pode sair sem nome: o papel leva o
            nome que está gravado. */}
        <strong className="hidden text-[var(--color-brand-navy)] print:block">{nomePagamento(pagamento)}</strong>
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          <input
            autoFocus
            value={nomeExibicaoEditando.texto}
            onChange={(evento) => setNomeExibicaoEditando((atual) => ({ ...atual, texto: evento.target.value }))}
            onKeyDown={(evento) => { if (evento.key === "Escape") setNomeExibicaoEditando(null); }}
            maxLength={LIMITE_NOME_EXIBICAO}
            placeholder="Ex.: Zé Alimentos — Merenda"
            aria-label={`Nome mostrado de ${nomePagamento(pagamento)} nesta programação`}
            className="min-w-[12rem] flex-1 rounded-lg border border-black/10 px-2 py-1 text-[13px]"
          />
          <button onClick={() => salvarNomeExibicao(pagamento, indice)} disabled={salvando} className="rounded-lg bg-[var(--color-brand-navy)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-white disabled:opacity-50">Salvar nome</button>
          <button onClick={() => setNomeExibicaoEditando(null)} className="rounded-lg border border-black/15 px-2 py-1 text-[11px] font-semibold text-[var(--color-brand-navy)]">Cancelar</button>
        </div>
        </>
      );
    }

    return (
      <div className="flex items-start gap-1">
        <strong className="min-w-0 flex-1 text-[var(--color-brand-navy)]">
          <NomeFornecedor pagamento={pagamento} classeSecundaria="text-[var(--color-brand-navy)]/60" />
        </strong>
        {podeRenomearExibicao && (
          <button
            onClick={() => abrirNomeExibicao(pagamento, indice)}
            title="Editar o nome mostrado nesta programação"
            aria-label="Editar o nome mostrado nesta programação"
            className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--color-brand-navy)]/35 hover:text-[var(--color-brand-navy)] print:hidden"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
    );
  }

  /**
   * Etiqueta discreta dizendo de onde o item veio, quando ele nasceu de um
   * registro de área. É só informação: o pagamento continua ligado ao
   * fornecedor pelo fornecedor_id, e a busca de nota ou de processo na baixa
   * não usa a origem para nada. Item sem origem -- o caso normal -- não mostra
   * etiqueta nenhuma.
   */
  function etiquetaDeOrigem(pagamento) {
    if (!itemTemOrigem(pagamento)) return null;
    return (
      <small className="ml-1 text-[10px] text-[var(--color-brand-navy)]/45" title="Origem do item. O pagamento continua vinculado ao fornecedor, e a baixa continua sendo por NF/processo.">
        via {rotuloDaOrigem(pagamento.origem_tipo)}
      </small>
    );
  }

  return (
    <Layout titulo="Pagamentos Diários" subtitulo="Planejamento diário para análise da gestão">
      <div className="mx-auto max-w-[1500px] px-4 pb-10 sm:px-6">
        {/* Faixa fina e sempre visível: os três totais de um lado, a impressão do
            outro. É desta tela que sai o papel levado ao gestor, então o botão de
            impressão não pode depender de rolagem. */}
        <div className="sticky top-0 z-30 -mx-4 mb-3 border-b border-[var(--color-brand-navy)]/10 bg-[var(--color-brand-off-white)]/95 px-4 py-2 shadow-[0_6px_18px_rgba(23,53,47,0.07)] backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
            <div className="flex min-w-[18rem] flex-1 flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg bg-white px-3 py-1">
              <div><span className="mr-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Saldo da programação</span><strong className="text-xl font-bold tabular-nums text-[var(--color-brand-navy)]">{textoSaldoDaProgramacao}</strong></div>
              <span className="text-[10px] text-[var(--color-brand-navy)]/55">Saldo restante <strong className={`tabular-nums ${restante < 0 ? "text-[#8A321C]" : "text-[var(--color-brand-navy)]"}`}>{textoRestante}</strong></span>
              <span className="text-[10px] text-[var(--color-brand-navy)]/55">Total programado <strong className="tabular-nums text-[var(--color-brand-navy)]">{formatBRL(totalProgramado)}</strong></span>
              <span className="text-[10px] text-[var(--color-brand-navy)]/50">Pago {formatBRL(totalPago)} · Não pago {formatBRL(totalNaoPago)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 print:hidden">
              <Link to="/pagamentos/pendencias" className="inline-flex items-center rounded-lg border border-[var(--color-brand-navy)]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-brand-navy)]">Pendências</Link>
              {programacao && <>
              <button onClick={imprimir} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-navy)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white hover:bg-[var(--color-brand-navy-strong)]"><Printer size={14}/> Imprimir programação para análise</button>
              <button onClick={gerarPdf} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-brand-navy)]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)]"><FileDown size={14}/> PDF</button>
              <button onClick={exportarExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-brand-navy)]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)]"><FileSpreadsheet size={14}/> Excel</button>
              </>}
            </div>
          </div>
          {acimaDoSaldo && <p className="mx-auto mt-1.5 max-w-[1500px] rounded-md bg-[#8A321C] px-2.5 py-1 text-center text-[11px] font-semibold text-white"><AlertTriangle size={12} className="mr-1 inline"/> PROGRAMAÇÃO ACIMA DO SALDO DISPONÍVEL — diferença de {formatBRL(Math.abs(restante))}</p>}
        </div>

        <div className="mb-3 grid gap-2 rounded-xl border border-[var(--color-brand-navy)]/10 bg-white p-2.5 shadow-sm print:hidden lg:grid-cols-[1fr_12rem_auto] lg:items-end">
          <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/60">Secretaria<select value={secretariaId} onChange={(evento) => setSecretariaId(evento.target.value)} className="mt-0.5 block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal">{secretarias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/60">Data<input type="date" value={data} onChange={(evento) => setData(evento.target.value)} className="mt-0.5 block w-full rounded-lg border border-black/10 px-2 py-1.5 text-[13px] font-normal"/></label>
          <button onClick={criarProgramacao} disabled={!podeEditar || salvando} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brand-navy)] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"><Plus size={15}/> Nova programação</button>
        </div>

        {estrutura && !estrutura.ok && <div className="mb-3 rounded-xl border border-[#8A321C]/25 bg-[#FBE9DF] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">
          <p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline"/> Estrutura da Fase 1 incompleta no banco conectado a esta tela</p>
          <p className="mt-1">Não existe no banco: <strong>{listaLegivel(estrutura.faltando)}</strong>.</p>
          <p className="mt-1">Execute {MIGRATION_FASE_1} e {MIGRATION_REPARO_FASE_1} no mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo de cada objeto está no console (F12).</p>
          {estrutura.naoVerificado.length > 0 && <p className="mt-1 text-[11px]">Sem permissão para conferir: {listaLegivel(estrutura.naoVerificado)} — estes não estão sendo acusados de faltar.</p>}
        </div>}

        {/* A tela funciona antes de a migration da Fase 2 rodar: o aviso diz o
            que falta e só a aprovação, a execução e a transferência ficam
            indisponíveis. Nada do planejamento é afetado. */}
        {estruturaFase2 && !estruturaFase2.ok && <div className="mb-3 rounded-xl border border-[var(--color-brand-gold)]/40 bg-[#FBF3EA] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">
          <p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline"/> Estrutura da execução financeira (Fase 2) incompleta no banco conectado a esta tela</p>
          <p className="mt-1">Não existe no banco: <strong>{listaLegivel(estruturaFase2.faltando)}</strong>.</p>
          <p className="mt-1">Execute {MIGRATION_FASE_2} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página. A revisão, a impressão e o restante do planejamento continuam funcionando; apenas aprovar, executar e transferir ficam indisponíveis.</p>
          {estruturaFase2.naoVerificado.length > 0 && <p className="mt-1 text-[11px]">Sem permissão para conferir: {listaLegivel(estruturaFase2.naoVerificado)} — estes não estão sendo acusados de faltar.</p>}
        </div>}

        {/* Registro de área esperando: a programação da data não existe, está
            aprovada ou está fechada. Nenhuma regra nova é inventada aqui -- o
            caminho continua sendo criar programação, trocar de data ou reabrir. */}
        {avisoPendente && <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[var(--color-brand-gold)]/40 bg-[#FBF3EA] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">
          <p className="min-w-[16rem] flex-1">{avisoPendente}</p>
          <button onClick={cancelarEnvioPendente} className="rounded-lg border border-[#8A321C]/30 px-2 py-1 text-[11px] font-semibold hover:bg-[#8A321C]/5">Cancelar envio</button>
        </div>}

        {/* Só quem veio de uma área vê este aviso: sem as colunas de origem o
            item entra na programação do mesmo jeito, apenas sem guardar de qual
            registro ele nasceu. */}
        {semColunasDeOrigem && (envioAnotado || envioPendente) && <div className="mb-3 rounded-xl border border-[var(--color-brand-gold)]/40 bg-[#FBF3EA] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">{AVISO_MIGRATION_ORIGEM}</div>}

        {(erro || mensagem) && <div className={`mb-3 rounded-xl px-3 py-2 text-[13px] print:hidden ${erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{erro || mensagem}<button onClick={() => { setErro(""); setMensagem(""); }} className="float-right"><X size={15}/></button></div>}

        {carregando ? <p className="py-12 text-center text-[13px] text-[var(--color-brand-navy)]/55">Carregando...</p> : <>
          {programacoes.length > 0 && <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 print:hidden">{programacoes.map((item) => <div key={item.id} className="flex shrink-0 overflow-hidden rounded-full border border-black/10"><button onClick={() => setProgramacaoId(item.id)} className={`px-3 py-1 text-[11px] font-semibold ${String(programacaoId) === String(item.id) ? "bg-[var(--color-brand-navy)] text-white" : "bg-white text-[var(--color-brand-navy)]"}`}>{item.nome_programacao} · {statusLabel(item.status, item.fechado)}</button>{podeExcluir && <button type="button" onClick={() => abrirExclusao(item)} className="border-l border-black/10 bg-white px-2 text-red-600 hover:bg-red-50" aria-label={`Excluir ${item.nome_programacao}`} title="Excluir programação"><Trash2 size={13}/></button>}</div>)}</div>}

          {!programacao ? <div className="rounded-xl border border-dashed border-[var(--color-brand-navy)]/20 bg-white/60 px-4 py-12 text-center"><h2 className="font-serif text-lg text-[var(--color-brand-navy)]">Comece uma programação diária</h2><p className="mt-1 text-[12px] text-[var(--color-brand-navy)]/55">Planejamento apenas: nenhuma conta é debitada ou bloqueada.</p></div> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--color-brand-navy)] px-3 py-2 text-white">
              <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">{programacao.nome_programacao}</h1><p className="text-[10px] uppercase tracking-[0.1em] text-white/55">{statusLabel(programacao.status, programacao.fechado)} · ID {programacao.id} · {dataBR(programacao.data_programacao)}</p></div>
              <div className="flex flex-wrap gap-2 print:hidden"><button type="button" onClick={() => setDuplicacao({ conflito: 0 })} disabled={salvando || !podeEditar} className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/10 disabled:opacity-50"><Copy size={13}/> Duplicar programação</button><button onClick={salvarProgramacao} disabled={salvando || !podeEditarProgramacao} className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-brand-navy)] disabled:opacity-50">{salvando ? "Salvando..." : "Salvar programação"}</button>{podeRevisarProposta(programacao) && <button onClick={() => setMostrarAprovacao(true)} disabled={salvando || !podeEditarProgramacao || fase2Indisponivel || permissoesFase2?.aprovar_programacao === false || impedimentosDaAprovacao.length > 0} title={fase2Indisponivel ? "Execute a migration da Fase 2 para confirmar." : permissoesFase2?.aprovar_programacao === false ? "Você não tem permissão para confirmar programação." : impedimentosDaAprovacao[0] || "Confirmar não movimenta saldo"} className="inline-flex items-center gap-1.5 rounded-lg bg-[#B06A3C] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"><Check size={14}/> CONFIRMAR PROGRAMAÇÃO</button>}{podeReabrirProgramacao(programacao) && permissoesFase2?.reabrir_programacao !== false && <button onClick={abrirReabertura} disabled={salvando} title="Volta à montagem sem desfazer baixas, transferências, marcações nem saldos." className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"><Unlock size={13}/> Reabrir programação</button>}</div>
            </div>

            {podeExcluir && <div className="mb-3 flex justify-end print:hidden"><button type="button" onClick={() => abrirExclusao(programacao)} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={13}/> Excluir programação</button></div>}

            {/* Volta da reunião com o gestor: a MESMA programação é reaberta
                para ajuste. Retirar da programação não é excluir fornecedor --
                sai só desta programação, e cadastro, notas, processos,
                histórico, dados de banco e certidões ficam intactos. */}
            {emRevisao && <div className="mb-3 rounded-xl border border-[var(--color-brand-gold)]/40 bg-[#FBF3EA] px-3 py-2 print:hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8A321C]">Revisão após a análise</p>
              <p className="mt-1 text-[12px] text-[var(--color-brand-navy)]">Acrescentar fornecedor, retirar fornecedor, alterar valor, acrescentar conta e retirar conta nesta mesma programação. Cada mudança recalcula na hora o saldo da programação, o total programado e o restante.</p>
              <p className="mt-1 text-[11px] text-[var(--color-brand-navy)]/70">Retirar da programação não é excluir fornecedor: sai apenas desta programação. O cadastro, as notas, os processos, o histórico, os dados de banco e PIX e as certidões continuam intactos.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={alterarContas} disabled={!podeEditarProgramacao} className="rounded-lg border border-[var(--color-brand-navy)]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)] disabled:opacity-50">REVISAR CONTAS</button>
                <button onClick={alterarFornecedores} disabled={!podeEditarProgramacao} className="rounded-lg border border-[var(--color-brand-navy)]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)] disabled:opacity-50">REVISAR FORNECEDORES</button>
              </div>
            </div>}

            <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
              <section className={`${emEtapaDeExecucao ? "hidden" : ""} overflow-hidden rounded-xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm`}>
                <div className="border-b border-black/5 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]"><span className="text-[#B06A3C]">1.</span> Contas de trabalho</h2>
                    <span className="text-[10px] text-[var(--color-brand-navy)]/45 print:hidden">{contasConfirmadas ? "Confirmadas — seleção não movimenta saldo" : "Selecionar não movimenta saldo"}</span>
                  </div>
                  {/* A programação é documento: reaberta em outro dia, ela mostra
                      o saldo que estava na mesa quando foi montada. Este aviso
                      diz isso em palavras, para ninguém ler os valores como se
                      fossem os saldos de hoje. */}
                  {avisoCongelado && <p className="mt-2 rounded-lg border border-[var(--color-brand-gold)]/40 bg-[#FBF3EA] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--color-brand-navy)]">{avisoCongelado}</p>}
                </div>

                {/* Lista completa: só enquanto a seleção não foi confirmada, e nunca no papel.
                    As contas vêm agrupadas pela Secretaria, com grupo que abre e
                    fecha e busca por número, nome, banco, agência ou secretaria.
                    Marcar conta aqui NÃO debita, não reserva e não altera saldo:
                    é o registro de com quais contas a programação trabalha. Não
                    existe aqui criar conta — só se escolhe conta já cadastrada. */}
                {!contasConfirmadas && <div className="print:hidden">
                  <SeletorContas
                    contas={contasDaProgramacao}
                    modo="multipla"
                    selecionadas={[...contasSelecionadas]}
                    onEscolher={(conta) => alternarConta(conta.id)}
                    busca={buscaConta}
                    onBuscaChange={setBuscaConta}
                    desabilitado={!podeEditarProgramacao}
                    altura="max-h-[430px]"
                    className="rounded-none border-0"
                    vazio="Nenhuma conta cadastrada nesta secretaria."
                    acoes={
                      <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-brand-navy)]"><input type="checkbox" checked={todasVisiveisMarcadas} onChange={selecionarTodas} className="h-3.5 w-3.5 accent-[var(--color-brand-navy)]"/> Selecionar todas</label>
                    }
                  />
                </div>}

                {/* Resumo do que foi escolhido: na tela quando confirmado, na impressão sempre. */}
                <div className={contasConfirmadas ? "" : "hidden print:block"}>
                  <div className="hidden grid-cols-[1.1fr_1fr_1fr_1.2fr] gap-2 border-b border-black/5 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]/45 md:grid print:grid"><span>Banco</span><span>Nº da conta</span><span>Saldo</span><span>Nome da conta</span></div>
                  {contasSelecionadasComSaldo.length === 0 ? <p className="px-3 py-5 text-center text-[13px] text-[var(--color-brand-navy)]/45">Nenhuma conta selecionada.</p> : contasSelecionadasComSaldo.map((conta) => <div key={conta.id} className="grid items-center gap-0.5 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 md:grid-cols-[1.1fr_1fr_1fr_1.2fr] md:gap-2 print:grid-cols-[1.1fr_1fr_1fr_1.2fr]"><span className="truncate">{conta.banco}</span><span className="truncate">{conta.numero_conta || "--"}</span><strong className="tabular-nums">{saldoDaLinha(conta)}</strong><span className="truncate">{conta.nome_conta || "--"}</span></div>)}
                </div>

                {/* Resumo sempre visível, FORA da área com rolagem: a contagem e o
                    SALDO DA PROGRAMAÇÃO, que continua sendo a soma exclusiva das
                    contas selecionadas. Marcar inclui, desmarcar retira; recolher
                    grupo e filtrar pela busca não mexem em nada disto. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[var(--color-brand-navy)] px-3 py-1.5 text-[11px] font-bold tracking-[0.04em] text-white">
                  <span>{rotuloContasSelecionadas(contasSelecionadas.size)} — SALDO DA PROGRAMAÇÃO: {textoSaldoDaProgramacao}</span>
                  <button type="button" onClick={() => setVerSelecionadas((valor) => !valor)} aria-expanded={verSelecionadas} className="inline-flex items-center gap-1 rounded-lg border border-white/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white hover:bg-white/10 print:hidden">
                    {verSelecionadas ? <ChevronUp size={12}/> : <ChevronDown size={12}/>} Ver contas selecionadas
                  </button>
                </div>

                {/* Conferência do que está marcado, sem procurar na lista: as contas
                    vêm da seleção inteira, mesmo as de grupo recolhido ou fora do
                    filtro da busca. É leitura — não desmarca e não altera saldo. */}
                {verSelecionadas && <div className="border-b border-black/5 bg-[var(--color-brand-off-white)]/60 px-3 py-2 print:hidden">
                  {contasSelecionadasComSaldo.length === 0 ? <p className="py-2 text-center text-[12px] text-[var(--color-brand-navy)]/55">Nenhuma conta selecionada até agora.</p> : <ul className="max-h-[180px] space-y-1 overflow-y-auto overscroll-contain">
                    {contasSelecionadasComSaldo.map((conta) => <li key={conta.id} className="grid gap-x-2 gap-y-0.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] leading-tight text-[var(--color-brand-navy)] sm:grid-cols-[1fr_.8fr_1.2fr_1fr_auto] sm:items-center">
                      <span className="truncate">{conta.banco || "--"}</span>
                      <span className="truncate tabular-nums">{conta.numero_conta || "--"}</span>
                      <span className="truncate font-semibold">{conta.nome_conta || "--"}</span>
                      <span className="truncate text-[11px] text-[var(--color-brand-navy)]/55">{conta.secretaria || "--"}</span>
                      <strong className="tabular-nums sm:justify-self-end">{saldoDaLinha(conta)}</strong>
                    </li>)}
                  </ul>}
                </div>}

                <div className="flex justify-end border-t border-black/5 px-3 py-2 print:hidden">{contasConfirmadas ? <button onClick={alterarContas} className="rounded-lg border border-[var(--color-brand-navy)]/25 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)]">ALTERAR CONTAS</button> : <button onClick={confirmarContas} disabled={contasSelecionadas.size === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-navy)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-40"><Check size={13}/> CONFIRMAR CONTAS</button>}</div>
              </section>

              <section className="overflow-hidden rounded-xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm">
                <div className="border-b border-black/5 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]"><span className="text-[#B06A3C]">2.</span> Proposta</h2>
                    <span className="text-[10px] text-[var(--color-brand-navy)]/45 print:hidden">{fornecedoresConfirmados ? "Fornecedores confirmados" : "Ordem alfabética"}</span>
                  </div>
                  {!fornecedoresConfirmados && <div className="relative mt-3 print:hidden"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-navy)]/40"/><input value={buscaFornecedor} onChange={(evento) => setBuscaFornecedor(evento.target.value)} placeholder="Buscar por nome, apelido, razão social ou CNPJ/CPF" className="w-full rounded-lg border border-black/10 py-1.5 pl-8 pr-2 text-[13px]"/></div>}
                </div>

                {/* Lista completa, em ordem alfabética pelo nome exibido -- o
                    mesmo nome que aparece na linha. O valor em aberto continua
                    ao lado de cada fornecedor, só não manda mais na posição. */}
                {!fornecedoresConfirmados && <div className="max-h-[330px] overflow-y-auto print:hidden">{fornecedoresFiltrados.map((fornecedor) => { const marcado = idsSelecionados.has(String(fornecedor.id)); return <label key={fornecedor.id} className={`grid cursor-pointer grid-cols-[1.6rem_1fr_auto] items-center gap-2 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 ${marcado ? "bg-[var(--color-brand-off-white)]" : "hover:bg-[#FAF9F5]"}`}><input type="checkbox" checked={marcado} onChange={() => alternarFornecedor(fornecedor)} className="h-3.5 w-3.5 accent-[var(--color-brand-navy)]"/><span className="min-w-0 font-medium text-[var(--color-brand-navy)]"><NomeFornecedor fornecedor={fornecedor} classeSecundaria="text-[var(--color-brand-navy)]/60"/></span><span className={fornecedor.valor_em_aberto > 0 ? "font-bold tabular-nums text-[#B05D31]" : "text-[var(--color-brand-navy)]/40"}>{formatBRL(fornecedor.valor_em_aberto)}</span></label>; })}</div>}

                {/* Escolhidos, com o valor editável ao lado: na tela quando confirmado, na impressão sempre. */}
                <div className={fornecedoresConfirmados ? "" : "hidden print:block"}>
                  {emEtapaDeExecucao ? <LinhasExecucaoProgramacao pagamentos={pagamentosOrdenados} nomePagamento={nomePagamento} podeMarcar={podeEditar && permissoesFase2?.executar_programacao !== false} salvando={salvando} onMarcar={marcarSituacao}/> : <>{pagamentos.length === 0 ? <p className="px-3 py-5 text-center text-[13px] text-[var(--color-brand-navy)]/45">Nenhum fornecedor escolhido.</p> : pagamentosOrdenados.map((pagamento, indice) => <div key={chaveDoPagamento(pagamento, indice)} data-item-programacao={chaveDoPagamento(pagamento, indice)} className="grid gap-1 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 sm:grid-cols-[1fr_9rem_auto] sm:items-center sm:gap-2"><div className="min-w-0">{nomeDoItem(pagamento, indice)}{pagamento.cadastrar_fornecedor_posteriormente && <small className="text-[10px] text-[#A5542F]">Cadastrar posteriormente</small>}{etiquetaDeOrigem(pagamento)}</div><CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento, valor)} aria-label={`Valor a pagar para ${nomePagamento(pagamento)}`} className="w-full rounded-lg border border-black/10 px-2 py-1 text-right text-[13px] font-bold normal-case tracking-normal text-[var(--color-brand-navy)] print:hidden"/><strong className="hidden text-right tabular-nums print:block">{formatBRL(pagamento.valor_a_pagar)}</strong><button onClick={() => setPagamentos((itens) => itens.filter((item) => item !== pagamento))} className="rounded p-1 text-red-600 hover:bg-red-50 print:hidden" aria-label={`Retirar ${nomePagamento(pagamento)} da programação`}><Trash2 size={14}/></button></div>)}<div className="bg-[var(--color-brand-navy)] px-3 py-1.5 text-[11px] font-bold tracking-[0.04em] text-white">{pagamentos.length} {pagamentos.length === 1 ? "FORNECEDOR ESCOLHIDO" : "FORNECEDORES ESCOLHIDOS"} — TOTAL PROGRAMADO: {formatBRL(totalProgramado)}</div></>}
                </div>

                <div className="border-t border-black/5 p-2.5 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2"><button onClick={() => setMostrarAvulso((valor) => !valor)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#A5542F]"><Plus size={14}/> Adicionar fornecedor avulso</button>{fornecedoresConfirmados ? <button onClick={alterarFornecedores} className="rounded-lg border border-[var(--color-brand-navy)]/25 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)] hover:bg-[var(--color-brand-off-white-hover)]">ALTERAR FORNECEDORES</button> : <button onClick={confirmarFornecedores} disabled={pagamentos.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-navy)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-40"><Check size={13}/> CONFIRMAR FORNECEDORES</button>}</div>
                  {mostrarAvulso && <div className="mt-2 grid min-w-0 gap-2 rounded-lg bg-[#FBF3EA] p-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start"><input value={avulso.nome} onChange={(evento) => setAvulso({ ...avulso, nome: evento.target.value })} placeholder="Nome" className="min-w-0 w-full rounded-lg border border-black/10 px-2 py-1.5 text-[13px]"/><CampoMoeda valor={avulso.valor} onValorChange={(valor) => setAvulso({ ...avulso, valor })} aria-label="Valor do fornecedor avulso" className="w-full max-w-full rounded-lg border border-black/10 px-2 py-1.5 text-right text-[13px]"/><button onClick={adicionarAvulso} className="w-full rounded-lg bg-[#A5542F] px-3 py-1.5 text-[13px] font-semibold text-white sm:w-auto">Adicionar</button><label className="flex items-center gap-2 text-[11px] text-[var(--color-brand-navy)]/65 sm:col-span-3"><input type="checkbox" checked={avulso.cadastrarDepois} onChange={(evento) => setAvulso({ ...avulso, cadastrarDepois: evento.target.checked })} className="h-3.5 w-3.5"/> Cadastrar posteriormente como fornecedor</label></div>}
                </div>
              </section>
            </div>

            {/* Bloco 3 é o detalhamento de quem já está escolhido enquanto a lista
                está aberta. Depois de confirmar, o valor editável passa a ficar no
                próprio bloco 2 e este sai da tela para não repetir a mesma lista. */}
            {!fornecedoresConfirmados && <section className="mt-3 overflow-hidden rounded-xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm print:hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/5 px-3 py-2"><h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]"><span className="text-[#B06A3C]">3.</span> Valores</h2><span className="text-[10px] text-[var(--color-brand-navy)]/45">Valor editável, pode ser menor que o aberto</span></div>
              {pagamentos.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-[var(--color-brand-navy)]/45">Selecione fornecedores ou adicione um avulso.</p> : <div>{pagamentosOrdenados.map((pagamento, indice) => <div key={chaveDoPagamento(pagamento, indice)} data-item-programacao={chaveDoPagamento(pagamento, indice)} className="grid gap-1 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 sm:grid-cols-[1fr_9rem_auto] sm:items-center sm:gap-2"><div className="min-w-0">{nomeDoItem(pagamento, indice)}{pagamento.cadastrar_fornecedor_posteriormente && <small className="text-[10px] text-[#A5542F]">Cadastrar posteriormente</small>}{etiquetaDeOrigem(pagamento)}</div><CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento, valor)} aria-label={`Valor a programar para ${nomePagamento(pagamento)}`} className="w-full rounded-lg border border-black/10 px-2 py-1 text-right text-[13px] font-bold normal-case tracking-normal text-[var(--color-brand-navy)]"/><button onClick={() => setPagamentos((itens) => itens.filter((item) => item !== pagamento))} className="rounded p-1 text-red-600 hover:bg-red-50" aria-label={`Retirar ${nomePagamento(pagamento)} da programação`}><Trash2 size={14}/></button></div>)}</div>}
            </section>}

            {/* Etapa de execução: a conta é definida POR PAGAMENTO. Nenhuma
                operação daqui movimenta saldo, exceto a transferência entre
                contas confirmada. */}
          </>}
        </>}
        {mostrarAprovacao && programacao && <ModalAprovacaoProgramacao
          resumo={resumoDaAprovacao}
          programacao={programacao}
          salvando={salvando}
          onFechar={() => setMostrarAprovacao(false)}
          onConfirmar={confirmarAprovacao}
        />}

        {exclusaoProgramacao && <ModalConfirmarExclusao
          titulo={exclusaoProgramacao.temPagamentoPago ? "Cancelar programação" : "Excluir programação"}
          registro={exclusaoProgramacao.programacao.nome_programacao || `a programação ${exclusaoProgramacao.programacao.id}`}
          detalhes={[
            { rotulo: "Data", valor: exclusaoProgramacao.programacao.data_programacao ? dataBR(exclusaoProgramacao.programacao.data_programacao) : dataBR(data) },
            { rotulo: "Situação", valor: statusLabel(exclusaoProgramacao.programacao.status, exclusaoProgramacao.programacao.fechado) },
          ]}
          aviso="A programação irá para a Lixeira. Nenhum saldo de conta será alterado."
          exigirMotivo
          bloqueio={exclusaoProgramacao.temPagamentoPago ? {
            texto: "Esta programação tem pagamento marcado como pago e não pode ser excluída. O pagamento e o saldo real serão preservados.",
            acao: { rotulo: "Cancelar programação", descricao: "Informe o motivo acima. O cancelamento preserva o histórico das marcações.", onAcionar: concluirCancelamento },
          } : null}
          onCancelar={() => setExclusaoProgramacao(null)}
          onConfirmar={concluirExclusao}
        />}

        {/* A transferência é a ÚNICA operação desta tela que move dinheiro, e
            por isso ela trabalha com o saldo de HOJE das contas, mesmo quando a
            programação aberta é um documento de data anterior. O aviso abaixo
            diz isso na própria janela, para o número dela não ser lido como o
            saldo congelado que o resto da programação exibe. */}
        {mostrarReabertura && programacao && <ModalReaberturaProgramacao
          programacao={programacao}
          vinculos={vinculosReabertura}
          salvando={salvando}
          onFechar={() => setMostrarReabertura(false)}
          onConfirmar={confirmarReabertura}
        />}

        {duplicacao && programacao && <ModalDuplicarProgramacao
          programacao={programacao}
          conflito={duplicacao.conflito}
          salvando={salvando}
          onFechar={() => setDuplicacao(null)}
          onMudarData={() => setDuplicacao((atual) => atual?.conflito ? { conflito: 0 } : atual)}
          onVerificar={verificarDestinoDuplicacao}
          onConfirmar={confirmarDuplicacao}
        />}

      </div>
    </Layout>
  );
}
