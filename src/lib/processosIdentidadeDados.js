// Camada de dados da IDENTIDADE VISUAL dos documentos de Processos.
//
// O brasão e os dados institucionais de cabeçalho/rodapé moram na chave
// 'processos' de public.configuracoes_sistema -- a mesma tabela chave-valor das
// outras categorias da tela de Configurações. Trocar o brasão aqui NÃO altera
// documento já finalizado: o processo guarda dentro de si, no ato da
// finalização, a identidade vigente naquele momento (coluna identidade_visual),
// exatamente como já acontece com os dados do secretário e da prefeita.
//
// Documental, como todo o módulo: as únicas tabelas escritas aqui são
// configuracoes_sistema e auditoria_eventos, e o único bucket tocado é o
// 'configuracoes'. Nada nisto debita conta, dá baixa em NF, altera saldo,
// marca fornecedor como pago, cria pagamento ou mexe na Programação Diária.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import { enviarImagemDeIdentidade } from "./logomarcaEnvio.js";
import { MODULO_DIARIAS } from "./processosDiarias.js";
import {
  IDENTIDADE_PADRAO,
  atualizarRodapeLegado,
  diferencaDaIdentidade,
  normalizarIdentidade,
  primeiroErroDaIdentidade,
  validarIdentidade,
} from "./processosIdentidade.js";

const TABELA_CONFIGURACOES = "configuracoes_sistema";

/** Chave da linha de configuração desta identidade. */
export const CHAVE_PROCESSOS = "processos";

/** Chave da categoria Geral, de onde sai a logomarca do sistema (Aparência). */
export const CHAVE_GERAL = "geral";

/** Pasta do Storage onde o brasão dos documentos é guardado. */
export const PASTA_BRASAO = "processos-brasao";

/** true quando o erro é "a configuração ainda não existe neste banco". */
function configuracaoAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return /schema cache/i.test(String(erro?.message ?? ""));
}

async function usuarioAtualId() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data, error } = await supabase.from("usuarios").select("id").eq("auth_id", auth.user.id).limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

/**
 * A identidade visual VIGENTE, já normalizada e completa.
 *
 * Banco sem a linha (ou sem a migration) devolve a identidade padrão da
 * prefeitura com `ausente: true` -- os documentos continuam saindo com o brasão
 * do repositório e o rodapé institucional já definido.
 */
export async function carregarIdentidadeProcessos() {
  try {
    const { data, error } = await supabase
      .from(TABELA_CONFIGURACOES)
      .select("valor, atualizado_em, atualizado_por")
      .eq("chave", CHAVE_PROCESSOS)
      .limit(1);
    if (error) throw error;

    const linha = data?.[0] ?? null;
    if (!linha) {
      return { identidade: normalizarIdentidade(IDENTIDADE_PADRAO), ausente: false, autoria: null };
    }

    const autor = linha.atualizado_por ? await nomeDoAutor(linha.atualizado_por) : null;
    return {
      // ⚠️ Só a identidade VIGENTE recebe o rodapé novo, com o CEP. A congelada
      // dentro de processo finalizado nunca passa por aqui.
      identidade: normalizarIdentidade(atualizarRodapeLegado(linha.valor)),
      ausente: false,
      autoria: { atualizado_em: linha.atualizado_em ?? null, autor },
    };
  } catch (e) {
    if (configuracaoAusente(e)) {
      return { identidade: normalizarIdentidade(IDENTIDADE_PADRAO), ausente: true, autoria: null };
    }
    throw erroAmigavel(
      mensagemAmigavel(e, "Não foi possível carregar a identidade visual dos documentos."),
    );
  }
}

/**
 * A LOGOMARCA DO SISTEMA (Configurações -> Aparência), só o endereço da imagem.
 *
 * Existe porque o documento precisa imprimir A LOGOMARCA QUE ESTÁ CADASTRADA.
 * Quem cadastrou a imagem em Aparência e não em Processos -> Identidade visual
 * via o documento sair com o brasão genérico do repositório, como se nada
 * estivesse cadastrado. Esta leitura é o segundo degrau da escolha feita por
 * `logoDoDocumento`: brasão dos documentos, depois logomarca do sistema, e só
 * então o brasão do repositório.
 *
 * Banco sem a linha, sem a coluna ou sem permissão de leitura devolve null --
 * nunca derruba a tela nem impede o documento de sair.
 */
export async function carregarLogomarcaDoSistema() {
  try {
    const { data, error } = await supabase
      .from(TABELA_CONFIGURACOES)
      .select("valor")
      .eq("chave", CHAVE_GERAL)
      .limit(1);
    if (error) throw error;
    const url = String(data?.[0]?.valor?.logo_url ?? "").trim();
    return url === "" ? null : url;
  } catch {
    // A logomarca do sistema é um degrau opcional: sem ela o documento segue
    // para o degrau seguinte da escolha, sem erro na tela.
    return null;
  }
}

async function nomeDoAutor(id) {
  try {
    const { data, error } = await supabase.from("usuarios").select("nome_completo").eq("id", id).limit(1);
    if (error) throw error;
    return data?.[0]?.nome_completo ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

/**
 * Grava a identidade visual dos documentos de Processos.
 *
 * A gravação passa pela RLS já existente da tabela de configurações (módulo
 * 'administracao', ação editar). Documentos já finalizados seguem intactos:
 * eles imprimem a identidade congelada na própria linha do processo.
 */
export async function salvarIdentidadeProcessos(identidadeAnterior, valores) {
  const primeiro = primeiroErroDaIdentidade(validarIdentidade(valores));
  if (primeiro) throw erroAmigavel(primeiro);

  const pronta = normalizarIdentidade(valores);
  const autor = await usuarioAtualId();

  const { error } = await supabase
    .from(TABELA_CONFIGURACOES)
    .upsert({ chave: CHAVE_PROCESSOS, valor: pronta }, { onConflict: "chave" });

  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "42501"
          ? "Você não tem permissão para alterar a identidade visual dos documentos."
          : "Não foi possível salvar a identidade visual. Tente novamente.",
      ),
    );
  }

  const diferenca = diferencaDaIdentidade(identidadeAnterior, pronta);
  if (diferenca.houveAlteracao) {
    await registrarEvento({
      modulo: MODULO_DIARIAS,
      acao: "alterou_identidade_processos",
      registroAfetado: "Identidade visual dos documentos de Processos",
      valorAnterior: diferenca.anterior,
      valorNovo: diferenca.novo,
      nivel: "atencao",
      usuarioId: autor,
    });
  }

  return pronta;
}

/* -------------------------------------------------------------------------
 * Brasão no Storage
 * ---------------------------------------------------------------------- */

/**
 * Envia o brasão dos documentos para o Storage e devolve a URL pública.
 *
 * Reaproveita o bucket 'configuracoes' que a logomarca do sistema já usa, em
 * pasta própria: o brasão dos documentos é uma imagem SEPARADA da logomarca das
 * telas, e uma não substitui a outra.
 *
 * O envio em si é o de src/lib/logomarcaEnvio.js, com as regras de formato,
 * redução e tradução da falha em src/lib/logomarcaImagem.js -- a ORIGEM ÚNICA, a mesma que
 * Configurações -> Aparência usa. Antes havia aqui uma cópia das mesmas regras,
 * e a recusa do servidor virava "Não foi possível enviar o brasão. Tente outra
 * imagem", escondendo o motivo real. Corrigir na origem conserta as duas telas.
 */
export async function enviarBrasaoProcessos(arquivo) {
  return enviarImagemDeIdentidade(arquivo, {
    pasta: PASTA_BRASAO,
    rotuloDaImagem: "a imagem do brasão",
  });
}

/* -------------------------------------------------------------------------
 * Preparo do brasão para o documento
 * ---------------------------------------------------------------------- */

/** Lado, em pixels, da imagem rasterizada. Alto de propósito: o PDF imprime o
 * brasão com cerca de 16 mm, e 512 px nesse espaço dão ~810 dpi -- sem
 * serrilhado no papel nem no PDF. */
const LADO_RASTER = 512;

const cacheDoLogo = new Map();

/**
 * Rasteriza o brasão para o jsPDF: devolve { dataUrl, largura, altura } ou null.
 *
 * O jsPDF não desenha SVG, e uma imagem pequena esticada serrilha. Aqui a
 * imagem (SVG ou raster) é redesenhada num canvas grande, PRESERVANDO A
 * PROPORÇÃO -- o lado menor recebe margem transparente em vez de ser esticado,
 * então o brasão nunca sai deformado. A largura/altura originais voltam junto
 * para quem quiser calcular o encaixe.
 *
 * Só roda no navegador; falha (imagem inacessível, CORS, ambiente sem canvas)
 * devolve null, e o documento usa o desenho vetorial de reserva.
 */
export async function prepararLogoParaDocumento(url) {
  const endereco = String(url ?? "").trim();
  if (endereco === "") return null;
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (cacheDoLogo.has(endereco)) return cacheDoLogo.get(endereco);

  const preparado = await rasterizar(endereco).catch(() => null);
  cacheDoLogo.set(endereco, preparado);
  return preparado;
}

function rasterizar(endereco) {
  return new Promise((resolve, reject) => {
    const imagem = new window.Image();
    imagem.crossOrigin = "anonymous";
    imagem.decoding = "sync";

    const falhou = () => reject(new Error("brasão não pôde ser carregado"));
    imagem.onerror = falhou;
    imagem.onload = () => {
      try {
        const largura = imagem.naturalWidth || imagem.width || LADO_RASTER;
        const altura = imagem.naturalHeight || imagem.height || LADO_RASTER;
        const escala = LADO_RASTER / Math.max(largura, altura);
        const destinoL = Math.max(1, Math.round(largura * escala));
        const destinoA = Math.max(1, Math.round(altura * escala));

        const canvas = document.createElement("canvas");
        canvas.width = destinoL;
        canvas.height = destinoA;
        const pincel = canvas.getContext("2d");
        if (!pincel) {
          falhou();
          return;
        }
        pincel.imageSmoothingEnabled = true;
        pincel.imageSmoothingQuality = "high";
        pincel.drawImage(imagem, 0, 0, destinoL, destinoA);

        resolve({
          // A URL de ORIGEM viaja junto: é ela que o documento confere antes de
          // usar esta imagem, para não imprimir o brasão de hoje num processo
          // que congelou outro.
          url: endereco,
          dataUrl: canvas.toDataURL("image/png"),
          largura: destinoL,
          altura: destinoA,
          proporcao: destinoL / destinoA,
        });
      } catch (e) {
        reject(e);
      }
    };

    imagem.src = endereco;
  });
}

/** Esquece o que já foi rasterizado -- usado depois de trocar o brasão. */
export function limparCacheDoLogo() {
  cacheDoLogo.clear();
}
