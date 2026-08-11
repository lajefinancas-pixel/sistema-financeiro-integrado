// Camada de dados da tela de Configurações (tabela public.configuracoes_sistema,
// criada pela migration 20260811140000_configuracoes_sistema.sql).
//
// A tabela é chave-valor: cada categoria da tela grava UMA linha, com o conteúdo
// inteiro em jsonb. Ler e gravar aqui passa pela RLS, que exige pode_visualizar
// (leitura) e pode_editar (gravação) no módulo 'administracao'.
//
// Nenhuma função deste arquivo lê, escreve ou expõe senha de usuário: a listagem
// de usuários traz apenas identificação, cargo, perfil e situação.

import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";
import { emailValido } from "./usuariosEquipe";
import { buscarPaginado } from "./saldosContasDados";

const TABELA = "configuracoes_sistema";

/** Bucket público da logomarca (criado pela mesma migration). */
export const BUCKET_CONFIGURACOES = "configuracoes";

export const CHAVE_GERAL = "geral";
export const CHAVE_SEGURANCA = "seguranca";
export const CHAVE_TRIBUTARIO = "tributario";

/** Categorias da navegação lateral da tela. */
export const CATEGORIAS = [
  { id: "geral", label: "Geral", descricao: "Identificação da instituição e do sistema", pronta: true },
  {
    id: "usuarios-seguranca",
    label: "Usuários e Segurança",
    descricao: "Acessos, política de senha e situação dos usuários",
    pronta: true,
  },
  {
    id: "financeiro",
    label: "Financeiro",
    descricao: "Formato dos valores, bancos utilizados e secretarias",
    pronta: true,
  },
  {
    id: "fornecedores",
    label: "Fornecedores",
    descricao: "Tipos e situações usados nos cadastros",
    pronta: true,
  },
  { id: "tributario", label: "Tributário", descricao: "Alíquotas de ISS e IRPJ", pronta: true },
  { id: "relatorios-impressao", label: "Relatórios e Impressão", descricao: "Cabeçalhos, marca d'água e formatos" },
  { id: "notificacoes", label: "Notificações", descricao: "Avisos por e-mail e alertas do sistema" },
  { id: "backup", label: "Backup", descricao: "Rotina de cópias e exportação de dados" },
  { id: "aparencia", label: "Aparência", descricao: "Cores, densidade e preferências visuais" },
  { id: "sistema", label: "Sistema", descricao: "Informações técnicas e ferramentas de conferência" },
];

export const CATEGORIA_PADRAO = CATEGORIAS[0].id;

export function categoriaValida(id) {
  return CATEGORIAS.some((c) => c.id === id) ? id : CATEGORIA_PADRAO;
}

/* -------------------------------------------------------------------------
 * Valores padrão de cada chave
 * ---------------------------------------------------------------------- */

export const GERAL_PADRAO = {
  nome_instituicao: "",
  nome_sistema: "",
  logo_url: null,
  cnpj: "",
  telefone: "",
  email: "",
  endereco: "",
};

export const SEGURANCA_PADRAO = {
  sessao_minutos: 480,
  tentativas_bloqueio: 5,
};

/**
 * Formato monetário do sistema. É fixo e aparece na tela apenas para
 * conferência: todo valor exibido passa por lib/moeda.js, que formata em real
 * brasileiro com duas casas. Mudar isso não é uma configuração — seria mudar a
 * moeda do sistema inteiro, inclusive dos registros já gravados.
 */
export const FORMATO_MONETARIO = { simbolo: "R$", casas_decimais: 2 };

/**
 * Parâmetros tributários. São referências de alíquota para os lançamentos
 * feitos daqui em diante — nenhum pagamento, retenção ou valor já gravado é
 * recalculado quando estes números mudam.
 */
export const TRIBUTARIO_PADRAO = {
  aliquota_iss_padrao: 0,
  aliquota_ir_padrao: 0,
};

// Faixa aceita nas alíquotas (percentual, com até duas casas decimais).
export const LIMITE_ALIQUOTA = { minimo: 0, maximo: 100 };

// Faixas aceitas na política de senha/sessão.
export const LIMITE_SESSAO = { minimo: 5, maximo: 1440 };
export const LIMITE_TENTATIVAS = { minimo: 1, maximo: 20 };

/** Tamanho máximo da logomarca enviada ao Storage. */
export const LIMITE_LOGO_MB = 2;

/* -------------------------------------------------------------------------
 * Máscaras e validações dos campos de identificação
 * ---------------------------------------------------------------------- */

function digitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/** "12345678000195" -> "12.345.678/0001-95" (formata o que já foi digitado). */
export function formatarCNPJ(valor) {
  const numeros = digitos(valor).slice(0, 14);
  return numeros
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** "11987654321" -> "(11) 98765-4321". Aceita fixo (10) e celular (11). */
export function formatarTelefone(valor) {
  const numeros = digitos(valor).slice(0, 11);
  if (numeros.length <= 2) return numeros;
  if (numeros.length <= 6) return `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
  if (numeros.length <= 10) return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
  return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
}

/** CNPJ com os dois dígitos verificadores corretos. */
export function cnpjValido(valor) {
  const numeros = digitos(valor);
  if (numeros.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(numeros)) return false;

  const digitoVerificador = (base) => {
    let peso = base.length === 12 ? 5 : 6;
    let soma = 0;
    for (const caractere of base) {
      soma += Number(caractere) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = numeros.slice(0, 12);
  return (
    digitoVerificador(base) === Number(numeros[12]) &&
    digitoVerificador(base + numeros[12]) === Number(numeros[13])
  );
}

/** Telefone com DDD: 10 dígitos (fixo) ou 11 (celular). */
export function telefoneValido(valor) {
  const total = digitos(valor).length;
  return total === 10 || total === 11;
}

function inteiroNaFaixa(valor, faixa) {
  const numero = Number(String(valor ?? "").trim());
  if (!Number.isInteger(numero)) return null;
  if (numero < faixa.minimo || numero > faixa.maximo) return null;
  return numero;
}

/**
 * Percentual digitado ("5", "5,5" ou "5.5") como número, ou null quando o texto
 * não é uma alíquota aceitável. Campo vazio vale zero: "sem alíquota padrão".
 */
export function aliquotaNumero(valor) {
  const texto = String(valor ?? "").trim().replace(",", ".");
  if (texto === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  if (numero < LIMITE_ALIQUOTA.minimo || numero > LIMITE_ALIQUOTA.maximo) return null;
  return numero;
}

/** 5 -> "5%", 5.5 -> "5,5%", 0 -> "Não definida". */
export function textoAliquota(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return "Não definida";
  return `${numero.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

function comPadrao(padrao, valor) {
  const gravado = valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
  return { ...padrao, ...gravado };
}

/**
 * Nome de quem salvou cada configuração. Consulta separada e tolerante: se a
 * leitura de usuários falhar, o rodapé apenas deixa de mostrar o nome.
 */
async function nomesDosAutores(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return {};
  try {
    const { data, error } = await supabase.from("usuarios").select("id, nome_completo").in("id", unicos);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((u) => [u.id, u.nome_completo]));
  } catch {
    return {};
  }
}

/**
 * Configurações de Geral, de Segurança e do Tributário, já preenchidas com os
 * valores padrão onde o banco ainda não tem nada.
 *
 * Devolve { geral, seguranca, tributario, autoria } — autoria traz, por chave,
 * { atualizado_em, autor } para o rodapé "última alteração".
 */
export async function carregarConfiguracoes() {
  const { data, error } = await supabase
    .from(TABELA)
    .select("chave, valor, atualizado_em, atualizado_por")
    .in("chave", [CHAVE_GERAL, CHAVE_SEGURANCA, CHAVE_TRIBUTARIO]);

  if (error) {
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível carregar as configurações do sistema."));
  }

  const linhas = data ?? [];
  const porChave = Object.fromEntries(linhas.map((linha) => [linha.chave, linha]));
  const autores = await nomesDosAutores(linhas.map((linha) => linha.atualizado_por));

  const autoria = Object.fromEntries(
    linhas.map((linha) => [
      linha.chave,
      { atualizado_em: linha.atualizado_em ?? null, autor: autores[linha.atualizado_por] ?? null },
    ])
  );

  return {
    geral: comPadrao(GERAL_PADRAO, porChave[CHAVE_GERAL]?.valor),
    seguranca: comPadrao(SEGURANCA_PADRAO, porChave[CHAVE_SEGURANCA]?.valor),
    tributario: comPadrao(TRIBUTARIO_PADRAO, porChave[CHAVE_TRIBUTARIO]?.valor),
    autoria,
  };
}

/** "11/08/2026 às 14:32" — vazio quando a configuração nunca foi salva. */
export function textoUltimaAlteracao(info) {
  const quando = info?.atualizado_em;
  if (!quando) return "";
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "";
  const formatado = data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const texto = `Última alteração em ${formatado.replace(", ", " às ")}`;
  return info?.autor ? `${texto} por ${info.autor}` : texto;
}

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

/** Grava (ou cria) a linha da chave informada. atualizado_em/por vêm do banco. */
async function gravar(chave, valor) {
  const { error } = await supabase.from(TABELA).upsert({ chave, valor }, { onConflict: "chave" });
  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "42501"
          ? "Você não tem permissão para alterar as configurações do sistema."
          : "Não foi possível salvar as configurações. Tente novamente."
      )
    );
  }
}

/**
 * Categoria Geral. Valida o que foi preenchido (CNPJ, telefone e e-mail são
 * opcionais, mas quando informados precisam estar corretos) e grava a chave
 * 'geral' inteira.
 */
export async function salvarGeral(valores) {
  const nomeInstituicao = String(valores?.nome_instituicao ?? "").trim();
  const nomeSistema = String(valores?.nome_sistema ?? "").trim();
  const cnpj = String(valores?.cnpj ?? "").trim();
  const telefone = String(valores?.telefone ?? "").trim();
  const email = String(valores?.email ?? "").trim().toLowerCase();
  const endereco = String(valores?.endereco ?? "").trim();

  if (!nomeInstituicao) throw erroAmigavel("Informe o nome da instituição.");
  if (!nomeSistema) throw erroAmigavel("Informe o nome do sistema.");
  if (cnpj !== "" && !cnpjValido(cnpj)) throw erroAmigavel("O CNPJ informado não é válido. Confira os números.");
  if (telefone !== "" && !telefoneValido(telefone)) {
    throw erroAmigavel("Informe o telefone com DDD, por exemplo (11) 98765-4321.");
  }
  if (email !== "" && !emailValido(email)) throw erroAmigavel("Informe um e-mail institucional válido.");

  const pronto = {
    nome_instituicao: nomeInstituicao,
    nome_sistema: nomeSistema,
    logo_url: valores?.logo_url ?? null,
    cnpj: cnpj === "" ? "" : formatarCNPJ(cnpj),
    telefone: telefone === "" ? "" : formatarTelefone(telefone),
    email,
    endereco,
  };

  await gravar(CHAVE_GERAL, pronto);
  return pronto;
}

/** Categoria Usuários e Segurança: tempo de sessão e bloqueio por tentativas. */
export async function salvarSeguranca(valores) {
  const sessao = inteiroNaFaixa(valores?.sessao_minutos, LIMITE_SESSAO);
  if (sessao === null) {
    throw erroAmigavel(
      `Informe o tempo máximo de sessão em minutos, entre ${LIMITE_SESSAO.minimo} e ${LIMITE_SESSAO.maximo}.`
    );
  }

  const tentativas = inteiroNaFaixa(valores?.tentativas_bloqueio, LIMITE_TENTATIVAS);
  if (tentativas === null) {
    throw erroAmigavel(
      `Informe quantas tentativas incorretas bloqueiam o acesso, entre ${LIMITE_TENTATIVAS.minimo} e ${LIMITE_TENTATIVAS.maximo}.`
    );
  }

  const pronto = { sessao_minutos: sessao, tentativas_bloqueio: tentativas };
  await gravar(CHAVE_SEGURANCA, pronto);
  return pronto;
}

/**
 * Categoria Tributário: alíquotas de referência de ISS e IRPJ.
 *
 * Gravar aqui NÃO recalcula nada: pagamentos, retenções e valores já lançados
 * continuam exatamente como estão. O número novo passa a valer só para o que
 * for informado a partir de agora.
 */
export async function salvarTributario(valores) {
  const iss = aliquotaNumero(valores?.aliquota_iss_padrao);
  if (iss === null) {
    throw erroAmigavel(
      `Informe a alíquota de ISS em percentual, entre ${LIMITE_ALIQUOTA.minimo} e ${LIMITE_ALIQUOTA.maximo}, com até duas casas decimais.`
    );
  }

  const ir = aliquotaNumero(valores?.aliquota_ir_padrao);
  if (ir === null) {
    throw erroAmigavel(
      `Informe a alíquota de IRPJ em percentual, entre ${LIMITE_ALIQUOTA.minimo} e ${LIMITE_ALIQUOTA.maximo}, com até duas casas decimais.`
    );
  }

  const pronto = { aliquota_iss_padrao: iss, aliquota_ir_padrao: ir };
  await gravar(CHAVE_TRIBUTARIO, pronto);
  return pronto;
}

/* -------------------------------------------------------------------------
 * Logomarca
 * ---------------------------------------------------------------------- *//** Envia a logomarca para o Storage e devolve a URL pública. */
export async function enviarLogomarca(arquivo) {
  if (!arquivo) throw erroAmigavel("Escolha uma imagem para a logomarca.");
  if (!/^image\//.test(arquivo.type ?? "")) {
    throw erroAmigavel("A logomarca precisa ser uma imagem (JPG, PNG ou SVG).");
  }
  if (arquivo.size > LIMITE_LOGO_MB * 1024 * 1024) {
    throw erroAmigavel(`A imagem é grande demais. Envie um arquivo de até ${LIMITE_LOGO_MB} MB.`);
  }

  const extensao = (arquivo.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aleatorio = Math.random().toString(36).slice(2, 8);
  const caminho = `logomarca/${Date.now()}-${aleatorio}.${extensao || "png"}`;

  const { error } = await supabase.storage.from(BUCKET_CONFIGURACOES).upload(caminho, arquivo, {
    cacheControl: "3600",
    upsert: false,
    contentType: arquivo.type || undefined,
  });
  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(error, "Não foi possível enviar a logomarca. Tente outra imagem.")
    );
  }

  const { data } = supabase.storage.from(BUCKET_CONFIGURACOES).getPublicUrl(caminho);
  return data.publicUrl;
}

/* -------------------------------------------------------------------------
 * Usuários (somente leitura)
 * ---------------------------------------------------------------------- */

/**
 * Usuários ativos e bloqueados, para o panorama somente-leitura da categoria
 * Usuários e Segurança. Cadastrar, editar e desbloquear continua sendo feito em
 * Equipe > Usuários — esta lista só mostra a situação atual.
 *
 * Seleciona apenas identificação, cargo, perfil e situação: nenhum dado de
 * senha é lido ou exibido.
 */
export async function listarUsuariosPorSituacao() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome_completo, email, cargo, status, perfis_acesso ( nome )")
    .in("status", ["ativo", "bloqueado"])
    .order("nome_completo", { ascending: true });

  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(error, "Não foi possível carregar a situação dos usuários agora.")
    );
  }

  const usuarios = data ?? [];
  return {
    ativos: usuarios.filter((u) => u.status === "ativo"),
    bloqueados: usuarios.filter((u) => u.status === "bloqueado"),
  };
}

/* -------------------------------------------------------------------------
 * Financeiro — bancos utilizados (somente leitura)
 * ---------------------------------------------------------------------- */

/**
 * Bancos do sistema com quantas contas bancárias cada um tem.
 *
 * A lista é apenas o retrato do que já existe: cadastrar, renomear ou remover
 * banco continua sendo feito ao cadastrar a conta, em Saldos das Contas. Esta
 * tela não grava nada em `bancos` nem em `contas_bancarias`.
 *
 * @returns [{ id, nome, contas, contasAtivas }] em ordem alfabética
 */
export async function listarBancosEmUso() {
  const { data: bancos, error } = await supabase.from("bancos").select("id, nome").order("nome");
  if (error) {
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível carregar os bancos cadastrados."));
  }

  const contas = await buscarPaginado(() =>
    supabase.from("contas_bancarias").select("id, banco_id, ativo")
  );

  const total = new Map();
  const ativas = new Map();
  for (const conta of contas) {
    const chave = String(conta.banco_id ?? "");
    total.set(chave, (total.get(chave) ?? 0) + 1);
    if (conta.ativo !== false) ativas.set(chave, (ativas.get(chave) ?? 0) + 1);
  }

  return (bancos ?? []).map((banco) => ({
    id: banco.id,
    nome: banco.nome,
    contas: total.get(String(banco.id)) ?? 0,
    contasAtivas: ativas.get(String(banco.id)) ?? 0,
  }));
}

/* -------------------------------------------------------------------------
 * Financeiro — secretarias
 * ---------------------------------------------------------------------- */

/** Limite de caracteres do nome da secretaria. */
export const LIMITE_NOME_SECRETARIA = 120;

function nomeDeSecretaria(valor) {
  const nome = String(valor ?? "").trim().replace(/\s+/g, " ");
  if (nome === "") throw erroAmigavel("Informe o nome da secretaria.");
  if (nome.length > LIMITE_NOME_SECRETARIA) {
    throw erroAmigavel(`O nome da secretaria pode ter no máximo ${LIMITE_NOME_SECRETARIA} caracteres.`);
  }
  return nome;
}

/**
 * Quantos registros apontam para cada secretaria.
 *
 * Contas e fornecedores são contados inteiros (ativos e inativos): um cadastro
 * desativado continua sendo um vínculo, e apagar a secretaria dele deixaria o
 * registro órfão. Quando uma das contagens não puder ser lida, ela volta como
 * `null` — e a tela trata "não sei" como "não pode excluir".
 */
async function vinculosDasSecretarias() {
  async function contarPor(tabela) {
    try {
      const linhas = await buscarPaginado(() => supabase.from(tabela).select("secretaria_id"));
      const mapa = new Map();
      for (const linha of linhas) {
        const chave = String(linha.secretaria_id ?? "");
        if (chave === "" || chave === "null") continue;
        mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
      }
      return mapa;
    } catch {
      return null;
    }
  }

  const [contas, fornecedores] = await Promise.all([
    contarPor("contas_bancarias"),
    contarPor("fornecedores"),
  ]);
  return { contas, fornecedores };
}

/**
 * Secretarias cadastradas (ativas e inativas) com os vínculos de cada uma.
 *
 * `podeExcluir` já vem resolvido: só é verdadeiro quando as duas contagens
 * foram lidas com sucesso e as duas estão zeradas.
 *
 * @returns [{ id, nome, ativo, contas, fornecedores, podeExcluir, motivoBloqueio }]
 */
export async function listarSecretarias() {
  const { data, error } = await supabase
    .from("secretarias")
    .select("id, nome, ativo")
    .order("nome");
  if (error) {
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível carregar as secretarias."));
  }

  const vinculos = await vinculosDasSecretarias();

  return (data ?? []).map((secretaria) => {
    const chave = String(secretaria.id);
    const contas = vinculos.contas?.get(chave) ?? (vinculos.contas ? 0 : null);
    const fornecedores = vinculos.fornecedores?.get(chave) ?? (vinculos.fornecedores ? 0 : null);
    return {
      id: secretaria.id,
      nome: secretaria.nome,
      ativo: secretaria.ativo !== false,
      contas,
      fornecedores,
      podeExcluir: contas === 0 && fornecedores === 0,
      motivoBloqueio: motivoDeBloqueio({ contas, fornecedores }),
    };
  });
}

/** Frase que explica por que a secretaria não pode ser excluída (ou null). */
export function motivoDeBloqueio({ contas, fornecedores }) {
  if (contas === null || fornecedores === null) {
    return "Não foi possível conferir se esta secretaria tem contas ou fornecedores vinculados, então a exclusão fica bloqueada por segurança.";
  }
  if (contas === 0 && fornecedores === 0) return null;

  const partes = [];
  if (contas > 0) partes.push(`${contas} ${contas === 1 ? "conta bancária" : "contas bancárias"}`);
  if (fornecedores > 0) {
    partes.push(`${fornecedores} ${fornecedores === 1 ? "fornecedor" : "fornecedores"}`);
  }
  return `Esta secretaria não pode ser excluída porque já possui ${partes.join(
    " e "
  )} vinculada(s). Transfira ou remova esses registros antes de excluí-la — ou marque a secretaria como inativa.`;
}

/** Já existe outra secretaria com este nome? (comparação sem diferenciar maiúsculas) */
async function nomeJaUsado(nome, ignorarId = null) {
  const { data, error } = await supabase.from("secretarias").select("id").ilike("nome", nome);
  if (error) return false; // conferência de conveniência: não impede o cadastro
  return (data ?? []).some((linha) => String(linha.id) !== String(ignorarId ?? ""));
}

/** Cadastra uma secretaria nova. */
export async function criarSecretaria(nomeBruto, { ativo = true } = {}) {
  const nome = nomeDeSecretaria(nomeBruto);
  if (await nomeJaUsado(nome)) {
    throw erroAmigavel(`Já existe uma secretaria chamada "${nome}".`);
  }

  const { data, error } = await supabase
    .from("secretarias")
    .insert({ nome, ativo: ativo !== false })
    .select("id, nome, ativo")
    .single();
  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "42501"
          ? "Você não tem permissão para cadastrar secretarias."
          : "Não foi possível cadastrar a secretaria. Tente novamente."
      )
    );
  }
  return { id: data.id, nome: data.nome, ativo: data.ativo !== false };
}

/**
 * Altera o nome e/ou a situação de uma secretaria.
 *
 * Marcar como inativa é o caminho recomendado quando existem vínculos: as telas
 * de Saldos, Fornecedores, Pagamentos e Histórico já listam somente as ativas,
 * e nenhum registro antigo é perdido.
 */
export async function atualizarSecretaria(id, { nome: nomeBruto, ativo }) {
  const nome = nomeDeSecretaria(nomeBruto);
  if (await nomeJaUsado(nome, id)) {
    throw erroAmigavel(`Já existe outra secretaria chamada "${nome}".`);
  }

  const { data, error } = await supabase
    .from("secretarias")
    .update({ nome, ativo: ativo !== false })
    .eq("id", id)
    .select("id, nome, ativo");
  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "42501"
          ? "Você não tem permissão para alterar secretarias."
          : "Não foi possível salvar a secretaria. Tente novamente."
      )
    );
  }
  // Update que não devolve linha nenhuma = a política do banco barrou a gravação.
  if ((data ?? []).length === 0) {
    throw erroAmigavel("A secretaria não pôde ser alterada. Confira suas permissões e tente de novo.");
  }

  const linha = data[0];
  return { id: linha.id, nome: linha.nome, ativo: linha.ativo !== false };
}

/**
 * Exclui uma secretaria — apenas quando ela não tem nenhum vínculo.
 *
 * A conferência é refeita aqui, contra o banco, mesmo que a tela já tenha
 * escondido o botão: entre carregar a lista e clicar em excluir, outra pessoa
 * pode ter cadastrado uma conta ou um fornecedor na secretaria.
 */
export async function excluirSecretaria(id) {
  const vinculos = await vinculosDasSecretarias();
  const chave = String(id);
  const contas = vinculos.contas?.get(chave) ?? (vinculos.contas ? 0 : null);
  const fornecedores = vinculos.fornecedores?.get(chave) ?? (vinculos.fornecedores ? 0 : null);

  const bloqueio = motivoDeBloqueio({ contas, fornecedores });
  if (bloqueio) throw erroAmigavel(bloqueio);

  const { data, error } = await supabase.from("secretarias").delete().eq("id", id).select("id");
  if (error) {
    // 23503 = outra tabela ainda referencia esta secretaria (chave estrangeira).
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "23503"
          ? "Esta secretaria não pode ser excluída porque ainda existem registros vinculados a ela."
          : error?.code === "42501"
            ? "Você não tem permissão para excluir secretarias."
            : "Não foi possível excluir a secretaria. Tente novamente."
      )
    );
  }
  if ((data ?? []).length === 0) {
    throw erroAmigavel(
      "A secretaria não pôde ser excluída. Confira suas permissões — ou marque-a como inativa, que produz o mesmo efeito nas telas."
    );
  }
}

/* -------------------------------------------------------------------------
 * Fornecedores — classificações em uso (somente leitura)
 * ---------------------------------------------------------------------- */

function textoNormalizado(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Primeira coluna de texto preenchida cujo nome casa com o padrão informado. */
function colunaDeTexto(linhas, padrao) {
  const chaves = new Set();
  linhas.forEach((linha) => Object.keys(linha).forEach((chave) => chaves.add(chave)));
  return (
    [...chaves].find(
      (chave) =>
        padrao.test(textoNormalizado(chave)) &&
        linhas.some((linha) => typeof linha[chave] === "string" && linha[chave].trim() !== "")
    ) ?? ""
  );
}

function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Lista [{ valor, total }] ordenada alfabeticamente, a partir de um contador. */
function itensContados(mapa) {
  return [...mapa.entries()]
    .map(([valor, total]) => ({ valor, total }))
    .sort((a, b) => a.valor.localeCompare(b.valor, "pt-BR", { sensitivity: "base" }));
}

/**
 * Tipos e situações que os fornecedores já cadastrados usam hoje.
 *
 * Nada aqui é uma lista fixa mantida pela tela de Configurações: os valores são
 * lidos do próprio cadastro, exatamente como o filtro de Fornecedores faz. Por
 * isso a categoria é somente leitura — um tipo em uso não pode ser renomeado ou
 * removido daqui sem mexer nos cadastros que dependem dele.
 *
 * Quando a tabela não tem coluna própria de tipo, o tipo sai do CPF/CNPJ já
 * gravado (11 dígitos = Pessoa Física, 14 = Pessoa Jurídica); quando não tem
 * coluna própria de situação, ela sai do campo `ativo` (Ativo / Inativo).
 *
 * @returns { total, tipos: { origem, campo, itens }, status: { origem, campo, itens } }
 */
export async function listarClassificacoesFornecedores() {
  let linhas = [];
  try {
    linhas = await buscarPaginado(() => supabase.from("fornecedores").select("*"));
  } catch (e) {
    throw erroAmigavel(
      mensagemAmigavel(e, "Não foi possível carregar as classificações dos fornecedores.")
    );
  }

  const campoTipo = colunaDeTexto(linhas, /^(tipo|categoria|natureza|classificacao)/);
  const campoStatus = colunaDeTexto(linhas, /^(status|situacao)/);

  const tipos = new Map();
  const status = new Map();

  for (const fornecedor of linhas) {
    let tipo = "";
    if (campoTipo) {
      tipo = String(fornecedor[campoTipo] ?? "").trim();
    } else {
      const digitos = somenteDigitos(fornecedor.cpf_cnpj);
      if (digitos.length === 11) tipo = "Pessoa Física";
      else if (digitos.length === 14) tipo = "Pessoa Jurídica";
    }
    if (tipo) tipos.set(tipo, (tipos.get(tipo) ?? 0) + 1);

    const situacao = campoStatus
      ? String(fornecedor[campoStatus] ?? "").trim()
      : fornecedor.ativo === false
        ? "Inativo"
        : "Ativo";
    if (situacao) status.set(situacao, (status.get(situacao) ?? 0) + 1);
  }

  return {
    total: linhas.length,
    tipos: {
      origem: campoTipo ? "cadastro" : "documento",
      campo: campoTipo || "cpf_cnpj",
      itens: itensContados(tipos),
    },
    status: {
      origem: campoStatus ? "cadastro" : "ativo",
      campo: campoStatus || "ativo",
      itens: itensContados(status),
    },
  };
}
