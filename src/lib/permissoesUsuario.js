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
  { id: "pagamentos", label: "Pagamentos" },
  { id: "tributario", label: "Tributário" },
  { id: "certidoes", label: "Certidões" },
  { id: "relatorios", label: "Relatórios" },
  { id: "auditoria", label: "Auditoria" },
  { id: "administracao", label: "Administração" },
  { id: "tarefas", label: "Tarefas" },
  { id: "backup", label: "Backup" },
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

const CAMPOS_PERMISSAO = [...ACOES.map((a) => a.campo), CAMPO_VALORES];

/**
 * Ações exibidas na seção do módulo: as cinco padrão, mais "Visualizar valores"
 * em Saldos, ou os rótulos próprios do Backup.
 */
export function acoesDoModulo(modulo) {
  if (modulo === MODULO_BACKUP) return ACOES_BACKUP;
  if (modulo !== MODULO_COM_VALORES) return ACOES;
  return [...ACOES, { campo: CAMPO_VALORES, label: "Visualizar valores" }];
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
