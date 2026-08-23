// Notas/lançamentos de um fornecedor, prontos para a lista da "Vida do
// Fornecedor".
//
// Aqui não nasce regra financeira nenhuma: valor, retenção e situação continuam
// vindo de `valores_em_aberto` exatamente como foram gravados. O que este
// módulo faz é organizar o que já existe -- rotular a situação de cada nota
// (inclusive "Vencida", que é só o vencimento comparado com a data de hoje),
// juntar o resumo da lista, aplicar os filtros rápidos da seção e montar a
// leitura expandida de uma nota a partir dos campos dela e dos pagamentos que
// a tela já carregou.

import { paraNumeroMoeda } from "./moeda";

/** Situações que encerram a nota: não vencem mais nem entram no "em aberto". */
const RESOLVIDAS = new Set(["pago", "cancelado"]);

// Rótulos no feminino ("a nota está paga"), com espaço para situações que o
// banco pode ter e a lista de situações da tela ainda não traga.
const ROTULOS = {
  em_aberto: "Em aberto",
  programado: "Programada",
  parcialmente_pago: "Parcialmente paga",
  pago: "Paga",
  suspenso: "Suspensa",
  cancelado: "Cancelada",
  aguardando_aprovacao: "Aguardando aprovação",
  aguardando_aprovacao_gestor: "Aguardando aprovação",
  em_aprovacao: "Aguardando aprovação",
};

const NEUTRA = { cor: "#0F2A44", bg: "rgba(15,42,68,0.06)" };
const VENCIDA = { chave: "vencida", rotulo: "Vencida", cor: "#B91C1C", bg: "#FEE2E2" };

export const FILTRO_VAZIO = {
  situacao: "todas",
  numero: "",
  campoData: "vencimento",
  dataInicial: "",
  dataFinal: "",
  valorMin: "",
  valorMax: "",
};

export function soData(valor) {
  return valor ? String(valor).slice(0, 10) : "";
}

export function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatarData(valor) {
  const data = soData(valor);
  return data ? new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR") : "--";
}

function numero(valor) {
  return paraNumeroMoeda(valor);
}

/** "aguardando_aprovacao" -> "Aguardando aprovacao", para situações desconhecidas. */
function humanizar(chave) {
  const texto = String(chave ?? "").replace(/_/g, " ").trim();
  return texto === "" ? "" : texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Data que a lista usa como "data da nota" quando a emissão não foi informada. */
export function dataDaNota(nota) {
  return soData(nota?.data_nota_fiscal) || soData(nota?.created_at);
}

export function notaResolvida(nota) {
  return RESOLVIDAS.has(String(nota?.situacao ?? ""));
}

/** Em aberto e com o vencimento já passado -- leitura de data, não de saldo. */
export function notaVencida(nota, hoje = hojeISO()) {
  if (notaResolvida(nota)) return false;
  const vencimento = soData(nota?.data_vencimento);
  return vencimento !== "" && vencimento < hoje;
}

/**
 * Situação exibida na coluna: a que está gravada na nota, ou "Vencida" quando o
 * prazo passou. `rotuloGravado` preserva a situação original para quem precisa
 * ver as duas coisas ("Vencida" e, embaixo, "Em aberto").
 */
export function situacaoDaNota(nota, situacoes = [], hoje = hojeISO()) {
  const chave = String(nota?.situacao ?? "").trim();
  const opcao = situacoes.find((s) => s.value === chave) ?? null;
  const rotulo = ROTULOS[chave] ?? opcao?.label ?? humanizar(chave) ?? "";
  const gravada = {
    chaveGravada: chave,
    rotuloGravado: rotulo === "" ? "Sem situação" : rotulo,
  };

  if (notaVencida(nota, hoje)) return { ...VENCIDA, ...gravada, vencida: true };
  return {
    chave,
    rotulo: gravada.rotuloGravado,
    cor: opcao?.cor ?? NEUTRA.cor,
    bg: opcao?.bg ?? NEUTRA.bg,
    vencida: false,
    ...gravada,
  };
}

/**
 * Opções do filtro rápido: "Todas", as situações que realmente aparecem nas
 * notas deste fornecedor e "Vencidas" quando existe alguma no prazo estourado.
 */
export function filtrosDeSituacao(notas = [], situacoes = [], hoje = hojeISO()) {
  const opcoes = [{ value: "todas", label: "Todas", quantidade: notas.length }];

  const ordem = situacoes.map((s) => s.value);
  const contagem = new Map();
  notas.forEach((nota) => {
    const chave = String(nota.situacao ?? "");
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  });

  [...contagem.keys()]
    .sort((a, b) => {
      const ia = ordem.indexOf(a);
      const ib = ordem.indexOf(b);
      return (ia < 0 ? ordem.length : ia) - (ib < 0 ? ordem.length : ib);
    })
    .forEach((chave) => {
      const rotulo = situacaoDaNota({ situacao: chave }, situacoes, hoje).rotuloGravado;
      opcoes.push({ value: chave, label: rotulo, quantidade: contagem.get(chave) });
    });

  const vencidas = notas.filter((nota) => notaVencida(nota, hoje)).length;
  if (vencidas > 0) opcoes.push({ value: "vencida", label: "Vencidas", quantidade: vencidas });

  return opcoes;
}

/** Competência do lançamento, se o cadastro guardar esse campo. */
export function competenciaDaNota(nota) {
  const bruto = nota?.competencia ?? nota?.mes_competencia ?? nota?.competencia_mes ?? "";
  const texto = String(bruto ?? "").trim();
  if (texto === "") return "";
  const iso = texto.match(/^(\d{4})-(\d{2})/);
  return iso ? `${iso[2]}/${iso[1]}` : texto;
}

/** ISS e IRPJ retidos na nota, como já foram gravados nela. */
export function tributosDaNota(nota) {
  const iss = numero(nota?.desconto_iss);
  const ir = numero(nota?.desconto_ir);
  return { iss, ir, total: iss + ir };
}

export function valorBrutoDaNota(nota) {
  const bruto = numero(nota?.valor_bruto);
  return bruto > 0 ? bruto : numero(nota?.valor);
}

/** Identificação curta da nota, sem repetir o número que já tem coluna própria. */
export function descricaoDaNota(nota, fornecedor) {
  const propria = String(nota?.descricao ?? "").trim();
  if (propria !== "") return propria;

  const partes = [];
  if (nota?.parcela) partes.push(`Parcela ${nota.parcela}`);
  if (nota?.numero_processo) partes.push(`Processo ${nota.numero_processo}`);
  if (nota?.numero_empenho) partes.push(`Empenho ${nota.numero_empenho}`);
  if (partes.length > 0) return partes.join(" · ");

  return String(fornecedor?.descricao ?? "").trim();
}

/** Pagamentos já efetivados que apontam para esta nota (`valor_em_aberto_id`). */
export function pagamentosDaNota(nota, pagamentos = []) {
  return pagamentos.filter((p) => p.valor_em_aberto_id && String(p.valor_em_aberto_id) === String(nota?.id));
}

/**
 * Comprovante do pagamento, quando o banco guarda o arquivo. Só é mostrado se o
 * campo existir de verdade -- nada é criado aqui.
 */
export function comprovanteDaNota(nota, pagamentosVinculados = []) {
  const candidatos = [
    nota?.comprovante_url,
    nota?.comprovante,
    nota?.anexo_url,
    nota?.arquivo_url,
    ...pagamentosVinculados.flatMap((p) => [p.comprovante_url, p.comprovante, p.anexo_url]),
  ];
  const url = candidatos.find((v) => String(v ?? "").trim() !== "");
  return url ? String(url) : "";
}

export function observacoesDaNota(nota) {
  const texto = nota?.observacoes ?? nota?.observacao ?? nota?.obs ?? "";
  return String(texto ?? "").trim();
}

/**
 * Linha do tempo da nota montada com os campos que ela já tem: quando foi
 * lançada, a emissão, o vencimento e os pagamentos vinculados. A trilha
 * completa do cadastro continua sendo a do módulo de Histórico.
 */
export function historicoDaNota(nota, pagamentosVinculados = [], hoje = hojeISO()) {
  const itens = [];
  const lancamento = soData(nota?.created_at);
  if (lancamento) itens.push({ data: lancamento, titulo: "Lançamento registrado" });

  const emissao = soData(nota?.data_nota_fiscal);
  if (emissao) {
    itens.push({
      data: emissao,
      titulo: nota?.numero_nota_fiscal ? `Nota fiscal ${nota.numero_nota_fiscal} emitida` : "Nota fiscal emitida",
    });
  }

  const vencimento = soData(nota?.data_vencimento);
  if (vencimento) {
    itens.push({
      data: vencimento,
      titulo: notaVencida(nota, hoje) ? "Vencimento (em atraso)" : "Vencimento",
    });
  }

  pagamentosVinculados.forEach((p) => {
    itens.push({
      data: soData(p.data),
      titulo: "Pagamento efetivado",
      detalhe: p.contas?.length > 0 ? p.contas.join(" · ") : "",
      valor: numero(p.valor),
    });
  });

  return itens
    .filter((item) => item.data)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

/**
 * Resumo compacto da lista. Os totais em aberto e pago são os mesmos que o
 * bloco financeiro da vida do fornecedor já calculou -- entram prontos, para
 * não existirem duas contas diferentes na mesma tela.
 */
export function resumoDasNotas({ notas = [], totalAberto = 0, totalPago = 0, hoje = hojeISO() } = {}) {
  const emAberto = notas.filter((nota) => !notaResolvida(nota));
  const vencidas = emAberto.filter((nota) => notaVencida(nota, hoje));

  const proximos = emAberto
    .map((nota) => soData(nota.data_vencimento))
    .filter((data) => data !== "" && data >= hoje)
    .sort();

  const atrasados = vencidas
    .map((nota) => soData(nota.data_vencimento))
    .filter(Boolean)
    .sort();

  return {
    totalAberto: numero(totalAberto),
    totalPago: numero(totalPago),
    totalMovimentado: numero(totalAberto) + numero(totalPago),
    quantidade: notas.length,
    quantidadeEmAberto: emAberto.length,
    quantidadeVencidas: vencidas.length,
    // Sem nenhum vencimento futuro, o mais informativo é o atraso mais antigo.
    proximoVencimento: proximos[0] ?? atrasados[0] ?? "",
    proximoVencimentoEmAtraso: proximos.length === 0 && atrasados.length > 0,
  };
}

function textoComparavel(valor) {
  return String(valor ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Aplica os filtros rápidos da seção (situação, número, período e valor). */
export function filtrarNotas(notas = [], filtros = FILTRO_VAZIO, hoje = hojeISO()) {
  const f = { ...FILTRO_VAZIO, ...(filtros ?? {}) };
  const numeroBuscado = textoComparavel(f.numero);
  const minimo = f.valorMin === "" || f.valorMin === null ? null : numero(f.valorMin);
  const maximo = f.valorMax === "" || f.valorMax === null ? null : numero(f.valorMax);

  return notas.filter((nota) => {
    if (f.situacao === "vencida") {
      if (!notaVencida(nota, hoje)) return false;
    } else if (f.situacao !== "todas" && String(nota.situacao ?? "") !== f.situacao) {
      return false;
    }

    if (numeroBuscado !== "") {
      const alvo = textoComparavel(nota.numero_nota_fiscal);
      if (!alvo.includes(numeroBuscado)) return false;
    }

    if (f.dataInicial || f.dataFinal) {
      const data = f.campoData === "nota" ? dataDaNota(nota) : soData(nota.data_vencimento);
      if (!data) return false;
      if (f.dataInicial && data < f.dataInicial) return false;
      if (f.dataFinal && data > f.dataFinal) return false;
    }

    const valor = numero(nota.valor);
    if (minimo !== null && valor < minimo) return false;
    if (maximo !== null && valor > maximo) return false;

    return true;
  });
}

/** Em aberto primeiro (por vencimento), resolvidas depois -- como já era. */
export function ordenarNotas(notas = []) {
  return notas.slice().sort((a, b) => {
    const resolvidaA = notaResolvida(a) ? 1 : 0;
    const resolvidaB = notaResolvida(b) ? 1 : 0;
    if (resolvidaA !== resolvidaB) return resolvidaA - resolvidaB;

    const vencA = soData(a.data_vencimento) || "9999-12-31";
    const vencB = soData(b.data_vencimento) || "9999-12-31";
    if (vencA !== vencB) return vencA.localeCompare(vencB);

    return String(dataDaNota(a)).localeCompare(String(dataDaNota(b)));
  });
}

export function filtroAtivo(filtros = FILTRO_VAZIO) {
  const f = { ...FILTRO_VAZIO, ...(filtros ?? {}) };
  return (
    f.situacao !== "todas" ||
    f.numero.trim() !== "" ||
    f.dataInicial !== "" ||
    f.dataFinal !== "" ||
    f.valorMin !== "" ||
    f.valorMax !== ""
  );
}
