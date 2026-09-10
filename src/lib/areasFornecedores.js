// Áreas específicas dentro de Fornecedores: Patrocínios, Aluguéis e Bandas.
//
// REGRA FUNDAMENTAL: estas áreas NÃO são categorias nem tipo de fornecedor.
// Cada uma é um REGISTRO OPERACIONAL próprio, com a sua estrutura, que APONTA
// para um fornecedor JÁ CADASTRADO pelo id. O mesmo fornecedor pode ter dois
// patrocínios, um aluguel e três contratações de banda ao mesmo tempo, e
// continua sendo UM cadastro só. Não existe (e não deve existir) campo
// "categoria" ou "tipo" no cadastro do fornecedor.
//
// PAGO E SALDO SÃO CALCULADOS, NUNCA GRAVADOS. Quanto de um registro já foi
// pago é a soma do que as BAIXAS abateram das NFs vinculadas a ele, lida da
// mesma coluna que a aba de Baixas usa (`valores_em_aberto.valor_pago`) e pela
// mesma função (`valorBaixadoDaNota`, de lib/regrasBaixas). Um segundo controle
// de valor pago, paralelo ao das notas, divergiria do primeiro no primeiro
// estorno.
//
// A BAIXA NÃO ACONTECE AQUI. Este módulo não registra, não valida e não estorna
// baixa nenhuma: ele só LÊ o que a aba de Baixas gravou na NF. A baixa continua
// sendo exclusivamente por NF/processo, no fluxo que já existe.
//
// Tudo aqui é função pura, sem banco e sem tela, para que a mesma regra valha
// na listagem, na busca, no formulário e no teste automatizado. A camada de
// dados está em lib/areasFornecedoresDados.js.

import { centavos, valorBaixadoDaNota, valorDaNota } from "./regrasBaixas.js";
import {
  apelidoDoFornecedor,
  nomeExibicaoDoFornecedor,
  nomeOficialDoFornecedor,
} from "./nomesFornecedor.js";
import { paraNumeroMoeda } from "./moeda.js";

/** Nome do arquivo da migration que cria as tabelas destas áreas. */
export const MIGRATION_AREAS =
  "20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql";

/**
 * Recado de quando a migration ainda não foi rodada neste banco. A página
 * "Todos os Fornecedores" e todo o resto do sistema continuam funcionando
 * igual; só as três áreas dependem das tabelas criadas por ela.
 */
export const AVISO_MIGRATION_AREAS =
  "As tabelas destas áreas ainda não existem neste banco. Rode a migration " +
  `supabase/migrations/${MIGRATION_AREAS} no SQL Editor do Supabase e recarregue a página.`;

/**
 * Situação do registro: o ANDAMENTO dele, e nada mais.
 *
 * Nenhuma destas situações significa pagamento: programado ≠ pago e
 * aprovado ≠ pago continuam valendo. Quem diz quanto foi pago é a baixa da NF.
 */
export const SITUACOES_AREA = [
  { value: "previsto", label: "Previsto", cor: "#EA9A1E", bg: "#FFF6E5" },
  { value: "vigente", label: "Vigente", cor: "#2563EB", bg: "#EAF1FF" },
  { value: "concluido", label: "Concluído", cor: "#16A34A", bg: "#EAFBF0" },
  { value: "suspenso", label: "Suspenso", cor: "#64748B", bg: "#F1F5F9" },
  { value: "cancelado", label: "Cancelado", cor: "#DC2626", bg: "#FEF2F2" },
];

export function situacaoAreaInfo(valor) {
  return (
    SITUACOES_AREA.find((s) => s.value === valor) ?? {
      value: valor,
      label: valor ?? "--",
      cor: "#64748B",
      bg: "#F1F5F9",
    }
  );
}

/** Sugestões do campo "Objeto alugado" — texto livre, não catálogo. */
export const OBJETOS_ALUGUEL = ["Imóvel", "Veículo", "Equipamento", "Estrutura", "Outro"];

/* -------------------------------------------------------------------------
 * Os descritores das áreas
 *
 * Cada área declara a sua estrutura: campos do formulário, colunas da listagem
 * e filtros. Quem monta a tela lê daqui, então acrescentar uma área futura é
 * escrever um descritor novo (e a sua migration) -- sem reconstruir o módulo e
 * sem tocar nas três que já existem.
 * ---------------------------------------------------------------------- */

const CAMPOS_COMUNS_FIM = [
  { chave: "observacoes", rotulo: "Observações", tipo: "textoLongo" },
  { chave: "situacao", rotulo: "Situação", tipo: "situacao" },
];

export const AREAS = [
  {
    id: "patrocinios",
    rota: "patrocinios",
    rotulo: "Patrocínios",
    singular: "patrocínio",
    artigo: "o",
    // Permissões próprias: o módulo tem o mesmo nome da área.
    modulo: "patrocinios",
    tabela: "fornecedor_patrocinios",
    tabelaNotas: "fornecedor_patrocinio_notas",
    colunaRegistro: "patrocinio_id",
    rotuloNovo: "Novo Patrocínio",
    // Campo que identifica o registro na listagem e nas mensagens.
    campoTitulo: "nome",
    colunasProprias: "nome, evento",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome/Descrição do patrocínio",
        tipo: "texto",
        obrigatorio: true,
        exemplo: "Patrocínio Festa de São José",
      },
      { chave: "evento", rotulo: "Evento/Finalidade", tipo: "texto" },
      { chave: "secretaria_id", rotulo: "Secretaria", tipo: "secretaria" },
      { chave: "valor", rotulo: "Valor", tipo: "moeda" },
      ...CAMPOS_COMUNS_FIM,
    ],
    colunas: [
      { chave: "fornecedor", rotulo: "Fornecedor" },
      { chave: "apelido", rotulo: "Apelido" },
      { chave: "nome", rotulo: "Patrocínio" },
      { chave: "secretaria", rotulo: "Secretaria" },
      { chave: "valor", rotulo: "Valor", numerico: true },
      { chave: "pago", rotulo: "Pago", numerico: true },
      { chave: "saldo", rotulo: "Saldo", numerico: true },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "acoes", rotulo: "Ações" },
    ],
    camposDeBusca: ["fornecedor", "apelido", "nome", "evento", "secretaria"],
    filtros: [
      { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", campos: ["fornecedor"] },
      { chave: "apelido", rotulo: "Apelido", tipo: "texto", campos: ["apelido"] },
      { chave: "secretaria", rotulo: "Secretaria", tipo: "secretaria" },
      { chave: "situacao", rotulo: "Situação", tipo: "situacao" },
      { chave: "valor", rotulo: "Valor", tipo: "faixaValor" },
    ],
  },
  {
    id: "alugueis",
    rota: "alugueis",
    rotulo: "Aluguéis",
    singular: "aluguel",
    artigo: "o",
    modulo: "alugueis",
    tabela: "fornecedor_alugueis",
    tabelaNotas: "fornecedor_aluguel_notas",
    colunaRegistro: "aluguel_id",
    rotuloNovo: "Novo Aluguel",
    campoTitulo: "descricao",
    colunasProprias: "descricao, objeto, valor_mensal, data_inicio, data_fim",
    campos: [
      {
        chave: "descricao",
        rotulo: "Descrição do aluguel",
        tipo: "texto",
        obrigatorio: true,
        exemplo: "Aluguel de imóvel — Secretaria de Saúde",
      },
      {
        chave: "objeto",
        rotulo: "Objeto alugado",
        tipo: "sugestoes",
        sugestoes: OBJETOS_ALUGUEL,
        // Descritivo DESTE aluguel: texto livre, escrito por quem cadastra.
        // As sugestões são atalho de digitação, não catálogo — nada aqui vira
        // categoria de fornecedor.
        ajuda: "Descreve o que está alugado neste registro. Texto livre; as opções são apenas sugestões.",
      },
      { chave: "secretaria_id", rotulo: "Secretaria", tipo: "secretaria" },
      { chave: "valor", rotulo: "Valor", tipo: "moeda" },
      {
        chave: "valor_mensal",
        rotulo: "Valor mensal",
        tipo: "moeda",
        ajuda: "Preencha quando houver recorrência mensal.",
      },
      { chave: "data_inicio", rotulo: "Data de início", tipo: "data" },
      { chave: "data_fim", rotulo: "Data de término", tipo: "data", ajuda: "Opcional." },
      ...CAMPOS_COMUNS_FIM,
    ],
    colunas: [
      { chave: "fornecedor", rotulo: "Fornecedor" },
      { chave: "apelido", rotulo: "Apelido" },
      { chave: "objetoDescricao", rotulo: "Objeto/Descrição" },
      { chave: "secretaria", rotulo: "Secretaria" },
      { chave: "valor", rotulo: "Valor", numerico: true },
      { chave: "pago", rotulo: "Pago", numerico: true },
      { chave: "saldo", rotulo: "Saldo", numerico: true },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "acoes", rotulo: "Ações" },
    ],
    camposDeBusca: ["fornecedor", "apelido", "descricao", "objeto", "secretaria"],
    filtros: [
      { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", campos: ["fornecedor"] },
      { chave: "secretaria", rotulo: "Secretaria", tipo: "secretaria" },
      {
        chave: "objeto",
        rotulo: "Objeto / Descrição",
        tipo: "texto",
        campos: ["objeto", "descricao"],
      },
      { chave: "situacao", rotulo: "Situação", tipo: "situacao" },
      { chave: "valor", rotulo: "Valor", tipo: "faixaValor" },
    ],
  },
  {
    id: "bandas",
    rota: "bandas",
    rotulo: "Bandas",
    singular: "contratação",
    artigo: "a",
    modulo: "bandas",
    tabela: "fornecedor_bandas",
    tabelaNotas: "fornecedor_banda_notas",
    colunaRegistro: "banda_id",
    rotuloNovo: "Nova Contratação",
    campoTitulo: "banda",
    colunasProprias: "banda, evento, data_apresentacao",
    campos: [
      {
        chave: "banda",
        rotulo: "Nome da Banda/Artista",
        tipo: "texto",
        obrigatorio: true,
        exemplo: "Trio Pé de Serra",
        // O nome artístico NÃO precisa ser igual à razão social: o fornecedor
        // pode ser a empresa, a produtora, o empresário ou o representante.
        ajuda: "Não precisa ser igual à razão social do fornecedor.",
      },
      { chave: "evento", rotulo: "Evento", tipo: "texto" },
      {
        chave: "data_apresentacao",
        rotulo: "Data da apresentação",
        tipo: "data",
        ajuda: "Quando aplicável.",
      },
      { chave: "secretaria_id", rotulo: "Secretaria", tipo: "secretaria" },
      { chave: "valor", rotulo: "Valor da contratação", tipo: "moeda" },
      ...CAMPOS_COMUNS_FIM,
    ],
    // Banda/Artista é a PRIMEIRA coluna.
    colunas: [
      { chave: "banda", rotulo: "Banda/Artista" },
      { chave: "fornecedor", rotulo: "Fornecedor" },
      { chave: "apelido", rotulo: "Apelido" },
      { chave: "evento", rotulo: "Evento" },
      { chave: "secretaria", rotulo: "Secretaria" },
      { chave: "valor", rotulo: "Valor", numerico: true },
      { chave: "pago", rotulo: "Pago", numerico: true },
      { chave: "saldo", rotulo: "Saldo", numerico: true },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "acoes", rotulo: "Ações" },
    ],
    camposDeBusca: ["banda", "fornecedor", "apelido", "evento", "secretaria"],
    filtros: [
      { chave: "banda", rotulo: "Banda / Artista", tipo: "texto", campos: ["banda"] },
      { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", campos: ["fornecedor"] },
      { chave: "apelido", rotulo: "Apelido", tipo: "texto", campos: ["apelido"] },
      { chave: "evento", rotulo: "Evento", tipo: "texto", campos: ["evento"] },
      { chave: "secretaria", rotulo: "Secretaria", tipo: "secretaria" },
      { chave: "situacao", rotulo: "Situação", tipo: "situacao" },
      { chave: "valor", rotulo: "Valor", tipo: "faixaValor" },
    ],
  },
];

/** Os módulos de permissão das áreas, na ordem em que aparecem no submenu. */
export const MODULOS_AREAS = AREAS.map((area) => area.modulo);

/** A área da rota (`/fornecedores/bandas`), ou null para "Todos os Fornecedores". */
export function areaPorRota(rota) {
  const alvo = String(rota ?? "").trim().toLowerCase();
  if (alvo === "") return null;
  return AREAS.find((area) => area.rota === alvo) ?? null;
}

export function areaPorId(id) {
  return AREAS.find((area) => area.id === id) ?? null;
}

/* -------------------------------------------------------------------------
 * Leitura de um registro
 * ---------------------------------------------------------------------- */

function textoLimpo(valor) {
  return String(valor ?? "").trim();
}

function semAcento(texto) {
  return textoLimpo(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function somenteDigitos(texto) {
  return String(texto ?? "").replace(/\D+/g, "");
}

/** O cadastro do fornecedor vinculado ao registro (vem do join pelo id). */
export function cadastroDoRegistro(registro) {
  return registro?.fornecedores ?? registro?.fornecedor ?? null;
}

/** Nome do fornecedor como a listagem o mostra (apelido -> razão social). */
export function nomeDoFornecedorDoRegistro(registro) {
  return nomeExibicaoDoFornecedor(cadastroDoRegistro(registro));
}

/**
 * Texto de um campo do registro, para busca e filtro. É o único lugar que
 * traduz "chave do filtro" em "conteúdo", e por isso vale igual na busca
 * rápida, nos filtros e nos chips.
 */
export function textoDoCampo(registro, chave) {
  const cadastro = cadastroDoRegistro(registro);
  if (chave === "fornecedor") {
    return [
      nomeOficialDoFornecedor(cadastro),
      cadastro?.nome_fantasia,
      cadastro?.nome,
      cadastro?.cpf_cnpj,
    ]
      .map(textoLimpo)
      .filter((parte) => parte !== "")
      .join(" ");
  }
  if (chave === "apelido") return apelidoDoFornecedor(cadastro);
  if (chave === "secretaria") return textoLimpo(registro?.secretarias?.nome);
  return textoLimpo(registro?.[chave]);
}

/* -------------------------------------------------------------------------
 * Pago e Saldo -- calculados a partir das baixas das NFs vinculadas
 * ---------------------------------------------------------------------- */

/** As NFs/processos vinculados ao registro (lista vazia quando não há). */
export function notasDoRegistro(registro) {
  return Array.isArray(registro?.notas) ? registro.notas : [];
}

/**
 * `{ valor, pago, saldo, notas }` de um registro.
 *
 * `pago` é a soma do que as baixas abateram das NFs vinculadas -- lido pela
 * MESMA função que a aba de Baixas usa na linha da nota, de forma que os dois
 * números não possam divergir. Sem NF vinculada, `pago` é 0 e `saldo` é o valor
 * total do registro.
 *
 * `saldo` pode ficar negativo quando as baixas das NFs vinculadas passam do
 * valor do registro (registro cadastrado por menos do que as notas somam). É
 * informação, não erro: esconder isso ao zerar em `Math.max` faria o registro
 * mentir sobre o que foi pago.
 */
export function resumoFinanceiroDoRegistro(registro) {
  const notas = notasDoRegistro(registro);
  const valor = centavos(paraNumeroMoeda(registro?.valor));
  const pago = centavos(notas.reduce((soma, nota) => soma + valorBaixadoDaNota(nota), 0));
  return {
    valor,
    pago,
    saldo: centavos(valor - pago),
    notas: notas.length,
    // Total das NFs vinculadas: serve para explicar o Pago no detalhe do
    // registro, sem virar coluna da listagem.
    valorDasNotas: centavos(notas.reduce((soma, nota) => soma + valorDaNota(nota), 0)),
  };
}

/** Soma da listagem, para o rodapé do painel de filtros. */
export function totaisDaLista(registros = []) {
  return registros.reduce(
    (acumulado, registro) => {
      const resumo = resumoFinanceiroDoRegistro(registro);
      return {
        registros: acumulado.registros + 1,
        valor: centavos(acumulado.valor + resumo.valor),
        pago: centavos(acumulado.pago + resumo.pago),
        saldo: centavos(acumulado.saldo + resumo.saldo),
      };
    },
    { registros: 0, valor: 0, pago: 0, saldo: 0 },
  );
}

/* -------------------------------------------------------------------------
 * Busca rápida e filtros
 * ---------------------------------------------------------------------- */

/** Filtros vazios da área (o estado inicial e o "Limpar filtros"). */
export function filtrosVazios(area) {
  const vazios = {};
  (area?.filtros ?? []).forEach((filtro) => {
    if (filtro.tipo === "faixaValor") {
      vazios[`${filtro.chave}Min`] = "";
      vazios[`${filtro.chave}Max`] = "";
      return;
    }
    vazios[filtro.chave] = "";
  });
  return vazios;
}

/**
 * A busca rápida do topo: filtra enquanto se digita, olhando ao mesmo tempo
 * todos os campos que a área declarou. Acento e pontuação não importam, e um
 * trecho de CPF/CNPJ (3 dígitos ou mais) também encontra.
 */
export function registroAtendeBusca(area, registro, termo) {
  const busca = textoLimpo(termo);
  if (busca === "") return true;

  const digitos = somenteDigitos(busca);
  if (digitos.length >= 3) {
    const documento = somenteDigitos(cadastroDoRegistro(registro)?.cpf_cnpj);
    if (documento.includes(digitos)) return true;
  }

  const alvo = semAcento(busca);
  if (alvo === "") return true;
  return (area?.camposDeBusca ?? []).some((chave) =>
    semAcento(textoDoCampo(registro, chave)).includes(alvo),
  );
}

function atendeFiltro(area, registro, filtro, filtros) {
  if (filtro.tipo === "faixaValor") {
    const minimo = filtros[`${filtro.chave}Min`];
    const maximo = filtros[`${filtro.chave}Max`];
    const valor = paraNumeroMoeda(registro?.valor);
    if (textoLimpo(minimo) !== "" && valor < paraNumeroMoeda(minimo)) return false;
    if (textoLimpo(maximo) !== "" && valor > paraNumeroMoeda(maximo)) return false;
    return true;
  }

  const escolhido = textoLimpo(filtros[filtro.chave]);
  if (escolhido === "") return true;

  if (filtro.tipo === "secretaria") {
    return String(registro?.secretaria_id ?? "") === escolhido;
  }
  if (filtro.tipo === "situacao") {
    return String(registro?.situacao ?? "") === escolhido;
  }

  const alvo = semAcento(escolhido);
  return (filtro.campos ?? [filtro.chave]).some((chave) =>
    semAcento(textoDoCampo(registro, chave)).includes(alvo),
  );
}

/** Quantos filtros da área estão preenchidos (o contador do PainelFiltros). */
export function totalFiltrosAtivos(area, filtros = {}) {
  return (area?.filtros ?? []).reduce((total, filtro) => {
    if (filtro.tipo === "faixaValor") {
      const preenchido =
        textoLimpo(filtros[`${filtro.chave}Min`]) !== "" ||
        textoLimpo(filtros[`${filtro.chave}Max`]) !== "";
      return total + (preenchido ? 1 : 0);
    }
    return total + (textoLimpo(filtros[filtro.chave]) !== "" ? 1 : 0);
  }, 0);
}

/**
 * A listagem da área: busca rápida e filtros aplicados juntos, e a ordenação
 * de sempre. Registro inativado não aparece (é a exclusão lógica).
 */
export function filtrarRegistros(area, registros = [], { busca = "", filtros = {} } = {}) {
  const filtradas = (registros ?? []).filter((registro) => {
    if (!registroAtendeBusca(area, registro, busca)) return false;
    return (area?.filtros ?? []).every((filtro) => atendeFiltro(area, registro, filtro, filtros));
  });
  return ordenarRegistros(area, filtradas);
}

/**
 * Ordem da listagem: o campo que identifica o registro na área e, dentro dele,
 * o fornecedor. Em Bandas a Banda/Artista vem primeiro, como na tabela.
 */
export function ordenarRegistros(area, registros = []) {
  const titulo = area?.campoTitulo ?? "nome";
  const chaves = area?.id === "bandas" ? [titulo, "fornecedor"] : ["fornecedor", titulo];
  return [...(registros ?? [])].sort((a, b) => {
    for (const chave of chaves) {
      const comparacao = semAcento(textoDoCampo(a, chave)).localeCompare(
        semAcento(textoDoCampo(b, chave)),
        "pt-BR",
      );
      if (comparacao !== 0) return comparacao;
    }
    return String(a?.criado_em ?? "").localeCompare(String(b?.criado_em ?? ""));
  });
}

/* -------------------------------------------------------------------------
 * O formulário
 * ---------------------------------------------------------------------- */

/** Formulário em branco da área (fornecedor escolhido à parte, pela busca). */
export function registroVazio(area) {
  const vazio = { fornecedor_id: "" };
  (area?.campos ?? []).forEach((campo) => {
    if (campo.tipo === "situacao") {
      vazio[campo.chave] = "vigente";
      return;
    }
    if (campo.tipo === "moeda") {
      vazio[campo.chave] = "";
      return;
    }
    vazio[campo.chave] = "";
  });
  return vazio;
}

/** O formulário preenchido com um registro já gravado (para editar). */
export function registroParaFormulario(area, registro) {
  const formulario = registroVazio(area);
  formulario.fornecedor_id = String(registro?.fornecedor_id ?? "");
  (area?.campos ?? []).forEach((campo) => {
    const valor = registro?.[campo.chave];
    if (valor === null || valor === undefined) return;
    formulario[campo.chave] = campo.tipo === "data" ? String(valor).slice(0, 10) : valor;
  });
  return formulario;
}

/**
 * Confere o formulário antes de gravar, com a mensagem que a pessoa vai ler.
 *
 * O fornecedor é obrigatório e é SEMPRE um cadastro que já existe: nenhuma área
 * cadastra fornecedor. Vincular NF, ao contrário, nunca é obrigatório.
 */
export function validarRegistro(area, formulario = {}) {
  if (textoLimpo(formulario.fornecedor_id) === "") {
    return { ok: false, campo: "fornecedor_id", mensagem: "Escolha o fornecedor (um cadastro que já existe)." };
  }

  for (const campo of area?.campos ?? []) {
    if (campo.obrigatorio && textoLimpo(formulario[campo.chave]) === "") {
      return { ok: false, campo: campo.chave, mensagem: `Preencha ${campo.rotulo.toLowerCase()}.` };
    }
  }

  const situacao = textoLimpo(formulario.situacao);
  if (situacao !== "" && !SITUACOES_AREA.some((s) => s.value === situacao)) {
    return { ok: false, campo: "situacao", mensagem: "Escolha uma situação válida." };
  }

  const inicio = textoLimpo(formulario.data_inicio);
  const fim = textoLimpo(formulario.data_fim);
  if (inicio !== "" && fim !== "" && fim < inicio) {
    return { ok: false, campo: "data_fim", mensagem: "A data de término não pode ser anterior à de início." };
  }

  return { ok: true };
}

/**
 * O formulário pronto para o banco: só as colunas da área, valor como número e
 * campo vazio como null.
 *
 * Nenhuma coluna de valor pago é montada aqui, e não é esquecimento: Pago e
 * Saldo são calculados a partir das baixas das NFs vinculadas.
 */
export function registroParaBanco(area, formulario = {}) {
  const linha = { fornecedor_id: idParaBanco(formulario.fornecedor_id) };
  (area?.campos ?? []).forEach((campo) => {
    const bruto = formulario[campo.chave];
    if (campo.tipo === "moeda") {
      const numero = paraNumeroMoeda(bruto);
      linha[campo.chave] =
        campo.chave === "valor" ? centavos(numero) : textoLimpo(bruto) === "" ? null : centavos(numero);
      return;
    }
    if (campo.tipo === "secretaria") {
      linha[campo.chave] = textoLimpo(bruto) === "" ? null : idParaBanco(bruto);
      return;
    }
    if (campo.tipo === "situacao") {
      linha[campo.chave] = textoLimpo(bruto) === "" ? "vigente" : textoLimpo(bruto);
      return;
    }
    linha[campo.chave] = textoLimpo(bruto) === "" ? null : textoLimpo(bruto);
  });
  return linha;
}

/**
 * O id como a coluna dele espera: número quando a chave é inteira (é o caso de
 * fornecedores e secretarias neste banco), texto quando é uuid. O <select> e a
 * busca sempre entregam texto, e o tipo da chave varia de instalação para
 * instalação -- converter aqui evita depender de coerção no caminho.
 */
function idParaBanco(valor) {
  const texto = textoLimpo(valor);
  if (texto === "") return null;
  return /^\d+$/.test(texto) ? Number(texto) : texto;
}

/**
 * Antes/Depois para a auditoria: só o que mudou, com o rótulo que a pessoa lê
 * na tela. Devolve `null` quando nada mudou.
 */
export function diferencaParaAuditoria(area, anterior = {}, novo = {}) {
  const antes = {};
  const depois = {};
  let mudou = false;

  const comparaveis = ["fornecedor_id", ...(area?.campos ?? []).map((campo) => campo.chave)];
  comparaveis.forEach((chave) => {
    const de = anterior?.[chave] ?? null;
    const para = novo?.[chave] ?? null;
    if (String(de ?? "") === String(para ?? "")) return;
    antes[chave] = de;
    depois[chave] = para;
    mudou = true;
  });

  return mudou ? { antes, depois } : null;
}

/** Como o registro é identificado na trilha de auditoria e nas mensagens. */
export function identificacaoDoRegistro(area, registro) {
  const titulo = textoLimpo(registro?.[area?.campoTitulo]) || "(sem nome)";
  const fornecedor = nomeOficialDoFornecedor(cadastroDoRegistro(registro));
  return `${area?.rotulo ?? ""} · ${titulo} — ${fornecedor}`;
}

/* -------------------------------------------------------------------------
 * Permissões próprias de cada área
 *
 * Cada área tem o seu módulo na Matriz de Permissões, com as quatro ações
 * abaixo. Nenhuma permissão que já existia muda de significado: as áreas só
 * acrescentam módulos.
 * ---------------------------------------------------------------------- */

export const ACOES_AREA = [
  { chave: "visualizar", coluna: "pode_visualizar", rotulo: "Visualizar" },
  { chave: "criar", coluna: "pode_cadastrar", rotulo: "Criar" },
  { chave: "editar", coluna: "pode_editar", rotulo: "Editar" },
  // "Inativar" é a exclusão lógica desta área; o registro nunca é apagado.
  { chave: "inativar", coluna: "pode_excluir", rotulo: "Inativar" },
];

export const PERMISSOES_AREA_NENHUMA = Object.freeze({
  visualizar: false,
  criar: false,
  editar: false,
  inativar: false,
});

/**
 * As permissões de uma área a partir da linha de `permissoes_efetivas`.
 *
 * Quando o módulo da área ainda NÃO tem linha nenhuma — banco em que a
 * migration desta parte não foi rodada, ou perfil criado antes dela — vale a
 * permissão que a pessoa já tem no módulo 'fornecedores'. As áreas vivem dentro
 * de Fornecedores, então herdar dele é o comportamento previsível; o que não
 * pode acontecer é alguém sem acesso a Fornecedores ganhar acesso por aqui.
 *
 * Herança só na AUSÊNCIA da linha. Uma linha existente com tudo em falso é uma
 * decisão de quem administra, e é respeitada como negativa.
 */
export function permissoesDaLinha(linha, linhaFornecedores = null) {
  const origem = linha ?? linhaFornecedores;
  if (!origem) return { ...PERMISSOES_AREA_NENHUMA };
  const resultado = {};
  ACOES_AREA.forEach((acao) => {
    resultado[acao.chave] = origem[acao.coluna] === true;
  });
  return resultado;
}

/**
 * Permissões das três áreas de uma vez: `{ patrocinios, alugueis, bandas }`.
 *
 * `linhas` são as linhas de `permissoes_efetivas` do usuário (os módulos das
 * áreas e o de 'fornecedores', lidos na mesma consulta).
 */
export function resolverPermissoesAreas({ linhas = [] } = {}) {
  const porModulo = new Map(
    (linhas ?? []).filter(Boolean).map((linha) => [String(linha.modulo), linha]),
  );
  const fornecedores = porModulo.get("fornecedores") ?? null;
  const resultado = {};
  AREAS.forEach((area) => {
    resultado[area.id] = permissoesDaLinha(porModulo.get(area.modulo) ?? null, fornecedores);
  });
  return resultado;
}

/** As áreas que a pessoa pode ver — quem não tem visualizar não vê o item dela. */
export function areasVisiveis(permissoes = {}) {
  return AREAS.filter((area) => permissoes?.[area.id]?.visualizar === true);
}
