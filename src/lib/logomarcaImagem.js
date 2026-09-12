// As REGRAS da imagem de identidade visual -- puras, sem rede e sem Supabase.
//
// Aqui mora tudo o que decide, antes e depois do envio:
//
//   * que formatos o sistema aceita (JPG, PNG, SVG -- e qualquer outra imagem,
//     convertida), e como o seletor de arquivo os oferece;
//   * se a imagem escolhida pode subir, e QUAL É O MOTIVO quando não pode;
//   * se ela precisa ser REDUZIDA (em vez de recusada) e como reduzi-la sem
//     deformar, mantendo qualidade de impressão;
//   * a tradução da recusa do servidor pelo motivo REAL -- depósito inexistente,
//     permissão, formato, tamanho, conexão -- e o registro do erro técnico
//     completo no console (F12).
//
// Está separado de src/lib/logomarcaEnvio.js, que é o transporte (Storage e
// função do servidor), por um motivo prático: sem importar o cliente do
// Supabase, estas regras são conferidas por teste automatizado -- e foi
// justamente a falta disso que deixou de pé o defeito "Não foi possível enviar
// a logomarca. Tente outra imagem" para qualquer imagem.
//
// Nada aqui altera saldo, baixa, programação, nota, transferência ou pagamento:
// são contas sobre um arquivo de imagem.

/** Bucket público das imagens de configuração (migration 20260811140000). */
export const BUCKET_CONFIGURACOES = "configuracoes";

/** Caminho da função do servidor que sobe a imagem com a chave de serviço. */
export const ROTA_ENVIO_SERVIDOR = "/api/configuracoes/logomarca";

/**
 * Tamanho a partir do qual a imagem é REDUZIDA antes de subir.
 *
 * Não é mais um limite de recusa: acima disto o navegador redimensiona. Continua
 * exportado com o nome antigo porque é o número que as telas mostram no texto de
 * ajuda do seletor.
 */
export const LIMITE_LOGO_MB = 2;

/** Teto absoluto do arquivo escolhido. Acima disto a recusa diz o tamanho. */
export const LIMITE_ARQUIVO_MB = 25;

/** Maior lado, em pixels, da imagem reduzida. */
export const LADO_MAXIMO = 1600;

/** Os formatos que o sistema aceita por nome. */
export const FORMATOS_ACEITOS = Object.freeze([
  Object.freeze({ rotulo: "PNG", mime: "image/png", extensoes: ["png"], vetor: false }),
  Object.freeze({ rotulo: "JPG", mime: "image/jpeg", extensoes: ["jpg", "jpeg", "jpe"], vetor: false }),
  Object.freeze({ rotulo: "SVG", mime: "image/svg+xml", extensoes: ["svg"], vetor: true }),
]);

/**
 * O `accept` do seletor de arquivo.
 *
 * Os três formatos vêm nomeados primeiro, para a janela do sistema já abrir
 * neles; `image/*` fecha a lista porque qualquer outra imagem que o navegador
 * saiba abrir é aceita e convertida em PNG no envio -- o seletor não esconde o
 * que o sistema aceitaria. O que ele mantém fora é o que não é imagem, como PDF.
 */
export const ACEITE_DO_SELETOR =
  "image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg,image/*";

const BYTES_POR_MB = 1024 * 1024;

function texto(valor) {
  return String(valor ?? "").trim();
}

/** A extensão do nome do arquivo, em minúsculas e sem pontuação. */
export function extensaoDoNome(nome) {
  const partes = texto(nome).toLowerCase().split(".");
  if (partes.length < 2) return "";
  return partes.pop().replace(/[^a-z0-9]/g, "");
}

/**
 * Que formato é este arquivo?
 *
 * O tipo declarado pelo navegador vem primeiro, mas NÃO é confiável sozinho:
 * há sistema que entrega SVG com tipo vazio e captura de tela com tipo genérico.
 * Por isso a extensão do nome entra como segunda leitura, e qualquer outro
 * `image/*` é aceito e CONVERTIDO para PNG no envio -- recusar um formato de
 * imagem que o navegador sabe abrir seria inventar um problema.
 *
 * @returns { rotulo, mime, extensao, vetor, aceito, converter }
 */
export function formatoDoArquivo(arquivo) {
  const mime = texto(arquivo?.type).toLowerCase();
  const extensao = extensaoDoNome(arquivo?.name);

  const porMime = FORMATOS_ACEITOS.find((f) => f.mime === mime);
  const porExtensao = FORMATOS_ACEITOS.find((f) => f.extensoes.includes(extensao));
  const conhecido = porMime ?? porExtensao;
  if (conhecido) {
    return {
      rotulo: conhecido.rotulo,
      mime: conhecido.mime,
      extensao: conhecido.extensoes[0],
      vetor: conhecido.vetor,
      aceito: true,
      converter: false,
    };
  }

  // Outra imagem qualquer (WEBP, BMP, GIF, HEIC...): entra, convertida em PNG.
  if (mime.startsWith("image/")) {
    return {
      rotulo: mime.slice(6).toUpperCase() || "imagem",
      mime: "image/png",
      extensao: "png",
      vetor: false,
      aceito: true,
      converter: true,
    };
  }

  return {
    rotulo: rotuloDoArquivoRecusado(mime, extensao),
    mime: mime || "",
    extensao,
    vetor: false,
    aceito: false,
    converter: false,
  };
}

function rotuloDoArquivoRecusado(mime, extensao) {
  if (extensao) return extensao.toUpperCase();
  if (mime) return mime;
  return "sem formato reconhecido";
}

/** Tamanho legível, para a mensagem dizer o número que a pessoa vê no arquivo. */
export function tamanhoLegivel(bytes) {
  const total = Number(bytes);
  if (!Number.isFinite(total) || total <= 0) return "0 KB";
  if (total < BYTES_POR_MB) return `${Math.max(1, Math.round(total / 1024))} KB`;
  return `${(total / BYTES_POR_MB).toFixed(total / BYTES_POR_MB < 10 ? 1 : 0)} MB`;
}

/**
 * A imagem escolhida pode subir? Devolve null quando sim.
 *
 * A recusa sempre DIZ O MOTIVO. Tamanho acima do limite de redução não é motivo
 * de recusa -- a imagem é reduzida --, só o teto absoluto é.
 *
 * @returns null | { codigo, mensagem }
 */
export function motivoDaRecusa(arquivo, { rotuloDaImagem = "a imagem" } = {}) {
  if (!arquivo) {
    return { codigo: "sem_arquivo", mensagem: `Escolha ${rotuloDaImagem} para enviar.` };
  }

  const formato = formatoDoArquivo(arquivo);
  if (!formato.aceito) {
    return {
      codigo: "formato",
      mensagem:
        `O arquivo escolhido (${formato.rotulo}) não é uma imagem que o sistema aceite. ` +
        `Envie um arquivo JPG, PNG ou SVG.`,
    };
  }

  const tamanho = Number(arquivo.size ?? 0);
  if (tamanho > LIMITE_ARQUIVO_MB * BYTES_POR_MB) {
    return {
      codigo: "tamanho",
      mensagem:
        `O arquivo tem ${tamanhoLegivel(tamanho)} e passa do máximo de ${LIMITE_ARQUIVO_MB} MB ` +
        `que o sistema recebe. Envie uma imagem menor.`,
    };
  }

  return null;
}

/** A imagem precisa ser reduzida antes de subir? */
export function precisaReduzir(arquivo) {
  if (!arquivo) return false;
  const formato = formatoDoArquivo(arquivo);
  // SVG é vetor: reduzir não diminuiria nada e tiraria a qualidade de impressão.
  if (formato.vetor) return false;
  if (formato.converter) return true;
  return Number(arquivo.size ?? 0) > LIMITE_LOGO_MB * BYTES_POR_MB;
}

/** O caminho do arquivo dentro do bucket. Nome novo a cada envio, sem colisão. */
export function caminhoNoBucket(pasta, arquivo, { agora = Date.now(), sorteio = null } = {}) {
  const formato = formatoDoArquivo(arquivo);
  const extensao = formato.extensao || extensaoDoNome(arquivo?.name) || "png";
  const aleatorio = sorteio ?? Math.random().toString(36).slice(2, 8);
  return `${texto(pasta) || "logomarca"}/${agora}-${aleatorio}.${extensao}`;
}

/* -------------------------------------------------------------------------
 * A tradução da falha do servidor
 * ---------------------------------------------------------------------- */

const FALHAS = [
  {
    codigo: "bucket_ausente",
    combina: (t, status) => /bucket not found|bucket.*does not exist/i.test(t) || (status === 404 && /bucket/i.test(t)),
    mensagem:
      "O servidor não encontrou o depósito de imagens do sistema (bucket 'configuracoes'). " +
      "A imagem não foi enviada. Avise o responsável pelo sistema: falta rodar a migration " +
      "supabase/migrations/20260912130000_storage_logomarca.sql no Supabase.",
  },
  {
    codigo: "permissao",
    combina: (t, status) =>
      status === 401 ||
      status === 403 ||
      /row-level security|violates row|permission denied|not authorized|unauthorized|forbidden|42501/i.test(t),
    mensagem:
      "O servidor recusou o envio por falta de permissão no depósito de imagens. " +
      "A imagem não foi enviada. Se você tem permissão de edição em Configurações, avise o " +
      "responsável pelo sistema: falta rodar a migration " +
      "supabase/migrations/20260912130000_storage_logomarca.sql no Supabase, que recria as " +
      "políticas do Storage.",
  },
  {
    codigo: "formato_servidor",
    combina: (t) => /mime type.*not supported|invalid mime|content type.*not (allowed|supported)/i.test(t),
    mensagem:
      "O servidor não aceitou o formato desta imagem. Envie um arquivo JPG, PNG ou SVG.",
  },
  {
    codigo: "tamanho_servidor",
    combina: (t, status) =>
      status === 413 || /exceeded the maximum allowed size|payload too large|entity too large/i.test(t),
    mensagem:
      "O servidor recusou a imagem por tamanho. Envie uma imagem menor ou avise o responsável " +
      "pelo sistema para aumentar o limite do depósito de imagens.",
  },
  {
    codigo: "duplicado",
    combina: (t) => /already exists|duplicate/i.test(t),
    mensagem: "Já existe um arquivo com este nome no servidor. Tente enviar novamente.",
  },
  {
    codigo: "conexao",
    combina: (t) => /failed to fetch|network|load failed|timeout|abort|offline|ecconnreset/i.test(t),
    mensagem:
      "A imagem não subiu porque a conexão com o servidor falhou. Verifique sua internet e " +
      "tente novamente.",
  },
];

/**
 * Por que o servidor recusou o envio?
 *
 * Devolve o motivo REAL, escrito para quem está na tela. A frase genérica só
 * aparece quando nem o código nem o texto da falha permitem nomear a causa -- e
 * mesmo aí ela manda a pessoa ao console, onde o erro completo está.
 *
 * @returns { codigo, mensagem }
 */
export function motivoDaFalhaDeEnvio(erro) {
  const partes = [
    erro?.message,
    erro?.error,
    erro?.details,
    erro?.hint,
    erro?.code,
    erro?.name,
    typeof erro === "string" ? erro : "",
  ]
    .map((parte) => texto(parte))
    .filter(Boolean);
  const assinatura = partes.join(" | ");
  const status = Number(erro?.statusCode ?? erro?.status ?? erro?.originalError?.status ?? 0) || 0;

  const encontrada = FALHAS.find((falha) => falha.combina(assinatura, status));
  if (encontrada) return { codigo: encontrada.codigo, mensagem: encontrada.mensagem };

  return {
    codigo: "desconhecida",
    mensagem:
      "O servidor recusou o envio da imagem" +
      (status ? ` (código ${status})` : "") +
      ". A imagem não foi enviada e nada foi alterado. O erro completo está no console do " +
      "navegador (F12) — mostre-o ao responsável pelo sistema.",
  };
}

/** Escreve a falha inteira no console. É aqui que o motivo real fica legível. */
export function registrarFalhaTecnica(etapa, erro, contexto = {}) {
  if (typeof console === "undefined") return;
  try {
    console.error(
      `[logomarca] ${etapa}`,
      {
        code: erro?.code ?? null,
        status: erro?.statusCode ?? erro?.status ?? null,
        message: erro?.message ?? null,
        details: erro?.details ?? null,
        hint: erro?.hint ?? null,
        ...contexto,
      },
      erro,
    );
  } catch {
    // console indisponível: não há o que fazer.
  }
}

/* -------------------------------------------------------------------------
 * A redução da imagem (navegador)
 * ---------------------------------------------------------------------- */

function temCanvas() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof Image !== "undefined";
}

function carregarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(endereco);
      resolve(imagem);
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(endereco);
      reject(new Error("a imagem escolhida não pôde ser aberta pelo navegador"));
    };
    imagem.src = endereco;
  });
}

function paraBlob(canvas, tipo, qualidade) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), tipo, qualidade);
  });
}

/**
 * Redesenha a imagem menor, SEM DEFORMAR.
 *
 * A proporção é sempre a original: a escala é a mesma nos dois lados. Começa em
 * PNG, que preserva transparência; só se o PNG ainda passar do limite a imagem
 * sai em JPG sobre fundo branco -- documento é papel branco, e é melhor do que
 * recusar o envio.
 *
 * Falha aqui NÃO é erro de tela: devolve null e o arquivo original é enviado
 * como está, porque o teto do servidor é muito maior que o limite de redução.
 */
export async function reduzirImagem(arquivo, { ladoMaximo = LADO_MAXIMO, limiteMb = LIMITE_LOGO_MB } = {}) {
  if (!temCanvas()) return null;

  let imagem;
  try {
    imagem = await carregarImagem(arquivo);
  } catch (e) {
    registrarFalhaTecnica("a imagem escolhida não pôde ser aberta para redução", e, {
      nome: arquivo?.name ?? null,
    });
    return null;
  }

  const larguraOriginal = imagem.naturalWidth || imagem.width;
  const alturaOriginal = imagem.naturalHeight || imagem.height;
  if (!larguraOriginal || !alturaOriginal) return null;

  const limite = limiteMb * BYTES_POR_MB;
  const nomeBase = texto(arquivo?.name).replace(/\.[^.]+$/, "") || "logomarca";

  const desenhar = (lado, fundo) => {
    const escala = Math.min(1, lado / Math.max(larguraOriginal, alturaOriginal));
    const largura = Math.max(1, Math.round(larguraOriginal * escala));
    const altura = Math.max(1, Math.round(alturaOriginal * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const pincel = canvas.getContext("2d");
    if (!pincel) return null;
    pincel.imageSmoothingEnabled = true;
    pincel.imageSmoothingQuality = "high";
    if (fundo) {
      pincel.fillStyle = fundo;
      pincel.fillRect(0, 0, largura, altura);
    }
    pincel.drawImage(imagem, 0, 0, largura, altura);
    return canvas;
  };

  let melhor = null;

  // Primeiro em PNG, reduzindo o lado até caber. Os degraus mantêm resolução
  // muito acima do necessário para impressão (o brasão sai com ~16 mm no papel).
  for (const lado of [ladoMaximo, 1200, 900, 700]) {
    const canvas = desenhar(lado, null);
    if (!canvas) return null;
    const blob = await paraBlob(canvas, "image/png");
    if (!blob) return null;
    if (!melhor || blob.size < melhor.size) melhor = arquivoDoBlob(blob, `${nomeBase}.png`);
    if (blob.size <= limite) return arquivoDoBlob(blob, `${nomeBase}.png`);
  }

  // Ainda grande: JPG sobre fundo branco, baixando a qualidade por degraus.
  for (const qualidade of [0.92, 0.85, 0.75]) {
    const canvas = desenhar(ladoMaximo, "#FFFFFF");
    if (!canvas) break;
    const blob = await paraBlob(canvas, "image/jpeg", qualidade);
    if (!blob) break;
    if (!melhor || blob.size < melhor.size) melhor = arquivoDoBlob(blob, `${nomeBase}.jpg`);
    if (blob.size <= limite) return arquivoDoBlob(blob, `${nomeBase}.jpg`);
  }

  // Nem assim caiu abaixo do limite: sobe o menor resultado. O teto do servidor
  // é bem maior, e recusar seria pior.
  return melhor;
}

function arquivoDoBlob(blob, nome) {
  if (typeof File === "function") {
    try {
      return new File([blob], nome, { type: blob.type });
    } catch {
      // Navegador sem construtor de File: o Blob serve para o upload.
    }
  }
  if (blob && typeof blob === "object") {
    try {
      Object.defineProperty(blob, "name", { value: nome, configurable: true });
    } catch {
      // Blob sem nome: o caminho no bucket já traz a extensão certa.
    }
  }
  return blob;
}
