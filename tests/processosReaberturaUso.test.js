import test from "node:test";
import assert from "node:assert/strict";

import {
  formularioParaBanco,
  processoParaFormulario,
  sincronizarAssinanteDaLiquidacao,
} from "../src/lib/processosServicos.js";

const completo = {
  id: "processo-7",
  ano: 2026,
  numero: 7,
  situacao: "finalizada",
  data_processo: "2026-09-10",
  requisicao_data: "2026-09-10",
  liquidacao_data: "2026-09-12",
  objeto: "Peças para manutenção da frota",
  referencia: "Referente à aquisição de peças",
  fundamentacao: "Nota fiscal 9187",
  observacoes: "Entrega conferida",
  liquidacao_observacoes: "Pagamento solicitado",
  valor_total: 1847.35,
  itens: [
    { quantidade: "1 UN", discriminacao: "RETENTOR CARRARO CUBO DA RODA DIANTEIRA" },
    { quantidade: "2 UN", discriminacao: "ROLAMENTO DO EIXO" },
  ],
  requisitante_servidor_id: "servidor-1",
  requisitante_nome: "Maria das Dores Lima",
  requisitante_cpf: "123.456.789-00",
  requisitante_cargo: "Diretora de Transportes",
};

test("processo completo atravessa duas reaberturas sem perder conteúdo, espaços ou número", () => {
  let registro = completo;
  for (let vez = 0; vez < 2; vez += 1) {
    const formulario = processoParaFormulario({ ...registro, situacao: "rascunho" });
    const persistido = formularioParaBanco(formulario);
    assert.equal(formulario.id, completo.id);
    assert.equal(formulario.numero, 7);
    assert.equal(formulario.ano, 2026);
    assert.deepEqual(persistido.itens, completo.itens);
    assert.equal(persistido.objeto, completo.objeto);
    assert.equal(persistido.referencia, completo.referencia);
    assert.equal(persistido.fundamentacao, completo.fundamentacao);
    assert.equal(persistido.observacoes, completo.observacoes);
    assert.equal(persistido.liquidacao_observacoes, completo.liquidacao_observacoes);
    registro = { ...registro, ...persistido, situacao: "finalizada" };
  }
});

test("assinante da liquidação acompanha a requisição até existir preenchimento manual", () => {
  const sugerido = sincronizarAssinanteDaLiquidacao({}, completo);
  assert.equal(sugerido.liquidacao_assinante_nome, completo.requisitante_nome);
  assert.equal(sugerido.liquidacao_assinante_cpf, completo.requisitante_cpf);
  assert.equal(sugerido.liquidacao_assinante_cargo, completo.requisitante_cargo);

  const manual = { ...sugerido, liquidacao_assinante_nome: "Outra servidora", requisitante_nome: "Novo requisitante" };
  assert.equal(
    sincronizarAssinanteDaLiquidacao(sugerido, manual, { preenchidoManualmente: true }).liquidacao_assinante_nome,
    "Outra servidora",
  );
});

