import React from "react";
import { Plus, X, Save, ChevronDown, ChevronUp, Trash2, Printer, FileText, FileSpreadsheet, Filter, Eraser, Star, ArrowUpDown, Pencil } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { listarFiltrosFavoritos, salvarFiltroFavorito, excluirFiltroFavorito } from "../lib/filtrosFavoritos";
import { registrarEvento } from "../lib/auditoria";
import Layout from "../components/Layout";
import ModalCertidao from "../components/certidoes/ModalCertidao";
import FiltrosSalvos from "../components/fornecedores/FiltrosSalvos";
import ModalEscopoExportacao from "../components/fornecedores/ModalEscopoExportacao";
import VidaDoFornecedor from "../components/fornecedores/VidaDoFornecedor";
import ModalHistoricoFornecedor from "../components/historico/ModalHistoricoFornecedor";
import { carregarPagamentosPorFornecedor } from "../lib/vidaFornecedor";
import { MODULO as MODULO_CERTIDOES, listarTipos as listarTiposCertidao } from "../lib/certidoes";
import { carregarCertidoesPorFornecedor, detalheDocumental, resumoDocumental } from "../lib/certidoesFornecedor";
import { usePermissaoModulo } from "../lib/permissoes";
import { usePermissoesEspeciais } from "../lib/permissoesEspeciais";
import { resumirDadosPagamentoFornecedores } from "../lib/dadosPagamentoFornecedor";
import { comTratamento, erroAmigavel, mensagemAmigavel } from "../lib/erros";
import CampoMoeda from "../components/CampoMoeda";
import { colunasPorCabecalho, formatBRL, marcarColunasDeMoeda, paraNumeroMoeda } from "../lib/moeda";
import ModalConfirmarExclusao from "../components/comuns/ModalConfirmarExclusao";
import NomeFornecedor from "../components/comuns/NomeFornecedor";
import {
  LIMITE_NOME_EXIBICAO,
  apelidoDoFornecedor,
  estruturaDeApelidoAusente,
  normalizarNomeExibicao,
} from "../lib/nomesFornecedor";
import PainelFiltros from "../components/comuns/PainelFiltros";
import {
  auditarExclusao,
  excluirRegistro,
  filtroVigentes,
  textoDosVinculos,
  vinculosDoFornecedor,
} from "../lib/exclusaoRegistros";

/**
 * Recado de quando a migration do apelido ainda não foi rodada neste banco.
 * O cadastro sem apelido continua funcionando igual; só quem tenta gravar um
 * apelido precisa da coluna nova.
 */
const AVISO_MIGRATION_APELIDO =
  "O campo Apelido ainda não existe neste banco. Rode a migration " +
  "20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql no SQL Editor do Supabase e tente de novo.";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

const SITUACOES = [
  { value: "em_aberto", label: "Em aberto", cor: "#EA9A1E", bg: "#FFF6E5" },
  { value: "programado", label: "Programado", cor: "#2563EB", bg: "#EAF1FF" },
  { value: "parcialmente_pago", label: "Parcialmente pago", cor: "#7C3AED", bg: "#F3EDFF" },
  { value: "pago", label: "Pago", cor: "#16A34A", bg: "#EAFBF0" },
  { value: "suspenso", label: "Suspenso", cor: "#64748B", bg: "#F1F5F9" },
  { value: "cancelado", label: "Cancelado", cor: "#DC2626", bg: "#FEF2F2" },
];

const ALIQUOTAS_PADRAO = [2, 3, 4, 5];

// Cada opção aponta para um campo de data que já existe no cadastro:
// "cadastro" vem do fornecedor; os demais vêm dos lançamentos dele.
const CAMPOS_DATA = [
  { value: "cadastro", label: "Cadastro" },
  { value: "emissao", label: "Emissão" },
  { value: "vencimento", label: "Vencimento" },
  { value: "pagamento", label: "Pagamento" },
  { value: "lancamento", label: "Lançamento" },
];

const FAIXAS_VALOR = [
  { label: "Até R$ 1.000", min: "", max: "1000" },
  { label: "R$ 1.001 a R$ 5.000", min: "1000.01", max: "5000" },
  { label: "R$ 5.001 a R$ 10.000", min: "5000.01", max: "10000" },
  { label: "R$ 10.001 a R$ 50.000", min: "10000.01", max: "50000" },
  { label: "Acima de R$ 50.000", min: "50000.01", max: "" },
];

// Cada opção olha só para dados tributários que já existem: alíquotas fixas do
// fornecedor e retenções lançadas nos valores em aberto dele.
const TRIBUTARIOS = [
  { value: "iss_com", label: "Possui retenção de ISS", oposto: "iss_sem", testa: (p) => p.iss },
  { value: "iss_sem", label: "Sem retenção de ISS", oposto: "iss_com", testa: (p) => !p.iss },
  { value: "ir_com", label: "Possui IRPJ", oposto: "ir_sem", testa: (p) => p.ir },
  { value: "ir_sem", label: "Sem IRPJ", oposto: "ir_com", testa: (p) => !p.ir },
  { value: "retencoes", label: "Possui retenções tributárias", testa: (p) => p.retencoes },
  { value: "pendencia", label: "Pendência tributária", testa: (p) => p.pendencia },
];

const DOCUMENTACOES = [
  { value: "completa", label: "Documentação completa", precisaValidade: false },
  { value: "incompleta", label: "Documentação incompleta", precisaValidade: false },
  { value: "vencido", label: "Documento vencido", precisaValidade: true },
  { value: "proximo", label: "Documento próximo do vencimento", precisaValidade: true },
];

// Campos do cadastro do fornecedor considerados na conferência de documentação.
const CAMPOS_CADASTRO = ["razao_social", "cpf_cnpj", "secretaria_id", "telefone", "email", "descricao"];

// Nomes aceitos dentro de dados_bancarios; o cadastro pode gravar a chave de formas diferentes.
const CHAVES_BANCARIAS = {
  banco: ["banco", "instituicao"],
  agencia: ["agencia"],
  conta: ["conta"],
};

const DIAS_PROXIMO_VENCIMENTO = 30;

// Ordenação dos resultados da listagem. Não muda nenhum filtro: só a sequência
// em que os fornecedores encontrados aparecem (e saem nas exportações).
const ORDENACOES = [
  { value: "nome_az", label: "Nome (A-Z)" },
  { value: "nome_za", label: "Nome (Z-A)" },
  { value: "valor_menor", label: "Menor valor" },
  { value: "valor_maior", label: "Maior valor" },
  { value: "recente", label: "Mais recente" },
  { value: "antigo", label: "Mais antigo" },
  { value: "vencimento", label: "Data de vencimento" },
  { value: "situacao", label: "Situação" },
];
const ORDENACAO_PADRAO = "nome_az";

// Filtros e ordenação continuam valendo ao sair da listagem e voltar; some ao
// fechar a aba, por isso sessionStorage e não banco.
const CHAVE_SESSAO = "sfi-fornecedores-filtros";

const FILTROS_VAZIOS = {
  nome: "",
  dataInicial: "",
  dataFinal: "",
  campoData: "vencimento",
  valorMin: "",
  valorMax: "",
  documento: "",
  situacao: "",
  secretariasIds: [],
  tipo: "",
  tributarios: [],
  banco: "",
  agencia: "",
  conta: "",
  documentacao: "",
};

function normalizarTexto(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function somenteDigitos(v) {
  return String(v ?? "").replace(/\D/g, "");
}
function soData(v) {
  return v ? String(v).slice(0, 10) : "";
}
function dentroDoPeriodo(valor, inicio, fim) {
  const data = soData(valor);
  if (!data) return false;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;
  return true;
}
function paraNumero(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}
// Campo de valor (filtros de faixa): em branco continua significando "sem
// limite" (null); o resto é lido pelo utilitário único de moeda, então tanto o
// texto com máscara ("R$ 1.234,56") quanto o valor colado de uma planilha
// ("1234.56") chegam ao filtro como o mesmo número.
function paraValorMonetario(v) {
  const texto = String(v ?? "");
  if (!/\d/.test(texto)) return null;
  return paraNumeroMoeda(texto);
}
function filtroPreenchido(f) {
  return (
    f.nome.trim() !== "" ||
    f.dataInicial !== "" ||
    f.dataFinal !== "" ||
    f.valorMin !== "" ||
    f.valorMax !== "" ||
    f.documento.trim() !== "" ||
    f.situacao !== "" ||
    f.secretariasIds.length > 0 ||
    f.tipo !== "" ||
    f.tributarios.length > 0 ||
    f.banco.trim() !== "" ||
    f.agencia.trim() !== "" ||
    f.conta.trim() !== "" ||
    f.documentacao !== ""
  );
}

function formatarData(iso) {
  const data = soData(iso);
  return data ? new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR") : "";
}

// Filtros vindos da sessão ou de um filtro salvo podem estar incompletos ou com
// tipos trocados; aqui eles voltam ao formato que a tela espera.
function normalizarFiltros(bruto) {
  const origem = bruto && typeof bruto === "object" ? bruto : {};
  const limpos = { ...FILTROS_VAZIOS };
  Object.keys(FILTROS_VAZIOS).forEach((chave) => {
    const valor = origem[chave];
    if (Array.isArray(FILTROS_VAZIOS[chave])) {
      limpos[chave] = Array.isArray(valor) ? valor.map(String) : [];
    } else if (typeof valor === "string") {
      limpos[chave] = valor;
    }
  });
  limpos.tributarios = limpos.tributarios.filter((t) => TRIBUTARIOS.some((opcao) => opcao.value === t));
  if (!CAMPOS_DATA.some((c) => c.value === limpos.campoData)) limpos.campoData = FILTROS_VAZIOS.campoData;
  if (!DOCUMENTACOES.some((d) => d.value === limpos.documentacao)) limpos.documentacao = "";
  return limpos;
}
function ordenacaoValida(valor) {
  return ORDENACOES.some((o) => o.value === valor) ? valor : ORDENACAO_PADRAO;
}

function lerEstadoSalvo() {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_SESSAO);
    const salvo = bruto ? JSON.parse(bruto) : null;
    return salvo && typeof salvo === "object" ? salvo : null;
  } catch {
    return null;
  }
}
function gravarEstadoSalvo(estado) {
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(estado));
  } catch {
    // Sessão sem armazenamento disponível: a tela segue funcionando sem lembrar os filtros.
  }
}

function nomeDoFornecedor(f) {
  return String(f.razao_social || f.nome_fantasia || "");
}
// Vencimento mais próximo entre os lançamentos que ainda estão por resolver.
function vencimentoDeReferencia(f) {
  return f.valores
    .filter((v) => v.situacao !== "pago" && v.situacao !== "cancelado")
    .map((v) => soData(v.data_vencimento))
    .filter(Boolean)
    .sort()[0] ?? "";
}
// Situação mais adiantada na lista de SITUACOES entre os lançamentos do fornecedor.
function situacaoDeReferencia(f) {
  const indices = f.valores
    .map((v) => SITUACOES.findIndex((s) => s.value === v.situacao))
    .filter((i) => i >= 0);
  return indices.length > 0 ? Math.min(...indices) : SITUACOES.length;
}
// Mesma leitura, pronta para o rótulo da listagem recolhida (null = sem lançamentos).
function situacaoResumo(f) {
  const indice = situacaoDeReferencia(f);
  return indice < SITUACOES.length ? SITUACOES[indice] : null;
}
function compararFornecedores(a, b, ordenacao) {
  const porNome = () => nomeDoFornecedor(a).localeCompare(nomeDoFornecedor(b), "pt-BR", { sensitivity: "base" });
  const porCadastro = () => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

  if (ordenacao === "nome_za") return -porNome();
  if (ordenacao === "valor_menor") return (a.totalAberto ?? 0) - (b.totalAberto ?? 0) || porNome();
  if (ordenacao === "valor_maior") return (b.totalAberto ?? 0) - (a.totalAberto ?? 0) || porNome();
  if (ordenacao === "recente") return -porCadastro() || porNome();
  if (ordenacao === "antigo") return porCadastro() || porNome();
  if (ordenacao === "vencimento") {
    const va = vencimentoDeReferencia(a);
    const vb = vencimentoDeReferencia(b);
    // Fornecedor sem vencimento em aberto fica no fim da lista.
    if (!va && !vb) return porNome();
    if (!va) return 1;
    if (!vb) return -1;
    return va.localeCompare(vb) || porNome();
  }
  if (ordenacao === "situacao") return situacaoDeReferencia(a) - situacaoDeReferencia(b) || porNome();
  return porNome();
}
function ordenarFornecedores(lista, ordenacao) {
  return [...lista].sort((a, b) => compararFornecedores(a, b, ordenacao));
}

function chaveSimples(v) {
  return normalizarTexto(v).replace(/[^a-z0-9]/g, "");
}

// Tipo do fornecedor: usa a coluna de tipo do cadastro quando ela existir; sem
// ela, o próprio CPF/CNPJ já registrado diz se é pessoa física ou jurídica.
function tipoDoFornecedor(f, campoTipo) {
  if (campoTipo) return String(f[campoTipo] ?? "").trim();
  const digitos = somenteDigitos(f.cpf_cnpj);
  if (digitos.length === 11) return "Pessoa Física";
  if (digitos.length === 14) return "Pessoa Jurídica";
  return "";
}

function perfilTributario(f) {
  const issFixo = paraNumero(f.aliquota_iss_fixa) > 0;
  const irFixo = paraNumero(f.aliquota_ir_fixa) > 0;
  const iss = issFixo || f.valores.some((v) => (v.desconto_iss ?? 0) > 0);
  const ir = irFixo || f.valores.some((v) => (v.desconto_ir ?? 0) > 0);
  // Pendência: lançamento fora do Simples com alíquota informada e nenhuma retenção aplicada.
  const pendencia = f.valores.some(
    (v) =>
      v.optante_simples === false &&
      ((v.aliquota_iss ?? 0) > 0 || (v.aliquota_ir ?? 0) > 0) &&
      (v.desconto_iss ?? 0) <= 0 &&
      (v.desconto_ir ?? 0) <= 0
  );
  return { iss, ir, retencoes: iss || ir, pendencia };
}

// Texto pesquisável de banco/agência/conta a partir de dados_bancarios do cadastro.
// Aceita tanto o campo gravado como texto quanto como objeto com chaves próprias.
function textoBancario(f, campo) {
  const dados = f.dados_bancarios;
  if (!dados) return "";
  if (typeof dados !== "object") return String(dados);
  if (Object.keys(dados).length === 0) return "";

  const encontrados = [];
  Object.entries(dados).forEach(([chave, valor]) => {
    if (valor === null || valor === undefined || typeof valor === "object") return;
    const nome = chaveSimples(chave);
    if (CHAVES_BANCARIAS[campo].some((esperada) => nome.includes(esperada))) encontrados.push(String(valor));
  });
  // Sem chave reconhecida, procura no conteúdo inteiro para não perder o filtro.
  return encontrados.length > 0 ? encontrados.join(" ") : JSON.stringify(dados);
}

// Dados bancários prontos para exibição na vida do fornecedor. O cadastro pode
// gravar o campo como texto livre ou como objeto: quando a chave não é
// reconhecida, o bloco mostra o conteúdo como texto em vez de JSON cru.
function dadosBancariosExibicao(f) {
  const dados = f.dados_bancarios;
  if (!dados) return { banco: "", agencia: "", conta: "" };
  if (typeof dados !== "object") return { texto: String(dados) };

  const ler = (campo) => {
    const texto = textoBancario(f, campo);
    return texto.trim().startsWith("{") ? "" : texto;
  };
  const banco = ler("banco");
  const agencia = ler("agencia");
  const conta = ler("conta");
  if (banco || agencia || conta) return { banco, agencia, conta };
  const partes = Object.entries(dados)
    .filter(([, valor]) => valor !== null && valor !== undefined && typeof valor !== "object" && String(valor).trim() !== "")
    .map(([chave, valor]) => `${chave}: ${valor}`);
  return partes.length > 0 ? { texto: partes.join(" · ") } : { banco: "", agencia: "", conta: "" };
}

// Datas de validade que existirem no cadastro (inclusive dentro de campos em JSON).
function datasDeValidade(f) {
  const datas = [];
  const varrer = (obj, profundidade) => {
    if (!obj || typeof obj !== "object" || profundidade > 2) return;
    Object.entries(obj).forEach(([chave, valor]) => {
      if (chave === "valores") return; // lançamentos têm vencimento de título, não de documento
      if (valor && typeof valor === "object") return varrer(valor, profundidade + 1);
      if (!/validade|vencimento/.test(normalizarTexto(chave))) return;
      const data = soData(valor);
      if (/^\d{4}-\d{2}-\d{2}$/.test(data)) datas.push(data);
    });
  };
  varrer(f, 0);
  return datas;
}

function camposFaltando(f) {
  const faltando = CAMPOS_CADASTRO.filter((campo) => String(f[campo] ?? "").trim() === "");
  if ("dados_bancarios" in f && !textoBancario(f, "banco")) faltando.push("dados_bancarios");
  return faltando;
}

function combinaDocumentacao(f, escolha) {
  if (escolha === "completa") return camposFaltando(f).length === 0;
  if (escolha === "incompleta") return camposFaltando(f).length > 0;

  const datas = datasDeValidade(f);
  if (datas.length === 0) return false;
  const hoje = hojeISO();
  if (escolha === "vencido") return datas.some((d) => d < hoje);

  const limite = new Date(`${hoje}T00:00:00`);
  limite.setDate(limite.getDate() + DIAS_PROXIMO_VENCIMENTO);
  const limiteISO = limite.toISOString().slice(0, 10);
  return datas.some((d) => d >= hoje && d <= limiteISO);
}

const FORM_VALOR_VAZIO = {
  fornecedor_id: "",
  numero_processo: "",
  numero_empenho: "",
  numero_nota_fiscal: "",
  data_nota_fiscal: hojeISO(),
  parcela: "",
  valor_bruto: "",
  base_calculo: "",
  optante_simples: true,
  aliquota_iss: "",
  aliquota_iss_outra: "",
  aliquota_ir: "",
  aliquota_ir_outra: "",
  data_vencimento: "",
};

export default function Fornecedores() {
  // Estado da sessão anterior desta aba (filtros, ordenação e fornecedor aberto).
  const salvoNaSessao = React.useMemo(lerEstadoSalvo, []);

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [dadosPagamentoPorFornecedor, setDadosPagamentoPorFornecedor] = React.useState({});
  const { valores: permissoesEspeciais } = usePermissoesEspeciais();
  const [expandido, setExpandido] = React.useState(salvoNaSessao?.expandido ?? null);
  // Fornecedor com o histórico aberto no modal (null quando nenhum está aberto).
  const [historicoDe, setHistoricoDe] = React.useState(null);

  const [mostrarForm, setMostrarForm] = React.useState(false);
  const [mostrarFormValor, setMostrarFormValor] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const [form, setForm] = React.useState({
    razao_social: "",
    nome_fantasia: "",
    apelido: "",
    cpf_cnpj: "",
    secretaria_id: "",
    descricao: "",
    telefone: "",
    email: "",
  });

  // Apelido de fornecedor já cadastrado: o cadastro não tem tela de edição, então
  // o apelido é ajustado no lápis ao lado do nome, aqui mesmo na listagem. Grava
  // SÓ a coluna `apelido` -- razão social, nome fantasia, CPF/CNPJ, dados
  // bancários, NFs, processos e histórico ficam intactos.
  const [apelidoEditando, setApelidoEditando] = React.useState(null);
  const [salvandoApelido, setSalvandoApelido] = React.useState(false);

  const [formValor, setFormValor] = React.useState(FORM_VALOR_VAZIO);
  const [fixarIss, setFixarIss] = React.useState(false);
  const [fixarIr, setFixarIr] = React.useState(false);

  // Filtros avançados: a busca rápida vale na hora; os demais só ao clicar em "Aplicar Filtros".
  const [buscaRapida, setBuscaRapida] = React.useState(salvoNaSessao?.buscaRapida ?? "");
  const [filtros, setFiltros] = React.useState(() => normalizarFiltros(salvoNaSessao?.filtros));
  const [filtrosAplicados, setFiltrosAplicados] = React.useState(() => normalizarFiltros(salvoNaSessao?.filtrosAplicados));
  const [ordenacao, setOrdenacao] = React.useState(() => ordenacaoValida(salvoNaSessao?.ordenacao));
  // Abrir ou fechar o painel de filtros é assunto do próprio PainelFiltros: a
  // tela começa sempre com ele recolhido e não guarda esse estado na sessão.

  // Filtros favoritos do usuário logado.
  const [favoritos, setFavoritos] = React.useState([]);
  const [carregandoFavoritos, setCarregandoFavoritos] = React.useState(true);
  const [erroFavoritos, setErroFavoritos] = React.useState(null);
  const [nomeNovoFiltro, setNomeNovoFiltro] = React.useState(null); // null = campo de nome fechado
  const [salvandoFiltro, setSalvandoFiltro] = React.useState(false);

  // Exportações: com filtros ativos, o escopo é perguntado antes de gerar o arquivo.
  const [exportacaoPendente, setExportacaoPendente] = React.useState(null);
  const [imprimindoTodos, setImprimindoTodos] = React.useState(false);

  // Datas de pagamento (data da programação em que o valor foi pago), por valor em aberto.
  const [datasPagamento, setDatasPagamento] = React.useState({});

  // Pagamentos já efetivados, por fornecedor: base do bloco "Pagamentos
  // realizados" e do total já pago da vida do fornecedor.
  const [pagamentosPorFornecedor, setPagamentosPorFornecedor] = React.useState({});
  const [carregandoPagamentos, setCarregandoPagamentos] = React.useState(true);
  const [erroPagamentos, setErroPagamentos] = React.useState(null);

  // Exclusão: nada é excluído no clique. O modal padrão confirma, pede o motivo
  // (fornecedor é registro sensível) e, quando há pagamentos ou certidões
  // ligados, bloqueia a exclusão e oferece a inativação no lugar.
  const [exclusaoPendente, setExclusaoPendente] = React.useState(null);
  const { usuario: usuarioLogado, permissao: permissaoFornecedores } =
    usePermissaoModulo("fornecedores");
  const podeExcluirFornecedor = permissaoFornecedores?.pode_excluir === true;
  // Apelido é dado de identificação: quem pode editar o fornecedor pode ajustá-lo.
  const podeEditarFornecedor = permissaoFornecedores?.pode_editar === true;

  // Documentação: as certidões vêm da mesma tabela do módulo de Certidões e só
  // são pedidas para quem enxerga o módulo (pode_visualizar em 'certidoes').
  const { usuario: usuarioCertidoes, permissao: permissaoCertidoes } =
    usePermissaoModulo(MODULO_CERTIDOES);
  const podeVerCertidoes = permissaoCertidoes?.pode_visualizar === true;
  const podeCadastrarCertidao = permissaoCertidoes?.pode_cadastrar === true;

  const [certidoesPorFornecedor, setCertidoesPorFornecedor] = React.useState({});
  const [tiposCertidao, setTiposCertidao] = React.useState([]);
  const [carregandoCertidoes, setCarregandoCertidoes] = React.useState(true);
  const [erroCertidoes, setErroCertidoes] = React.useState(null);
  // Fornecedor que terá uma certidão cadastrada (null = modal fechado).
  const [novaCertidaoPara, setNovaCertidaoPara] = React.useState(null);

  React.useEffect(() => {
    carregarDados();
    carregarDatasPagamento();
    carregarPagamentosRealizados();
    carregarFavoritos();
  }, []);

  // Consulta isolada: se falhar, só a documentação fica sem base; o restante da
  // tela de fornecedores continua igual.
  React.useEffect(() => {
    if (!podeVerCertidoes) return undefined;
    let ativo = true;

    (async () => {
      setCarregandoCertidoes(true);
      setErroCertidoes(null);
      try {
        const [porFornecedor, tipos] = await Promise.all([
          carregarCertidoesPorFornecedor(),
          listarTiposCertidao(),
        ]);
        if (!ativo) return;
        setCertidoesPorFornecedor(porFornecedor);
        setTiposCertidao(tipos);
      } catch (e) {
        if (!ativo) return;
        setCertidoesPorFornecedor({});
        setErroCertidoes(mensagemAmigavel(e, "Não foi possível carregar as certidões deste fornecedor."));
      } finally {
        if (ativo) setCarregandoCertidoes(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [podeVerCertidoes]);

  /** Certidão criada pela vida do fornecedor: entra na lista já carregada. */
  function aoSalvarCertidao(salva) {
    setCertidoesPorFornecedor((atual) => {
      const chave = String(salva.fornecedor_id);
      const lista = [...(atual[chave] ?? []).filter((c) => c.id !== salva.id), salva].sort((a, b) =>
        soData(a.data_vencimento || "9999-12-31").localeCompare(soData(b.data_vencimento || "9999-12-31"))
      );
      return { ...atual, [chave]: lista };
    });
  }

  React.useEffect(() => {
    gravarEstadoSalvo({ buscaRapida, filtros, filtrosAplicados, ordenacao, expandido });
  }, [buscaRapida, filtros, filtrosAplicados, ordenacao, expandido]);

  // Impressão de "todos os fornecedores": espera a listagem completa aparecer na
  // tela antes de abrir a janela de impressão.
  React.useEffect(() => {
    if (!imprimindoTodos) return;
    const id = window.setTimeout(() => {
      window.print();
      setImprimindoTodos(false);
    }, 60);
    return () => window.clearTimeout(id);
  }, [imprimindoTodos]);

  // Consulta isolada: se a tabela de favoritos falhar, o resto da tela continua igual.
  async function carregarFavoritos() {
    setCarregandoFavoritos(true);
    const { dados, erro: falha } = await comTratamento(
      listarFiltrosFavoritos,
      "Não foi possível carregar seus filtros salvos. Os demais filtros continuam disponíveis."
    );
    setFavoritos(dados ?? []);
    setErroFavoritos(falha);
    setCarregandoFavoritos(false);
  }

  // Consulta isolada: se falhar, só o filtro por data de pagamento fica sem base, sem afetar a tela.
  async function carregarDatasPagamento() {
    try {
      const vigentes = await filtroVigentes("pagamentos");
      const { data, error } = await vigentes(
        supabase
          .from("pagamentos")
          .select("valor_em_aberto_id, programacoes_pagamento(data_programacao)")
          .eq("situacao", "pago"),
      );
      if (error) throw error;

      const porValor = {};
      (data ?? []).forEach((p) => {
        const data_pg = soData(p.programacoes_pagamento?.data_programacao);
        if (!p.valor_em_aberto_id || !data_pg) return;
        (porValor[p.valor_em_aberto_id] ??= []).push(data_pg);
      });
      setDatasPagamento(porValor);
    } catch {
      setDatasPagamento({});
    }
  }

  // Consulta isolada: se falhar, só o bloco de pagamentos realizados da vida do
  // fornecedor fica sem base; o resto da tela continua igual.
  async function carregarPagamentosRealizados() {
    setCarregandoPagamentos(true);
    setErroPagamentos(null);
    try {
      setPagamentosPorFornecedor(await carregarPagamentosPorFornecedor());
    } catch (e) {
      setPagamentosPorFornecedor({});
      setErroPagamentos(
        mensagemAmigavel(e, "Não foi possível carregar os pagamentos realizados deste fornecedor.")
      );
    } finally {
      setCarregandoPagamentos(false);
    }
  }

  async function carregarDados() {
    setCarregando(true);
    setErro(null);
    try {
      const { data: secs, error: e1 } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (e1) throw e1;

      // "*" traz também os campos usados só nos filtros (ex: dados bancários), sem mudar o cadastro.
      // Os fornecedores excluídos (exclusão lógica) ficam de fora da listagem.
      const fornecedoresVigentes = await filtroVigentes("fornecedores");
      const { data: forns, error: e2 } = await fornecedoresVigentes(
        supabase
          .from("fornecedores")
          .select("*, secretarias(nome)")
          .eq("ativo", true)
          .order("razao_social"),
      );
      if (e2) throw e2;

      const { data: valores, error: e3 } = await supabase
        .from("valores_em_aberto")
        .select("*")
        .order("data_vencimento", { ascending: true });
      if (e3) throw e3;

      const comValores = (forns ?? []).map((f) => {
        const valoresDoFornecedor = (valores ?? []).filter((v) => v.fornecedor_id === f.id);
        const totalAberto = valoresDoFornecedor
          .filter((v) => v.situacao !== "pago" && v.situacao !== "cancelado")
          .reduce((acc, v) => acc + (v.valor - (v.valor_pago ?? 0)), 0);
        return { ...f, valores: valoresDoFornecedor, totalAberto };
      });

      setSecretarias(secs ?? []);
      setFornecedores(comValores);
      resumirDadosPagamentoFornecedores(comValores.map((fornecedor) => fornecedor.id))
        .then(setDadosPagamentoPorFornecedor)
        .catch(() => {});
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar dados."));
    } finally {
      setCarregando(false);
    }
  }
  async function criarFornecedor(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (!form.razao_social || !form.cpf_cnpj || !form.secretaria_id) {
        throw erroAmigavel("Preencha razão social, CPF/CNPJ e secretaria.");
      }
      // Apelido é opcional: vazio nem entra no insert, para o cadastro continuar
      // idêntico em banco onde a migration do apelido ainda não rodou.
      const apelido = normalizarNomeExibicao(form.apelido);
      const cadastro = {
        razao_social: form.razao_social,
        nome_fantasia: form.nome_fantasia || null,
        cpf_cnpj: form.cpf_cnpj,
        secretaria_id: form.secretaria_id,
        descricao: form.descricao || null,
        telefone: form.telefone || null,
        email: form.email || null,
      };
      if (apelido) cadastro.apelido = apelido;

      const { error } = await supabase.from("fornecedores").insert(cadastro);
      if (error) {
        if (apelido && estruturaDeApelidoAusente(error)) throw erroAmigavel(AVISO_MIGRATION_APELIDO);
        throw error;
      }

      // Auditoria: cadastro de fornecedor é evento de informação.
      await registrarEvento({
        modulo: "fornecedores",
        acao: "criou",
        registroAfetado: `${form.razao_social} (${form.cpf_cnpj})`,
        valorNovo: {
          razao_social: form.razao_social,
          nome_fantasia: form.nome_fantasia || null,
          apelido,
          cpf_cnpj: form.cpf_cnpj,
          secretaria: secretarias.find((s) => String(s.id) === String(form.secretaria_id))?.nome ?? null,
          telefone: form.telefone || null,
          email: form.email || null,
          descricao: form.descricao || null,
        },
        nivel: "informacao",
      });

      setForm({
        razao_social: "", nome_fantasia: "", apelido: "", cpf_cnpj: "", secretaria_id: "",
        descricao: "", telefone: "", email: "",
      });
      setMostrarForm(false);
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao cadastrar fornecedor."));
    } finally {
      setSalvando(false);
    }
  }

  /** Abre o lápis do apelido já com o apelido atual do fornecedor no campo. */
  function abrirEdicaoApelido(f) {
    setErro(null);
    setApelidoEditando({
      id: f.id,
      oficial: f.razao_social ?? "",
      texto: apelidoDoFornecedor(f),
    });
  }

  /**
   * Grava o apelido do fornecedor -- e SÓ o apelido.
   *
   * O update toca uma única coluna: razão social, nome fantasia, CPF/CNPJ,
   * secretaria, dados bancários, NFs, processos, programações, pagamentos e
   * histórico não são alterados. Campo apagado volta a `null`, e a tela passa a
   * mostrar o nome de sempre.
   */
  async function salvarApelido(e) {
    e.preventDefault();
    if (!apelidoEditando) return;
    setSalvandoApelido(true);
    setErro(null);
    try {
      const apelido = normalizarNomeExibicao(apelidoEditando.texto);
      const { error } = await supabase
        .from("fornecedores")
        .update({ apelido })
        .eq("id", apelidoEditando.id);
      if (error) {
        if (estruturaDeApelidoAusente(error)) throw erroAmigavel(AVISO_MIGRATION_APELIDO);
        throw error;
      }

      await registrarEvento({
        modulo: "fornecedores",
        acao: "editou",
        registroAfetado: `Apelido de ${apelidoEditando.oficial || `fornecedor ${apelidoEditando.id}`}`,
        valorNovo: { apelido },
        nivel: "informacao",
      });

      setApelidoEditando(null);
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao salvar o apelido do fornecedor."));
    } finally {
      setSalvandoApelido(false);
    }
  }

  /** Como o fornecedor é identificado na trilha de auditoria. */
  function rotuloDoFornecedor(fornecedor, nome) {
    const identificacao = String(nome ?? fornecedor?.razao_social ?? "").trim();
    return fornecedor?.cpf_cnpj ? `${identificacao} (${fornecedor.cpf_cnpj})` : identificacao;
  }

  /**
   * Abre a confirmação de exclusão do fornecedor e, em paralelo, confere os
   * vínculos: existindo pagamento ou certidão ligado ao cadastro, a exclusão é
   * bloqueada e o modal passa a oferecer "Inativar fornecedor" no lugar — um
   * pagamento não pode ficar apontando para um cadastro que sumiu.
   */
  function excluirFornecedor(id, nome) {
    const fornecedor = fornecedores.find((f) => String(f.id) === String(id));
    const rotulo = rotuloDoFornecedor(fornecedor, nome);
    setExclusaoPendente({
      tipo: "fornecedor",
      id,
      rotulo,
      registro: `o fornecedor ${nome}`,
      aviso: "Os valores em aberto dele deixarão de aparecer no sistema.",
      exigirMotivo: true,
      verificando: true,
      bloqueio: null,
      detalhes: [
        { rotulo: "CNPJ/CPF", valor: fornecedor?.cpf_cnpj ?? "--" },
        { rotulo: "Secretaria", valor: fornecedor?.secretarias?.nome ?? "--" },
        { rotulo: "Total em aberto", valor: formatBRL(fornecedor?.totalAberto ?? 0) },
      ],
      anterior: { fornecedor: rotulo, situacao: "Ativo no sistema" },
    });

    vinculosDoFornecedor(id).then((vinculos) => {
      const texto = textoDosVinculos(vinculos);
      setExclusaoPendente((atual) => {
        if (!atual || atual.tipo !== "fornecedor" || String(atual.id) !== String(id)) return atual;
        if (!texto) return { ...atual, verificando: false, bloqueio: null };
        return {
          ...atual,
          verificando: false,
          anterior: { ...atual.anterior, vinculos: texto },
          bloqueio: {
            texto: `Este fornecedor tem ${texto} no sistema e por isso não pode ser excluído.`,
            acao: {
              rotulo: "Inativar fornecedor",
              descricao:
                "Inativar tira o fornecedor das listagens e de novos lançamentos, mantendo o cadastro ligado aos registros que já existem.",
              onAcionar: (motivo) => inativarFornecedor(id, rotulo, motivo, texto),
            },
          },
        };
      });
    });
  }

  /** Alternativa à exclusão bloqueada: o cadastro fica inativo, sem exclusão lógica. */
  async function inativarFornecedor(id, rotulo, motivo, vinculos) {
    setErro(null);

    const { error } = await supabase.from("fornecedores").update({ ativo: false }).eq("id", id);
    if (error) throw error;

    await registrarEvento({
      modulo: "fornecedores",
      acao: "alterou",
      registroAfetado: rotulo,
      valorAnterior: { situacao: "Ativo no sistema" },
      valorNovo: {
        situacao: "Inativo (exclusão bloqueada por vínculos)",
        vinculos: vinculos ?? null,
        motivo_exclusao: motivo || "Não informado",
      },
      nivel: "atencao",
      usuarioId: usuarioLogado?.id ?? null,
    });

    setExclusaoPendente(null);
    if (expandido === id) setExpandido(null);
    await carregarDados();
  }

  function aliquotaIssFinal() {
    if (formValor.aliquota_iss === "outra") return parseFloat(formValor.aliquota_iss_outra || "0");
    return parseFloat(formValor.aliquota_iss || "0");
  }
  function aliquotaIrFinal() {
    if (formValor.aliquota_ir === "outra") return parseFloat(formValor.aliquota_ir_outra || "0");
    return parseFloat(formValor.aliquota_ir || "0");
  }

  function calcularISS() {
    const base = paraNumeroMoeda(formValor.base_calculo || formValor.valor_bruto);
    return base * (aliquotaIssFinal() / 100);
  }
  function calcularIR() {
    const base = paraNumeroMoeda(formValor.base_calculo || formValor.valor_bruto);
    return base * (aliquotaIrFinal() / 100);
  }
  function calcularValorLiquido() {
    const bruto = paraNumeroMoeda(formValor.valor_bruto);
    if (formValor.optante_simples) return bruto;
    return bruto - calcularISS() - calcularIR();
  }

  function selecionarFornecedorNoValor(fornecedorId) {
    const fornecedor = fornecedores.find((f) => String(f.id) === String(fornecedorId));
    setFormValor({
      ...formValor,
      fornecedor_id: fornecedorId,
      aliquota_iss: fornecedor?.aliquota_iss_fixa ? String(fornecedor.aliquota_iss_fixa) : "",
      aliquota_ir: fornecedor?.aliquota_ir_fixa ? String(fornecedor.aliquota_ir_fixa) : "",
    });
    setFixarIss(false);
    setFixarIr(false);
  }
  async function criarValor(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (!formValor.fornecedor_id) throw erroAmigavel("Selecione o fornecedor.");
      if (!formValor.valor_bruto) throw erroAmigavel("Informe o valor da nota.");

      const bruto = paraNumeroMoeda(formValor.valor_bruto);
      const base = paraNumeroMoeda(formValor.base_calculo || formValor.valor_bruto);
      const issAliquota = formValor.optante_simples ? 0 : aliquotaIssFinal();
      const irAliquota = formValor.optante_simples ? 0 : aliquotaIrFinal();
      const iss = formValor.optante_simples ? 0 : calcularISS();
      const ir = formValor.optante_simples ? 0 : calcularIR();
      const liquido = bruto - iss - ir;

      const { error } = await supabase.from("valores_em_aberto").insert({
        fornecedor_id: formValor.fornecedor_id,
        numero_processo: formValor.numero_processo || null,
        numero_empenho: formValor.numero_empenho || null,
        numero_nota_fiscal: formValor.numero_nota_fiscal || null,
        data_nota_fiscal: formValor.data_nota_fiscal || null,
        parcela: formValor.parcela || null,
        valor_bruto: bruto,
        base_calculo: base,
        valor: liquido,
        optante_simples: formValor.optante_simples,
        desconto_iss: iss,
        desconto_ir: ir,
        aliquota_iss: issAliquota,
        aliquota_ir: irAliquota,
        data_vencimento: formValor.data_vencimento || null,
        situacao: "em_aberto",
      });
      if (error) throw error;

      if (!formValor.optante_simples) {
        const updates = {};
        if (fixarIss) updates.aliquota_iss_fixa = issAliquota;
        if (fixarIr) updates.aliquota_ir_fixa = irAliquota;
        if (Object.keys(updates).length > 0) {
          await supabase.from("fornecedores").update(updates).eq("id", formValor.fornecedor_id);

          // Auditoria: fixar alíquota altera o cadastro do fornecedor. Só entram
          // na trilha as alíquotas que mudaram de valor.
          const fornecedor = fornecedores.find((f) => String(f.id) === String(formValor.fornecedor_id));
          const antes = {};
          const depois = {};
          Object.keys(updates).forEach((campo) => {
            const anterior = fornecedor?.[campo] ?? null;
            if (Number(anterior) === Number(updates[campo])) return;
            antes[campo] = anterior;
            depois[campo] = updates[campo];
          });
          if (Object.keys(depois).length > 0) {
            await registrarEvento({
              modulo: "fornecedores",
              acao: "alterou",
              registroAfetado: fornecedor
                ? `${fornecedor.razao_social} (${fornecedor.cpf_cnpj})`
                : "Fornecedor",
              valorAnterior: antes,
              valorNovo: depois,
              nivel: "informacao",
            });
          }
        }
      }

      setFormValor(FORM_VALOR_VAZIO);
      setFixarIss(false);
      setFixarIr(false);
      setMostrarFormValor(false);
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao adicionar valor."));
    } finally {
      setSalvando(false);
    }
  }

  function excluirValor(id) {
    let valor = null;
    let dono = null;
    fornecedores.forEach((f) => {
      const encontrado = (f.valores ?? []).find((v) => String(v.id) === String(id));
      if (encontrado) {
        valor = encontrado;
        dono = f;
      }
    });

    const situacao = SITUACOES.find((op) => op.value === valor?.situacao);
    setExclusaoPendente({
      tipo: "valor",
      id,
      rotulo: `${dono?.razao_social ?? "Fornecedor"} — NF ${valor?.numero_nota_fiscal ?? "--"}`,
      registro: valor?.numero_nota_fiscal
        ? `o valor em aberto da NF ${valor.numero_nota_fiscal}`
        : "este valor em aberto",
      aviso: "O lançamento sai do sistema e deixa de compor o total em aberto do fornecedor.",
      exigirMotivo: false,
      detalhes: [
        { rotulo: "Fornecedor", valor: dono?.razao_social ?? "--" },
        { rotulo: "Nota fiscal", valor: valor?.numero_nota_fiscal ?? "--" },
        { rotulo: "Valor", valor: formatBRL(valor?.valor ?? 0) },
        { rotulo: "Situação", valor: situacao?.label ?? valor?.situacao ?? "--" },
      ],
      anterior: {
        fornecedor: dono?.razao_social ?? null,
        valor: formatBRL(valor?.valor ?? 0),
        situacao: situacao?.label ?? valor?.situacao ?? null,
      },
    });
  }

  async function mudarSituacao(valorId, novaSituacao) {
    setErro(null);
    try {
      const { error } = await supabase.from("valores_em_aberto").update({ situacao: novaSituacao }).eq("id", valorId);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao atualizar situação."));
    }
  }

  function exportarExcel(lista) {
    const linhas = [];
    lista.forEach((f) => {
      if (f.valores.length === 0) {
        linhas.push({ Fornecedor: f.razao_social, CPF_CNPJ: f.cpf_cnpj, NF: "", Bruto: "", ISS: "", IR: "", Liquido: "", Situacao: "" });
      }
      f.valores.forEach((v) => {
        linhas.push({
          Fornecedor: f.razao_social,
          CPF_CNPJ: f.cpf_cnpj,
          NF: v.numero_nota_fiscal ?? "",
          Bruto: v.valor_bruto ?? v.valor,
          ISS: v.desconto_iss ?? 0,
          IR: v.desconto_ir ?? 0,
          Liquido: v.valor,
          Situacao: v.situacao,
        });
      });
    });
    const cabecalho = ["Fornecedor", "CPF_CNPJ", "NF", "Bruto", "ISS", "IR", "Liquido", "Situacao"];
    const ws = XLSX.utils.json_to_sheet(linhas, { header: cabecalho });
    // Bruto, ISS, IR e Líquido saem como número com formato de moeda brasileiro:
    // somam na planilha em vez de chegarem como texto.
    marcarColunasDeMoeda(ws, colunasPorCabecalho(cabecalho, ["Bruto", "ISS", "IR", "Liquido"]), {
      ultimaLinha: linhas.length,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fornecedores");
    XLSX.writeFile(wb, `fornecedores-${hojeISO()}.xlsx`);
  }

  // Situações oferecidas no filtro: apenas as que realmente aparecem nos fornecedores cadastrados.
  const situacoesDisponiveis = React.useMemo(() => {
    const encontradas = new Set();
    fornecedores.forEach((f) => f.valores.forEach((v) => { if (v.situacao) encontradas.add(v.situacao); }));
    return [...encontradas]
      .map((s) => ({ value: s, label: SITUACOES.find((x) => x.value === s)?.label ?? s }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [fornecedores]);

  // Coluna de tipo do cadastro, se ela existir na tabela de fornecedores.
  const campoTipo = React.useMemo(() => {
    const chaves = new Set();
    fornecedores.forEach((f) => Object.keys(f).forEach((k) => chaves.add(k)));
    return (
      [...chaves].find(
        (k) =>
          /^(tipo|categoria|natureza|classificacao)/.test(normalizarTexto(k)) &&
          fornecedores.some((f) => typeof f[k] === "string" && f[k].trim() !== "")
      ) ?? ""
    );
  }, [fornecedores]);

  // Tipos oferecidos no filtro: apenas os que aparecem nos fornecedores cadastrados.
  const tiposDisponiveis = React.useMemo(() => {
    const encontrados = new Set();
    fornecedores.forEach((f) => {
      const tipo = tipoDoFornecedor(f, campoTipo);
      if (tipo) encontrados.add(tipo);
    });
    return [...encontrados].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [fornecedores, campoTipo]);

  // Só oferece os filtros que têm base no cadastro atual.
  const temDadosBancarios = React.useMemo(
    () => fornecedores.some((f) => "dados_bancarios" in f),
    [fornecedores]
  );
  const temValidadeDocumentos = React.useMemo(
    () => fornecedores.some((f) => datasDeValidade(f).length > 0),
    [fornecedores]
  );
  const documentacoesDisponiveis = DOCUMENTACOES.filter((d) => !d.precisaValidade || temValidadeDocumentos);

  function dataDoLancamento(valor, campo) {
    if (campo === "emissao") return [valor.data_nota_fiscal];
    if (campo === "vencimento") return [valor.data_vencimento];
    if (campo === "lancamento") return [valor.created_at];
    if (campo === "pagamento") return datasPagamento[valor.id] ?? [];
    return [];
  }

  const { fornecedoresFiltrados, totalFiltrado } = React.useMemo(() => {
    const busca = normalizarTexto(buscaRapida);
    const {
      nome, dataInicial, dataFinal, campoData, valorMin, valorMax, documento, situacao,
      secretariasIds, tipo, tributarios, banco, agencia, conta, documentacao,
    } = filtrosAplicados;

    const nomeBusca = normalizarTexto(nome);
    const docDigitos = somenteDigitos(documento);
    const docTexto = normalizarTexto(documento);
    const minimo = paraValorMonetario(valorMin);
    const maximo = paraValorMonetario(valorMax);
    const temPeriodo = Boolean(dataInicial || dataFinal);
    const periodoNoLancamento = temPeriodo && campoData !== "cadastro";
    // Valor, situação e período (exceto cadastro) precisam bater todos no mesmo lançamento.
    const filtraLancamentos = Boolean(situacao) || minimo !== null || maximo !== null || periodoNoLancamento;

    const bancoBusca = normalizarTexto(banco);
    const agenciaBusca = normalizarTexto(agencia);
    const contaBusca = normalizarTexto(conta);
    const regrasTributarias = TRIBUTARIOS.filter((t) => tributarios.includes(t.value));

    const lista = [];
    let total = 0;

    fornecedores.forEach((f) => {
      const digitosDoc = somenteDigitos(f.cpf_cnpj);
      // A busca considera razão social, nome fantasia e APELIDO: digitar "Zé"
      // encontra quem tem apelido "Zé Alimentos" sem deixar de encontrar quem
      // tem "Zé" na razão social. O CPF/CNPJ continua comparado por dígitos.
      const nomes = normalizarTexto(
        `${f.razao_social ?? ""} ${f.nome_fantasia ?? ""} ${f.nome ?? ""} ${f.apelido ?? ""}`,
      );

      if (busca) {
        const buscaDigitos = somenteDigitos(busca);
        const achouTexto = `${nomes} ${normalizarTexto(f.cpf_cnpj)}`.includes(busca);
        const achouDoc = buscaDigitos !== "" && digitosDoc.includes(buscaDigitos);
        if (!achouTexto && !achouDoc) return;
      }

      if (nomeBusca && !nomes.includes(nomeBusca)) return;

      if (documento.trim()) {
        // Aceita com ou sem pontuação: compara só os dígitos quando o filtro tiver algum.
        const combina = docDigitos ? digitosDoc.includes(docDigitos) : normalizarTexto(f.cpf_cnpj).includes(docTexto);
        if (!combina) return;
      }

      if (temPeriodo && campoData === "cadastro" && !dentroDoPeriodo(f.created_at, dataInicial, dataFinal)) return;

      if (secretariasIds.length > 0 && !secretariasIds.includes(String(f.secretaria_id ?? ""))) return;

      if (tipo && tipoDoFornecedor(f, campoTipo) !== tipo) return;

      if (regrasTributarias.length > 0) {
        const perfil = perfilTributario(f);
        if (!regrasTributarias.every((regra) => regra.testa(perfil))) return;
      }

      if (bancoBusca && !normalizarTexto(textoBancario(f, "banco")).includes(bancoBusca)) return;
      if (agenciaBusca && !normalizarTexto(textoBancario(f, "agencia")).includes(agenciaBusca)) return;
      if (contaBusca && !normalizarTexto(textoBancario(f, "conta")).includes(contaBusca)) return;

      if (documentacao && !combinaDocumentacao(f, documentacao)) return;

      const correspondentes = !filtraLancamentos
        ? f.valores
        : f.valores.filter((v) => {
            if (situacao && v.situacao !== situacao) return false;

            const valorLiquido = v.valor ?? 0;
            if (minimo !== null && valorLiquido < minimo) return false;
            if (maximo !== null && valorLiquido > maximo) return false;

            if (periodoNoLancamento) {
              const datas = dataDoLancamento(v, campoData);
              if (!datas.some((d) => dentroDoPeriodo(d, dataInicial, dataFinal))) return false;
            }
            return true;
          });

      if (filtraLancamentos && correspondentes.length === 0) return;

      lista.push(f);
      // Soma só o que sobrou do filtro, no mesmo critério do total em aberto da tela.
      total += correspondentes
        .filter((v) => v.situacao !== "pago" && v.situacao !== "cancelado")
        .reduce((acc, v) => acc + (v.valor - (v.valor_pago ?? 0)), 0);
    });

    return { fornecedoresFiltrados: lista, totalFiltrado: total };
  }, [fornecedores, buscaRapida, filtrosAplicados, datasPagamento, campoTipo]);

  const filtrandoAlgo = buscaRapida.trim() !== "" || filtroPreenchido(filtrosAplicados);

  // A ordenação escolhida vale para a listagem e para o que sai nas exportações.
  const fornecedoresVisiveis = React.useMemo(
    () => ordenarFornecedores(fornecedoresFiltrados, ordenacao),
    [fornecedoresFiltrados, ordenacao]
  );
  const todosOrdenados = React.useMemo(
    () => ordenarFornecedores(fornecedores, ordenacao),
    [fornecedores, ordenacao]
  );
  // Ao imprimir "todos", a listagem completa aparece na tela só durante a impressão.
  const listaExibida = imprimindoTodos ? todosOrdenados : fornecedoresVisiveis;

  // Sem filtros ativos, cada botão exporta tudo como já funcionava; com filtros,
  // pergunta antes se o arquivo leva só os resultados filtrados.
  function pedirExportacao(tipo) {
    if (!filtrandoAlgo) return executarExportacao(tipo, "todos");
    setExportacaoPendente(tipo);
  }
  function executarExportacao(tipo, escopo) {
    setExportacaoPendente(null);
    if (tipo === "excel") {
      exportarExcel(escopo === "filtrados" ? fornecedoresVisiveis : todosOrdenados);
      return;
    }
    if (escopo === "todos" && filtrandoAlgo) setImprimindoTodos(true);
    // Espera a tela atualizar sem o modal antes de abrir a janela de impressão.
    else window.setTimeout(() => window.print(), 60);
  }

  function aplicarFiltros() {
    setFiltrosAplicados(filtros);
  }
  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    setFiltrosAplicados(FILTROS_VAZIOS);
    setBuscaRapida("");
  }

  // Guarda a combinação que está na tela (filtros, busca rápida e ordenação).
  async function confirmarSalvarFiltro(e) {
    e.preventDefault();
    setSalvandoFiltro(true);
    setErroFavoritos(null);
    try {
      const criterios = { versao: 1, buscaRapida, filtros, ordenacao };
      const novo = await salvarFiltroFavorito(nomeNovoFiltro, criterios);
      setFavoritos((atuais) => [novo, ...atuais]);
      setNomeNovoFiltro(null);
    } catch (erroSalvar) {
      setErroFavoritos(mensagemAmigavel(erroSalvar, "Não foi possível salvar o filtro."));
    } finally {
      setSalvandoFiltro(false);
    }
  }
  function aplicarFavorito(favorito) {
    const criterios = favorito.criterios ?? {};
    const escolhidos = normalizarFiltros(criterios.filtros);
    setFiltros(escolhidos);
    setFiltrosAplicados(escolhidos);
    setBuscaRapida(typeof criterios.buscaRapida === "string" ? criterios.buscaRapida : "");
    setOrdenacao(ordenacaoValida(criterios.ordenacao));
  }
  function excluirFavorito(favorito) {
    setExclusaoPendente({
      tipo: "favorito",
      id: favorito.id,
      rotulo: favorito.nome,
      registro: `o filtro salvo "${favorito.nome}"`,
      aviso: "O filtro deixa de aparecer na lista de filtros salvos. Os cadastros não são afetados.",
      exigirMotivo: false,
      detalhes: [{ rotulo: "Filtro salvo", valor: favorito.nome }],
      anterior: { titulo: favorito.nome },
    });
  }

  /**
   * Executa a exclusão confirmada no modal e registra o evento na auditoria.
   *
   * Fornecedor é exclusão lógica (excluido_em/excluido_por, com o cadastro
   * também marcado como inativo); valor em aberto e filtro salvo continuam
   * sendo exclusão física, como sempre foram.
   */
  async function confirmarExclusao(motivo) {
    const pendente = exclusaoPendente;
    if (!pendente) return;

    if (pendente.tipo === "favorito") {
      setErroFavoritos(null);
      await excluirFiltroFavorito(pendente.id);
      setFavoritos((atuais) => atuais.filter((f) => f.id !== pendente.id));
      await auditarExclusao({
        modulo: "fornecedores",
        registroAfetado: `Filtro salvo: ${pendente.rotulo}`,
        motivo,
        valorAnterior: pendente.anterior,
        logica: false,
        nivel: "informacao",
        usuarioId: usuarioLogado?.id ?? null,
      });
      setExclusaoPendente(null);
      return;
    }

    setErro(null);

    if (pendente.tipo === "valor") {
      const { error } = await supabase.from("valores_em_aberto").delete().eq("id", pendente.id);
      if (error) throw error;
      await auditarExclusao({
        modulo: "fornecedores",
        registroAfetado: pendente.rotulo,
        motivo,
        valorAnterior: pendente.anterior,
        logica: false,
        usuarioId: usuarioLogado?.id ?? null,
      });
      setExclusaoPendente(null);
      await carregarDados();
      return;
    }

    // Fornecedor: o cadastro sai das listagens pelas duas vias — inativo e
    // marcado como excluído —, mas continua no banco.
    const { logica } = await excluirRegistro({
      tabela: "fornecedores",
      id: pendente.id,
      usuarioId: usuarioLogado?.id ?? null,
      camposExtras: { ativo: false },
      aoNaoSuportar: async () => {
        const { error } = await supabase.from("fornecedores").update({ ativo: false }).eq("id", pendente.id);
        if (error) throw error;
      },
    });

    await auditarExclusao({
      modulo: "fornecedores",
      registroAfetado: pendente.rotulo,
      motivo,
      valorAnterior: pendente.anterior,
      logica,
      usuarioId: usuarioLogado?.id ?? null,
    });

    setExclusaoPendente(null);
    if (expandido === pendente.id) setExpandido(null);
    await carregarDados();
  }
  // Tira um filtro específico já aplicado, mantendo todos os outros.
  function removerFiltro(alteracao) {
    setFiltros((atuais) => ({ ...atuais, ...alteracao }));
    setFiltrosAplicados({ ...filtrosAplicados, ...alteracao });
  }
  function alternarSecretaria(id) {
    const atuais = filtros.secretariasIds;
    setFiltros({
      ...filtros,
      secretariasIds: atuais.includes(id) ? atuais.filter((s) => s !== id) : [...atuais, id],
    });
  }
  function alternarTributario(valor) {
    const opcao = TRIBUTARIOS.find((t) => t.value === valor);
    const atuais = filtros.tributarios;
    setFiltros({
      ...filtros,
      tributarios: atuais.includes(valor)
        ? atuais.filter((t) => t !== valor)
        : [...atuais.filter((t) => t !== opcao.oposto), valor],
    });
  }

  const nomeSecretaria = (id) => secretarias.find((s) => String(s.id) === String(id))?.nome ?? "Secretaria";

  // Um chip por critério aplicado; cada um sai sozinho, sem mexer nos demais.
  const chipsAtivos = React.useMemo(() => {
    const f = filtrosAplicados;
    const chips = [];

    if (buscaRapida.trim()) {
      chips.push({ chave: "busca", rotulo: `Busca: ${buscaRapida.trim()}`, remover: () => setBuscaRapida("") });
    }
    if (f.nome.trim()) {
      chips.push({ chave: "nome", rotulo: `Nome: ${f.nome.trim()}`, remover: () => removerFiltro({ nome: "" }) });
    }
    if (f.dataInicial || f.dataFinal) {
      const campo = CAMPOS_DATA.find((c) => c.value === f.campoData)?.label ?? "Período";
      const inicio = f.dataInicial ? formatarData(f.dataInicial) : "...";
      const fim = f.dataFinal ? formatarData(f.dataFinal) : "...";
      chips.push({
        chave: "periodo",
        rotulo: `${campo}: ${inicio} a ${fim}`,
        remover: () => removerFiltro({ dataInicial: "", dataFinal: "" }),
      });
    }
    if (f.valorMin || f.valorMax) {
      const min = f.valorMin ? formatBRL(paraValorMonetario(f.valorMin)) : "...";
      const max = f.valorMax ? formatBRL(paraValorMonetario(f.valorMax)) : "...";
      chips.push({
        chave: "valor",
        rotulo: `Valor: ${min} a ${max}`,
        remover: () => removerFiltro({ valorMin: "", valorMax: "" }),
      });
    }
    if (f.documento.trim()) {
      chips.push({
        chave: "documento",
        rotulo: `CNPJ/CPF: ${f.documento.trim()}`,
        remover: () => removerFiltro({ documento: "" }),
      });
    }
    if (f.situacao) {
      const label = SITUACOES.find((s) => s.value === f.situacao)?.label ?? f.situacao;
      chips.push({ chave: "situacao", rotulo: label, remover: () => removerFiltro({ situacao: "" }) });
    }
    f.secretariasIds.forEach((id) => {
      chips.push({
        chave: `secretaria-${id}`,
        rotulo: nomeSecretaria(id),
        remover: () => removerFiltro({ secretariasIds: f.secretariasIds.filter((s) => s !== id) }),
      });
    });
    if (f.tipo) {
      chips.push({ chave: "tipo", rotulo: f.tipo, remover: () => removerFiltro({ tipo: "" }) });
    }
    f.tributarios.forEach((valor) => {
      const opcao = TRIBUTARIOS.find((t) => t.value === valor);
      chips.push({
        chave: `tributario-${valor}`,
        rotulo: opcao?.label ?? valor,
        remover: () => removerFiltro({ tributarios: f.tributarios.filter((t) => t !== valor) }),
      });
    });
    ["banco", "agencia", "conta"].forEach((campo) => {
      if (!f[campo].trim()) return;
      const rotulos = { banco: "Banco", agencia: "Agência", conta: "Conta" };
      chips.push({
        chave: campo,
        rotulo: `${rotulos[campo]}: ${f[campo].trim()}`,
        remover: () => removerFiltro({ [campo]: "" }),
      });
    });
    if (f.documentacao) {
      const label = DOCUMENTACOES.find((d) => d.value === f.documentacao)?.label ?? f.documentacao;
      chips.push({ chave: "documentacao", rotulo: label, remover: () => removerFiltro({ documentacao: "" }) });
    }
    return chips;
  }, [filtrosAplicados, buscaRapida, secretarias]);

  // A faixa é comparada pelo número, não pelo texto: o campo com máscara guarda
  // "R$ 1.000,01" e a faixa guarda "1000.01" -- é o mesmo valor.
  function faixaAtiva(faixa) {
    return (
      paraValorMonetario(filtros.valorMin) === paraValorMonetario(faixa.min) &&
      paraValorMonetario(filtros.valorMax) === paraValorMonetario(faixa.max)
    );
  }

  function aplicarFaixa(faixa) {
    const jaAtiva = faixaAtiva(faixa);
    const novos = jaAtiva
      ? { ...filtros, valorMin: "", valorMax: "" }
      : { ...filtros, valorMin: faixa.min, valorMax: faixa.max };
    setFiltros(novos);
    setFiltrosAplicados(novos);
  }

  const totalGeralAberto = fornecedores.reduce((acc, f) => acc + f.totalAberto, 0);
  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6 print:mb-4 print:flex-row">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Fornecedores</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              Total em aberto: <span className="font-semibold">{formatBRL(totalGeralAberto)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button onClick={() => pedirExportacao("imprimir")} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <Printer size={14} /> Imprimir
            </button>
            <button onClick={() => pedirExportacao("pdf")} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => pedirExportacao("excel")} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={() => { setMostrarFormValor((v) => !v); setMostrarForm(false); }}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5"
            >
              {mostrarFormValor ? <X size={16} /> : <Plus size={16} />}
              {mostrarFormValor ? "Cancelar" : "Novo Valor em Aberto"}
            </button>
            <button
              onClick={() => { setMostrarForm((v) => !v); setMostrarFormValor(false); }}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              {mostrarForm ? <X size={16} /> : <Plus size={16} />}
              {mostrarForm ? "Cancelar" : "Novo Fornecedor"}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            {erro}
          </div>
        )}

        <PainelFiltros
          className="mb-6"
          rotulo="Filtros avançados"
          chips={chipsAtivos}
          onLimpar={limparFiltros}
          topo={
            <>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="text"
                  value={buscaRapida}
                  onChange={(e) => setBuscaRapida(e.target.value)}
                  placeholder="🔎 Buscar fornecedor..."
                  className="flex-1 px-3 py-2.5 rounded-lg border border-black/10 text-sm"
                />
                <div className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5">
                  <ArrowUpDown size={14} className="text-[#0F2A44]/40 shrink-0" />
                  <select
                    value={ordenacao}
                    onChange={(e) => setOrdenacao(e.target.value)}
                    title="Ordenar resultados"
                    className="w-full py-2.5 text-sm bg-transparent text-[#0F2A44]/80 outline-none"
                  >
                    {ORDENACOES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-[#0F2A44]/40 mt-1.5">
                A busca rápida procura ao mesmo tempo em nome, razão social, nome fantasia, CPF e CNPJ.
              </p>

              <FiltrosSalvos
                favoritos={favoritos}
                carregando={carregandoFavoritos}
                erro={erroFavoritos}
                onAplicar={aplicarFavorito}
                onExcluir={excluirFavorito}
              />
            </>
          }
          rodape={
            filtrandoAlgo ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-[#0F2A44]/70">
                <span>
                  Quantidade encontrada: <span className="font-semibold text-[#0F2A44]">{fornecedoresFiltrados.length} fornecedores</span>
                </span>
                {totalFiltrado > 0 && (
                  <span>
                    Valor total filtrado: <span className="font-semibold text-[#0F2A44]">{formatBRL(totalFiltrado)}</span>
                  </span>
                )}
              </div>
            ) : null
          }
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70">Nome / Razão social / Nome fantasia</label>
              <input
                type="text"
                value={filtros.nome}
                onChange={(e) => setFiltros({ ...filtros, nome: e.target.value })}
                placeholder="Parte do nome, ex: Meta"
                className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Data inicial</label>
                <input
                  type="date"
                  value={filtros.dataInicial}
                  onChange={(e) => setFiltros({ ...filtros, dataInicial: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Data final</label>
                <input
                  type="date"
                  value={filtros.dataFinal}
                  onChange={(e) => setFiltros({ ...filtros, dataFinal: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Filtrar data por</label>
                <select
                  value={filtros.campoData}
                  onChange={(e) => setFiltros({ ...filtros, campoData: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  {CAMPOS_DATA.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#0F2A44]/70">Valor mínimo</label>
                  <CampoMoeda
                    placeholder="R$ 0,00"
                    valor={filtros.valorMin}
                    onValorChange={(_numero, texto) => setFiltros({ ...filtros, valorMin: texto })}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#0F2A44]/70">Valor máximo</label>
                  <CampoMoeda
                    placeholder="R$ 0,00"
                    valor={filtros.valorMax}
                    onValorChange={(_numero, texto) => setFiltros({ ...filtros, valorMax: texto })}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {FAIXAS_VALOR.map((faixa) => (
                  <button
                    key={faixa.label}
                    type="button"
                    onClick={() => aplicarFaixa(faixa)}
                    className={`px-3 py-1.5 rounded-md text-xs border ${
                      faixaAtiva(faixa)
                        ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                        : "border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
                    }`}
                  >
                    {faixa.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">Considera o valor líquido de cada lançamento do fornecedor.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">CNPJ / CPF</label>
                <input
                  type="text"
                  value={filtros.documento}
                  onChange={(e) => setFiltros({ ...filtros, documento: e.target.value })}
                  placeholder="Com ou sem pontuação"
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Situação</label>
                <select
                  value={filtros.situacao}
                  onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  <option value="">Todas</option>
                  {situacoesDisponiveis.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-1 border-t border-black/5">
              <label className="text-xs font-medium text-[#0F2A44]/70">Secretaria / Setor</label>
              <div className="mt-1 rounded-lg border border-black/10 p-2 max-h-36 overflow-y-auto space-y-1">
                <label className="flex items-center gap-2 text-sm text-[#0F2A44]/80">
                  <input
                    type="checkbox"
                    checked={filtros.secretariasIds.length === 0}
                    onChange={() => setFiltros({ ...filtros, secretariasIds: [] })}
                    className="w-3.5 h-3.5 accent-[#0F2A44]"
                  />
                  Todas as secretarias
                </label>
                {secretarias.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-[#0F2A44]/80">
                    <input
                      type="checkbox"
                      checked={filtros.secretariasIds.includes(String(s.id))}
                      onChange={() => alternarSecretaria(String(s.id))}
                      className="w-3.5 h-3.5 accent-[#0F2A44]"
                    />
                    {s.nome}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">
                Marque uma ou várias secretarias ao mesmo tempo; sem marcação, considera todas.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Tipo de fornecedor</label>
                <select
                  value={filtros.tipo}
                  onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  <option value="">Todos</option>
                  {tiposDisponiveis.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">Lista montada com os tipos dos fornecedores já cadastrados.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Documentação</label>
                <select
                  value={filtros.documentacao}
                  onChange={(e) => setFiltros({ ...filtros, documentacao: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  <option value="">Todas</option>
                  {documentacoesDisponiveis.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">
                  Considera os campos preenchidos no cadastro
                  {temValidadeDocumentos ? " e as datas de validade registradas." : "; datas de validade ainda não existem no cadastro."}
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Situação tributária</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                {TRIBUTARIOS.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 text-sm text-[#0F2A44]/80">
                    <input
                      type="checkbox"
                      checked={filtros.tributarios.includes(t.value)}
                      onChange={() => alternarTributario(t.value)}
                      className="w-3.5 h-3.5 accent-[#0F2A44]"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">
                Usa as alíquotas fixas do fornecedor e as retenções já lançadas. Pendência tributária: lançamento
                fora do Simples com alíquota informada e nenhuma retenção aplicada.
              </p>
            </div>

            {temDadosBancarios && (
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Dados bancários</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <input
                    type="text"
                    value={filtros.banco}
                    onChange={(e) => setFiltros({ ...filtros, banco: e.target.value })}
                    placeholder="Banco"
                    className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <input
                    type="text"
                    value={filtros.agencia}
                    onChange={(e) => setFiltros({ ...filtros, agencia: e.target.value })}
                    placeholder="Agência"
                    className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <input
                    type="text"
                    value={filtros.conta}
                    onChange={(e) => setFiltros({ ...filtros, conta: e.target.value })}
                    placeholder="Número da conta"
                    className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                </div>
                <p className="text-[10px] text-[#0F2A44]/40 mt-1.5">Busca nos dados bancários gravados no cadastro do fornecedor.</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={aplicarFiltros}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
              >
                <Filter size={15} /> Aplicar Filtros
              </button>
              <button
                type="button"
                onClick={limparFiltros}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              >
                <Eraser size={15} /> Limpar Filtros
              </button>
              <button
                type="button"
                onClick={() => setNomeNovoFiltro((atual) => (atual === null ? "" : null))}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              >
                <Star size={15} /> Salvar filtro
              </button>
              {filtrandoAlgo && (
                <span className="text-xs text-[#0F2A44]/50 ml-1">
                  {fornecedoresFiltrados.length} de {fornecedores.length} fornecedores
                </span>
              )}
            </div>

            {nomeNovoFiltro !== null && (
              <form onSubmit={confirmarSalvarFiltro} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  value={nomeNovoFiltro}
                  onChange={(e) => setNomeNovoFiltro(e.target.value)}
                  placeholder='Nome do filtro, ex: "Fornecedores Saúde — Pendências"'
                  className="flex-1 px-3 py-2.5 rounded-lg border border-black/10 text-sm"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={salvandoFiltro || nomeNovoFiltro.trim() === ""}
                    className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
                  >
                    <Save size={15} />
                    {salvandoFiltro ? "Salvando..." : "Salvar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNomeNovoFiltro(null)}
                    className="text-sm px-4 py-2.5 rounded-lg text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </PainelFiltros>

        {mostrarFormValor && (
          <form
            onSubmit={criarValor}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4 print:hidden"
          >
            <h2 className="text-base font-semibold text-[#0F2A44]">Cadastrar valor em aberto</h2>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70">Fornecedor</label>
              <select
                value={formValor.fornecedor_id}
                onChange={(e) => selecionarFornecedorNoValor(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
              >
                <option value="">Selecione...</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.razao_social}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Número da NF</label>
                <input
                  type="text"
                  value={formValor.numero_nota_fiscal}
                  onChange={(e) => setFormValor({ ...formValor, numero_nota_fiscal: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Data da NF</label>
                <input
                  type="date"
                  value={formValor.data_nota_fiscal}
                  onChange={(e) => setFormValor({ ...formValor, data_nota_fiscal: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Valor bruto da nota</label>
                <CampoMoeda
                  placeholder="R$ 0,00"
                  valor={formValor.valor_bruto}
                  onValorChange={(_numero, texto) => setFormValor({ ...formValor, valor_bruto: texto })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Optante pelo Simples Nacional?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormValor({ ...formValor, optante_simples: true })}
                  className={`px-4 py-2 rounded-lg text-sm border ${
                    formValor.optante_simples ? "bg-[#0F2A44] text-white border-[#0F2A44]" : "border-black/10 text-[#0F2A44]/60"
                  }`}
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setFormValor({ ...formValor, optante_simples: false })}
                  className={`px-4 py-2 rounded-lg text-sm border ${
                    !formValor.optante_simples ? "bg-[#0F2A44] text-white border-[#0F2A44]" : "border-black/10 text-[#0F2A44]/60"
                  }`}
                >
                  Não
                </button>
              </div>
            </div>
            {!formValor.optante_simples && (
              <div className="bg-[#0F2A44]/[0.03] rounded-lg p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-[#0F2A44]/70">Base de cálculo</label>
                  <CampoMoeda
                    placeholder={formValor.valor_bruto || "R$ 0,00"}
                    valor={formValor.base_calculo}
                    onValorChange={(_numero, texto) => setFormValor({ ...formValor, base_calculo: texto })}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <p className="text-[10px] text-[#0F2A44]/40 mt-1">Deixe em branco para usar o valor bruto como base.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Alíquota de ISS</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ALIQUOTAS_PADRAO.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setFormValor({ ...formValor, aliquota_iss: String(a) })}
                          className={`px-3 py-1.5 rounded-md text-xs border ${
                            formValor.aliquota_iss === String(a)
                              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                              : "border-black/10 text-[#0F2A44]/60"
                          }`}
                        >
                          {a}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormValor({ ...formValor, aliquota_iss: "outra" })}
                        className={`px-3 py-1.5 rounded-md text-xs border ${
                          formValor.aliquota_iss === "outra"
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/60"
                        }`}
                      >
                        Outra
                      </button>
                    </div>
                    {formValor.aliquota_iss === "outra" && (
                      <input
                        type="number" step="0.01" placeholder="Ex: 3.5"
                        value={formValor.aliquota_iss_outra}
                        onChange={(e) => setFormValor({ ...formValor, aliquota_iss_outra: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-2"
                      />
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[#0F2A44]/60">
                      <input type="checkbox" checked={fixarIss} onChange={(e) => setFixarIss(e.target.checked)} className="w-3.5 h-3.5 accent-[#0F2A44]" />
                      Fixar esta alíquota para este fornecedor
                    </label>
                    <div className="text-xs text-[#0F2A44]/70 mt-1.5">ISS retido: <span className="font-semibold">{formatBRL(calcularISS())}</span></div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Alíquota de IR</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ALIQUOTAS_PADRAO.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setFormValor({ ...formValor, aliquota_ir: String(a) })}
                          className={`px-3 py-1.5 rounded-md text-xs border ${
                            formValor.aliquota_ir === String(a)
                              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                              : "border-black/10 text-[#0F2A44]/60"
                          }`}
                        >
                          {a}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormValor({ ...formValor, aliquota_ir: "outra" })}
                        className={`px-3 py-1.5 rounded-md text-xs border ${
                          formValor.aliquota_ir === "outra"
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/60"
                        }`}
                      >
                        Outra
                      </button>
                    </div>
                    {formValor.aliquota_ir === "outra" && (
                      <input
                        type="number" step="0.01" placeholder="Ex: 1.5"
                        value={formValor.aliquota_ir_outra}
                        onChange={(e) => setFormValor({ ...formValor, aliquota_ir_outra: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-2"
                      />
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[#0F2A44]/60">
                      <input type="checkbox" checked={fixarIr} onChange={(e) => setFixarIr(e.target.checked)} className="w-3.5 h-3.5 accent-[#0F2A44]" />
                      Fixar esta alíquota para este fornecedor
                    </label>
                    <div className="text-xs text-[#0F2A44]/70 mt-1.5">IR retido: <span className="font-semibold">{formatBRL(calcularIR())}</span></div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#EAF1FF] rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-[#0F2A44]/70">Valor líquido da nota</span>
              <span className="text-base font-semibold text-[#0F2A44]">{formatBRL(calcularValorLiquido())}</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Processo (opcional)</label>
                <input
                  type="text"
                  value={formValor.numero_processo}
                  onChange={(e) => setFormValor({ ...formValor, numero_processo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Empenho (opcional)</label>
                <input
                  type="text"
                  value={formValor.numero_empenho}
                  onChange={(e) => setFormValor({ ...formValor, numero_empenho: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Vencimento</label>
                <input
                  type="date"
                  value={formValor.data_vencimento}
                  onChange={(e) => setFormValor({ ...formValor, data_vencimento: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <button
              type="submit" disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar valor em aberto"}
            </button>
          </form>
        )}
        {mostrarForm && (
          <form
            onSubmit={criarFornecedor}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4 print:hidden"
          >
            <h2 className="text-base font-semibold text-[#0F2A44]">Cadastrar fornecedor</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Razão social</label>
                <input
                  type="text"
                  value={form.razao_social}
                  onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Nome fantasia (opcional)</label>
                <input
                  type="text"
                  value={form.nome_fantasia}
                  onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Apelido / Nome de exibição (opcional)</label>
                <input
                  type="text"
                  value={form.apelido}
                  onChange={(e) => setForm({ ...form, apelido: e.target.value })}
                  maxLength={LIMITE_NOME_EXIBICAO}
                  placeholder="Ex.: Zé Alimentos"
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
                <p className="mt-1 text-[11px] text-[#0F2A44]/50">
                  Serve para reconhecer e buscar o fornecedor nas telas. A razão social continua gravada e é a que vai
                  para documento oficial e fiscal.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">CPF ou CNPJ</label>
                <input
                  type="text"
                  value={form.cpf_cnpj}
                  onChange={(e) => setForm({ ...form, cpf_cnpj: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Secretaria</label>
                <select
                  value={form.secretaria_id}
                  onChange={(e) => setForm({ ...form, secretaria_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  <option value="">Selecione...</option>
                  {secretarias.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Telefone (opcional)</label>
                <input
                  type="text"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">E-mail (opcional)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70">Descrição do serviço/fornecimento (opcional)</label>
              <textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                rows={2}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
              />
            </div>

            <button
              type="submit" disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar fornecedor"}
            </button>
          </form>
        )}
        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : fornecedores.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
            Nenhum fornecedor cadastrado ainda.
          </div>
        ) : listaExibida.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
            Nenhum fornecedor encontrado com os filtros aplicados.
          </div>
        ) : (
          <div className="space-y-3">
            {listaExibida.map((f) => {
              // Um fornecedor aberto por vez: abrir outro recolhe o anterior.
              const aberto = expandido === f.id;
              const alternar = () => setExpandido(aberto ? null : f.id);
              const situacao = situacaoResumo(f);
              // Indicador documental: só para quem enxerga o módulo de
              // Certidões e só depois de a leitura das certidões terminar.
              const documental =
                podeVerCertidoes && !carregandoCertidoes && !erroCertidoes
                  ? resumoDocumental(certidoesPorFornecedor[String(f.id)])
                  : null;
              return (
                <div key={f.id} className="rounded-xl border border-black/5 overflow-hidden bg-white print:break-inside-avoid">
                  <div className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-black/[0.02]">
                    <button
                      onClick={alternar}
                      aria-expanded={aberto}
                      title={aberto ? "Ocultar detalhes" : "Ver detalhes"}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm font-semibold text-[#0F2A44]">
                        <NomeFornecedor fornecedor={f} classeSecundaria="text-[#0F2A44]/60" />
                      </div>
                      <div className="text-xs text-[#0F2A44]/50 truncate">
                        {f.cpf_cnpj} · {f.secretarias?.nome ?? "--"}
                      </div>
                      <div className={`mt-1 text-[11px] ${dadosPagamentoPorFornecedor[String(f.id)] || f.dados_bancarios ? "text-[#16803C]" : "text-[#9A6700]"}`}>
                        {dadosPagamentoPorFornecedor[String(f.id)] || f.dados_bancarios ? "Dados bancários ✓" : "Dados para pagamento pendentes"}
                      </div>
                    </button>
                    {podeEditarFornecedor && (
                      <button
                        onClick={() => abrirEdicaoApelido(f)}
                        className="shrink-0 text-[#0F2A44]/30 hover:text-[#0F2A44] print:hidden"
                        title={apelidoDoFornecedor(f) ? "Editar apelido" : "Dar um apelido a este fornecedor"}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <div className="flex items-center gap-3 shrink-0">
                      {documental && (
                        <span
                          title={detalheDocumental(documental)}
                          className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md"
                          style={{ color: documental.cor, backgroundColor: documental.bg }}
                        >
                          <span aria-hidden="true">{documental.emoji}</span>
                          <span className="hidden lg:inline">{documental.texto}</span>
                          <span className="lg:hidden sr-only">{documental.texto}</span>
                        </span>
                      )}
                      <span
                        className="hidden sm:inline text-[11px] font-medium px-2 py-1 rounded-md"
                        style={
                          situacao
                            ? { color: situacao.cor, backgroundColor: situacao.bg }
                            : { color: "#0F2A44", backgroundColor: "rgba(15,42,68,0.06)" }
                        }
                      >
                        {situacao ? situacao.label : "Sem lançamentos"}
                      </span>
                      <span className="text-sm font-semibold text-[#0F2A44] tabular-nums">{formatBRL(f.totalAberto)}</span>
                      {podeExcluirFornecedor && (
                        <button
                          onClick={() => excluirFornecedor(f.id, f.razao_social)}
                          className="text-[#0F2A44]/30 hover:text-red-500 print:hidden"
                          title="Excluir fornecedor"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                      <button
                        onClick={alternar}
                        aria-expanded={aberto}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5 print:hidden"
                      >
                        <span className="hidden sm:inline">{aberto ? "Ocultar detalhes" : "Ver detalhes"}</span>
                        {aberto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {apelidoEditando?.id === f.id && (
                    <form
                      onSubmit={salvarApelido}
                      className="px-4 pb-3 pt-1 border-t border-black/5 bg-[#F7F9FC] print:hidden"
                    >
                      <label className="text-xs font-medium text-[#0F2A44]/70">
                        Apelido / Nome de exibição (opcional)
                      </label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          autoFocus
                          value={apelidoEditando.texto}
                          onChange={(ev) =>
                            setApelidoEditando((atual) => ({ ...atual, texto: ev.target.value }))
                          }
                          maxLength={LIMITE_NOME_EXIBICAO}
                          placeholder="Ex.: Zé Alimentos"
                          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-black/10 text-sm"
                        />
                        <button
                          type="submit"
                          disabled={salvandoApelido}
                          className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-60"
                        >
                          <Save size={14} /> {salvandoApelido ? "Salvando..." : "Salvar apelido"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setApelidoEditando(null)}
                          className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70"
                        >
                          <X size={14} /> Cancelar
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-[#0F2A44]/50">
                        Grava apenas o apelido. Razão social, nome fantasia, CPF/CNPJ, dados bancários, NFs, processos e
                        histórico continuam como estão. Campo vazio volta a mostrar o nome de sempre.
                      </p>
                    </form>
                  )}

                  {aberto && (
                    <VidaDoFornecedor
                      fornecedor={f}
                      secretariaNome={f.secretarias?.nome ?? ""}
                      tipo={tipoDoFornecedor(f, campoTipo)}
                      bancario={dadosBancariosExibicao(f)}
                      situacoes={SITUACOES}
                      pagamentos={pagamentosPorFornecedor[String(f.id)] ?? []}
                      carregandoPagamentos={carregandoPagamentos}
                      erroPagamentos={erroPagamentos}
                      certidoes={certidoesPorFornecedor[String(f.id)] ?? []}
                      carregandoCertidoes={carregandoCertidoes}
                      erroCertidoes={erroCertidoes}
                      podeVerCertidoes={podeVerCertidoes}
                      podeCadastrarCertidao={podeCadastrarCertidao}
                      onNovaCertidao={() => setNovaCertidaoPara(f)}
                      onMudarSituacao={mudarSituacao}
                      onExcluirValor={excluirValor}
                      onVerHistorico={() => setHistoricoDe(f)}
                      permissoesPagamento={permissoesEspeciais}
                      onDadosPagamentoChange={(formas) => setDadosPagamentoPorFornecedor((atual) => ({ ...atual, [String(f.id)]: formas.length > 0 }))}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {exportacaoPendente && (
        <ModalEscopoExportacao
          tipo={exportacaoPendente}
          quantidadeFiltrada={fornecedoresVisiveis.length}
          quantidadeTotal={fornecedores.length}
          onEscolher={(escopo) => executarExportacao(exportacaoPendente, escopo)}
          onCancelar={() => setExportacaoPendente(null)}
        />
      )}

      {historicoDe && (
        <ModalHistoricoFornecedor fornecedor={historicoDe} onFechar={() => setHistoricoDe(null)} />
      )}

      {exclusaoPendente && (
        <ModalConfirmarExclusao
          registro={exclusaoPendente.registro}
          aviso={exclusaoPendente.aviso}
          exigirMotivo={exclusaoPendente.exigirMotivo}
          detalhes={exclusaoPendente.detalhes}
          verificando={exclusaoPendente.verificando === true}
          bloqueio={exclusaoPendente.bloqueio ?? null}
          onCancelar={() => setExclusaoPendente(null)}
          onConfirmar={confirmarExclusao}
        />
      )}

      {/* Mesmo modal de cadastro de /certidoes, já com este fornecedor escolhido. */}
      {novaCertidaoPara && (
        <ModalCertidao
          certidao={{ fornecedor_id: novaCertidaoPara.id }}
          fornecedores={fornecedores}
          tipos={tiposCertidao}
          usuario={usuarioCertidoes}
          onFechar={() => setNovaCertidaoPara(null)}
          onSalva={aoSalvarCertidao}
        />
      )}
    </Layout>
  );
}
