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

const TABELA = "configuracoes_sistema";

/** Bucket público da logomarca (criado pela mesma migration). */
export const BUCKET_CONFIGURACOES = "configuracoes";

export const CHAVE_GERAL = "geral";
export const CHAVE_SEGURANCA = "seguranca";

/** Categorias da navegação lateral da tela. */
export const CATEGORIAS = [
  { id: "geral", label: "Geral", descricao: "Identificação da instituição e do sistema", pronta: true },
  {
    id: "usuarios-seguranca",
    label: "Usuários e Segurança",
    descricao: "Acessos, política de senha e situação dos usuários",
    pronta: true,
  },
  { id: "financeiro", label: "Financeiro", descricao: "Contas, secretarias e regras de lançamento" },
  { id: "fornecedores", label: "Fornecedores", descricao: "Campos obrigatórios e classificações" },
  { id: "tributario", label: "Tributário", descricao: "Alíquotas, retenções e obrigações" },
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
 * Configurações de Geral e de Segurança, já preenchidas com os valores padrão
 * onde o banco ainda não tem nada.
 *
 * Devolve { geral, seguranca, autoria } — autoria traz, por chave,
 * { atualizado_em, autor } para o rodapé "última alteração".
 */
export async function carregarConfiguracoes() {
  const { data, error } = await supabase
    .from(TABELA)
    .select("chave, valor, atualizado_em, atualizado_por")
    .in("chave", [CHAVE_GERAL, CHAVE_SEGURANCA]);

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

/* -------------------------------------------------------------------------
 * Logomarca
 * ---------------------------------------------------------------------- */

/** Envia a logomarca para o Storage e devolve a URL pública. */
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
