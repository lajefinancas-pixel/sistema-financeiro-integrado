import React from "react";
import {
  AlertTriangle,
  DatabaseBackup,
  History,
  Info,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Alerta, Campo, ModalShell } from "../equipe/comuns";
import { Cartao } from "./comuns";
import {
  formatarDataHora,
  justificativaValida,
  listarRegistros,
  MINIMO_JUSTIFICATIVA,
  nomeDoAutor,
  registrarSolicitacaoRestauracao,
  resumoBackups,
  statusInfo,
  tipoInfo,
} from "../../lib/backups";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/** Texto explicativo repetido na tela: de onde vêm (e de onde não vêm) os backups. */
const TEXTO_INFRAESTRUTURA =
  "As cópias de segurança do banco de dados são geradas e mantidas automaticamente pela infraestrutura do Supabase, fora desta aplicação. Esta área mostra apenas os registros informativos gravados no sistema — nenhum número é estimado ou simulado.";

/** Um número (ou traço) com o rótulo em cima, no painel de resumo. */
function Indicador({ rotulo, valor, apoio, destaque }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#0F2A44]/40">{rotulo}</div>
      <div
        className={`mt-1 text-sm font-medium ${destaque ? "text-[#0F2A44]" : "text-[#0F2A44]/70"}`}
      >
        {valor}
      </div>
      {apoio && <div className="text-[11px] text-[#0F2A44]/45 mt-0.5 leading-relaxed">{apoio}</div>}
    </div>
  );
}

/** Etiqueta colorida de tipo/situação usada na lista do histórico. */
function Etiqueta({ info }) {
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      {info.label}
    </span>
  );
}

/** Modal "Ver Histórico de Backups": só o que está realmente gravado. */
function ModalHistorico({ onFechar }) {
  const [estado, setEstado] = React.useState({ carregando: true, registros: [], disponivel: true });
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const dados = await listarRegistros();
        if (ativo) setEstado({ carregando: false, ...dados });
      } catch (e) {
        if (ativo) {
          setErro(mensagemAmigavel(e, "Não foi possível carregar o histórico de backups."));
          setEstado({ carregando: false, registros: [], disponivel: true });
        }
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const vazio = !estado.carregando && estado.registros.length === 0;

  return (
    <ModalShell
      titulo="Histórico de backups"
      subtitulo="Registros de cópias e de solicitações de restauração"
      largura="max-w-2xl"
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

        {estado.carregando ? (
          <p className="text-sm text-[#0F2A44]/45 py-6 text-center">Carregando histórico...</p>
        ) : vazio ? (
          <div className="rounded-xl border border-dashed border-black/10 px-5 py-10 text-center">
            <History size={22} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <p className="text-sm text-[#0F2A44]/60">
              {estado.disponivel
                ? "Nenhum registro de backup foi gravado neste sistema."
                : "O registro de backups ainda não está disponível neste banco de dados."}
            </p>
            <p className="text-xs text-[#0F2A44]/45 mt-2 max-w-md mx-auto leading-relaxed">
              Gerenciado automaticamente pela infraestrutura do Supabase.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
            {estado.registros.map((registro) => (
              <li key={registro.id} className="px-4 py-3.5 bg-white">
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta info={tipoInfo(registro.tipo)} />
                  <Etiqueta info={statusInfo(registro.status)} />
                  <span className="text-[11px] text-[#0F2A44]/45 ml-auto">
                    {formatarDataHora(registro.criado_em)}
                  </span>
                </div>
                {registro.descricao && (
                  <p className="text-sm text-[#0F2A44] mt-2 leading-relaxed">{registro.descricao}</p>
                )}
                {registro.justificativa && (
                  <p className="text-xs text-[#0F2A44]/60 mt-1.5 leading-relaxed">
                    <span className="text-[#0F2A44]/40">Justificativa: </span>
                    {registro.justificativa}
                  </p>
                )}
                <p className="text-[11px] text-[#0F2A44]/40 mt-1.5">{nomeDoAutor(registro)}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
          <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
          <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">{TEXTO_INFRAESTRUTURA}</p>
        </div>
      </div>
    </ModalShell>
  );
}

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

      // Exigência da categoria: a solicitação é uma ação CRÍTICA. Usuário e
      // data/hora são preenchidos pela própria trilha de auditoria.
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

/**
 * Categoria BACKUP: panorama das cópias do sistema e registro de restaurações.
 *
 * Duas decisões guiam a tela:
 *
 *  1. Nada inventado. O backup automático do banco é da infraestrutura do
 *     Supabase; a aplicação não tem acesso a ele. Então os indicadores mostram
 *     apenas o que está gravado em backups_log — e "nenhum registro" quando é o
 *     caso, em vez de datas e quantidades de exemplo.
 *  2. Restaurar é pedido, não execução. O botão abre um aviso com justificativa
 *     obrigatória e grava o pedido na Auditoria como ação crítica; a restauração
 *     em si continua fora do alcance de uma aplicação web.
 */
export default function CategoriaBackup({ podeEditar, usuarioId }) {
  const [resumo, setResumo] = React.useState(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [historicoAberto, setHistoricoAberto] = React.useState(false);
  const [restauracaoAberta, setRestauracaoAberta] = React.useState(false);
  const [sucesso, setSucesso] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      const dados = await resumoBackups();
      setResumo(dados);
      setErro(null);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível consultar os registros de backup."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const ultimo = resumo?.ultimoBackup ?? null;
  const semRegistros = resumo?.disponivel === false || !ultimo;

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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Indicador
                    rotulo="Último backup"
                    valor={ultimo ? formatarDataHora(ultimo.criado_em) : "Nenhum registro"}
                    apoio={ultimo ? nomeDoAutor(ultimo) : "Nada registrado neste sistema"}
                    destaque={Boolean(ultimo)}
                  />
                  <Indicador
                    rotulo="Status"
                    valor={ultimo ? statusInfo(ultimo.status).label : "Gerenciado pelo Supabase"}
                    apoio={
                      ultimo
                        ? ultimo.descricao || "Registro informativo do sistema"
                        : "A rotina automática é da infraestrutura"
                    }
                    destaque={Boolean(ultimo)}
                  />
                  <Indicador
                    rotulo="Backups armazenados"
                    valor={semRegistros ? "Não informado" : String(resumo.totalBackups)}
                    apoio={
                      semRegistros
                        ? "A aplicação não tem acesso à contagem da infraestrutura"
                        : "Registros informativos gravados no sistema"
                    }
                    destaque={!semRegistros}
                  />
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3">
                  <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
                  <p className="text-[11px] text-[#0F2A44]/55 leading-relaxed">
                    {TEXTO_INFRAESTRUTURA}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setHistoricoAberto(true)}
                  className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/75 hover:bg-black/5"
                >
                  <History size={15} />
                  Ver Histórico de Backups
                </button>
              </>
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
                Restaurar um backup é uma ação crítica e exige permissão elevada: apenas quem tem
                permissão de edição no módulo Administração pode registrar a solicitação. O pedido
                exige justificativa e fica gravado na Auditoria com o usuário e a data/hora.
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
                disabled={!podeEditar}
                onClick={() => {
                  setSucesso(null);
                  setAviso(null);
                  setRestauracaoAberta(true);
                }}
                title={
                  podeEditar
                    ? undefined
                    : "É necessária permissão de edição no módulo Administração."
                }
                className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[#B91C1C] text-white hover:bg-[#991B1B] disabled:opacity-40 disabled:hover:bg-[#B91C1C]"
              >
                <RotateCcw size={15} />
                Restaurar Backup
              </button>
              {!podeEditar && (
                <span className="text-[11px] text-[#0F2A44]/45">
                  Disponível apenas com permissão de edição em Administração.
                </span>
              )}
            </div>
          </div>
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
