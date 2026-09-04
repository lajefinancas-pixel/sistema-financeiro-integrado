import {
  SITUACAO_NAO_CADASTRADA,
  OPCOES_SITUACAO,
  diasAte,
  nomeFornecedor,
  situacaoEfetiva,
} from "./certidoes";
import { anotarVigencia, ehVigenteNoTipo } from "./certidoesRegras";

/**
 * Filtros, ordenação e agrupamento da listagem de certidões.
 *
 * Tudo aqui é cálculo em cima da lista que a tela já carregou (a mesma
 * `listarCertidoes`): nenhuma consulta nova e nenhuma coluna nova no banco. As
 * funções são puras para que a tela só precise guardar o formulário de filtros.
 *
 * Duas leituras de situação convivem, de propósito:
 *   * o filtro "Situação" usa a situação EXIBIDA (`situacaoEfetiva`), para que
 *     escolher "Em renovação" traga exatamente as linhas com essa etiqueta;
 *   * os atalhos de prazo ("Vencidas", "Vencendo em 7 dias"...) olham só a
 *     data, como fazem os alertas — uma certidão marcada como "Em renovação"
 *     continua vencendo e precisa aparecer nesses atalhos.
 *
 * Os dois recortes de situação consideram apenas a certidão MAIS RECENTE de
 * cada tipo (regra única em lib/certidoesRegras.js), para que o filtro
 * "Vencidas" traga as mesmas certidões que o indicador do fornecedor, o card do
 * Painel Principal e os alertas apontam. Sem filtro de situação, a listagem
 * continua mostrando TODAS as certidões — cada linha vem com `vigenteNoTipo`
 * anotado, e a tela marca as anteriores em vez de esconder.
 */

export const FILTROS_VAZIOS = {
  fornecedor: "",
  cnpj: "",
  secretariaId: "",
  tipoId: "",
  situacao: "",
  emissaoInicial: "",
  emissaoFinal: "",
  vencimentoInicial: "",
  vencimentoFinal: "",
  atalho: "",
};

/** Situações do filtro: as do cadastro + "Não cadastrada" (fornecedor sem certidão). */
export const OPCOES_SITUACAO_FILTRO = [
  ...OPCOES_SITUACAO,
  { id: SITUACAO_NAO_CADASTRADA, label: "Não cadastrada" },
];

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

export const ORDENACOES = [
  { id: "vencimento_proximo", label: "Vencimento mais próximo" },
  { id: "vencimento_distante", label: "Vencimento mais distante" },
  { id: "fornecedor_az", label: "Fornecedor (A-Z)" },
  { id: "fornecedor_za", label: "Fornecedor (Z-A)" },
  { id: "situacao", label: "Situação" },
  { id: "tipo", label: "Tipo de certidão" },
];

/** Mesma ordem que a consulta já usava: vencimento mais próximo primeiro. */
export const ORDENACAO_PADRAO = "vencimento_proximo";

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

function soData(valor) {
  return valor ? String(valor).slice(0, 10) : "";
}

/**
 * A data cai no período informado? Sem início e sem fim, tudo passa; com algum
 * limite, a linha sem data fica de fora (uma certidão sem vencimento não
 * pertence a um intervalo de vencimento).
 */
function dentroDoPeriodo(valor, inicio, fim) {
  if (!inicio && !fim) return true;
  const data = soData(valor);
  if (!data) return false;
  if (inicio && data < soData(inicio)) return false;
  if (fim && data > soData(fim)) return false;
  return true;
}

/** Algum filtro preenchido? Usado para mostrar "limpar" e o total encontrado. */
export function haFiltroAtivo(filtros) {
  const f = { ...FILTROS_VAZIOS, ...(filtros ?? {}) };
  return Object.keys(FILTROS_VAZIOS).some((chave) => String(f[chave] ?? "").trim() !== "");
}

/** Situação usada na exibição e no filtro, inclusive nas linhas sem cadastro. */
export function situacaoDaLinha(certidao) {
  return certidao?.naoCadastrada ? SITUACAO_NAO_CADASTRADA : situacaoEfetiva(certidao);
}

/** Nome + fantasia, para que a busca por fornecedor encontre os dois. */
function textoDoFornecedor(fornecedor) {
  return normalizarTexto(`${fornecedor?.razao_social ?? ""} ${fornecedor?.nome_fantasia ?? ""}`);
}

/**
 * Fornecedores ativos sem nenhuma certidão viram linhas "Não cadastrada".
 * Elas existem só na tela (id fabricado, sem gravação) e aparecem apenas quando
 * a pessoa pede por elas — a listagem padrão continua exatamente como era.
 */
export function linhasNaoCadastradas(certidoes, fornecedores) {
  const comCertidao = new Set((certidoes ?? []).map((c) => String(c.fornecedor_id)));
  return (fornecedores ?? [])
    .filter((f) => f?.ativo !== false && !comCertidao.has(String(f.id)))
    .map((f) => ({
      id: `nao-cadastrada-${f.id}`,
      naoCadastrada: true,
      fornecedor_id: f.id,
      fornecedores: f,
      tipos_certidao: null,
      numero_documento: null,
      data_emissao: null,
      data_vencimento: null,
      situacao: SITUACAO_NAO_CADASTRADA,
      arquivo_url: null,
    }));
}

function combinaAtalho(certidao, atalho) {
  // "Sem documento cadastrado" já definiu quais linhas entram na base.
  if (!atalho || atalho === "sem_documento") return true;

  // Recorte de prazo é leitura de regularidade: a emissão já superada por uma
  // mais nova do mesmo tipo não é pendência e fica fora.
  if (!ehVigenteNoTipo(certidao)) return false;

  const dias = diasAte(certidao?.data_vencimento);
  if (dias === null) return false;
  if (atalho === "vencidas") return dias < 0;

  const limite = ATALHOS.find((a) => a.id === atalho)?.dias;
  if (!limite) return true;
  return dias >= 0 && dias <= limite;
}

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

/**
 * Aplica todos os filtros preenchidos, sempre somando as condições (E).
 * `fornecedores` entra para dois papéis: dar a secretaria de cada certidão
 * (o vínculo vive no cadastro do fornecedor) e montar as linhas "Não
 * cadastrada" quando esse recorte é pedido.
 */
export function filtrarCertidoes(certidoes, fornecedores, filtros) {
  const f = { ...FILTROS_VAZIOS, ...(filtros ?? {}) };
  const porId = new Map((fornecedores ?? []).map((item) => [String(item.id), item]));

  const semCadastro = f.situacao === SITUACAO_NAO_CADASTRADA || f.atalho === "sem_documento";
  // A vigência é calculada sobre a lista COMPLETA (antes de qualquer filtro):
  // quem vale por tipo não pode depender do recorte que está na tela.
  const base = semCadastro
    ? linhasNaoCadastradas(certidoes, fornecedores)
    : anotarVigencia(certidoes ?? []);

  const nome = normalizarTexto(f.fornecedor);
  const cnpj = somenteDigitos(f.cnpj);

  return base.filter((certidao) => {
    const fornecedor = porId.get(String(certidao.fornecedor_id)) ?? certidao.fornecedores ?? null;

    if (nome && !textoDoFornecedor(fornecedor).includes(nome)) return false;
    if (cnpj && !somenteDigitos(fornecedor?.cpf_cnpj).includes(cnpj)) return false;
    if (f.secretariaId && String(fornecedor?.secretaria_id ?? "") !== String(f.secretariaId)) return false;
    if (f.tipoId && String(certidao.tipo_certidao_id ?? "") !== String(f.tipoId)) return false;
    if (f.situacao && !ehVigenteNoTipo(certidao)) return false;
    if (f.situacao && situacaoDaLinha(certidao) !== f.situacao) return false;
    if (!dentroDoPeriodo(certidao.data_emissao, f.emissaoInicial, f.emissaoFinal)) return false;
    if (!dentroDoPeriodo(certidao.data_vencimento, f.vencimentoInicial, f.vencimentoFinal)) return false;
    if (!combinaAtalho(certidao, f.atalho)) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

// Do mais urgente ao menos urgente, para a ordenação "Situação".
const PESO_SITUACAO = {
  vencida: 0,
  a_vencer: 1,
  em_renovacao: 2,
  valida: 3,
  sem_vencimento: 4,
  [SITUACAO_NAO_CADASTRADA]: 5,
};

function compararTexto(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

/** Certidão sem vencimento vai para o fim das duas ordenações por data. */
function compararVencimento(a, b, crescente) {
  const va = soData(a.data_vencimento);
  const vb = soData(b.data_vencimento);
  if (!va && !vb) return compararTexto(nomeFornecedor(a.fornecedores), nomeFornecedor(b.fornecedores));
  if (!va) return 1;
  if (!vb) return -1;
  if (va === vb) return String(b.criado_em ?? "").localeCompare(String(a.criado_em ?? ""));
  return crescente ? va.localeCompare(vb) : vb.localeCompare(va);
}

export function ordenarCertidoes(lista, ordenacao) {
  const copia = [...(lista ?? [])];
  const porFornecedor = (a, b) =>
    compararTexto(nomeFornecedor(a.fornecedores), nomeFornecedor(b.fornecedores));

  switch (ordenacao) {
    case "vencimento_distante":
      return copia.sort((a, b) => compararVencimento(a, b, false));
    case "fornecedor_az":
      return copia.sort((a, b) => porFornecedor(a, b) || compararVencimento(a, b, true));
    case "fornecedor_za":
      return copia.sort((a, b) => -porFornecedor(a, b) || compararVencimento(a, b, true));
    case "situacao":
      return copia.sort((a, b) => {
        const pa = PESO_SITUACAO[situacaoDaLinha(a)] ?? 9;
        const pb = PESO_SITUACAO[situacaoDaLinha(b)] ?? 9;
        return pa - pb || compararVencimento(a, b, true);
      });
    case "tipo":
      return copia.sort(
        (a, b) =>
          compararTexto(a.tipos_certidao?.nome, b.tipos_certidao?.nome) || porFornecedor(a, b),
      );
    default:
      return copia.sort((a, b) => compararVencimento(a, b, true));
  }
}

// ---------------------------------------------------------------------------
// Agrupamento por fornecedor
// ---------------------------------------------------------------------------

/**
 * Junta as certidões de cada fornecedor mantendo a ordenação escolhida: a
 * sequência dos grupos segue a primeira certidão de cada um, e dentro do grupo
 * a ordem da lista recebida é preservada.
 */
export function agruparPorFornecedor(lista) {
  const grupos = new Map();

  (lista ?? []).forEach((certidao) => {
    const chave = String(certidao.fornecedor_id ?? certidao.id);
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        id: chave,
        fornecedor: certidao.fornecedores ?? null,
        certidoes: [],
      });
    }
    grupos.get(chave).certidoes.push(certidao);
  });

  return [...grupos.values()];
}
