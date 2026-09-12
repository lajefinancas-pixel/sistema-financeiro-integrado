// Envio de imagem de identidade visual para o Storage -- A ORIGEM ÚNICA.
//
// Duas telas mandam imagem e as duas passam por aqui:
//
//   Configurações -> Aparência          -> logo do sistema  (pasta 'logomarca')
//   Configurações -> Processos          -> brasão dos documentos
//                    Identidade visual     (pasta 'processos-brasao')
//
// O DEFEITO QUE ISTO CONSERTA: as duas telas mostravam sempre "Não foi possível
// enviar a logomarca. Tente outra imagem", qualquer que fosse a imagem -- até um
// PNG de poucos KB, muito abaixo do limite. A frase vinha do fallback genérico
// do envio, e o motivo REAL era apagado antes de chegar à tela: `mensagemAmigavel`
// troca por padrão qualquer erro que carregue code/details/hint (é o caso de toda
// recusa do Storage) pela mensagem do contexto. Ou seja: a falha do servidor
// existia, mas ninguém conseguia ler qual era.
//
// O que passa a acontecer:
//
//   1. a recusa do lado do navegador diz O QUE está errado (formato não aceito,
//      arquivo acima do teto) nomeando o arquivo recebido;
//   2. imagem acima do limite não é mais recusada: é REDUZIDA no navegador,
//      mantendo a proporção e resolução de sobra para impressão;
//   3. a falha do servidor é traduzida pelo motivo real -- depósito inexistente,
//      permissão recusada, formato barrado pelo bucket, tamanho barrado pelo
//      servidor, sem conexão -- e o erro técnico COMPLETO vai para o console (F12);
//   4. se o envio direto for barrado pela política do Storage, o arquivo sobe
//      pela função do servidor (/api/configuracoes/logomarca), que confere a
//      permissão de administração, garante o bucket e grava com a chave de
//      serviço. Assim a tela funciona mesmo em banco onde as políticas do
//      Storage nunca foram criadas.
//
// As REGRAS (formatos, recusa com motivo, redução, tradução da falha) moram em
// src/lib/logomarcaImagem.js, sem Supabase, e por isso são conferidas por teste
// fora do navegador. Este arquivo é o TRANSPORTE -- e reexporta aquelas regras
// para que as telas continuem importando de um lugar só.
//
// Nada aqui altera saldo, baixa, programação, nota, transferência ou pagamento:
// escreve UM arquivo no bucket 'configuracoes' e devolve a URL pública dele.

import { supabase } from "./supabaseClient.js";
import { erroAmigavel } from "./erros.js";
import {
  BUCKET_CONFIGURACOES,
  ROTA_ENVIO_SERVIDOR,
  caminhoNoBucket,
  motivoDaFalhaDeEnvio,
  motivoDaRecusa,
  precisaReduzir,
  reduzirImagem,
  registrarFalhaTecnica,
} from "./logomarcaImagem.js";

export {
  ACEITE_DO_SELETOR,
  BUCKET_CONFIGURACOES,
  FORMATOS_ACEITOS,
  LADO_MAXIMO,
  LIMITE_ARQUIVO_MB,
  LIMITE_LOGO_MB,
  ROTA_ENVIO_SERVIDOR,
  caminhoNoBucket,
  extensaoDoNome,
  formatoDoArquivo,
  motivoDaFalhaDeEnvio,
  motivoDaRecusa,
  precisaReduzir,
  reduzirImagem,
  registrarFalhaTecnica,
  tamanhoLegivel,
} from "./logomarcaImagem.js";

/* -------------------------------------------------------------------------
 * O envio
 * ---------------------------------------------------------------------- */

async function subirDireto(caminho, arquivo) {
  const { error } = await supabase.storage.from(BUCKET_CONFIGURACOES).upload(caminho, arquivo, {
    cacheControl: "3600",
    upsert: false,
    contentType: arquivo?.type || undefined,
  });
  return error ?? null;
}

function urlPublica(caminho) {
  const { data } = supabase.storage.from(BUCKET_CONFIGURACOES).getPublicUrl(caminho);
  return data?.publicUrl ?? null;
}

/**
 * Segunda tentativa: a função do servidor sobe com a chave de serviço.
 *
 * Existe porque a causa mais provável da recusa é a política do Storage não
 * existir no banco (criar política em storage.objects pelo SQL Editor falha por
 * dono do objeto em alguns projetos). A função confere a MESMA permissão que a
 * política conferiria -- edição no módulo 'administracao' -- antes de gravar, e
 * garante o bucket. Sem isso, a tela ficaria travada até alguém rodar SQL.
 */
async function subirPelaFuncao(arquivo, pasta) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw erroAmigavel("Sua sessão expirou. Entre novamente para enviar a imagem.");

  const formulario = new FormData();
  formulario.append("pasta", texto(pasta) || "logomarca");
  formulario.append("arquivo", arquivo, texto(arquivo?.name) || "logomarca.png");

  const resposta = await fetch(ROTA_ENVIO_SERVIDOR, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formulario,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !corpo?.url) {
    const falha = new Error(corpo?.erro || corpo?.error || `a função do servidor respondeu ${resposta.status}`);
    falha.status = resposta.status;
    falha.code = corpo?.code ?? null;
    falha.details = corpo?.details ?? null;
    throw falha;
  }
  return corpo.url;
}

/**
 * Envia a imagem e devolve a URL pública. A ÚNICA porta de envio do sistema.
 *
 * @param arquivo    o arquivo escolhido na tela
 * @param pasta      pasta dentro do bucket ('logomarca' ou 'processos-brasao')
 * @param rotuloDaImagem como chamar a imagem nas mensagens ("a logomarca")
 */
export async function enviarImagemDeIdentidade(arquivo, { pasta, rotuloDaImagem = "a imagem" } = {}) {
  const recusa = motivoDaRecusa(arquivo, { rotuloDaImagem });
  if (recusa) throw erroAmigavel(recusa.mensagem);

  // Grande demais ou formato que o bucket pode estranhar: reduz/converte aqui,
  // em vez de recusar. Se a redução não for possível, segue o original.
  let pronto = arquivo;
  if (precisaReduzir(arquivo)) {
    const reduzido = await reduzirImagem(arquivo);
    if (reduzido) pronto = reduzido;
  }

  const caminho = caminhoNoBucket(pasta, pronto);

  const erroDireto = await subirDireto(caminho, pronto);
  if (!erroDireto) {
    const url = urlPublica(caminho);
    if (url) return url;
    // Envio feito e URL não montada: é configuração do bucket, não da imagem.
    throw erroAmigavel(
      "A imagem foi enviada, mas o sistema não conseguiu montar o endereço público dela. " +
        "Avise o responsável pelo sistema: o depósito de imagens precisa ser público."
    );
  }

  const motivo = motivoDaFalhaDeEnvio(erroDireto);
  registrarFalhaTecnica("o envio direto ao Storage foi recusado", erroDireto, {
    caminho,
    motivo: motivo.codigo,
    tamanho: pronto?.size ?? null,
    tipo: pronto?.type ?? null,
  });

  // Recusa por política/bucket tem segunda porta. Erro de conexão não tem: a
  // função do servidor depende da mesma rede.
  if (motivo.codigo === "conexao") throw erroAmigavel(motivo.mensagem);

  try {
    return await subirPelaFuncao(pronto, pasta);
  } catch (e) {
    if (e?.amigavel === true) throw e;
    registrarFalhaTecnica("o envio pela função do servidor também falhou", e, { caminho });
    throw erroAmigavel(motivo.mensagem);
  }
}
