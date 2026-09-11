// Cadastro de SERVIDORES do município: as regras, sem banco e sem tela.
//
// ⚠️ SERVIDOR NÃO É FORNECEDOR. Fornecedor é quem VENDE para o município;
// servidor é quem TRABALHA no município -- efetivos, comissionados, secretários
// e agentes políticos. São dois cadastros distintos, e nenhum dos dois escreve
// no outro: nada neste arquivo lê, cria, altera ou duplica `fornecedores`, e o
// cadastro de fornecedores continua exatamente como está.
//
// O MESMO SERVIDOR APARECE NOS PROCESSOS EM DOIS PAPÉIS: como BENEFICIÁRIO da
// diária (quem viaja) e como SIGNATÁRIO do documento (o secretário que assina a
// requisição, o responsável pela secretaria). O papel é do processo, não do
// cadastro -- aqui a pessoa é cadastrada UMA VEZ e serve aos dois.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nada aqui debita conta, dá baixa em
// NF, altera saldo, marca fornecedor como pago, cria pagamento ou toca na
// Programação Diária. A "categoria para fins de diária" é uma SUGESTÃO de
// preenchimento do papel: ela ajuda a calcular o valor que o documento mostra,
// e não paga nada a ninguém.
//
// Este arquivo é carregado direto pelos testes, sem o resolvedor de módulos do
// Vite: só funções puras, nada de React e nada de supabase.

import { CATEGORIAS_CARGO, rotuloDaCategoria } from "./processosDiariasTabela.js";

/* -------------------------------------------------------------------------
 * Identificação
 * ---------------------------------------------------------------------- */

export const TABELA_SERVIDORES = "processos_servidores";

/**
 * A migration do cadastro de servidores e dos ajustes no documento.
 *
 * Cria `public.processos_servidores`, o módulo de permissão próprio dele, o CPF
 * único por dígitos e as colunas do vínculo (beneficiário e signatário) em
 * `public.processos_diarias`. Também retira a restrição do campo Transporte,
 * SEM dropar as colunas. Precisa ser rodada à mão no SQL Editor do Supabase.
 */
export const MIGRATION_SERVIDORES = "20260911230000_processos_servidores_e_ajustes_documento.sql";

export const AVISO_MIGRATION_SERVIDORES =
  `O cadastro de Servidores ainda não existe neste banco. Rode a migration ${MIGRATION_SERVIDORES} `
  + "no SQL Editor do Supabase para liberar a subaba. Ela só acrescenta -- nenhum outro módulo é "
  + "afetado, e o cadastro de fornecedores não é tocado.";

/**
 * As CATEGORIAS para fins de diária.
 *
 * São exatamente as colunas da Tabela de Diárias, e é de propósito: é o que
 * permite que escolher o servidor no cadastro já sugira a categoria certa, e
 * dela saia o valor da diária sem ninguém consultar tabela em papel. Uma lista
 * própria aqui viraria duas listas para manter e um cálculo que erra.
 */
export const CATEGORIAS_DIARIA = CATEGORIAS_CARGO;

export { rotuloDaCategoria };

/** Situação do cadastro. Inativar é a "exclusão" -- a linha nunca é apagada. */
export const SITUACOES_SERVIDOR = [
  { id: "ativo", rotulo: "Ativo" },
  { id: "inativo", rotulo: "Inativo" },
];

export function situacaoServidorInfo(situacao) {
  const id = texto(situacao) || "ativo";
  return SITUACOES_SERVIDOR.find((s) => s.id === id) ?? { id, rotulo: id };
}

/* -------------------------------------------------------------------------
 * Leitura de valores
 * ---------------------------------------------------------------------- */

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return valor === null || valor === undefined || String(valor).trim() === "";
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * SÓ OS DÍGITOS de um CPF.
 *
 * É esta leitura que faz "123.456.789-00", "12345678900" e "123 456 789 00"
 * serem o MESMO CPF -- na busca e, principalmente, na conferência de duplicado.
 * A pontuação não pode criar um segundo cadastro da mesma pessoa.
 */
export function somenteDigitos(valor) {
  return texto(valor).replace(/\D/g, "");
}

/** "123.456.789-00" a partir de onze dígitos; o que não tem onze sai como veio. */
export function cpfFormatado(valor) {
  const numeros = somenteDigitos(valor);
  if (numeros.length !== 11) return texto(valor);
  return `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6, 9)}-${numeros.slice(9)}`;
}

/* -------------------------------------------------------------------------
 * O formulário do cadastro
 * ---------------------------------------------------------------------- */

/** Os campos de texto do cadastro, na ordem em que a tela os mostra. */
export const CAMPOS_SERVIDOR = [
  "nome",
  "cpf",
  "endereco",
  "cargo",
  "lotacao",
  "categoria_diaria",
  "telefone",
  "email",
  // O NÚMERO do banco, do cadastro de Bancos: é ele que faz o documento sair
  // "001 — Banco do Brasil", como no modelo oficial.
  "banco_codigo",
  "banco",
  "agencia",
  "conta",
  "pix",
  "pix_titular",
];

export function servidorVazio() {
  const formulario = { id: null, solicitante_id: "", secretaria_id: "", situacao: "ativo" };
  CAMPOS_SERVIDOR.forEach((campo) => {
    formulario[campo] = "";
  });
  return formulario;
}

/** Linha do banco -> formulário. Nulo vira texto vazio, como o input espera. */
export function servidorParaFormulario(servidor) {
  const formulario = servidorVazio();
  if (!servidor) return formulario;

  formulario.id = servidor.id ?? null;
  formulario.solicitante_id = servidor.solicitante_id ?? "";
  formulario.secretaria_id = servidor.secretaria_id ?? "";
  formulario.situacao = texto(servidor.situacao) || "ativo";
  CAMPOS_SERVIDOR.forEach((campo) => {
    formulario[campo] = servidor[campo] ?? "";
  });
  return formulario;
}

/**
 * Formulário -> linha do banco.
 *
 * Texto em branco vai como null (o documento mostra "--", não uma string
 * vazia). `situacao` NÃO sai daqui: mudar a situação é inativar ou reativar, e
 * isso tem permissão própria e caminho próprio -- não acontece por edição.
 */
export function servidorParaBanco(formulario) {
  const base = formulario ?? {};
  const linha = {
    // A SOLICITANTE é o cadastro do módulo. `secretaria_id` (o cadastro
    // financeiro) continua sendo gravado como está para não perder o vínculo de
    // quem foi cadastrado antes deste cadastro existir.
    solicitante_id: vazio(base.solicitante_id) ? null : base.solicitante_id,
    secretaria_id: vazio(base.secretaria_id) ? null : base.secretaria_id,
  };
  CAMPOS_SERVIDOR.forEach((campo) => {
    linha[campo] = texto(base[campo]) === "" ? null : texto(base[campo]);
  });
  return linha;
}

/* -------------------------------------------------------------------------
 * CPF duplicado
 * ---------------------------------------------------------------------- */

/**
 * Quem JÁ USA aquele CPF, comparando SÓ OS DÍGITOS -- ou null.
 *
 * Compara também com servidor INATIVO: a pessoa não deixou de existir por estar
 * fora de exercício, e o caminho certo é reativar o cadastro dela, não criar um
 * segundo com o mesmo CPF. `ignorarId` é a própria pessoa, ao editar.
 *
 * A trava final é do banco (o índice único por dígitos da migration). Esta
 * função existe para a tela poder AVISAR ANTES, dizendo de quem é o CPF.
 */
export function cpfEmUso(servidores = [], cpf, { ignorarId = null } = {}) {
  const numeros = somenteDigitos(cpf);
  if (numeros === "") return null;
  return (
    (servidores ?? []).find(
      (servidor) =>
        servidor
        && String(servidor.id ?? "") !== String(ignorarId ?? "")
        && somenteDigitos(servidor.cpf) === numeros,
    ) ?? null
  );
}

/**
 * A mensagem do CPF repetido, DIZENDO QUEM JÁ O USA.
 *
 * "CPF já cadastrado" sozinho obriga quem preenche a sair procurando. Com o
 * nome, o cargo e a situação, a pessoa entende na hora se é a mesma pessoa (e
 * deve abrir o cadastro que existe) ou se digitou o número errado.
 */
export function mensagemDeCpfDuplicado(servidor) {
  if (!servidor) return "Este CPF já está cadastrado em outro servidor.";
  const nome = texto(servidor.nome) || "outro servidor";
  const cargo = texto(servidor.cargo);
  const inativo = texto(servidor.situacao) === "inativo";

  let mensagem = `O CPF ${cpfFormatado(servidor.cpf)} já está cadastrado para ${nome}`;
  if (cargo !== "") mensagem += ` (${cargo})`;
  mensagem += ".";
  if (inativo) {
    mensagem += " Esse cadastro está INATIVO -- se for a mesma pessoa, reative o cadastro existente"
      + " em vez de criar um novo.";
  } else {
    mensagem += " Se for a mesma pessoa, edite o cadastro existente em vez de criar um novo.";
  }
  return mensagem;
}

/* -------------------------------------------------------------------------
 * Validação
 * ---------------------------------------------------------------------- */

const LIMITE_CPF = 11;

/**
 * O que impede gravar o cadastro: `{ campo: "mensagem" }`, vazio quando passa.
 *
 * Curto de propósito. Nome, CPF e cargo são o mínimo para a pessoa aparecer num
 * documento oficial; matrícula, telefone e e-mail são OPCIONAIS, como pedido, e
 * ficar sem eles é normal.
 */
export function validarServidor(formulario, { servidores = [] } = {}) {
  const base = formulario ?? {};
  const erros = {};

  if (texto(base.nome) === "") erros.nome = "Informe o nome completo do servidor.";

  const numeros = somenteDigitos(base.cpf);
  if (numeros === "") erros.cpf = "Informe o CPF do servidor.";
  else if (numeros.length !== LIMITE_CPF) erros.cpf = "O CPF tem 11 dígitos.";
  else {
    const jaUsado = cpfEmUso(servidores, base.cpf, { ignorarId: base.id });
    if (jaUsado) erros.cpf = mensagemDeCpfDuplicado(jaUsado);
  }

  if (texto(base.cargo) === "") erros.cargo = "Informe o cargo ou a função.";
  // A secretaria SOLICITANTE é a exigida agora. Cadastro antigo, que só tem a
  // secretaria financeira gravada, continua válido e continua salvando.
  if (vazio(base.solicitante_id) && vazio(base.secretaria_id)) {
    erros.solicitante_id = "Escolha a secretaria solicitante.";
  }
  if (texto(base.categoria_diaria) === "") {
    erros.categoria_diaria = "Escolha a categoria para fins de diária.";
  }

  const email = texto(base.email);
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erros.email = "E-mail inválido.";
  }

  return erros;
}

export function primeiroErroDoServidor(erros = {}) {
  const chaves = Object.keys(erros ?? {});
  return chaves.length === 0 ? null : erros[chaves[0]];
}

/* -------------------------------------------------------------------------
 * Busca e filtros
 * ---------------------------------------------------------------------- */

/**
 * Busca rápida: nome, CPF, cargo e secretaria.
 *
 * Filtra ENQUANTO SE DIGITA, sem ida ao banco -- a lista da tela já está em
 * memória. O CPF é comparado por dígitos, então "12345678900" acha
 * "123.456.789-00" e vice-versa.
 */
export function servidorAtendeBusca(servidor, termo, secretarias = []) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;

  const numeros = somenteDigitos(termo);
  if (numeros !== "" && somenteDigitos(servidor?.cpf).includes(numeros)) return true;

  const campos = [
    servidor?.nome,
    servidor?.cpf,
    servidor?.cargo,
    servidor?.lotacao,
    nomeDaSecretariaDoServidor(servidor, secretarias),
    rotuloDaCategoria(servidor?.categoria_diaria),
  ];

  return campos.some((campo) => semAcento(campo).includes(procurado));
}

export function filtrosVaziosDeServidores() {
  return { secretaria: "", categoria: "", situacao: "" };
}

export function totalFiltrosDeServidoresAtivos(filtros = {}) {
  return Object.entries(filtrosVaziosDeServidores())
    .filter(([chave]) => texto(filtros?.[chave]) !== "").length;
}

/** Filtros recolhíveis: secretaria, categoria e situação. */
export function servidorAtendeFiltros(servidor, filtros = {}) {
  const f = filtros ?? {};
  if (texto(f.secretaria) !== "") {
    const escolhida = texto(f.secretaria);
    const daSolicitante = String(servidor?.solicitante_id ?? "");
    const daFinanceira = String(servidor?.secretaria_id ?? "");
    if (escolhida !== daSolicitante && escolhida !== daFinanceira) return false;
  }
  if (texto(f.categoria) !== "" && texto(servidor?.categoria_diaria) !== texto(f.categoria)) return false;
  if (texto(f.situacao) !== "" && (texto(servidor?.situacao) || "ativo") !== texto(f.situacao)) return false;
  return true;
}

export function filtrarServidores(servidores = [], { busca = "", filtros = {}, secretarias = [] } = {}) {
  return (servidores ?? [])
    .filter((servidor) => servidorAtendeBusca(servidor, busca, secretarias))
    .filter((servidor) => servidorAtendeFiltros(servidor, filtros));
}

/** Ativos primeiro e, dentro de cada grupo, em ordem de nome. */
export function ordenarServidores(servidores = []) {
  return [...(servidores ?? [])].sort((a, b) => {
    const ativoA = (texto(a?.situacao) || "ativo") === "ativo" ? 0 : 1;
    const ativoB = (texto(b?.situacao) || "ativo") === "ativo" ? 0 : 1;
    if (ativoA !== ativoB) return ativoA - ativoB;
    return semAcento(a?.nome).localeCompare(semAcento(b?.nome), "pt-BR");
  });
}

/**
 * O nome da secretaria do servidor.
 *
 * A SOLICITANTE vem primeiro, porque é o cadastro do módulo. A secretaria
 * financeira só é consultada para o cadastro ANTIGO, feito antes de a
 * solicitante existir: ele continua mostrando a secretaria dele, como sempre.
 */
export function nomeDaSecretariaDoServidor(servidor, secretarias = []) {
  const daSolicitante = texto(servidor?.solicitante?.nome);
  if (daSolicitante !== "") return daSolicitante;
  const embutida = texto(servidor?.secretaria?.nome);
  if (embutida !== "") return embutida;

  const lista = secretarias ?? [];
  const idSolicitante = String(servidor?.solicitante_id ?? "");
  if (idSolicitante !== "") {
    const achada = texto(lista.find((s) => String(s?.id) === idSolicitante)?.nome);
    if (achada !== "") return achada;
  }

  const id = String(servidor?.secretaria_id ?? "");
  if (id === "") return "";
  return texto(lista.find((s) => String(s?.id) === id)?.nome);
}

/** Só os ativos -- é a lista que o formulário da diária oferece para escolher. */
export function servidoresAtivos(servidores = []) {
  return (servidores ?? []).filter((s) => (texto(s?.situacao) || "ativo") === "ativo");
}

/* -------------------------------------------------------------------------
 * O servidor no documento: BENEFICIÁRIO
 * ---------------------------------------------------------------------- */

/**
 * Os dados que um servidor JÁ CADASTRADO leva para o documento da diária.
 *
 * Isto COPIA informação PARA O DOCUMENTO, num só sentido. Nada aqui escreve no
 * cadastro: o servidor não é criado, não é alterado e não é marcado como nada.
 * O que fica guardado no processo é o id dele (`beneficiario_servidor_id`), o
 * vínculo interno, mais o texto que o documento passa a ter por conta própria
 * -- e que pode ser ajustado ali sem mexer no nome, no CPF, no endereço, nos
 * dados bancários ou no PIX de ninguém.
 *
 * `diaria_categoria` vem junto porque é ela que SUGERE o valor da diária: quem
 * escolhe o beneficiário no cadastro já recebe a categoria certa e o valor
 * calculado pela Tabela de Diárias, sem consultar tabela em papel.
 */
export function dadosDoServidorParaDocumento(servidor) {
  if (!servidor) return { beneficiario_servidor_id: null };
  return {
    beneficiario_servidor_id: servidor.id ?? null,
    beneficiario_nome: texto(servidor.nome),
    beneficiario_cpf: texto(servidor.cpf),
    beneficiario_endereco: texto(servidor.endereco),
    beneficiario_cargo: texto(servidor.cargo),
    beneficiario_lotacao: texto(servidor.lotacao),
    solicitante_id: servidor.solicitante_id ?? "",
    secretaria_id: servidor.secretaria_id ?? "",
    diaria_categoria: texto(servidor.categoria_diaria),
    banco_codigo: texto(servidor.banco_codigo),
    banco: texto(servidor.banco),
    agencia: texto(servidor.agencia),
    conta: texto(servidor.conta),
    pix: texto(servidor.pix),
    titular: texto(servidor.pix_titular) || texto(servidor.nome),
  };
}

/** A categoria que o cadastro sugere para o cálculo -- "" quando não há. */
export function categoriaSugerida(servidor) {
  return texto(servidor?.categoria_diaria);
}

/**
 * Preenchimento MANUAL: a pessoa não está cadastrada e NÃO passa a estar.
 *
 * Soltar o vínculo é só apagar `beneficiario_servidor_id`. O texto já digitado
 * continua no documento -- quem preencheu à mão não perde o que escreveu ao
 * desfazer a busca -- e NENHUM servidor é criado no cadastro por causa disto.
 */
export function soltarVinculoDoServidor(formulario) {
  return { ...(formulario ?? {}), beneficiario_servidor_id: null };
}

/* -------------------------------------------------------------------------
 * O servidor no documento: SIGNATÁRIO
 * ---------------------------------------------------------------------- */

/**
 * Os SIGNATÁRIOS que um documento pode identificar a partir do cadastro.
 *
 * Hoje há um: o responsável pela secretaria, que assina a Requisição de
 * Diárias. A lista é a porta de entrada dos próximos -- a Solicitação de
 * Serviços/Materiais terá o solicitante e os seus signatários, e quando ela
 * chegar basta acrescentar as entradas aqui. (Esse módulo NÃO está sendo
 * implementado agora; só o cadastro já nasce reutilizável.)
 */
export const SIGNATARIOS_DO_DOCUMENTO = [
  {
    prefixo: "assinante_secretaria",
    rotulo: "Responsável pela Secretaria",
    ajuda: "Quem assina a requisição pela secretaria.",
  },
];

/** As colunas de um signatário no processo, dado o prefixo dele. */
export function camposDoSignatario(prefixo = "assinante_secretaria") {
  const base = texto(prefixo) || "assinante_secretaria";
  return {
    servidorId: `${base}_servidor_id`,
    nome: `${base}_nome`,
    cpf: `${base}_cpf`,
    cargo: `${base}_cargo`,
  };
}

/** Todas as colunas de signatário que o processo grava. */
export const CAMPOS_SIGNATARIOS = SIGNATARIOS_DO_DOCUMENTO.flatMap((s) =>
  Object.values(camposDoSignatario(s.prefixo)),
);

/**
 * Os dados de quem ASSINA, copiados do cadastro para o processo.
 *
 * GENÉRICO de propósito: o prefixo escolhe o signatário, então o mesmo código
 * serve para o responsável pela secretaria de hoje e para os signatários da
 * Solicitação de Serviços/Materiais de amanhã, sem reescrever nada.
 *
 * NOME, CPF E CARGO FICAM GRAVADOS NO PROCESSO, e isso é o congelamento: o
 * documento guarda quem assinou NAQUELE momento. Processo finalizado não tem
 * mais o conteúdo alterado, então mudar o cadastro do servidor depois -- outro
 * cargo, outra secretaria, inativação -- NÃO altera documento antigo.
 */
export function dadosDoSignatarioParaDocumento(servidor, { prefixo = "assinante_secretaria" } = {}) {
  const campos = camposDoSignatario(prefixo);
  if (!servidor) {
    return {
      [campos.servidorId]: null,
      [campos.nome]: "",
      [campos.cpf]: "",
      [campos.cargo]: "",
    };
  }
  return {
    [campos.servidorId]: servidor.id ?? null,
    [campos.nome]: texto(servidor.nome),
    [campos.cpf]: texto(servidor.cpf),
    [campos.cargo]: texto(servidor.cargo),
  };
}

/**
 * Solta o vínculo do signatário, PRESERVANDO o que o documento já diz.
 *
 * Igual ao beneficiário: o nome, o CPF e o cargo digitados continuam no
 * documento; só o ponteiro para o cadastro sai.
 */
export function soltarVinculoDoSignatario(formulario, { prefixo = "assinante_secretaria" } = {}) {
  const campos = camposDoSignatario(prefixo);
  return { ...(formulario ?? {}), [campos.servidorId]: null };
}

/** O que o documento imprime em uma linha de assinatura -- "" quando em branco. */
export function nomeDoSignatario(processo, prefixo = "assinante_secretaria") {
  return texto(processo?.[camposDoSignatario(prefixo).nome]);
}

/* -------------------------------------------------------------------------
 * Permissões
 * ---------------------------------------------------------------------- */

/**
 * A subaba SERVIDORES tem MÓDULO PRÓPRIO de permissão.
 *
 * É um cadastro, não é um processo: quem pode preencher uma diária não passa a
 * poder criar, editar ou inativar servidores do município. As quatro ações
 * pedidas cabem nas colunas que a Matriz de Permissões já tem, então é uma
 * linha só -- e INATIVAR ocupa a coluna de exclusão, porque inativar é a
 * exclusão deste cadastro.
 */
export const MODULO_SERVIDORES = "processos_servidores";

export const ACOES_SERVIDORES = [
  { chave: "visualizar", modulo: MODULO_SERVIDORES, coluna: "pode_visualizar", rotulo: "Visualizar" },
  { chave: "criar", modulo: MODULO_SERVIDORES, coluna: "pode_cadastrar", rotulo: "Criar" },
  { chave: "editar", modulo: MODULO_SERVIDORES, coluna: "pode_editar", rotulo: "Editar" },
  // Inativar é a exclusão LÓGICA: a linha nunca é apagada do banco.
  { chave: "inativar", modulo: MODULO_SERVIDORES, coluna: "pode_excluir", rotulo: "Inativar e reativar" },
];

export const PERMISSOES_SERVIDORES_NENHUMA = Object.freeze(
  Object.fromEntries(ACOES_SERVIDORES.map((acao) => [acao.chave, false])),
);

/**
 * As permissões da subaba a partir das linhas de `permissoes_efetivas`.
 *
 * Sem a linha do módulo, ninguém entra: permissão nova não se herda de módulo
 * existente. A migration semeia o padrão (acompanha Processos · Diárias) e quem
 * administra ajusta na Matriz de Permissões.
 */
export function resolverPermissoesServidores({ linhas = [] } = {}) {
  const linha = (linhas ?? []).filter(Boolean).find((l) => String(l.modulo) === MODULO_SERVIDORES) ?? null;
  if (!linha) return { ...PERMISSOES_SERVIDORES_NENHUMA };

  const resultado = {};
  ACOES_SERVIDORES.forEach((acao) => {
    resultado[acao.chave] = linha[acao.coluna] === true;
  });
  return resultado;
}

/** Quem não pode visualizar não vê a subaba no menu e não abre a rota. */
export function podeVerServidores(permissoes) {
  return permissoes?.visualizar === true;
}

/**
 * ESCOLHER servidor no formulário da diária exige só VER o cadastro.
 *
 * Preencher um documento é leitura do cadastro, não alteração dele: quem
 * monta a diária escolhe o beneficiário e o signatário sem poder criar, editar
 * ou inativar ninguém.
 */
export function podeEscolherServidor(permissoes) {
  return permissoes?.visualizar === true;
}

/** As ações disponíveis para um servidor, dada a permissão e a situação dele. */
export function acoesNoServidor(servidor, permissoes = {}) {
  const ativo = (texto(servidor?.situacao) || "ativo") === "ativo";
  return {
    abrir: permissoes.visualizar === true,
    editar: permissoes.editar === true,
    inativar: permissoes.inativar === true && ativo,
    reativar: permissoes.inativar === true && !ativo,
  };
}

/* -------------------------------------------------------------------------
 * Auditoria
 * ---------------------------------------------------------------------- */

/** As ações que a auditoria registra neste cadastro. */
export const ACOES_AUDITORIA_SERVIDORES = {
  criar: "criar_servidor",
  editar: "editar_servidor",
  inativar: "inativar_servidor",
  reativar: "reativar_servidor",
};

/** Os rótulos dos campos na trilha de auditoria, para o "antes e depois". */
export const ROTULOS_SERVIDOR = {
  nome: "Nome completo",
  cpf: "CPF",
  endereco: "Endereço",
  cargo: "Cargo/Função",
  solicitante_id: "Secretaria solicitante",
  secretaria_id: "Secretaria (cadastro financeiro)",
  lotacao: "Lotação",
  categoria_diaria: "Categoria para diária",
  telefone: "Telefone",
  email: "E-mail",
  banco_codigo: "Número do banco",
  banco: "Banco",
  agencia: "Agência",
  conta: "Conta",
  pix: "PIX",
  pix_titular: "Titular do PIX",
  situacao: "Situação",
  motivo_inativacao: "Motivo da inativação",
};

/**
 * O "antes e depois" de uma alteração, só com o que REALMENTE mudou.
 *
 * A auditoria guarda o valor anterior e o novo: é o que permite responder
 * "quem mudou o CPF deste servidor, e quando".
 */
export function diferencaDoServidor(anterior, novo) {
  const de = anterior ?? {};
  const para = novo ?? {};
  const mudancas = {};

  Object.keys(ROTULOS_SERVIDOR).forEach((campo) => {
    const antes = texto(de[campo]);
    const depois = texto(para[campo]);
    if (antes !== depois) mudancas[campo] = { de: antes, para: depois };
  });

  return mudancas;
}
