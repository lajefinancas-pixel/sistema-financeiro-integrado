// SINO DO PAINEL PRINCIPAL: O CONTADOR ABRIA NADA.
//
// O ícone de sino no topo do Painel Principal mostrava o número de pendências,
// mas o botão não tinha ação nenhuma: clicar nele não abria painel e não
// navegava. O painel nunca havia sido construído.
//
// O que estes testes travam:
//
//   O SINO ABRE UM PAINEL COM AS PENDÊNCIAS
//   O NÚMERO DO SINO É O TAMANHO DA LISTA QUE ELE MOSTRA
//   A FONTE É A MESMA DOS DOIS BLOCOS DO PAINEL (SEM CONSULTA NOVA)
//   PERMISSÃO É HERDADA: O SINO NÃO DECIDE NADA POR CONTA PRÓPRIA
//   CADA PENDÊNCIA LEVA À TELA CERTA
//   FECHA AO CLICAR FORA E FUNCIONA POR TOQUE
//   SEM PENDÊNCIA: NENHUM CONTADOR E A FRASE "NENHUMA PENDÊNCIA NO MOMENTO"
//   NADA DE NOTIFICAÇÃO PERSISTIDA, LIDA, HISTÓRICO OU E-MAIL
//   O RESTO DO PAINEL PRINCIPAL CONTINUA IGUAL
//
// A união das pendências é função pura e é testada direto. O que é de tela
// (React + Supabase, que não podem ser importados aqui) é travado pelo texto
// dos arquivos, como nos outros testes de tela deste repositório.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TEXTO_SEM_PENDENCIA,
  contarPendencias,
  unirPendencias,
} from "../src/lib/pendenciasPainel.js";
import { ATALHOS, atalhoDaUrl, rotaCertidoesAVencer } from "../src/lib/atalhosCertidoes.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const PAINEL = "src/pages/Dashboard.jsx";
const SINO = "src/components/painel/SinoPendencias.jsx";
const SECOES = "src/components/painel/SecoesPessoais.jsx";
const PENDENCIAS = "src/lib/pendenciasPainel.js";
const PESSOAL = "src/lib/painelPessoal.js";
const TELA_CERTIDOES = "src/pages/Certidoes.jsx";

// Linhas como os dois blocos do painel as produzem hoje.
const ATENCAO = [
  { id: "certidoes-vencidas", cor: "#DC2626", texto: "3 certidões vencidas", rota: "/certidoes?atalho=vencidas" },
  { id: "tarefas-atrasadas", cor: "#DC2626", texto: "1 tarefa atrasada", rota: "/tarefas" },
];
const ALERTAS = [
  { id: "notas-vencidas", cor: "#DC2626", label: "Notas fiscais vencidas -- 4", rota: "/fornecedores" },
  { id: "fechamentos-pendentes", cor: "#EA9A1E", label: "Fechamentos diários pendentes -- 2", rota: "/pagamentos" },
];

// ---------------------------------------------------------------------------
// O número do sino é a lista do sino
// ---------------------------------------------------------------------------

test("o contador do sino é exatamente o tamanho da lista que ele abre", () => {
  const lista = unirPendencias({ atencao: ATENCAO, alertas: ALERTAS });
  assert.equal(lista.length, 4);
  assert.equal(contarPendencias({ atencao: ATENCAO, alertas: ALERTAS }), lista.length);
});

test("o sino mostra as mesmas linhas dos dois blocos, na mesma ordem", () => {
  const lista = unirPendencias({ atencao: ATENCAO, alertas: ALERTAS });
  assert.deepEqual(
    lista.map((item) => item.texto),
    [
      "3 certidões vencidas",
      "1 tarefa atrasada",
      "Notas fiscais vencidas -- 4",
      "Fechamentos diários pendentes -- 2",
    ],
  );
  // O rótulo dos alertas se chama "label" no bloco e vira "texto" no sino --
  // é a única diferença entre as duas origens.
  assert.deepEqual(
    lista.map((item) => item.rota),
    ["/certidoes?atalho=vencidas", "/tarefas", "/fornecedores", "/pagamentos"],
  );
});

test("uma pendência que sai de um bloco sai do contador do sino", () => {
  // Sem certidões (por permissão, por RLS ou porque não há nenhuma vencida), a
  // linha desaparece dos dois lugares ao mesmo tempo.
  const semCertidoes = ATENCAO.filter((i) => i.id !== "certidoes-vencidas");
  assert.equal(contarPendencias({ atencao: semCertidoes, alertas: ALERTAS }), 3);
  assert.equal(contarPendencias({ atencao: [], alertas: [] }), 0);
  assert.equal(contarPendencias({}), 0);
  assert.equal(contarPendencias(), 0);
});

test("a mesma pendência não conta duas vezes", () => {
  const repetida = unirPendencias({ atencao: ATENCAO, alertas: [...ALERTAS, ALERTAS[0]] });
  assert.equal(repetida.length, 4);
});

test("linha sem rótulo não entra na lista nem no contador", () => {
  const lista = unirPendencias({ atencao: [{ id: "vazia" }, ...ATENCAO], alertas: [] });
  assert.equal(lista.length, 2);
});

test("o sino não recalcula pendência: a união não consulta nem soma nada", async () => {
  const fonte = await read(PENDENCIAS);
  assert.doesNotMatch(fonte, /^import /m, "a união das pendências não deve depender de nada");
  assert.doesNotMatch(fonte, /supabase|from\("|select\(/);
  // O contador é o tamanho da lista por construção, não uma contagem paralela.
  assert.match(fonte, /export function contarPendencias\([^)]*\) \{\s*\n\s*return unirPendencias\(/);
});

// ---------------------------------------------------------------------------
// Uma leitura só alimenta os blocos e o sino
// ---------------------------------------------------------------------------

test("o painel lê as seções pessoais uma vez e passa a mesma leitura ao sino", async () => {
  const painel = await read(PAINEL);
  assert.match(painel, /const dadosPessoais = usePainelPessoal\(\);/);
  assert.equal((painel.match(/usePainelPessoal\(\)/g) ?? []).length, 1);
  assert.match(painel, /<SecoesPessoais dados=\{dadosPessoais\} \/>/);
  assert.match(painel, /<SinoPendencias[\s\S]{0,240}atencao=\{dadosPessoais\.atencao\}/);
  assert.match(painel, /<SinoPendencias[\s\S]{0,240}alertas=\{pendencias\}/);

  // A seção pessoal deixou de fazer a leitura por conta própria: se ela lesse
  // de novo, o sino e a seção poderiam mostrar números diferentes.
  const secoes = await read(SECOES);
  assert.doesNotMatch(secoes, /usePainelPessoal\(/);
  assert.match(secoes, /export default function SecoesPessoais\(\{ dados \}\)/);
});

test("o sino não faz consulta e não decide permissão por conta própria", async () => {
  const sino = await read(SINO);
  assert.doesNotMatch(sino, /supabase|usePermissao|pode_visualizar|from\("/);
  assert.match(sino, /unirPendencias/);
  // Permissão vem de quem monta as listas: sem direito a certidões, a linha de
  // certidão não existe na origem e, por isso, não existe no sino.
  const pessoal = await read(PESSOAL);
  assert.match(pessoal, /certidoes\?\.vencidas > 0/);
});

// ---------------------------------------------------------------------------
// Abrir, fechar, tocar
// ---------------------------------------------------------------------------

test("o botão do sino abre e fecha o painel", async () => {
  const sino = await read(SINO);
  assert.match(sino, /onClick=\{\(\) => setAberto\(\(v\) => !v\)\}/);
  assert.match(sino, /aria-expanded=\{aberto\}/);
  assert.match(sino, /\{aberto && \(/);

  // E o painel não tem mais um sino sem ação nenhuma.
  const painel = await read(PAINEL);
  assert.doesNotMatch(painel, /<Bell/);
  assert.match(painel, /<SinoPendencias/);
});

test("fecha ao clicar fora, com Esc, e o toque no iPad é atendido", async () => {
  const sino = await read(SINO);
  assert.match(sino, /window\.PointerEvent[\s\S]{0,120}pointerdown/);
  assert.match(sino, /"mousedown", "touchstart"/);
  assert.match(sino, /!caixaRef\.current\.contains\(evento\.target\)\) setAberto\(false\)/);
  assert.match(sino, /evento\.key === "Escape"/);
  // Botões de verdade (não div com onClick), alvo de toque confortável e sem
  // atraso de duplo-toque.
  assert.match(sino, /type="button"[\s\S]{0,200}onClick=\{\(\) => abrirPendencia\(item\)\}/);
  assert.match(sino, /min-h-\[44px\]/);
  assert.equal((sino.match(/touch-manipulation/g) ?? []).length, 2);
});

test("clicar numa pendência fecha o painel e vai para a tela dela", async () => {
  const sino = await read(SINO);
  assert.match(
    sino,
    /function abrirPendencia\(item\) \{\s*\n\s*setAberto\(false\);\s*\n\s*if \(item\.rota\) navigate\(item\.rota\);/,
  );
});

test("sem pendência o sino não mostra contador e avisa que não há nada", async () => {
  const sino = await read(SINO);
  assert.equal(TEXTO_SEM_PENDENCIA, "Nenhuma pendência no momento.");
  assert.match(sino, /pendencias\.length > 0 && \(/);
  assert.match(sino, /TEXTO_SEM_PENDENCIA/);
});

test("o sino não cria notificação persistida, leitura, histórico nem e-mail", async () => {
  const [sino, uniao] = await Promise.all([read(SINO), read(PENDENCIAS)]);
  [sino, uniao].forEach((fonte) => {
    assert.doesNotMatch(
      fonte,
      /from\("notificacoes"|listarNotificacoes|marcar(ComoLida|TodasComoLidas)|\.lida\b|sendMail|nodemailer/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Certidões vencidas abrem a listagem já recortada
// ---------------------------------------------------------------------------

test("o atalho pela URL só aceita recorte que existe na tela de Certidões", () => {
  assert.equal(atalhoDaUrl("vencidas"), "vencidas");
  assert.equal(atalhoDaUrl("vence_30"), "vence_30");
  assert.equal(atalhoDaUrl("pendencias"), "");
  assert.equal(atalhoDaUrl(null), "");
  assert.equal(atalhoDaUrl(undefined), "");
  assert.ok(ATALHOS.some((a) => a.id === "vencidas"));
});

test("a janela de alerta configurada escolhe o recorte, e a desconhecida abre tudo", () => {
  assert.equal(rotaCertidoesAVencer(30), "/certidoes?atalho=vence_30");
  assert.equal(rotaCertidoesAVencer(7), "/certidoes?atalho=vence_7");
  assert.equal(rotaCertidoesAVencer(45), "/certidoes");
});

test("certidões vencidas levam à listagem filtrada por vencidas", async () => {
  const pessoal = await read(PESSOAL);
  assert.match(pessoal, /rota: "\/certidoes\?atalho=vencidas"/);
  assert.match(pessoal, /rota: rotaCertidoesAVencer\(certidoes\.janela\)/);

  const tela = await read(TELA_CERTIDOES);
  assert.match(tela, /const atalhoPedido = atalhoDaUrl\(parametros\.get\("atalho"\)\);/);
  assert.match(tela, /\{ \.\.\.FILTROS_VAZIOS, atalho: atalhoPedido \}/);
});

// ---------------------------------------------------------------------------
// Nada de regra financeira mudou
// ---------------------------------------------------------------------------

test("o resto do Painel Principal continua o mesmo", async () => {
  const painel = await read(PAINEL);
  // Os blocos e os números do painel seguem intactos.
  assert.match(painel, /Saldo consolidado das contas/);
  assert.match(painel, /Pendências e Alertas/);
  assert.match(painel, /Últimos Registros/);
  assert.match(painel, /Pagamentos Programados/);
  assert.match(painel, /Ações Rápidas/);
  assert.match(painel, /<CardCertidoes \/>/);
  // Saldo Disponível = Saldo Real - Valor Reservado, como nas outras telas.
  assert.match(painel, /emCentavos\(saldoRealTotal - valorReservadoTotal\)/);
  // As três pendências do bloco continuam com a mesma origem e a mesma rota.
  assert.match(painel, /Notas fiscais vencidas -- \$\{vencidos\.length\}`, rota: "\/fornecedores"/);
  assert.match(
    painel,
    /Documentos próximos do vencimento -- \$\{proximosVencer\.length\}`, rota: "\/fornecedores"/,
  );
  assert.match(painel, /Fechamentos diários pendentes -- \$\{progsAbertas\.length\}`, rota: "\/pagamentos"/);
  assert.match(painel, /\.in\("situacao", \["em_aberto", "programado", "parcialmente_pago"\]\)/);
});
