import { supabase } from "./supabaseClient";

/**
 * Camada de dados da aba "Permissões" da tela de edição de usuário.
 *
 * O sistema tem três peças no banco:
 *   perfis_acesso       -> os perfis (Administrador, Gestora Financeira, ...)
 *   perfis_permissoes   -> o que cada perfil pode fazer em cada módulo (o PADRÃO)
 *   permissoes_excecao  -> ajustes individuais de um usuário sobre esse padrão
 *   permissoes_efetivas -> view que junta padrão + exceção (o que vale de fato)
 *
 * A tela lê a permissão EFETIVA da view e grava apenas o que difere do perfil
 * em permissoes_excecao. Quando um módulo volta a ser igual ao perfil, a linha
 * de exceção é apagada.
 */

// Módulos ajustáveis individualmente nesta aba. A lista vale para tudo:
// leitura do padrão do perfil, exibição das seções, gravação da exceção e o
// botão "Restaurar padrão do perfil". Certidões entra aqui como os demais.
export const MODULOS = [
  { id: "saldos", label: "Saldos" },
  { id: "fornecedores", label: "Fornecedores" },
  // As três áreas específicas dentro de Fornecedores. Cada uma é um módulo
  // próprio, com permissão própria; nenhuma permissão que já existia muda de
  // significado por causa delas.
  { id: "patrocinios", label: "Fornecedores · Patrocínios" },
  { id: "alugueis", label: "Fornecedores · Aluguéis" },
  { id: "bandas", label: "Fornecedores · Bandas" },
  { id: "pagamentos", label: "Pagamentos" },
  { id: "baixas", label: "Baixas de Pagamentos" },
  { id: "tributario", label: "Tributário" },
  { id: "certidoes", label: "Certidões" },
  { id: "relatorios", label: "Relatórios" },
  { id: "auditoria", label: "Auditoria" },
  { id: "administracao", label: "Administração" },
  { id: "tarefas", label: "Tarefas" },
  { id: "backup", label: "Backup" },
  // PROCESSOS · Diárias. São dois módulos porque a área tem sete ações e a
  // tabela tem cinco colunas: o segundo módulo carrega imprimir e duplicar.
  // Módulo DOCUMENTAL -- nenhuma destas permissões concede pagar, dar baixa,
  // debitar conta ou mexer na Programação Diária.
  { id: "processos_diarias", label: "Processos · Diárias" },
  { id: "processos_diarias_saida", label: "Processos · Diárias (impressão e duplicação)" },
  { id: "processos_diarias_tabela", label: "Processos · Tabela de Diárias" },
  // PROCESSOS · Serviços/Materiais. Dois módulos pela MESMA razão: sete ações,
  // cinco colunas. As permissões são SEPARADAS das de Diárias -- liberar uma não
  // libera a outra. Módulo igualmente DOCUMENTAL: nem "finalizar" nem
  // "imprimir" pagam nada, dão baixa em NF ou debitam conta.
  { id: "processos_servicos", label: "Processos · Serviços/Materiais" },
  {
    id: "processos_servicos_saida",
    label: "Processos · Serviços/Materiais (impressão e duplicação)",
  },
  // PROCESSOS · Servidores: o CADASTRO dos servidores do município. Módulo
  // próprio porque é cadastro, não é processo -- quem preenche uma diária não
  // passa a poder criar, editar ou inativar servidores. Não é o cadastro de
  // fornecedores e não concede nada sobre ele.
  { id: "processos_servidores", label: "Processos · Servidores" },
  // PROCESSOS · Prefeita: o cadastro de quem chefia o Poder Executivo e
  // AUTORIZA os documentos. Módulo próprio e RESTRITO pela mesma razão da
  // Tabela de Diárias: quem preenche um processo não passa a poder trocar quem
  // autoriza os documentos do município.
  { id: "processos_prefeita", label: "Processos · Prefeita (cadastro)" },
];

export const ACOES = [
  { campo: "pode_visualizar", label: "Visualizar" },
  { campo: "pode_cadastrar", label: "Cadastrar" },
  { campo: "pode_editar", label: "Editar" },
  { campo: "pode_excluir", label: "Excluir" },
  { campo: "pode_aprovar", label: "Aprovar" },
];

// "Visualizar valores" existe no banco para todos os módulos, mas só faz
// sentido (e só é editável) em Saldos.
export const CAMPO_VALORES = "pode_visualizar_valores";
export const MODULO_COM_VALORES = "saldos";

/**
 * Backup usa as mesmas cinco colunas dos demais módulos, mas as ações da
 * categoria não são "cadastrar/editar/excluir/aprovar" — são gerar, restaurar,
 * ver o histórico e administrar. Os rótulos abaixo dizem, em cada checkbox, o
 * que a permissão realmente concede, para que quem administra não precise
 * decorar o mapeamento.
 *
 * O mesmo mapa está escrito na migration 20260823180000 e em lib/backups.js.
 * As cinco são independentes: dá para conceder "Gerar backup manual" sem
 * conceder "Restaurar backup".
 */
export const MODULO_BACKUP = "backup";

const ACOES_BACKUP = [
  { campo: "pode_visualizar", label: "Visualizar backups" },
  { campo: "pode_cadastrar", label: "Gerar backup manual" },
  { campo: "pode_aprovar", label: "Visualizar histórico" },
  { campo: "pode_excluir", label: "Restaurar backup" },
  { campo: "pode_editar", label: "Administrar configurações de backup" },
];

/**
 * Saldos das Contas usa as mesmas cinco colunas, e os rótulos dizem sobre o que
 * cada uma manda: as três do meio governam o CADASTRO das contas bancárias.
 * Lançar o saldo do dia continua liberado para quem visualiza o módulo — é a
 * rotina diária da tela e não foi restringida.
 *
 * "Excluir" em conta bancária é desativar/reativar: não existe exclusão
 * definitiva de conta com histórico financeiro.
 */
const ACOES_SALDOS = [
  { campo: "pode_visualizar", label: "Visualizar saldos" },
  { campo: "pode_cadastrar", label: "Cadastrar conta bancária" },
  { campo: "pode_editar", label: "Editar conta bancária" },
  { campo: "pode_excluir", label: "Desativar / reativar conta bancária" },
  { campo: "pode_aprovar", label: "Aprovar" },
  { campo: CAMPO_VALORES, label: "Visualizar valores" },
];

/**
 * Baixas de Pagamentos usa as mesmas cinco colunas, com rótulos próprios: as
 * ações da aba são visualizar, registrar a baixa, imprimir, exportar e estornar.
 *
 * O mesmo mapa está escrito na migration 20260829120000 e na função do banco
 * `public.pode_em_baixas`. As cinco são independentes: dá para conceder
 * "Registrar baixa" sem conceder "Estornar baixa".
 */
export const MODULO_BAIXAS = "baixas";

const ACOES_BAIXAS = [
  { campo: "pode_visualizar", label: "Visualizar baixas" },
  { campo: "pode_cadastrar", label: "Registrar baixa" },
  { campo: "pode_editar", label: "Imprimir" },
  { campo: "pode_aprovar", label: "Exportar" },
  { campo: "pode_excluir", label: "Estornar baixa" },
];

/**
 * As áreas específicas de Fornecedores (Patrocínios, Aluguéis e Bandas) usam
 * quatro das cinco colunas, com os rótulos das ações que a área realmente tem.
 *
 * "Inativar" é a exclusão lógica da área -- o registro nunca é apagado, como no
 * resto do sistema. "Aprovar" não é usado por estas áreas: aprovar não é pagar,
 * e nenhuma delas registra pagamento.
 *
 * O mesmo mapa está escrito na migration
 * 20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql e na função
 * do banco `public.pode_em_area_fornecedor`.
 */
export const MODULOS_AREAS_FORNECEDORES = ["patrocinios", "alugueis", "bandas"];

const ACOES_AREAS_FORNECEDORES = [
  { campo: "pode_visualizar", label: "Visualizar" },
  { campo: "pode_cadastrar", label: "Criar" },
  { campo: "pode_editar", label: "Editar" },
  { campo: "pode_excluir", label: "Inativar" },
];

/**
 * PROCESSOS · Diárias usa as mesmas cinco colunas, repartidas em dois módulos
 * porque a área tem sete ações próprias: visualizar, criar, editar, finalizar,
 * cancelar, imprimir e duplicar.
 *
 *   processos_diarias         visualizar | criar | editar | finalizar | cancelar
 *   processos_diarias_saida   imprimir   | duplicar
 *   processos_diarias_tabela  editar a Tabela de Diárias (permissão RESTRITA:
 *                             é o parâmetro que define o valor das diárias)
 *
 * "Finalizar" fecha o documento -- NÃO paga, não gera pagamento, não debita
 * conta e não altera saldo. "Cancelar" é a exclusão lógica da área: o processo
 * e o histórico dele nunca são apagados, e o número nunca volta a ser usado.
 *
 * O mesmo mapa está escrito na migration
 * 20260911160000_processos_modulo_diarias.sql e na função do banco
 * `public.pode_em_processos`.
 */
export const MODULO_PROCESSOS_DIARIAS = "processos_diarias";
export const MODULO_PROCESSOS_DIARIAS_SAIDA = "processos_diarias_saida";
export const MODULO_PROCESSOS_DIARIAS_TABELA = "processos_diarias_tabela";

/**
 * PROCESSOS · Servidores é o CADASTRO dos servidores do município, e tem módulo
 * próprio: as quatro ações dele cabem nas colunas existentes.
 *
 *   processos_servidores  visualizar | criar | editar | INATIVAR
 *
 * "Inativar" ocupa a coluna de exclusão porque inativar É a exclusão deste
 * cadastro: a linha nunca é apagada, já que processos antigos apontam para ela.
 *
 * ⚠️ Isto NÃO é permissão sobre o cadastro de fornecedores. São dois cadastros
 * distintos: liberar servidores não libera nada em Fornecedores, e vice-versa.
 */
export const MODULO_PROCESSOS_SERVIDORES = "processos_servidores";

/**
 * PROCESSOS · Prefeita é o cadastro da chefe do Poder Executivo, e tem módulo
 * próprio porque a permissão de EDITAR é restrita:
 *
 *   processos_prefeita  visualizar | EDITAR o cadastro
 *
 * Consultar acompanha quem vê o módulo Processos -- o documento precisa do nome
 * para imprimir. Editar é permissão à parte: mudar quem autoriza os documentos
 * do município não acompanha quem preenche processo.
 */
export const MODULO_PROCESSOS_PREFEITA = "processos_prefeita";

/**
 * PROCESSOS · Serviços/Materiais reparte as mesmas cinco colunas em dois
 * módulos, porque a área tem sete ações próprias:
 *
 *   processos_servicos         visualizar | criar | editar | finalizar | cancelar
 *   processos_servicos_saida   imprimir   | duplicar
 *
 * ⚠️ São permissões SEPARADAS das de Diárias: quem preenche uma diária não passa
 * a poder criar processo de serviço, e vice-versa. Nada do que já existia foi
 * alterado -- estas são linhas NOVAS na Matriz.
 *
 * "Finalizar" fecha o documento -- NÃO paga, não gera pagamento, não dá baixa em
 * NF, não debita conta e não altera saldo. "Cancelar" é a exclusão lógica da
 * área: o processo e o histórico nunca são apagados, e o número nunca volta a
 * ser usado.
 *
 * O mesmo mapa está escrito na migration
 * 20260911260000_processos_modulo_servicos.sql e na função do banco
 * `public.pode_em_processos`.
 */
export const MODULO_PROCESSOS_SERVICOS = "processos_servicos";
export const MODULO_PROCESSOS_SERVICOS_SAIDA = "processos_servicos_saida";

const ACOES_PROCESSOS_DIARIAS = [
  { campo: "pode_visualizar", label: "Visualizar" },
  { campo: "pode_cadastrar", label: "Criar" },
  { campo: "pode_editar", label: "Editar" },
  { campo: "pode_aprovar", label: "Finalizar (não é pagar)" },
  { campo: "pode_excluir", label: "Cancelar / anular" },
];

const ACOES_PROCESSOS_DIARIAS_SAIDA = [
  { campo: "pode_visualizar", label: "Imprimir e gerar PDF" },
  { campo: "pode_cadastrar", label: "Duplicar" },
];

// A Tabela de Diárias tem DUAS ações e nenhuma a mais: ver (que acompanha quem
// vê o módulo Processos) e EDITAR, que é restrita — quem edita a tabela mexe no
// parâmetro que define o valor das diárias de todo mundo.
const ACOES_PROCESSOS_DIARIAS_TABELA = [
  { campo: "pode_visualizar", label: "Consultar a tabela" },
  { campo: "pode_editar", label: "Editar a tabela (afeta valores de diária)" },
];

// O cadastro da PREFEITA tem duas ações: consultar (que acompanha quem vê o
// módulo Processos) e EDITAR, restrita -- é quem autoriza os documentos.
const ACOES_PROCESSOS_PREFEITA = [
  { campo: "pode_visualizar", label: "Consultar o cadastro" },
  { campo: "pode_editar", label: "Editar o cadastro da prefeita (quem autoriza os documentos)" },
];

const ACOES_PROCESSOS_SERVICOS = [
  { campo: "pode_visualizar", label: "Visualizar" },
  { campo: "pode_cadastrar", label: "Criar" },
  { campo: "pode_editar", label: "Editar" },
  { campo: "pode_aprovar", label: "Finalizar (não é pagar)" },
  { campo: "pode_excluir", label: "Cancelar / anular" },
];

const ACOES_PROCESSOS_SERVICOS_SAIDA = [
  { campo: "pode_visualizar", label: "Imprimir e gerar PDF" },
  { campo: "pode_cadastrar", label: "Duplicar" },
];

const ACOES_PROCESSOS_SERVIDORES = [
  { campo: "pode_visualizar", label: "Visualizar" },
  { campo: "pode_cadastrar", label: "Criar" },
  { campo: "pode_editar", label: "Editar" },
  { campo: "pode_excluir", label: "Inativar e reativar" },
];

const CAMPOS_PERMISSAO = [...ACOES.map((a) => a.campo), CAMPO_VALORES];

/**
 * Ações exibidas na seção do módulo: as cinco padrão, ou os rótulos próprios de
 * Saldos (que incluem "Visualizar valores") e de Backup.
 */
export function acoesDoModulo(modulo) {
  if (modulo === MODULO_BACKUP) return ACOES_BACKUP;
  if (modulo === MODULO_COM_VALORES) return ACOES_SALDOS;
  if (modulo === MODULO_BAIXAS) return ACOES_BAIXAS;
  if (MODULOS_AREAS_FORNECEDORES.includes(modulo)) return ACOES_AREAS_FORNECEDORES;
  if (modulo === MODULO_PROCESSOS_DIARIAS) return ACOES_PROCESSOS_DIARIAS;
  if (modulo === MODULO_PROCESSOS_DIARIAS_SAIDA) return ACOES_PROCESSOS_DIARIAS_SAIDA;
  if (modulo === MODULO_PROCESSOS_DIARIAS_TABELA) return ACOES_PROCESSOS_DIARIAS_TABELA;
  if (modulo === MODULO_PROCESSOS_SERVICOS) return ACOES_PROCESSOS_SERVICOS;
  if (modulo === MODULO_PROCESSOS_SERVICOS_SAIDA) return ACOES_PROCESSOS_SERVICOS_SAIDA;
  if (modulo === MODULO_PROCESSOS_SERVIDORES) return ACOES_PROCESSOS_SERVIDORES;
  if (modulo === MODULO_PROCESSOS_PREFEITA) return ACOES_PROCESSOS_PREFEITA;
  return ACOES;
}

function linhaVazia() {
  const vazia = {};
  CAMPOS_PERMISSAO.forEach((campo) => {
    vazia[campo] = false;
  });
  return vazia;
}

function normalizar(origem) {
  const linha = {};
  CAMPOS_PERMISSAO.forEach((campo) => {
    linha[campo] = origem?.[campo] === true;
  });
  return linha;
}

/**
 * Carrega tudo que a aba precisa para um usuário:
 *   perfil    -> perfil de acesso atual (ou null)
 *   padrao    -> permissões do perfil, por módulo
 *   excecoes  -> linhas de permissoes_excecao já gravadas, por módulo
 *   valores   -> permissão efetiva, por módulo (estado inicial dos checkboxes)
 */
export async function carregarPermissoesDoUsuario(usuarioId) {
  const { data: usuario, error: erroUsuario } = await supabase
    .from("usuarios")
    .select("perfil_id, perfis_acesso ( id, nome, descricao )")
    .eq("id", usuarioId)
    .single();
  if (erroUsuario) throw erroUsuario;

  const perfilId = usuario?.perfil_id ?? null;
  const colunas = `modulo, ${CAMPOS_PERMISSAO.join(", ")}`;

  const [padraoResposta, excecaoResposta, efetivaResposta] = await Promise.all([
    perfilId
      ? supabase.from("perfis_permissoes").select(colunas).eq("perfil_id", perfilId)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("permissoes_excecao").select(`id, ${colunas}`).eq("usuario_id", usuarioId),
    supabase.from("permissoes_efetivas").select(colunas).eq("usuario_id", usuarioId),
  ]);

  const erro = padraoResposta.error || excecaoResposta.error || efetivaResposta.error;
  if (erro) throw erro;

  const padrao = {};
  const excecoes = {};
  const valores = {};

  const porModulo = (lista) => {
    const mapa = new Map();
    (lista ?? []).forEach((linha) => mapa.set(linha.modulo, linha));
    return mapa;
  };
  const mapaPadrao = porModulo(padraoResposta.data);
  const mapaExcecao = porModulo(excecaoResposta.data);
  const mapaEfetiva = porModulo(efetivaResposta.data);

  MODULOS.forEach(({ id }) => {
    padrao[id] = mapaPadrao.has(id) ? normalizar(mapaPadrao.get(id)) : linhaVazia();
    excecoes[id] = mapaExcecao.get(id) ?? null;
    // A view é a fonte da permissão efetiva; sem linha lá (usuário sem perfil,
    // por exemplo) o padrão do perfil é o ponto de partida.
    valores[id] = mapaEfetiva.has(id) ? normalizar(mapaEfetiva.get(id)) : { ...padrao[id] };
  });

  return { perfilId, perfil: usuario?.perfis_acesso ?? null, padrao, excecoes, valores };
}

/** Campos que a aba controla em cada módulo (os demais ficam como estão). */
function camposEditaveis(modulo) {
  return acoesDoModulo(modulo).map((a) => a.campo);
}

/** true quando o valor escolhido para o módulo difere do padrão do perfil. */
export function moduloTemExcecao(modulo, valoresModulo, padraoModulo) {
  return camposEditaveis(modulo).some((campo) => valoresModulo?.[campo] !== padraoModulo?.[campo]);
}

/**
 * Monta a linha de exceção do módulo: apenas os campos diferentes do perfil.
 * Campos iguais ao perfil vão como null para que a view volte a usar o padrão.
 * Retorna null quando não há nenhuma diferença.
 */
function montarExcecao(usuarioId, modulo, valoresModulo, padraoModulo, excecaoAtual) {
  const editaveis = camposEditaveis(modulo);
  const linha = { usuario_id: usuarioId, modulo };
  let temDiferenca = false;

  CAMPOS_PERMISSAO.forEach((campo) => {
    if (!editaveis.includes(campo)) {
      // Campo fora do controle desta seção (ex.: "visualizar valores" em módulos
      // que não são Saldos): preserva o que já estiver gravado.
      linha[campo] = excecaoAtual?.[campo] ?? null;
      if (linha[campo] !== null) temDiferenca = true;
      return;
    }
    const diferente = valoresModulo[campo] !== padraoModulo[campo];
    linha[campo] = diferente ? valoresModulo[campo] : null;
    if (diferente) temDiferenca = true;
  });

  return temDiferenca ? linha : null;
}

/**
 * Grava as alterações: faz upsert (por usuario_id + modulo) dos módulos que
 * ficaram diferentes do perfil e apaga a exceção dos que voltaram ao padrão.
 */
export async function salvarPermissoesDoUsuario(usuarioId, { padrao, valores, excecoes }) {
  const paraGravar = [];
  const paraApagar = [];

  MODULOS.forEach(({ id }) => {
    const linha = montarExcecao(usuarioId, id, valores[id], padrao[id], excecoes[id]);
    if (linha) paraGravar.push(linha);
    else if (excecoes[id]) paraApagar.push(id);
  });

  if (paraGravar.length > 0) {
    const { error } = await supabase
      .from("permissoes_excecao")
      .upsert(paraGravar, { onConflict: "usuario_id,modulo" });

    if (error?.code === "23502") {
      // Banco sem colunas anuláveis na exceção: grava a permissão efetiva inteira.
      const completos = paraGravar.map((linha) => ({
        ...linha,
        ...normalizar(valores[linha.modulo]),
      }));
      const { error: erroCompleto } = await supabase
        .from("permissoes_excecao")
        .upsert(completos, { onConflict: "usuario_id,modulo" });
      if (erroCompleto) throw erroCompleto;
    } else if (error) {
      throw error;
    }
  }

  if (paraApagar.length > 0) {
    const { error } = await supabase
      .from("permissoes_excecao")
      .delete()
      .eq("usuario_id", usuarioId)
      .in("modulo", paraApagar);
    if (error) throw error;
  }

  return { gravados: paraGravar.length, apagados: paraApagar.length };
}

/** Apaga a exceção de um módulo, devolvendo o usuário ao padrão do perfil. */
export async function restaurarPadraoDoModulo(usuarioId, modulo) {
  const { error } = await supabase
    .from("permissoes_excecao")
    .delete()
    .eq("usuario_id", usuarioId)
    .eq("modulo", modulo);
  if (error) throw error;
}
