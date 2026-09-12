import React from "react";
import {
  Building2, CalendarClock, History, Image, Landmark, Pencil, Plus, Table2, UserCheck,
} from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao, RodapeFormulario, SeletorLogomarca } from "./comuns";
import CampoMoeda from "../CampoMoeda";
import { mensagemAmigavel } from "../../lib/erros";
import { formatBRL } from "../../lib/moeda";
import { LIMITE_LOGO_MB, textoUltimaAlteracao } from "../../lib/configuracoesSistema";
import { usePermissoesProcessos } from "../../lib/permissoesProcessos";
import {
  podeEditarTabelaDeDiarias,
  podeVerTabelaDeDiarias,
} from "../../lib/processosDiarias";
import {
  AVISO_MIGRATION_TABELA,
  CATEGORIAS_CARGO,
  FAIXAS_DISTANCIA,
  LIMITE_PERNOITE,
  dataDaTabelaBR,
  normalizarTabela,
  primeiroErroDaTabela,
  textoPercentual,
  tituloDaTabela,
  validarTabela,
} from "../../lib/processosDiariasTabela";
import {
  carregarTabelaVigente,
  listarVersoesDaTabela,
  salvarNovaVersaoDaTabela,
} from "../../lib/processosDiariasTabelaDados";
import {
  LIMITE_TEXTO_IDENTIDADE,
  logoDoDocumento,
  normalizarIdentidade,
  primeiroErroDaIdentidade,
  usaBrasaoDoRepositorio,
  validarIdentidade,
} from "../../lib/processosIdentidade";
import {
  carregarIdentidadeProcessos,
  carregarLogomarcaDoSistema,
  enviarBrasaoProcessos,
  limparCacheDoLogo,
  salvarIdentidadeProcessos,
} from "../../lib/processosIdentidadeDados";
import {
  AVISO_MIGRATION_PREFEITA,
  ROTULOS_PREFEITA,
  ordenarPrefeitas,
  podeEditarPrefeita,
  podeVerPrefeita,
  prefeitaParaFormulario,
  prefeitaVazia,
  prefeitaVigente,
  primeiroErroDaPrefeita,
  textoDaVigencia,
} from "../../lib/processosPrefeita";
import {
  AVISO_MIGRATION_SOLICITANTES,
  ROTULOS_SOLICITANTE,
  SITUACOES_SOLICITANTE,
  nomeOficialDoSolicitante,
  ordenarSolicitantes,
  rotuloDoSolicitante,
  solicitanteParaFormulario,
  solicitanteVazio,
  validarSolicitante,
} from "../../lib/processosSecretariasSolicitantes";
import {
  AVISO_MIGRATION_BANCOS,
  BANCOS_INICIAIS,
  SITUACOES_BANCO,
  bancoParaFormulario,
  bancoVazio,
  numeroDoBancoFormatado,
  ordenarBancos,
  rotuloDoBanco,
  validarBanco,
} from "../../lib/processosBancos";
import {
  alternarSituacaoDaPrefeita,
  alternarSituacaoDoBanco,
  alternarSituacaoDoSolicitante,
  carregarBancos,
  carregarPrefeitas,
  carregarSolicitantes,
  criarBanco,
  criarPrefeita,
  criarSolicitante,
  salvarBanco,
  salvarPrefeita,
  salvarSolicitante,
} from "../../lib/processosCadastrosDados";

/**
 * Configurações → PROCESSOS: a Tabela de Diárias e a identidade visual dos
 * documentos.
 *
 * ⚠️ ESTA TELA É DE PARÂMETRO, NÃO DE DINHEIRO. Nada aqui debita conta, dá baixa
 * em NF, altera saldo, marca fornecedor como pago ou cria pagamento. As únicas
 * tabelas escritas são processos_diarias_tabela, configuracoes_sistema e a
 * auditoria.
 *
 * ⚠️ NADA AQUI ALTERA PROCESSO JÁ CRIADO OU FINALIZADO. Salvar a tabela PUBLICA
 * UMA VERSÃO NOVA e preserva a anterior -- os processos antigos guardam dentro
 * de si o valor unitário, a faixa, a categoria, o percentual de pernoite e a
 * versão da tabela que usaram, e o banco recusa qualquer reescrita disso. A
 * troca do brasão segue a mesma regra: documento finalizado continua saindo com
 * a identidade visual que ele congelou.
 *
 * PERMISSÃO. Editar a tabela é uma permissão PRÓPRIA (módulo
 * `processos_diarias_tabela`, ação editar), porque ela é o parâmetro que define
 * valores de diária. Consultar a tabela segue quem enxerga o módulo Processos.
 */
export default function CategoriaProcessos({ podeEditar = false }) {
  const { permissoes, permissoesPrefeita, carregando: verificando } = usePermissoesProcessos();
  const podeVerTabela = podeVerTabelaDeDiarias(permissoes);
  // Duas travas somadas: a desta tela (Administração) e a própria da tabela.
  const podeEditarTabela = podeEditar && podeEditarTabelaDeDiarias(permissoes);
  // A PREFEITA segue o mesmo desenho: consultar acompanha quem vê o módulo,
  // editar exige a permissão restrita PRÓPRIA, somada à desta tela.
  const podeVerAPrefeita = podeVerPrefeita(permissoesPrefeita);
  const podeEditarAPrefeita = podeEditar && podeEditarPrefeita(permissoesPrefeita);

  return (
    <>
      <BlocoPrefeita
        podeVer={verificando ? false : podeVerAPrefeita}
        podeEditar={podeEditarAPrefeita}
        verificando={verificando}
      />
      <BlocoTabelaDeDiarias
        podeVer={verificando ? false : podeVerTabela}
        podeEditar={podeEditarTabela}
        verificando={verificando}
      />
      <BlocoSecretariasSolicitantes podeEditar={podeEditar} />
      <BlocoBancos podeEditar={podeEditar} />
      <BlocoIdentidadeVisual podeEditar={podeEditar} />
    </>
  );
}

/* -------------------------------------------------------------------------
 * A PREFEITA — quem AUTORIZA os documentos
 * ---------------------------------------------------------------------- */

/**
 * O cadastro da chefe do Poder Executivo.
 *
 * É daqui que sai, PRONTA, a identificação de quem autoriza: a área
 * "Autorização da prefeita — CIENTE/AUTORIZO" e a identificação abaixo da linha
 * de assinatura (Nome, CPF e Cargo) deixam de ser redigitadas em cada processo.
 *
 * ⚠️ MUDANÇA DE GESTÃO NÃO REESCREVE DOCUMENTO ANTIGO. Ao finalizar, o processo
 * grava dentro dele o nome, o CPF e o cargo vigentes naquele momento, e o
 * gatilho do banco recusa qualquer reescrita disso. Alterar o cadastro aqui vale
 * para os processos daqui para a frente.
 *
 * Uma LINHA POR GESTÃO: a anterior é INATIVADA, nunca apagada -- ela é a memória
 * de quem autorizava naquela época.
 *
 * PERMISSÃO PRÓPRIA E RESTRITA: editar exige o módulo `processos_prefeita`, ação
 * editar, somado à permissão desta tela. Consultar acompanha quem vê o módulo
 * Processos, porque o documento imprime o nome. Toda alteração vai para a
 * auditoria.
 *
 * Documental: nada aqui debita conta, dá baixa em NF, altera saldo ou cria
 * pagamento.
 */
function BlocoPrefeita({ podeVer, podeEditar, verificando }) {
  const [lista, setLista] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [formulario, setFormulario] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      const linhas = await carregarPrefeitas();
      setLista(linhas);
      setFaltaMigration(linhas.length === 0);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar o cadastro da prefeita."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    if (!podeVer) {
      setCarregando(false);
      return;
    }
    carregar();
  }, [carregar, podeVer]);

  function abrirNovo() {
    setErro(null);
    setSucesso(null);
    // prefeitaVazia() já sugere o cargo que a prefeitura usa no documento.
    setFormulario(prefeitaVazia());
  }

  function abrirEdicao(registro) {
    setErro(null);
    setSucesso(null);
    setFormulario(prefeitaParaFormulario(registro));
  }

  function definir(campo, valor) {
    setFormulario((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const problema = primeiroErroDaPrefeita(formulario);
    if (problema) {
      setErro(problema);
      return;
    }

    setSalvando(true);
    try {
      const anterior = lista.find((p) => String(p.id) === String(formulario.id)) ?? null;
      if (formulario.id) await salvarPrefeita(formulario.id, formulario, { anterior });
      else await criarPrefeita(formulario);
      setFormulario(null);
      await carregar();
      setSucesso(
        formulario.id
          ? "Cadastro atualizado. Ele vale para os processos daqui para a frente — os já finalizados "
            + "continuam com a identificação que congelaram."
          : "Prefeita cadastrada. Os documentos passam a sair com o nome, o CPF e o cargo preenchidos.",
      );
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar o cadastro da prefeita."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(registro) {
    setErro(null);
    setSucesso(null);
    const destino = (registro?.situacao ?? "ativo") === "ativo" ? "inativo" : "ativo";
    try {
      await alternarSituacaoDaPrefeita(registro.id, destino, { anterior: registro });
      await carregar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar a situação do cadastro."));
    }
  }

  const ordenadas = React.useMemo(() => ordenarPrefeitas(lista), [lista]);
  const vigente = React.useMemo(() => prefeitaVigente(lista), [lista]);

  return (
    <div>
      <Cartao
        titulo="Prefeita — quem autoriza os documentos"
        descricao={
          "O nome, o CPF e o cargo de quem chefia o Poder Executivo. Os documentos do módulo passam a "
          + "sair com essa identificação pronta, sem redigitar em cada processo. Trocar o cadastro NÃO "
          + "altera documento já finalizado."
        }
        icone={UserCheck}
      >
        <div className="space-y-4">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

          {verificando ? (
            <p className="text-sm text-[#0F2A44]/45">Conferindo a sua permissão...</p>
          ) : !podeVer ? (
            <p className="text-sm leading-relaxed text-[#0F2A44]/55">
              A consulta a este cadastro segue quem enxerga o módulo Processos. Fale com um
              administrador do sistema para solicitar acesso.
            </p>
          ) : carregando ? (
            <p className="text-sm text-[#0F2A44]/45">Carregando o cadastro...</p>
          ) : (
            <>
              {faltaMigration && <Alerta tipo="erro">{AVISO_MIGRATION_PREFEITA}</Alerta>}

              {ordenadas.length === 0 ? (
                <p className="text-sm text-[#0F2A44]/45">
                  Nenhum cadastro. Enquanto ele não existir, a área de autorização e a identificação
                  abaixo da linha de assinatura continuam saindo em branco, para completar à mão.
                </p>
              ) : (
                <ul className="divide-y divide-black/5 rounded-xl border border-black/10">
                  {ordenadas.map((registro) => {
                    const inativa = (registro.situacao ?? "ativo") !== "ativo";
                    const eADoMomento = vigente !== null && String(vigente.id) === String(registro.id);
                    return (
                      <li key={registro.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${inativa ? "text-[#0F2A44]/40 line-through" : "text-[#0F2A44]"}`}>
                            {registro.nome}
                            {eADoMomento && (
                              <span className="ml-2 rounded-full bg-[#0F2A44]/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#0F2A44]/60">
                                Em vigor
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-[#0F2A44]/45">
                            {[registro.cargo, registro.cpf, textoDaVigencia(registro)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {podeEditar && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => abrirEdicao(registro)}
                              className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => alternar(registro)}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                              title="A exclusão é lógica: a linha nunca é apagada, porque ela explica os documentos daquela gestão."
                            >
                              {inativa ? "Reativar" : "Inativar"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {podeEditar && formulario === null && (
                <button
                  type="button"
                  onClick={abrirNovo}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90"
                >
                  <Plus size={15} /> {ordenadas.length === 0 ? "Cadastrar a prefeita" : "Nova gestão"}
                </button>
              )}

              {!podeEditar && (
                <p className="rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-xs leading-relaxed text-[#8A7526]">
                  Você está consultando o cadastro. Alterá-lo exige a permissão própria
                  <strong> Processos · Prefeita — editar</strong>, porque é quem autoriza os documentos
                  do município.
                </p>
              )}

              {formulario !== null && (
                <form onSubmit={salvar} noValidate className="rounded-xl border border-black/10 bg-[#F8FAFC] p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Campo label={ROTULOS_PREFEITA.nome} obrigatorio dica="Como sai impresso abaixo da linha de assinatura.">
                      <input
                        type="text"
                        value={formulario.nome}
                        onChange={(e) => definir("nome", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_PREFEITA.cpf} obrigatorio>
                      <input
                        type="text"
                        value={formulario.cpf}
                        onChange={(e) => definir("cpf", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_PREFEITA.cargo} obrigatorio dica="Por exemplo: Prefeita Municipal.">
                      <input
                        type="text"
                        value={formulario.cargo}
                        onChange={(e) => definir("cargo", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_PREFEITA.vigencia_inicio} dica="Opcional — a data da posse.">
                      <input
                        type="date"
                        value={formulario.vigencia_inicio}
                        onChange={(e) => definir("vigencia_inicio", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_PREFEITA.vigencia_fim} dica="Opcional — deixe em branco enquanto o mandato corre.">
                      <input
                        type="date"
                        value={formulario.vigencia_fim}
                        onChange={(e) => definir("vigencia_fim", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                  </div>

                  <p className="mt-3 text-[11px] leading-relaxed text-[#0F2A44]/45">
                    Estes dados preenchem a área de autorização e a identificação abaixo da linha de
                    assinatura nos documentos em rascunho. Processo já finalizado continua imprimindo a
                    identificação que congelou — mudança de gestão não reescreve documento antigo.
                  </p>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={salvando}
                      className="rounded-lg bg-[#0F2A44] px-5 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
                    >
                      {salvando ? "Salvando..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormulario(null)}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </Cartao>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * SECRETARIAS SOLICITANTES
 * ---------------------------------------------------------------------- */

/**
 * O cadastro das secretarias que REQUISITAM os processos.
 *
 * ⚠️ ELE NÃO É — E NÃO TOCA — O CADASTRO DE SECRETARIAS DO MÓDULO FINANCEIRO.
 * Os dois coexistem, cada um com a sua finalidade: lá ficam as secretarias
 * usadas em contas bancárias, fornecedores, pagamentos e relatórios; aqui ficam
 * as que pedem a diária. Quem REQUISITA quase nunca é quem PAGA, e é por isso
 * que a lista é outra.
 *
 * Guarda também quem responde pela secretaria — secretário(a), CPF e cargo —
 * porque é essa pessoa que assina a requisição. Escolher a secretaria no
 * processo traz esses dados prontos.
 *
 * ⚠️ Trocar o secretário aqui NÃO altera documento antigo: o processo grava
 * dentro dele os dados vigentes no momento.
 */
function BlocoSecretariasSolicitantes({ podeEditar }) {
  const [lista, setLista] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [formulario, setFormulario] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      const linhas = await carregarSolicitantes();
      setLista(linhas);
      setFaltaMigration(linhas.length === 0);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar as secretarias solicitantes."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  function abrirNovo() {
    setErro(null);
    setSucesso(null);
    setFormulario(solicitanteVazio());
  }

  function abrirEdicao(registro) {
    setErro(null);
    setSucesso(null);
    setFormulario(solicitanteParaFormulario(registro));
  }

  function definir(campo, valor) {
    setFormulario((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const erros = validarSolicitante(formulario, { solicitantes: lista });
    const chaves = Object.keys(erros);
    if (chaves.length > 0) {
      setErro(erros[chaves[0]]);
      return;
    }

    setSalvando(true);
    try {
      const anterior = lista.find((s) => String(s.id) === String(formulario.id)) ?? null;
      if (formulario.id) await salvarSolicitante(formulario.id, formulario, { anterior });
      else await criarSolicitante(formulario);
      setFormulario(null);
      await carregar();
      setSucesso(
        formulario.id
          ? "Secretaria solicitante atualizada. Ela vale para os processos daqui para a frente — os já "
            + "finalizados continuam com os dados que congelaram."
          : "Secretaria solicitante cadastrada. Ela já pode ser escolhida nos processos e no cadastro de servidores.",
      );
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a secretaria solicitante."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(registro) {
    setErro(null);
    setSucesso(null);
    const destino = (registro?.situacao ?? "ativo") === "ativo" ? "inativo" : "ativo";
    try {
      await alternarSituacaoDoSolicitante(registro.id, destino, { anterior: registro });
      await carregar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar a situação da secretaria solicitante."));
    }
  }

  const ordenadas = React.useMemo(() => ordenarSolicitantes(lista), [lista]);

  return (
    <div className="mt-5">
      <Cartao
        titulo="Secretarias solicitantes"
        descricao={
          "As secretarias que REQUISITAM os processos, com quem responde por elas. Cadastro próprio do "
          + "módulo: o cadastro de secretarias do financeiro (contas, fornecedores, pagamentos e "
          + "relatórios) continua existindo, separado e intocado."
        }
        icone={Building2}
      >
        <div className="space-y-4">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}
          {faltaMigration && !carregando && <Alerta tipo="erro">{AVISO_MIGRATION_SOLICITANTES}</Alerta>}

          {carregando ? (
            <p className="text-sm text-[#0F2A44]/45">Carregando as secretarias solicitantes...</p>
          ) : (
            <>
              {ordenadas.length === 0 ? (
                <p className="text-sm text-[#0F2A44]/45">
                  Nenhuma secretaria solicitante cadastrada. Cadastre a primeira para que ela apareça
                  no formulário do processo e no cadastro de servidores.
                </p>
              ) : (
                <ul className="divide-y divide-black/5 rounded-xl border border-black/10">
                  {ordenadas.map((registro) => {
                    const inativa = (registro.situacao ?? "ativo") !== "ativo";
                    return (
                      <li key={registro.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${inativa ? "text-[#0F2A44]/40 line-through" : "text-[#0F2A44]"}`}>
                            {nomeOficialDoSolicitante(registro)}
                          </p>
                          <p className="truncate text-[11px] text-[#0F2A44]/45">
                            {[
                              rotuloDoSolicitante(registro) !== nomeOficialDoSolicitante(registro)
                                ? rotuloDoSolicitante(registro)
                                : "",
                              registro.secretario,
                              registro.secretario_cargo,
                            ].filter(Boolean).join(" · ") || "Sem secretário(a) informado(a)"}
                          </p>
                        </div>
                        {podeEditar && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => abrirEdicao(registro)}
                              className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => alternar(registro)}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                              title="A exclusão é lógica: a linha nunca é apagada, porque processos antigos apontam para ela."
                            >
                              {inativa ? "Reativar" : "Inativar"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {podeEditar && formulario === null && (
                <button
                  type="button"
                  onClick={abrirNovo}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90"
                >
                  <Plus size={15} /> Nova secretaria solicitante
                </button>
              )}

              {formulario !== null && (
                <form onSubmit={salvar} noValidate className="rounded-xl border border-black/10 bg-[#F8FAFC] p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Campo label={ROTULOS_SOLICITANTE.nome} obrigatorio dica="Como sai impresso: &quot;Secretaria Municipal de Educação&quot;.">
                      <input
                        type="text"
                        value={formulario.nome}
                        onChange={(e) => definir("nome", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_SOLICITANTE.nome_curto} dica="Para listas e filtros: &quot;Educação&quot;.">
                      <input
                        type="text"
                        value={formulario.nome_curto}
                        onChange={(e) => definir("nome_curto", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_SOLICITANTE.secretario}>
                      <input
                        type="text"
                        value={formulario.secretario}
                        onChange={(e) => definir("secretario", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_SOLICITANTE.secretario_cpf}>
                      <input
                        type="text"
                        value={formulario.secretario_cpf}
                        onChange={(e) => definir("secretario_cpf", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label={ROTULOS_SOLICITANTE.secretario_cargo}>
                      <input
                        type="text"
                        value={formulario.secretario_cargo}
                        onChange={(e) => definir("secretario_cargo", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    {formulario.id && (
                      <Campo label={ROTULOS_SOLICITANTE.situacao}>
                        <select
                          value={formulario.situacao}
                          onChange={(e) => definir("situacao", e.target.value)}
                          disabled
                          className={CLASSE_ENTRADA}
                        >
                          {SITUACOES_SOLICITANTE.map((situacao) => (
                            <option key={situacao.id} value={situacao.id}>{situacao.rotulo}</option>
                          ))}
                        </select>
                      </Campo>
                    )}
                  </div>

                  <p className="mt-3 text-[11px] leading-relaxed text-[#0F2A44]/45">
                    Escolher esta secretaria no processo traz o nome oficial, o secretário(a), o CPF e o
                    cargo prontos. Alterar estes dados depois NÃO altera documento já finalizado.
                  </p>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={salvando}
                      className="rounded-lg bg-[#0F2A44] px-5 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
                    >
                      {salvando ? "Salvando..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormulario(null)}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </Cartao>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * BANCOS
 * ---------------------------------------------------------------------- */

/**
 * O cadastro de BANCOS do módulo: número e nome.
 *
 * Antes o banco era texto livre nos dados bancários do servidor. Agora é uma
 * lista com busca, e o documento sai "001 — Banco do Brasil", como no modelo
 * oficial. Banco novo entra por aqui, sem deploy.
 *
 * ⚠️ Este cadastro NÃO é o card "Bancos utilizados" do módulo financeiro, que
 * continua sendo a leitura das contas bancárias cadastradas.
 */
function BlocoBancos({ podeEditar }) {
  const [lista, setLista] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [formulario, setFormulario] = React.useState(null);
  const [busca, setBusca] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      const linhas = await carregarBancos();
      setLista(linhas);
      setFaltaMigration(linhas.length === 0);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar o cadastro de bancos."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  function definir(campo, valor) {
    setFormulario((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const erros = validarBanco(formulario, { bancos: lista });
    const chaves = Object.keys(erros);
    if (chaves.length > 0) {
      setErro(erros[chaves[0]]);
      return;
    }

    setSalvando(true);
    try {
      const anterior = lista.find((b) => String(b.id) === String(formulario.id)) ?? null;
      if (formulario.id) await salvarBanco(formulario.id, formulario, { anterior });
      else await criarBanco(formulario);
      setFormulario(null);
      await carregar();
      setSucesso("Banco salvo. Ele já aparece na lista de escolha dos dados bancários.");
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar o banco."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(registro) {
    setErro(null);
    setSucesso(null);
    const destino = (registro?.situacao ?? "ativo") === "ativo" ? "inativo" : "ativo";
    try {
      await alternarSituacaoDoBanco(registro.id, destino, { anterior: registro });
      await carregar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar a situação do banco."));
    }
  }

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const ordenados = ordenarBancos(lista);
    if (termo === "") return ordenados;
    return ordenados.filter((b) => rotuloDoBanco(b).toLowerCase().includes(termo));
  }, [lista, busca]);

  return (
    <div className="mt-5">
      <Cartao
        titulo="Bancos"
        descricao={
          "Número e nome dos bancos usados nos dados bancários dos documentos. O documento imprime os "
          + `dois juntos — "001 — Banco do Brasil". Já vêm cadastrados os ${BANCOS_INICIAIS.length} mais usados; `
          + "novos entram por aqui, sem precisar de deploy."
        }
        icone={Landmark}
      >
        <div className="space-y-4">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}
          {faltaMigration && !carregando && <Alerta tipo="erro">{AVISO_MIGRATION_BANCOS}</Alerta>}

          {carregando ? (
            <p className="text-sm text-[#0F2A44]/45">Carregando o cadastro de bancos...</p>
          ) : (
            <>
              {lista.length > 0 && (
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por número ou nome..."
                  className={CLASSE_ENTRADA}
                />
              )}

              {visiveis.length === 0 ? (
                <p className="text-sm text-[#0F2A44]/45">
                  Nenhum banco encontrado. Cadastre-o abaixo para que ele apareça na lista de escolha.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10">
                  {visiveis.map((registro) => {
                    const inativo = (registro.situacao ?? "ativo") !== "ativo";
                    return (
                      <li key={registro.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className={`min-w-0 flex-1 truncate text-sm ${inativo ? "text-[#0F2A44]/40 line-through" : "text-[#0F2A44]"}`}>
                          {rotuloDoBanco(registro)}
                        </span>
                        {podeEditar && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setErro(null); setSucesso(null); setFormulario(bancoParaFormulario(registro)); }}
                              className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => alternar(registro)}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                              title="Exclusão lógica: o número e o nome já gravados em documentos continuam intactos."
                            >
                              {inativo ? "Reativar" : "Inativar"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {podeEditar && formulario === null && (
                <button
                  type="button"
                  onClick={() => { setErro(null); setSucesso(null); setFormulario(bancoVazio()); }}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90"
                >
                  <Plus size={15} /> Novo banco
                </button>
              )}

              {formulario !== null && (
                <form onSubmit={salvar} noValidate className="rounded-xl border border-black/10 bg-[#F8FAFC] p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Campo label="Número do banco" obrigatorio dica="Três dígitos, como 001, 104 ou 237.">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formulario.numero}
                        onChange={(e) => definir("numero", e.target.value)}
                        onBlur={(e) => definir("numero", numeroDoBancoFormatado(e.target.value))}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label="Nome do banco" obrigatorio>
                      <input
                        type="text"
                        value={formulario.nome}
                        onChange={(e) => definir("nome", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    {formulario.id && (
                      <Campo label="Situação">
                        <select value={formulario.situacao} disabled className={CLASSE_ENTRADA}>
                          {SITUACOES_BANCO.map((situacao) => (
                            <option key={situacao.id} value={situacao.id}>{situacao.rotulo}</option>
                          ))}
                        </select>
                      </Campo>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={salvando}
                      className="rounded-lg bg-[#0F2A44] px-5 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
                    >
                      {salvando ? "Salvando..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormulario(null)}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </Cartao>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * A Tabela de Diárias
 * ---------------------------------------------------------------------- */

function BlocoTabelaDeDiarias({ podeVer, podeEditar, verificando }) {
  const [vigente, setVigente] = React.useState(null);
  const [rascunho, setRascunho] = React.useState(null);
  const [versoes, setVersoes] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { tabela, ausente } = await carregarTabelaVigente();
      setFaltaMigration(ausente);
      setVigente(tabela);
      setRascunho(tabela);
      setVersoes(ausente ? [] : await listarVersoesDaTabela());
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar a Tabela de Diárias."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    if (podeVer) carregar();
    else setCarregando(false);
  }, [podeVer, carregar]);

  const alterado = React.useMemo(() => {
    if (!vigente || !rascunho) return false;
    return JSON.stringify(normalizarTabela(vigente)) !== JSON.stringify(normalizarTabela(rascunho));
  }, [vigente, rascunho]);

  function definir(campo, valor) {
    setSucesso(null);
    setRascunho((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  function definirCelula(faixa, categoria, valor) {
    setSucesso(null);
    setRascunho((atual) => {
      const base = normalizarTabela(atual);
      return {
        ...base,
        valores: {
          ...base.valores,
          [faixa]: { ...base.valores[faixa], [categoria]: valor },
        },
      };
    });
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const impedimento = primeiroErroDaTabela(validarTabela(rascunho));
    if (impedimento) {
      setErro(impedimento);
      return;
    }

    setSalvando(true);
    try {
      const nova = await salvarNovaVersaoDaTabela(vigente, rascunho);
      setVigente(nova);
      setRascunho(nova);
      setVersoes(await listarVersoesDaTabela());
      setSucesso(
        `${tituloDaTabela(nova)} publicada. A versão anterior continua guardada para consulta, e os `
          + "processos já criados não foram alterados.",
      );
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a Tabela de Diárias."));
    } finally {
      setSalvando(false);
    }
  }

  if (verificando || carregando) {
    return (
      <Cartao titulo="Tabela de Diárias" icone={Table2}>
        <p className="text-sm text-[#0F2A44]/45">Carregando a Tabela de Diárias...</p>
      </Cartao>
    );
  }

  if (!podeVer) {
    return (
      <Cartao
        titulo="Tabela de Diárias"
        descricao="Os valores de diária por faixa de distância e categoria de cargo."
        icone={Table2}
      >
        <p className="text-sm text-[#0F2A44]/55 leading-relaxed">
          A consulta à Tabela de Diárias segue quem enxerga o módulo Processos. Fale com um
          administrador do sistema para solicitar acesso.
        </p>
      </Cartao>
    );
  }

  const pronta = normalizarTabela(rascunho);

  return (
    <form onSubmit={salvar} noValidate>
      <Cartao
        titulo={tituloDaTabela(vigente)}
        descricao="Faixa de distância × categoria do cargo. Os valores são SEM pernoite; o acréscimo do pernoite é o percentual gravado junto com a tabela."
        icone={Table2}
        rodape={
          <RodapeFormulario
            ultimaAlteracao={
              vigente?.atualizada_em ? `Atualizada em ${dataDaTabelaBR(vigente)}` : ""
            }
            podeEditar={podeEditar}
            salvando={salvando}
            alterado={alterado}
          />
        }
      >
        <div className="space-y-5">
          {faltaMigration && <Alerta tipo="erro">{AVISO_MIGRATION_TABELA}</Alerta>}
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

          {!podeEditar && (
            <p className="rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-xs leading-relaxed text-[#8A7526]">
              Você está consultando a tabela. Alterar os valores exige a permissão própria
              <strong> Processos · Tabela de Diárias — editar</strong>, porque este é o parâmetro que
              define os valores de diária.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Campo label="Título da tabela">
              <input
                type="text"
                value={rascunho?.titulo ?? ""}
                onChange={(e) => definir("titulo", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo label="Data desta atualização" obrigatorio>
              <input
                type="date"
                value={rascunho?.atualizada_em ?? ""}
                onChange={(e) => definir("atualizada_em", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo
              label="Acréscimo do pernoite (%)"
              dica={`Entre ${LIMITE_PERNOITE.minimo}% e ${LIMITE_PERNOITE.maximo}%. Hoje: ${textoPercentual(pronta.pernoite_percentual)}.`}
            >
              <input
                type="number"
                step="0.001"
                min={LIMITE_PERNOITE.minimo}
                max={LIMITE_PERNOITE.maximo}
                value={rascunho?.pernoite_percentual ?? ""}
                onChange={(e) => definir("pernoite_percentual", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>

          <QuadroDeValores
            tabela={pronta}
            podeEditar={podeEditar}
            definirCelula={definirCelula}
          />

          <Campo
            label="Memória do cálculo desta atualização"
            dica="Informativa: fica guardada junto da tabela para consulta, e não entra em nenhuma conta."
          >
            <textarea
              rows={3}
              value={rascunho?.memoria_calculo ?? ""}
              onChange={(e) => definir("memoria_calculo", e.target.value)}
              disabled={!podeEditar}
              className={`${CLASSE_ENTRADA} resize-y`}
            />
          </Campo>

          <p className="text-[11px] leading-relaxed text-[#0F2A44]/45">
            Salvar PUBLICA UMA VERSÃO NOVA. A versão anterior não é apagada — os processos antigos
            dependem dela —, e processo já criado ou finalizado não é alterado: ele guarda dentro de
            si o valor unitário, a faixa, a categoria, o percentual de pernoite e a identificação da
            versão que usou. Toda alteração vai para a auditoria com usuário, data, valores
            anteriores e novos.
          </p>
        </div>
      </Cartao>

      {versoes.length > 1 && <VersoesAnteriores versoes={versoes} />}
    </form>
  );
}

/**
 * O quadro de 20 valores: quatro faixas de distância × cinco categorias.
 *
 * Os valores digitados são SEM pernoite. A linha de apoio embaixo de cada
 * coluna mostra quanto fica COM pernoite, pelo percentual da própria tabela —
 * é a conferência que o item 3 pede, feita na hora.
 */
function QuadroDeValores({ tabela, podeEditar, definirCelula }) {
  const fator = 1 + Number(tabela.pernoite_percentual || 0) / 100;

  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border border-black/10 bg-[#F5F3EF] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0F2A44]/60">
              Faixa de distância
            </th>
            {CATEGORIAS_CARGO.map((categoria) => (
              <th
                key={categoria.id}
                className="border border-black/10 bg-[#F5F3EF] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0F2A44]/60"
              >
                {categoria.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FAIXAS_DISTANCIA.map((faixa) => (
            <tr key={faixa.id}>
              <th className="sticky left-0 z-10 border border-black/10 bg-white px-3 py-2 text-left text-xs font-medium text-[#0F2A44]">
                {faixa.rotulo}
              </th>
              {CATEGORIAS_CARGO.map((categoria) => {
                const valor = tabela.valores[faixa.id][categoria.id];
                return (
                  <td key={categoria.id} className="border border-black/10 px-2 py-2 align-top">
                    <CampoMoeda
                      valor={valor}
                      onValorChange={(numero) => definirCelula(faixa.id, categoria.id, numero)}
                      disabled={!podeEditar}
                      className="w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/60"
                      aria-label={`${faixa.rotulo} — ${categoria.rotulo}`}
                    />
                    <span className="mt-1 block text-[10px] text-[#0F2A44]/40">
                      c/ pernoite {formatBRL(Math.round(valor * fator * 100) / 100)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** As versões anteriores da tabela, guardadas para consulta. */
function VersoesAnteriores({ versoes }) {
  return (
    <div className="mt-5">
      <Cartao
        titulo="Versões anteriores"
        descricao="A tabela antiga não é apagada: os processos antigos foram calculados por ela."
        icone={History}
      >
        <ul className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5">
          {versoes.map((versao) => (
            <li key={versao.id ?? versao.criado_em} className="bg-white px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-[#0F2A44]">
                  {tituloDaTabela(versao)}
                  {versao.vigente && (
                    <span className="ml-2 rounded-full bg-[#EAFBF0] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#15803D]">
                      Vigente
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-[#0F2A44]/45">
                  Pernoite {textoPercentual(versao.pernoite_percentual)}
                  {versao.autor ? ` · publicada por ${versao.autor}` : ""}
                </span>
              </div>
              {versao.memoria_calculo && (
                <p className="mt-1 text-[11px] leading-relaxed text-[#0F2A44]/50">
                  {versao.memoria_calculo}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * A identidade visual dos documentos
 * ---------------------------------------------------------------------- */

/**
 * O brasão e os dados institucionais do cabeçalho/rodapé dos documentos.
 *
 * ⚠️ Trocar o brasão NÃO altera documento já finalizado: o processo congela a
 * identidade vigente no ato da finalização. Sem imagem enviada, o documento usa
 * o brasão guardado no repositório — ele não depende de link externo.
 */
/** De onde vem a imagem que o documento imprime, dito com o nome da tela. */
function textoDaImagemEmUso(identidade) {
  if (String(identidade?.logo_url ?? "").trim() !== "") {
    return "Em uso: a imagem enviada aqui. Remover devolve a logomarca do sistema, "
      + "cadastrada em Configurações → Aparência, e só então o brasão do repositório.";
  }
  return "Em uso: a logomarca do sistema, cadastrada em Configurações → Aparência. "
    + "Enviar uma imagem aqui vale só para os documentos de Processos.";
}

function BlocoIdentidadeVisual({ podeEditar }) {
  const [vigente, setVigente] = React.useState(null);
  // A logomarca cadastrada em Configurações -> Aparência. Ela entra aqui pelo
  // MESMO caminho que o documento usa, para que a miniatura mostrada seja
  // exatamente a imagem impressa -- e não o brasão do repositório enquanto o
  // papel sai com a logomarca do sistema.
  const [logoSistema, setLogoSistema] = React.useState(null);
  const [rascunho, setRascunho] = React.useState(null);
  const [autoria, setAutoria] = React.useState(null);
  const [arquivo, setArquivo] = React.useState(null);
  const [carregando, setCarregando] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const url = await carregarLogomarcaDoSistema();
        if (ativo && url) setLogoSistema(url);
        const { identidade, autoria: quem } = await carregarIdentidadeProcessos();
        if (!ativo) return;
        setVigente(identidade);
        setRascunho(identidade);
        setAutoria(quem);
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar a identidade visual."));
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const alterado = React.useMemo(() => {
    if (arquivo) return true;
    if (!vigente || !rascunho) return false;
    return JSON.stringify(normalizarIdentidade(vigente)) !== JSON.stringify(normalizarIdentidade(rascunho));
  }, [arquivo, vigente, rascunho]);

  function definir(campo, valor) {
    setSucesso(null);
    setRascunho((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const impedimento = primeiroErroDaIdentidade(validarIdentidade(rascunho));
    if (impedimento) {
      setErro(impedimento);
      return;
    }

    setSalvando(true);
    try {
      const logoUrl = arquivo ? await enviarBrasaoProcessos(arquivo) : rascunho?.logo_url ?? null;
      const salva = await salvarIdentidadeProcessos(vigente, { ...rascunho, logo_url: logoUrl });
      limparCacheDoLogo();
      setVigente(salva);
      setRascunho(salva);
      setArquivo(null);
      setAutoria((await carregarIdentidadeProcessos()).autoria);
      setSucesso(
        "Identidade visual salva. Ela vale para os documentos emitidos de agora em diante — os "
          + "processos já finalizados continuam saindo com a identidade que congelaram.",
      );
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar a identidade visual."));
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="mt-5">
        <Cartao titulo="Identidade visual dos documentos" icone={Image}>
          <p className="text-sm text-[#0F2A44]/45">Carregando a identidade visual...</p>
        </Cartao>
      </div>
    );
  }

  const pronta = normalizarIdentidade(rascunho);

  return (
    <form onSubmit={salvar} noValidate className="mt-5">
      <Cartao
        titulo="Identidade visual dos documentos"
        descricao="O brasão e os dados institucionais impressos em TODAS as páginas dos documentos de Processos."
        icone={Image}
        rodape={
          <RodapeFormulario
            ultimaAlteracao={textoUltimaAlteracao(autoria)}
            podeEditar={podeEditar}
            salvando={salvando}
            alterado={alterado}
          />
        }
      >
        <div className="space-y-5">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

          <div>
            <span className="text-xs font-medium text-[#0F2A44]/70">Brasão da Prefeitura</span>
            <div className="mt-2">
              <SeletorLogomarca
                urlAtual={logoDoDocumento(pronta, logoSistema)}
                arquivo={arquivo}
                onSelecionar={(escolhido) => {
                  setSucesso(null);
                  setArquivo(escolhido);
                }}
                onRemover={() => {
                  setSucesso(null);
                  setArquivo(null);
                  definir("logo_url", null);
                }}
                desabilitado={!podeEditar}
                limiteMb={LIMITE_LOGO_MB}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
              {usaBrasaoDoRepositorio(pronta, logoSistema)
                ? "Em uso: o brasão guardado no repositório do sistema — o documento não depende de link externo."
                : textoDaImagemEmUso(pronta)}
              {" "}Ele é impresso na proporção original, em tamanho discreto, e sai legível também em
              impressora preto e branco.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Órgão (1ª linha do cabeçalho)" obrigatorio>
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.orgao ?? ""}
                onChange={(e) => definir("orgao", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo label="Estado (2ª linha do cabeçalho)" obrigatorio>
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.estado ?? ""}
                onChange={(e) => definir("estado", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo label="Endereço (rodapé)" obrigatorio>
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.rodape_endereco ?? ""}
                onChange={(e) => definir("rodape_endereco", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo label="Telefone e e-mail (rodapé)" obrigatorio>
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.rodape_contato ?? ""}
                onChange={(e) => definir("rodape_contato", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
            <Campo label="CNPJ (3ª linha do rodapé)">
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.rodape_cnpj ?? ""}
                onChange={(e) => definir("rodape_cnpj", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
            <CalendarClock size={13} className="mt-0.5 shrink-0" />
            <span>
              O rodapé sai em TRÊS linhas em todas as páginas dos documentos de Processos: endereço
              com CEP, telefone e e-mail, e o CNPJ.{" "}
              A alteração vale para os documentos emitidos de agora em diante. Processo já finalizado
              continua saindo com o brasão e o rodapé que estavam em vigor quando ele foi fechado — a
              mesma regra já usada para os dados do secretário e da prefeita. Toda troca fica na
              auditoria.
            </span>
          </p>
        </div>
      </Cartao>
    </form>
  );
}
