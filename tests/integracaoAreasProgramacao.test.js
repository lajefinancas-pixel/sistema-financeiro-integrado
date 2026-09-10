import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AREAS, areaPorId, situacaoPagamentoDoRegistro } from "../src/lib/areasFornecedores.js";
import {
  AVISO_MIGRATION_ORIGEM,
  MIGRATION_ORIGEM_PROGRAMACAO,
  ORIGEM_POR_AREA,
  aplicarEnvioNosPagamentos,
  areaDaOrigem,
  avisoDeEnvioPendente,
  envioParaProgramacao,
  envioValido,
  itemDeProgramacaoDoEnvio,
  itemTemOrigem,
  nomeSugeridoParaProgramacao,
  origemDaArea,
  rotuloDaOrigem,
  valorAProgramar,
} from "../src/lib/programacaoDeAreas.js";
import { STATUS_APROVADA } from "../src/lib/execucaoProgramacao.js";

/**
 * Parte 2: a integração das áreas de Fornecedores (Patrocínios, Aluguéis e
 * Bandas) com a Programação Diária.
 *
 * O que este arquivo defende, e que nenhum outro defende:
 *
 *   1. mandar um registro para a programação envia SÓ o fornecedor e o valor a
 *      programar, e entra na lista pelo mesmo caminho de qualquer fornecedor --
 *      não existe caminho paralelo de gravação;
 *   2. o nome de exibição é SUGESTÃO no campo que já existia, continua editável
 *      e não encosta em razão social, apelido nem no cadastro do fornecedor;
 *   3. a origem (origem_tipo/origem_id) é informação ADICIONAL: o vínculo do
 *      pagamento com o fornecedor continua sendo o fornecedor_id, e item sem
 *      origem -- o caso normal -- funciona exatamente como antes;
 *   4. a situação de pagamento do registro é CALCULADA das baixas das NFs, sem
 *      segundo controle de valor pago em lugar nenhum;
 *   5. nada nesta integração paga, dá baixa ou movimenta saldo de conta.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ler = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");

function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linha) => linha.replace(/(^|\s)(\/\/|--).*$/, ""))
    .join("\n");
}

const MIGRACAO = `supabase/migrations/${MIGRATION_ORIGEM_PROGRAMACAO}`;

const FORNECEDOR = {
  id: 7,
  razao_social: "Produções Artísticas São José LTDA",
  nome_fantasia: "SJ Produções",
  apelido: "Zé Produções",
  secretaria_id: 2,
};

/** Registro de área com as NFs vinculadas que produzem Pago e Saldo. */
function registro(extras = {}, notas = []) {
  return {
    id: "8f1c2b7e-3a4d-4e5f-9a6b-7c8d9e0f1a2b",
    fornecedor_id: FORNECEDOR.id,
    fornecedores: FORNECEDOR,
    secretaria_id: 2,
    valor: 10000,
    situacao: "em_aberto",
    ativo: true,
    notas,
    ...extras,
  };
}

const PATROCINIO = areaPorId("patrocinios");
const ALUGUEL = areaPorId("alugueis");
const BANDA = areaPorId("bandas");

test("cada área tem a sua origem, e a origem volta para a área", () => {
  assert.deepEqual(Object.keys(ORIGEM_POR_AREA).sort(), ["alugueis", "bandas", "patrocinios"]);
  AREAS.forEach((area) => {
    const origem = origemDaArea(area);
    assert.ok(origem, `${area.id} precisa de origem`);
    assert.equal(areaDaOrigem(origem)?.id, area.id);
  });
});

test("o nome sugerido segue o padrão pedido e não mexe no cadastro", () => {
  assert.equal(
    nomeSugeridoParaProgramacao(PATROCINIO, registro({ nome: "Festa do Peão 2026" })),
    "Patrocínio — Festa do Peão 2026",
  );
  assert.equal(
    nomeSugeridoParaProgramacao(ALUGUEL, registro({ objeto: "Galpão da Rua 7" })),
    "Aluguel — Galpão da Rua 7",
  );
  // Banda vai sem prefixo: o nome do artista é o próprio rótulo.
  assert.equal(
    nomeSugeridoParaProgramacao(BANDA, registro({ banda: "Trio Serra Azul" })),
    "Trio Serra Azul",
  );

  const envio = envioParaProgramacao(PATROCINIO, registro({ nome: "Festa do Peão 2026" }));
  const item = itemDeProgramacaoDoEnvio(envio);
  // O que vai para a programação é rótulo do ITEM. Razão social, nome fantasia
  // e apelido do fornecedor não são tocados por lugar nenhum do envio.
  assert.equal(item.nome_exibicao_programacao, "Patrocínio — Festa do Peão 2026");
  assert.equal(envio.fornecedor.razao_social, FORNECEDOR.razao_social);
  assert.equal(envio.fornecedor.apelido, FORNECEDOR.apelido);
  assert.ok(!("razao_social" in item));
  assert.ok(!("apelido" in item));
});

test("o envio leva apenas fornecedor e valor a programar, e o valor é o saldo", () => {
  const comBaixa = registro({ valor: 10000 }, [{ id: 30, valor: 10000, valor_pago: 4000 }]);
  assert.equal(valorAProgramar(comBaixa), 6000);

  const envio = envioParaProgramacao(BANDA, registro({ banda: "Trio Serra Azul" }));
  assert.equal(envio.fornecedor_id, FORNECEDOR.id);
  assert.equal(envio.valor_a_pagar, 10000);
  assert.equal(envio.origem_tipo, "banda");
  assert.equal(envio.origem_id, "8f1c2b7e-3a4d-4e5f-9a6b-7c8d9e0f1a2b");
  assert.ok(envioValido(envio));

  // Nada de valor pago, nem de baixa, nem de conta viaja no envio.
  const chaves = Object.keys(envio).join(" ");
  assert.ok(!/valor_pago|baixa|conta|saldo_/i.test(chaves), chaves);
});

test("saldo negativo ou já pago não manda valor negativo para a programação", () => {
  const pago = registro({ valor: 5000 }, [{ id: 31, valor: 5000, valor_pago: 5000 }]);
  assert.equal(valorAProgramar(pago), 0);
  const aMais = registro({ valor: 5000 }, [{ id: 32, valor: 5000, valor_pago: 6000 }]);
  assert.equal(valorAProgramar(aMais), 0);
});

test("o item entra na lista com a MESMA forma dos itens de sempre", () => {
  const envio = envioParaProgramacao(ALUGUEL, registro({ objeto: "Galpão da Rua 7" }));
  const item = itemDeProgramacaoDoEnvio(envio);

  // Estas são as chaves que a tela de programação lê de cada item.
  assert.equal(item.id, null);
  assert.equal(item.fornecedor_id, FORNECEDOR.id);
  assert.equal(item.valor_a_pagar, 10000);
  assert.equal(item.nome_avulso, null);
  assert.equal(item.cadastrar_fornecedor_posteriormente, false);
  assert.equal(item.origem_tipo, "aluguel");
  assert.equal(item.origem_id, envio.origem_id);
});

test("fornecedor que já está na programação mantém o valor dele", () => {
  const envio = envioParaProgramacao(PATROCINIO, registro({ nome: "Festa do Peão 2026" }));
  const existente = {
    id: 501,
    fornecedor_id: FORNECEDOR.id,
    valor_a_pagar: 250,
    nome_exibicao_programacao: null,
  };
  const { pagamentos, resultado, mensagem } = aplicarEnvioNosPagamentos([existente], envio);

  assert.equal(resultado, "jaEstava");
  assert.equal(pagamentos.length, 1, "não duplica o fornecedor na programação");
  assert.equal(pagamentos[0].valor_a_pagar, 250, "o valor que já estava não é sobrescrito");
  assert.equal(pagamentos[0].origem_tipo, "patrocinio");
  assert.equal(pagamentos[0].nome_exibicao_programacao, "Patrocínio — Festa do Peão 2026");
  assert.match(mensagem, /já estava/i);
});

test("origem e nome que o item já tinha não são substituídos por um envio novo", () => {
  const envio = envioParaProgramacao(BANDA, registro({ banda: "Trio Serra Azul" }));
  const existente = {
    id: 502,
    fornecedor_id: FORNECEDOR.id,
    valor_a_pagar: 900,
    nome_exibicao_programacao: "Nome escolhido pelo usuário",
    origem_tipo: "aluguel",
    origem_id: "11111111-2222-3333-4444-555555555555",
  };
  const { pagamentos } = aplicarEnvioNosPagamentos([existente], envio);
  assert.equal(pagamentos[0].nome_exibicao_programacao, "Nome escolhido pelo usuário");
  assert.equal(pagamentos[0].origem_tipo, "aluguel");
  assert.equal(pagamentos[0].origem_id, "11111111-2222-3333-4444-555555555555");
});

test("itens sem origem continuam exatamente como são hoje", () => {
  const avulso = { id: 77, fornecedor_id: null, nome_avulso: "Fretes Silva", valor_a_pagar: 300 };
  const comum = { id: 78, fornecedor_id: 91, valor_a_pagar: 1200 };
  assert.equal(itemTemOrigem(avulso), false);
  assert.equal(itemTemOrigem(comum), false);
  assert.equal(itemTemOrigem({ origem_tipo: "patrocinio", origem_id: null }), false);
  assert.equal(itemTemOrigem({ origem_tipo: "outra_coisa", origem_id: "x" }), false);

  const envio = envioParaProgramacao(PATROCINIO, registro({ nome: "Festa" }));
  const { pagamentos, resultado } = aplicarEnvioNosPagamentos([avulso, comum], envio);
  assert.equal(resultado, "adicionado");
  assert.deepEqual(pagamentos[0], avulso, "o item avulso não é alterado");
  assert.deepEqual(pagamentos[1], comum, "o item comum não é alterado");
  assert.equal(pagamentos.length, 3);
});

test("registro sem fornecedor não gera envio válido", () => {
  const semFornecedor = registro({ fornecedor_id: null, fornecedores: null });
  assert.equal(envioValido(envioParaProgramacao(PATROCINIO, semFornecedor)), false);
  const { resultado } = aplicarEnvioNosPagamentos([], envioParaProgramacao(PATROCINIO, semFornecedor));
  assert.equal(resultado, "invalido");
});

test("sem programação que aceite item, o envio espera e o aviso aponta o caminho de sempre", () => {
  const envio = envioParaProgramacao(PATROCINIO, registro({ nome: "Festa" }));
  const semProgramacao = avisoDeEnvioPendente(envio, {
    programacao: null,
    podeEditarProgramacao: false,
  });
  assert.match(semProgramacao, /Nova programação/i);

  const aprovada = avisoDeEnvioPendente(envio, {
    programacao: { id: 3, status: STATUS_APROVADA },
    podeEditarProgramacao: false,
  });
  assert.match(aprovada, /aprovada|fechada/i);

  // Com programação em elaboração não há aviso: o item entra.
  assert.equal(
    avisoDeEnvioPendente(envio, {
      programacao: { id: 3, status: "em_elaboracao" },
      podeEditarProgramacao: true,
    }),
    "",
  );
});

test("a situação de pagamento do registro é lida das baixas, não guardada", () => {
  assert.equal(situacaoPagamentoDoRegistro(registro({ valor: 10000 })).value, "em_aberto");
  assert.equal(
    situacaoPagamentoDoRegistro(
      registro({ valor: 10000 }, [{ id: 40, valor: 10000, valor_pago: 4000 }]),
    ).value,
    "parcialmente_pago",
  );
  assert.equal(
    situacaoPagamentoDoRegistro(
      registro({ valor: 10000 }, [{ id: 41, valor: 10000, valor_pago: 10000 }]),
    ).value,
    "pago",
  );
  // Cancelado é situação do PRÓPRIO registro e vence a leitura das baixas.
  assert.equal(
    situacaoPagamentoDoRegistro(
      registro({ valor: 10000, situacao: "cancelado" }, [
        { id: 42, valor: 10000, valor_pago: 10000 },
      ]),
    ).value,
    "cancelado",
  );
});

test("nenhuma tabela de área ganha coluna de valor pago", () => {
  const sql = semComentarios(ler(MIGRACAO));
  assert.ok(!/valor_pago/i.test(sql), "a migration da origem não cria controle de valor pago");
  assert.ok(!/fornecedor_patrocinios\s+add column/i.test(sql));
  assert.ok(!/alter\s+table\s+public\.fornecedor_(patrocinios|alugueis|bandas)/i.test(sql));
});

test("a migration da origem é aditiva, idempotente e não encosta em saldo nem em baixa", () => {
  assert.ok(existsSync(join(RAIZ, MIGRACAO)), `${MIGRACAO} precisa existir`);
  const sql = ler(MIGRACAO);
  const codigo = semComentarios(sql);

  assert.match(codigo, /add column if not exists origem_tipo text/i);
  assert.match(codigo, /add column if not exists origem_id uuid/i);
  assert.match(codigo, /origem_tipo in \('patrocinio', 'aluguel', 'banda'\)/i);
  assert.match(codigo, /create index if not exists pagamentos_origem_idx/i);

  // Nada de mexer em saldo de conta, em baixa ou em valor pago.
  assert.ok(!/saldo_atual|saldos_contas|update\s+public\.contas_bancarias/i.test(codigo), "não movimenta saldo");
  assert.ok(!/valores_em_aberto|pagamentos_baixas|valor_pago/i.test(codigo), "não encosta em baixa");
  assert.ok(!/drop\s+(table|column|function|constraint)/i.test(codigo), "não remove nada");

  // O aviso da tela cita o arquivo certo e o SQL Editor.
  assert.match(AVISO_MIGRATION_ORIGEM, new RegExp(MIGRATION_ORIGEM_PROGRAMACAO.replace(/\./g, "\\.")));
  assert.match(AVISO_MIGRATION_ORIGEM, /SQL Editor/i);
});

test("o vínculo do pagamento continua sendo o fornecedor_id", () => {
  const rpc = semComentarios(ler(MIGRACAO));
  // A origem é gravada junto do item, e o fornecedor_id continua sendo enviado
  // e gravado como sempre pela mesma função de sempre.
  assert.match(rpc, /create or replace function public\.salvar_planejamento_programacao/i);
  assert.match(rpc, /fornecedor_id/);

  // A busca de notas da baixa não passou a usar origem em lugar nenhum.
  const baixas = semComentarios(ler("src/lib/baixasPagamentos.js"));
  assert.ok(!/origem_tipo|origem_id/.test(baixas), "a baixa não busca nota por origem");
  const regras = semComentarios(ler("src/lib/regrasBaixas.js"));
  assert.ok(!/origem_tipo|origem_id/.test(regras));
});

test("a tela de programação manda a origem e tolera a migration não rodada", () => {
  const tela = ler("src/pages/PagamentosRedesenhado.jsx");
  assert.match(tela, /origem_tipo, origem_id, fornecedores\(razao_social, apelido\)/);
  assert.match(tela, /estruturaDeApelidoAusente\(comOrigem\.error\)/);
  assert.match(tela, /origem_tipo: itemTemOrigem\(item\) \? item\.origem_tipo : null/);
  assert.match(tela, /salvar_planejamento_programacao/, "a gravação continua sendo a mesma RPC");

  // A tela não ganhou caminho de gravação novo para o envio das áreas.
  const codigo = semComentarios(tela);
  assert.ok(!/from\("fornecedor_(patrocinios|alugueis|bandas)"\)/.test(codigo));
  assert.ok(!/\.insert\(\{\s*programacao_id/.test(codigo), "o item continua sendo gravado pela RPC");
});

test("a ação da área só monta o envio e navega, sem gravar pagamento", () => {
  const pagina = ler("src/components/fornecedores/areas/PaginaAreaFornecedores.jsx");
  assert.match(pagina, /envioParaProgramacao\(area, registro\)/);
  assert.match(pagina, /guardarEnvio\(envio\)/);
  assert.match(pagina, /registrarEnvioParaProgramacao\(area\.id, registro, envio\)/);
  assert.match(pagina, /navigate\("\/pagamentos"\)/);

  const codigo = semComentarios(pagina);
  assert.ok(!/from\("pagamentos"\)/.test(codigo), "a área não grava item de programação");
  assert.ok(!/rpc\(/.test(codigo), "a área não chama RPC de programação");
  assert.ok(!/valor_pago/.test(codigo), "a área não grava valor pago");
});

test("Vínculos Específicos conta por permissão, some quando não há registro e filtra por id", () => {
  const componente = ler("src/components/fornecedores/VinculosEspecificos.jsx");
  assert.match(componente, /comRegistros\.length === 0\) return null/);
  assert.match(componente, /contagensDasAreasDoFornecedor\(fornecedorId, \{ permissoes \}\)/);
  assert.match(componente, /\?fornecedor=\$\{fornecedorId\}/);

  const dados = ler("src/lib/areasFornecedoresDados.js");
  assert.match(dados, /permissoes\?\.\[area\.id\]\?\.visualizar === true/);
  assert.match(dados, /\{ count: "exact", head: true \}/);

  // O recorte da lista é por fornecedor_id, nunca por nome.
  const pagina = ler("src/components/fornecedores/areas/PaginaAreaFornecedores.jsx");
  assert.match(pagina, /String\(registro\.fornecedor_id\) === fornecedorRecorte/);

  // A ficha do fornecedor apenas passa o id para a seção.
  const ficha = ler("src/components/fornecedores/VidaDoFornecedor.jsx");
  assert.match(ficha, /<VinculosEspecificos fornecedorId=\{fornecedor\.id\} \/>/);
});

test("o envio para a programação é registrado na auditoria", () => {
  const auditoria = ler("src/lib/auditoria.js");
  assert.match(auditoria, /enviou_para_programacao/);

  const dados = ler("src/lib/areasFornecedoresDados.js");
  assert.match(dados, /acao: "enviou_para_programacao"/);
  assert.match(dados, /fornecedor_id/);
  assert.match(dados, /valor_a_programar/);
  assert.match(dados, /origem_tipo/);
});

test("os rótulos das origens são os pedidos", () => {
  assert.equal(rotuloDaOrigem("patrocinio"), "Patrocínio");
  assert.equal(rotuloDaOrigem("aluguel"), "Aluguel");
  assert.equal(rotuloDaOrigem("banda"), "Banda");
  assert.equal(rotuloDaOrigem("qualquer"), "");
});
