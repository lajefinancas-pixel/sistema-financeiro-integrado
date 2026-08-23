import React from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  DatabaseBackup,
  History,
  Info,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Alerta, Campo, ModalShell } from "../equipe/comuns";
import { Cartao } from "./comuns";
import {
  carregarPermissoesBackup,
  descricaoAgendamentoAutomatico,
  duracaoLegivel,
  formatarData,
  formatarDataHora,
  formatarHora,
  formatarTamanho,
  gerarBackupManual,
  justificativaValida,
  listarRegistros,
  MINIMO_JUSTIFICATIVA,
  nomeDoAutor,
  PERMISSOES_BACKUP,
  registrarSolicitacaoRestauracao,
  resumoBackups,
  statusInfo,
  tipoInfo,
} from "../../lib/backups";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/**
 * Aviso repetido na tela: o que esta etapa faz e o que ainda depende de
 * infraestrutura. Nenhum número exibido aqui é inventado — ou veio de
 * backups_log, ou é uma estimativa declarada como tal.
 */
const TEXTO_INFRAESTRUTURA =
  "A geração do arquivo de backup propriamente dito depende de uma função de backend (Edge Function do Supabase), a ser configurada em uma etapa técnica separada — só ela tem a credencial de serviço necessária, que nunca pode ficar no navegador. Nesta etapa, \"Gerar Backup Agora\" registra a execução no sistema e apura um tamanho aproximado, medindo o volume real de registros do banco.";

/** Etiqueta colorida de tipo/situação. */
function Etiqueta({ info, comSimbolo }) {
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      {comSimbolo && info.simbolo && <span aria-hidden="true">{info.simbolo}</span>}
      {info.label}
    </span>
  );
}

/** Um bloco do painel de resumo: rótulo, valor em destaque e apoio embaixo. */
function Indicador({ rotulo, valor, apoio, destaque, children }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5 flex flex-col">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#0F2A44]/40">{rotulo}</div>
      <div
        className={`mt-1 text-sm font-medium ${destaque ? "text-[#0F2A44]" : "text-[#0F2A44]/70"}`}
      >
        {valor}
      </div>
      {apoio && <div className="text-[11px] text-[#0F2A44]/45 mt-0.5 leading-relaxed">{apoio}</div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Faixa mostrada quando o banco ainda não recebeu a migration desta categoria. */
function AvisoEstrutura({ tabelaAusente }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/40 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed">
        {tabelaAusente
          ? "O registro de backups ainda não existe neste banco de dados."
          : "Este banco de dados ainda não tem a estrutura completa de backup (início, conclusão, tamanho e motivo de falha)."}{" "}
        A migration da categoria Backup precisa ser aplicada no Supabase para que a tela funcione
        por inteiro. Até lá, o que já estiver gravado continua sendo exibido.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Histórico
 * ---------------------------------------------------------------------- */

/** Detalhes que não cabem na linha da tabela: duração, descrição, erro. */
function DetalhesRegistro({ registro }) {
  const duracao = duracaoLegivel(registro.iniciadoEm, registro.concluidoEm);
  return (
    <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3 space-y-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-[#0F2A44]/60">
        <span>
          <span className="text-[#0F2A44]/40">Início: </span>
          {formatarDataHora(registro.iniciadoEm)}
        </span>
        <span>
          <span className="text-[#0F2A44]/40">Conclusão: </span>
          {registro.concluidoEm ? formatarDataHora(registro.concluidoEm) : "--"}
        </span>
        {duracao && (
          <span>
            <span className="text-[#0F2A44]/40">Duração: </span>
            {duracao}
          </span>
        )}
        <span>
          <span className="text-[#0F2A44]/40">Tamanho: </span>
          {formatarTamanho(registro.tamanhoBytes)}
        </span>
      </div>
      {registro.descricao && (
        <p className="text-[11px] text-[#0F2A44]/60 leading-relaxed pt-1">{registro.descricao}</p>
      )}
      {registro.justificativa && (
        <p className="text-[11px] text-[#0F2A44]/60 leading-relaxed">
          <span className="text-[#0F2A44]/40">Justificativa: </span>
          {registro.justificativa}
        </p>
      )}
      {registro.detalhesErro && (
        <p className="text-[11px] text-[#B91C1C] leading-relaxed">
          <span className="opacity-70">Motivo da falha: </span>
          {registro.detalhesErro}
        </p>
      )}
    </div>
  );
}

/** Botão "Detalhes" da coluna Ações. */
function BotaoDetalhes({ aberto, onAlternar }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={aberto}
      className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap"
    >
      Detalhes
      <ChevronDown size={12} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
    </button>
  );
}

/**
 * Modal "Ver Histórico de Backups".
 *
 * Data | Hora | Tipo | Usuário | Status | Tamanho | Ações, dos mais recentes
 * para os mais antigos. Em telas estreitas a tabela vira uma lista de cartões,
 * porque sete colunas não cabem num celular sem virar rolagem horizontal.
 */
function ModalHistorico({ onFechar }) {
  const [estado, setEstado] = React.useState({
    carregando: true,
    registros: [],
    disponivel: true,
    estruturaCompleta: true,
  });
  const [erro, setErro] = React.useState(null);
  const [expandido, setExpandido] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const dados = await listarRegistros();
        if (ativo) setEstado({ carregando: false, ...dados });
      } catch (e) {
        if (ativo) {
          setErro(mensagemAmigavel(e, "Não foi possível carregar o histórico de backups."));
          setEstado({ carregando: false, registros: [], disponivel: true, estruturaCompleta: true });
        }
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const vazio = !estado.carregando && estado.registros.length === 0;
  const alternar = (id) => setExpandido((atual) => (atual === id ? null : id));

  return (
    <ModalShell
      titulo="Histórico de backups"
      subtitulo="Execuções automáticas e manuais, e solicitações de restauração"
      largura="max-w-4xl"
      onFechar={onFechar}
      rodape={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {!estado.carregando && (!estado.disponivel || !estado.estruturaCompleta) && (
          <AvisoEstrutura tabelaAusente={!estado.disponivel} />
        )}

        {estado.carregando ? (
          <p className="text-sm text-[#0F2A44]/45 py-6 text-center">Carregando histórico...</p>
        ) : vazio ? (
          <div className="rounded-xl border border-dashed border-black/10 px-5 py-10 text-center">
            <History size={22} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <p className="text-sm text-[#0F2A44]/60">
              {estado.disponivel
                ? "Nenhum backup foi registrado neste sistema até agora."
                : "O registro de backups ainda não está disponível neste banco de dados."}
            </p>
            <p className="text-xs text-[#0F2A44]/45 mt-2 max-w-md mx-auto leading-relaxed">
              Assim que a rotina automática rodar, ou alguém gerar um backup manual, os registros
              aparecem aqui.
            </p>
          </div>
        ) : (
          <>
            {/* Tabela — telas médias e grandes */}
            <div className="hidden md:block rounded-xl border border-black/5 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#F5F3EF]/70 border-b border-black/5">
                    {["Data", "Hora", "Tipo", "Usuário", "Status", "Tamanho", "Ações"].map(
                      (coluna) => (
                        <th
                          key={coluna}
                          scope="col"
                          className="px-3 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[#0F2A44]/45 font-medium whitespace-nowrap"
                        >
                          {coluna}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {estado.registros.map((registro) => (
                    <React.Fragment key={registro.id}>
                      <tr className="bg-white align-middle">
                        <td className="px-3 py-3 text-[13px] text-[#0F2A44] whitespace-nowrap">
                          {formatarData(registro.iniciadoEm)}
                        </td>
                        <td className="px-3 py-3 text-[13px] text-[#0F2A44]/70 whitespace-nowrap">
                          {formatarHora(registro.iniciadoEm)}
                        </td>
                        <td className="px-3 py-3">
                          <Etiqueta info={tipoInfo(registro.tipo)} />
                        </td>
                        <td className="px-3 py-3 text-[13px] text-[#0F2A44]/70 max-w-[180px] truncate">
                          {nomeDoAutor(registro)}
                        </td>
                        <td className="px-3 py-3">
                          <Etiqueta info={statusInfo(registro.status)} comSimbolo />
                        </td>
                        <td className="px-3 py-3 text-[13px] text-[#0F2A44]/70 whitespace-nowrap tabular-nums">
                          {formatarTamanho(registro.tamanhoBytes)}
                        </td>
                        <td className="px-3 py-3">
                          <BotaoDetalhes
                            aberto={expandido === registro.id}
                            onAlternar={() => alternar(registro.id)}
                          />
                        </td>
                      </tr>
                      {expandido === registro.id && (
                        <tr className="bg-white">
                          <td colSpan={7} className="px-3 pb-3">
                            <DetalhesRegistro registro={registro} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cartões — telas estreitas */}
            <ul className="md:hidden space-y-2.5">
              {estado.registros.map((registro) => (
                <li
                  key={registro.id}
                  className="rounded-xl border border-black/5 bg-white px-4 py-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiqueta info={tipoInfo(registro.tipo)} />
                    <Etiqueta info={statusInfo(registro.status)} comSimbolo />
                    <span className="text-[11px] text-[#0F2A44]/45 ml-auto whitespace-nowrap">
                      {formatarData(registro.iniciadoEm)} · {formatarHora(registro.iniciadoEm)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-[#0F2A44]/65 truncate">
                      {nomeDoAutor(registro)}
                    </span>
                    <span className="text-[12px] text-[#0F2A44]/65 tabular-nums whitespace-nowrap">
                      {formatarTamanho(registro.tamanhoBytes)}
                    </span>
                  </div>
                  <BotaoDetalhes
                    aberto={expandido === registro.id}
                    onAlternar={() => alternar(registro.id)}
                  />
                  {expandido === registro.id && <DetalhesRegistro registro={registro} />}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
          <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
          <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">{TEXTO_INFRAESTRUTURA}</p>
        </div>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------
 * Restauração
 * ---------------------------------------------------------------------- */

/**
 * Modal "Restaurar Backup": aviso claro + justificativa obrigatória.
 *
 * Confirmar NÃO restaura nada — a restauração de um banco de dados é feita na
 * infraestrutura, fora de uma aplicação web. O que a confirmação faz é
 * registrar o pedido: evento crítico na Auditoria (usuário, data/hora e
 * justificativa) e uma linha no histórico de backups.
 */
function ModalRestauracao({ usuarioId, onFechar, onRegistrado }) {
  const [justificativa, setJustificativa] = React.useState("");
  const [ciente, setCiente] = React.useState(false);
  const [registrando, setRegistrando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const restante = Math.max(0, MINIMO_JUSTIFICATIVA - justificativa.trim().length);
  const pronto = ciente && restante === 0;

  async function confirmar() {
    if (registrando) return;
    setErro(null);
    setRegistrando(true);
    try {
      const motivo = justificativaValida(justificativa);

      // A solicitação é uma ação CRÍTICA. Usuário e data/hora são preenchidos
      // pela própria trilha de auditoria.
      const falhaAuditoria = await registrarEvento({
        modulo: "administracao",
        acao: "restauracao_backup",
        nivel: "critico",
        registroAfetado: "Backup do sistema — solicitação de restauração",
        valorNovo: {
          justificativa: motivo,
          executada: false,
          observacao:
            "Solicitação registrada pela tela de Configurações. A restauração em si não é executada pela aplicação.",
        },
        usuarioId,
      });
      if (falhaAuditoria) {
        // Sem registro na trilha o pedido não fica documentado: não segue adiante.
        setErro(falhaAuditoria);
        return;
      }

      const falhaHistorico = await registrarSolicitacaoRestauracao({
        justificativa: motivo,
        usuarioId,
      });
      onRegistrado(falhaHistorico);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível registrar a solicitação de restauração."));
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <ModalShell
      titulo="Restaurar backup"
      subtitulo="Ação crítica — leia o aviso antes de continuar"
      largura="max-w-lg"
      onFechar={registrando ? () => {} : onFechar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={registrando}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!pronto || registrando}
            className="text-sm px-5 py-2.5 rounded-lg bg-[#B91C1C] text-white hover:bg-[#991B1B] disabled:opacity-40 disabled:hover:bg-[#B91C1C]"
          >
            {registrando ? "Registrando..." : "Confirmar e registrar solicitação"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed space-y-2">
            <p>
              Restaurar um backup substitui os dados atuais do sistema pelos dados da cópia
              escolhida. Tudo o que tiver sido lançado depois daquela cópia — saldos, pagamentos,
              fornecedores, tarefas — deixa de existir.
            </p>
            <p>
              A restauração propriamente dita não é executada por esta tela: ela é feita na
              infraestrutura do banco de dados, por quem administra o ambiente. Confirmar aqui
              registra o pedido, com a sua justificativa, na Auditoria do sistema como ação crítica.
            </p>
          </div>
        </div>

        <Campo
          label="Justificativa da restauração"
          obrigatorio
          dica={
            restante > 0
              ? `Faltam ${restante} ${restante === 1 ? "caractere" : "caracteres"} para o mínimo de ${MINIMO_JUSTIFICATIVA}.`
              : "Este texto ficará gravado na Auditoria, junto com seu nome e a data/hora."
          }
        >
          <textarea
            rows={4}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value.slice(0, 500))}
            disabled={registrando}
            placeholder="Explique o motivo do pedido de restauração, o que se pretende recuperar e desde quando."
            className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] disabled:bg-black/[0.03] resize-y"
          />
        </Campo>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={ciente}
            onChange={(e) => setCiente(e.target.checked)}
            disabled={registrando}
            className="mt-0.5 w-4 h-4 accent-[#B91C1C] shrink-0"
          />
          <span className="text-xs text-[#0F2A44]/70 leading-relaxed">
            Estou ciente de que a restauração pode causar perda definitiva dos dados lançados após a
            cópia e de que esta solicitação será registrada na Auditoria como ação crítica.
          </span>
        </label>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------
 * Categoria
 * ---------------------------------------------------------------------- */

/**
 * Categoria BACKUP das Configurações.
 *
 * Três decisões guiam a tela:
 *
 *  1. Nada inventado. Os indicadores mostram apenas o que está gravado em
 *     backups_log — e "nenhum registro" quando é o caso, em vez de datas de
 *     exemplo. O único número calculado é o tamanho do backup manual, e ele é
 *     apresentado como estimativa.
 *  2. Cada botão tem a sua permissão. Gerar, ver histórico, restaurar e
 *     administrar são permissões DISTINTAS do módulo 'backup', concedidas
 *     separadamente pelo Administrador.
 *  3. Restaurar é pedido, não execução. O botão abre um aviso com justificativa
 *     obrigatória e grava o pedido na Auditoria como ação crítica.
 */
export default function CategoriaBackup({ podeEditar, usuarioId }) {
  const [resumo, setResumo] = React.useState(null);
  const [permissoes, setPermissoes] = React.useState(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [historicoAberto, setHistoricoAberto] = React.useState(false);
  const [restauracaoAberta, setRestauracaoAberta] = React.useState(false);
  const [gerando, setGerando] = React.useState(false);
  const [sucesso, setSucesso] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      const [dados, permissoesBackup] = await Promise.all([
        resumoBackups(),
        carregarPermissoesBackup(usuarioId),
      ]);
      setResumo(dados);
      setPermissoes(permissoesBackup);
      setErro(null);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível consultar os registros de backup."));
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  // Banco sem o módulo 'backup' (migration não aplicada): a tela volta ao
  // comportamento anterior — permissão de edição em Administração — para não
  // trancar quem já administrava o sistema antes desta etapa.
  const moduloDisponivel = permissoes?.moduloDisponivel === true;
  const podeGerar = moduloDisponivel ? permissoes.gerar : podeEditar;
  const podeVerHistorico = moduloDisponivel ? permissoes.historico : true;
  const podeRestaurar = moduloDisponivel ? permissoes.restaurar : podeEditar;
  const podeAdministrar = moduloDisponivel ? permissoes.administrar : podeEditar;

  const ultimoAutomatico = resumo?.ultimoAutomatico ?? null;
  const ultimoManual = resumo?.ultimoManual ?? null;
  const estruturaIncompleta = resumo && (!resumo.disponivel || !resumo.estruturaCompleta);

  async function gerarAgora() {
    if (gerando || !podeGerar) return;
    setGerando(true);
    setErro(null);
    setSucesso(null);
    setAviso(null);
    try {
      const resultado = await gerarBackupManual({ usuarioId });

      // Backup é ação administrativa relevante: fica na trilha, como as demais.
      const falhaAuditoria = await registrarEvento({
        modulo: "administracao",
        acao: "gerou_backup",
        nivel: "atencao",
        registroAfetado: "Backup do sistema — geração manual",
        valorNovo: {
          tipo: "manual",
          tamanho_bytes: resultado.tamanhoBytes,
          observacao: resultado.detalhe,
        },
        usuarioId,
      });
      if (falhaAuditoria) setAviso(falhaAuditoria);

      setSucesso(
        `Backup manual registrado como concluído. Tamanho aproximado: ${formatarTamanho(resultado.tamanhoBytes)}. ${resultado.detalhe}`
      );
      if (resultado.parcial) {
        setAviso(
          "Algumas tabelas não puderam ser consultadas para o cálculo, então o tamanho registrado é parcial."
        );
      }
      await carregar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível gerar o backup agora."));
      await carregar();
    } finally {
      setGerando(false);
    }
  }

  function aoRegistrarRestauracao(falhaHistorico) {
    setRestauracaoAberta(false);
    setAviso(falhaHistorico ?? null);
    setSucesso(
      "Solicitação de restauração registrada na Auditoria como ação crítica, com seu nome, a data/hora e a justificativa. Nenhum dado do sistema foi alterado: a restauração precisa ser executada por quem administra a infraestrutura do banco."
    );
    carregar();
  }

  return (
    <>
      <div className="space-y-5">
        <Cartao
          titulo="Backups do sistema"
          descricao="Situação das cópias de segurança registradas no sistema."
          icone={DatabaseBackup}
        >
          <div className="space-y-5">
            {erro && <Alerta tipo="erro">{erro}</Alerta>}
            {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}
            {aviso && <Alerta tipo="erro">{aviso}</Alerta>}

            {carregando ? (
              <p className="text-sm text-[#0F2A44]/45 py-4">Consultando registros de backup...</p>
            ) : (
              <>
                {estruturaIncompleta && <AvisoEstrutura tabelaAusente={!resumo.disponivel} />}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  <Indicador
                    rotulo="Último backup automático"
                    valor={
                      ultimoAutomatico
                        ? formatarDataHora(ultimoAutomatico.iniciadoEm)
                        : "Nenhum registro"
                    }
                    apoio={
                      ultimoAutomatico
                        ? `Tamanho: ${formatarTamanho(ultimoAutomatico.tamanhoBytes)}`
                        : "A rotina automática ainda não registrou nenhuma execução"
                    }
                    destaque={Boolean(ultimoAutomatico)}
                  >
                    {ultimoAutomatico && (
                      <Etiqueta info={statusInfo(ultimoAutomatico.status)} comSimbolo />
                    )}
                  </Indicador>

                  <Indicador
                    rotulo="Último backup manual"
                    valor={
                      ultimoManual ? formatarDataHora(ultimoManual.iniciadoEm) : "Nenhum registro"
                    }
                    apoio={
                      ultimoManual
                        ? `${nomeDoAutor(ultimoManual)} · ${formatarTamanho(ultimoManual.tamanhoBytes)}`
                        : "Ninguém gerou um backup manual até agora"
                    }
                    destaque={Boolean(ultimoManual)}
                  >
                    {ultimoManual && <Etiqueta info={statusInfo(ultimoManual.status)} comSimbolo />}
                  </Indicador>

                  <Indicador
                    rotulo="Próximo backup automático"
                    valor={formatarDataHora(resumo?.proximoAutomatico)}
                    apoio={`Previsto para ${descricaoAgendamentoAutomatico()}`}
                    destaque
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {podeGerar && (
                    <button
                      type="button"
                      onClick={gerarAgora}
                      disabled={gerando}
                      className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40 disabled:hover:bg-[#0F2A44]"
                    >
                      <Play size={15} className="text-[#C9A227]" />
                      {gerando ? "Gerando backup..." : "Gerar Backup Agora"}
                    </button>
                  )}

                  {podeVerHistorico && (
                    <button
                      type="button"
                      onClick={() => setHistoricoAberto(true)}
                      className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/75 hover:bg-black/5"
                    >
                      <History size={15} />
                      Ver Histórico de Backups
                    </button>
                  )}

                  {!podeGerar && (
                    <span className="text-[11px] text-[#0F2A44]/45">
                      Gerar backup manual exige a permissão correspondente no módulo Backup.
                    </span>
                  )}
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
                  <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
                  <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">
                    {TEXTO_INFRAESTRUTURA}
                  </p>
                </div>
              </>
            )}
          </div>
        </Cartao>

        <Cartao
          titulo="Rotina automática"
          descricao="Quando o sistema espera que a cópia agendada aconteça."
          icone={CalendarClock}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Indicador
                rotulo="Agendamento"
                valor={descricaoAgendamentoAutomatico()}
                apoio="Horário de referência da rotina de backup"
                destaque
              />
              <Indicador
                rotulo="Registros de backup no sistema"
                valor={resumo?.disponivel ? String(resumo.totalRegistros) : "Não informado"}
                apoio={
                  resumo?.disponivel
                    ? "Execuções automáticas e manuais já gravadas"
                    : "O registro de backups ainda não existe neste banco"
                }
                destaque={Boolean(resumo?.disponivel)}
              />
            </div>

            <p className="text-xs text-[#0F2A44]/55 leading-relaxed">
              O agendamento acima é informativo: a execução da rotina é responsabilidade da
              infraestrutura do banco de dados e será ligada na etapa técnica que criar a função de
              backup no backend. Enquanto ela não rodar, "Último backup automático" continua vazio —
              a tela não preenche esse campo com uma data que não aconteceu.
            </p>

            {!podeAdministrar && (
              <p className="text-[11px] text-[#0F2A44]/45">
                Alterar o agendamento e as demais configurações de backup exigirá a permissão
                "Administrar configurações de backup".
              </p>
            )}
          </div>
        </Cartao>

        <Cartao
          titulo="Restauração de backup"
          descricao="Pedido formal de retorno do sistema a uma cópia anterior."
          icone={RotateCcw}
        >
          <div className="space-y-5">
            <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                Restaurar um backup é uma ação crítica e tem permissão própria: ter permissão para
                gerar backup manual não dá permissão para restaurar. O pedido exige justificativa e
                fica gravado na Auditoria com o usuário e a data/hora.
              </p>
            </div>

            <p className="text-xs text-[#0F2A44]/55 leading-relaxed">
              A execução da restauração não é feita por esta aplicação — ela acontece na
              infraestrutura do banco de dados, por quem administra o ambiente. O botão abaixo
              registra e documenta o pedido.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!podeRestaurar}
                onClick={() => {
                  setSucesso(null);
                  setAviso(null);
                  setRestauracaoAberta(true);
                }}
                title={podeRestaurar ? undefined : "É necessária a permissão de restaurar backup."}
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[#B91C1C] text-white hover:bg-[#991B1B] disabled:opacity-40 disabled:hover:bg-[#B91C1C]"
              >
                <RotateCcw size={15} />
                Restaurar Backup
              </button>
              {!podeRestaurar && (
                <span className="text-[11px] text-[#0F2A44]/45">
                  Disponível apenas com a permissão "Restaurar backup".
                </span>
              )}
            </div>
          </div>
        </Cartao>

        <Cartao
          titulo="Suas permissões nesta categoria"
          descricao="Concedidas uma a uma pelo Administrador, na aba Permissões da tela de usuário."
          icone={ShieldCheck}
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {PERMISSOES_BACKUP.map(({ chave, label }) => {
              const concedida = moduloDisponivel
                ? permissoes?.[chave] === true
                : chave === "visualizar" || chave === "historico" || podeEditar;
              return (
                <li key={chave} className="flex items-center gap-2 text-[13px]">
                  {concedida ? (
                    <Check size={14} className="text-[#15803D] shrink-0" />
                  ) : (
                    <X size={14} className="text-[#0F2A44]/25 shrink-0" />
                  )}
                  <span className={concedida ? "text-[#0F2A44]" : "text-[#0F2A44]/40"}>{label}</span>
                </li>
              );
            })}
          </ul>

          {!moduloDisponivel && !carregando && (
            <p className="text-[11px] text-[#0F2A44]/45 mt-4 leading-relaxed">
              O módulo de permissões "Backup" ainda não existe neste banco de dados. Até a migration
              ser aplicada, a categoria segue a regra anterior: permissão de edição no módulo
              Administração.
            </p>
          )}
        </Cartao>
      </div>

      {historicoAberto && <ModalHistorico onFechar={() => setHistoricoAberto(false)} />}

      {restauracaoAberta && (
        <ModalRestauracao
          usuarioId={usuarioId}
          onFechar={() => setRestauracaoAberta(false)}
          onRegistrado={aoRegistrarRestauracao}
        />
      )}
    </>
  );
}
