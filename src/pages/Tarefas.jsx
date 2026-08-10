import React from "react";
import { ClipboardList, Columns3, List, Plus, Search, UserRound, Users, X } from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import ModalNovaTarefa from "../components/tarefas/ModalNovaTarefa";
import ModalDetalheTarefa from "../components/tarefas/ModalDetalheTarefa";
import QuadroTarefas from "../components/tarefas/QuadroTarefas";
import MinhasTarefas from "../components/tarefas/MinhasTarefas";
import PainelEquipe from "../components/tarefas/PainelEquipe";
import SinoNotificacoes from "../components/tarefas/SinoNotificacoes";
import { BadgePrioridade, BadgeStatus } from "../components/tarefas/badges";
import { usePermissaoModulo } from "../lib/permissoes";
import { sincronizarNotificacoesDePrazo } from "../lib/notificacoes";
import {
  MODULO,
  categoriaLabel,
  estaAtrasada,
  formatarData,
  formatarHora,
  hojeISO,
  listarSecretarias,
  listarTarefas,
  listarTarefasCompartilhadasComigo,
  listarUsuarios,
  mudarStatusTarefa,
  statusInfo,
  statusVisual,
  textoPrazo,
} from "../lib/tarefas";
import { mensagemAmigavel } from "../lib/erros";

// Os contadores do topo. "atrasada" não é um status gravado: vem do prazo vencido.
const CONTADORES = [
  { chave: "recebida", label: "Recebidas" },
  { chave: "em_andamento", label: "Em andamento" },
  { chave: "aguardando_resposta", label: "Aguardando" },
  { chave: "concluida", label: "Concluídas" },
  { chave: "atrasada", label: "Atrasadas" },
];

const ORDENACOES = [
  { id: "prazo", label: "Prazo mais próximo" },
  { id: "prioridade", label: "Maior prioridade" },
  { id: "recentes", label: "Criadas recentemente" },
];

const PESO_PRIORIDADE = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

// Abas da página. "Equipe e tarefas" só aparece para quem aprova/administra.
const ABAS_PAGINA = [
  { id: "geral", label: "Visão geral", icone: ClipboardList },
  { id: "minhas", label: "Minhas tarefas", icone: UserRound },
  { id: "equipe", label: "Equipe e tarefas", icone: Users, somenteGestao: true },
];

function ordenar(lista, criterio) {
  const copia = [...lista];
  if (criterio === "prioridade") {
    copia.sort((a, b) => (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9));
    return copia;
  }
  if (criterio === "recentes") {
    copia.sort((a, b) => new Date(b.criado_em ?? 0) - new Date(a.criado_em ?? 0));
    return copia;
  }
  // Prazo mais próximo primeiro; tarefas sem prazo vão para o fim da lista.
  copia.sort((a, b) => {
    if (!a.prazo && !b.prazo) return 0;
    if (!a.prazo) return 1;
    if (!b.prazo) return -1;
    return a.prazo.localeCompare(b.prazo);
  });
  return copia;
}

function CardContador({ label, quantidade, chave, ativo, onClick }) {
  const info = statusInfo(chave);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white rounded-2xl border shadow-sm p-4 transition-colors hover:border-[#C9A227]/60 ${
        ativo ? "border-[#C9A227] ring-1 ring-[#C9A227]/30" : "border-black/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: info.ponto }} />
        <span className="text-[11px] uppercase tracking-wide font-medium text-[#0F2A44]/50 truncate">{label}</span>
      </div>
      <div className="text-2xl font-semibold mt-2" style={{ color: info.cor }}>
        {quantidade}
      </div>
      <div className="text-[11px] text-[#0F2A44]/40 mt-0.5">
        {ativo ? "Filtro aplicado" : "Clique para filtrar"}
      </div>
    </button>
  );
}

export default function Tarefas() {
  const { carregando: verificando, usuario: usuarioLogado, permissao, erro: erroPermissao } =
    usePermissaoModulo(MODULO);
  // Só para saber se a pessoa administra o sistema — a regra do painel da gestora.
  const { permissao: permissaoAdmin } = usePermissaoModulo("administracao");

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [tarefas, setTarefas] = React.useState([]);
  const [usuarios, setUsuarios] = React.useState([]);
  const [secretarias, setSecretarias] = React.useState([]);
  const [idsCompartilhadas, setIdsCompartilhadas] = React.useState(() => new Set());

  const [busca, setBusca] = React.useState("");
  const [filtroStatus, setFiltroStatus] = React.useState(null);
  const [escopo, setEscopo] = React.useState("minhas");
  const [ordenacao, setOrdenacao] = React.useState("prazo");

  const [abrirNova, setAbrirNova] = React.useState(false);
  const [tarefaAberta, setTarefaAberta] = React.useState(null);
  const [recarga, setRecarga] = React.useState(0);
  const [recargaSino, setRecargaSino] = React.useState(0);

  // Aba da página: a visão que já existia, as minhas tarefas ou o painel da equipe.
  const [abaPagina, setAbaPagina] = React.useState("geral");

  // "lista" mantém a tabela já existente; "quadro" mostra o Kanban.
  const [visao, setVisao] = React.useState("lista");
  const [movendoId, setMovendoId] = React.useState(null);

  const podeVisualizar = permissao?.pode_visualizar === true;
  const podeCadastrar = permissao?.pode_cadastrar === true;
  // Painel da gestora: ver tarefas e ser quem aprova (ou administrar o sistema).
  const podeVerEquipe =
    podeVisualizar && (permissao?.pode_aprovar === true || permissaoAdmin?.pode_editar === true);

  const abasVisiveis = ABAS_PAGINA.filter((a) => !a.somenteGestao || podeVerEquipe);
  const abaAtiva = abasVisiveis.some((a) => a.id === abaPagina) ? abaPagina : "geral";

  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const [listaTarefas, listaUsuarios, listaSecretarias, compartilhadas] = await Promise.all([
          listarTarefas(),
          listarUsuarios(),
          listarSecretarias().catch(() => []),
          usuarioLogado?.id
            ? listarTarefasCompartilhadasComigo(usuarioLogado.id).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!ativo) return;
        setTarefas(listaTarefas);
        setUsuarios(listaUsuarios);
        setSecretarias(listaSecretarias);
        setIdsCompartilhadas(new Set(compartilhadas));

        // Avisos de prazo: no máximo um por tarefa por dia, gerados na abertura da tela.
        if (usuarioLogado?.id) {
          sincronizarNotificacoesDePrazo(usuarioLogado.id, listaTarefas, hojeISO())
            .then(() => {
              if (ativo) setRecargaSino((n) => n + 1);
            })
            .catch(() => {});
        }
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Erro ao carregar as tarefas."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar, usuarioLogado?.id, recarga]);

  // Os contadores olham sempre as tarefas de quem está logado.
  const minhasTarefas = React.useMemo(
    () => tarefas.filter((t) => t.responsavel_id === usuarioLogado?.id),
    [tarefas, usuarioLogado],
  );

  // Aba "Minhas tarefas": o que é meu como responsável mais o que dividiram comigo.
  const tarefasDaPessoa = React.useMemo(
    () =>
      tarefas.filter(
        (t) => t.responsavel_id === usuarioLogado?.id || idsCompartilhadas.has(t.id),
      ),
    [tarefas, usuarioLogado, idsCompartilhadas],
  );

  const contagens = React.useMemo(() => {
    const mapa = { recebida: 0, em_andamento: 0, aguardando_resposta: 0, concluida: 0, atrasada: 0 };
    minhasTarefas.forEach((t) => {
      if (estaAtrasada(t)) mapa.atrasada += 1;
      if (mapa[t.status] !== undefined) mapa[t.status] += 1;
    });
    return mapa;
  }, [minhasTarefas]);

  const filtradas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = escopo === "minhas" ? minhasTarefas : tarefas;
    const lista = base.filter((t) => {
      if (filtroStatus === "atrasada" && !estaAtrasada(t)) return false;
      if (filtroStatus && filtroStatus !== "atrasada" && t.status !== filtroStatus) return false;
      if (termo && !(t.titulo ?? "").toLowerCase().includes(termo)) return false;
      return true;
    });
    return ordenar(lista, ordenacao);
  }, [tarefas, minhasTarefas, escopo, filtroStatus, busca, ordenacao]);

  function alternarContador(chave) {
    setFiltroStatus((atual) => (atual === chave ? null : chave));
    setEscopo("minhas"); // mantém a lista coerente com o número mostrado no card
  }

  const temFiltro = filtroStatus !== null || busca.trim() !== "" || escopo !== "minhas";
  function limparFiltros() {
    setFiltroStatus(null);
    setBusca("");
    setEscopo("minhas");
  }

  /** Mover no quadro é a mesma regra da política de update da tabela "tarefas". */
  function podeMoverTarefa(tarefa) {
    if (permissao?.pode_editar === true) return true;
    return Boolean(usuarioLogado?.id) && tarefa.responsavel_id === usuarioLogado.id;
  }

  function aplicarAtualizacao(atualizada) {
    setTarefas((atual) => atual.map((t) => (t.id === atualizada.id ? atualizada : t)));
    setTarefaAberta((aberta) => (aberta?.id === atualizada.id ? atualizada : aberta));
  }

  /** Clique na notificação: abre a tarefa correspondente, se ela estiver carregada. */
  function abrirTarefaPorId(tarefaId) {
    const encontrada = tarefas.find((t) => t.id === tarefaId);
    if (encontrada) {
      setTarefaAberta(encontrada);
      return;
    }
    setAviso("A tarefa desta notificação não está mais disponível para você.");
  }

  /** Card solto em outra coluna: grava o novo status e a linha de histórico. */
  async function moverTarefa(tarefa, novoStatus) {
    setMovendoId(tarefa.id);
    setErro(null);
    setAviso(null);
    try {
      const resultado = await mudarStatusTarefa(tarefa, novoStatus, usuarioLogado?.id);
      aplicarAtualizacao(resultado.tarefa);
      setAviso(
        resultado.avisoHistorico
          ? `O status foi alterado, mas o registro no histórico falhou: ${resultado.avisoHistorico}`
          : resultado.paraAprovacao
            ? "Tarefa importante: ficou em análise, aguardando a aprovação da gestora."
            : resultado.ocorrencia
              ? `Próxima ocorrência criada para ${formatarData(resultado.ocorrencia.prazo)}.`
              : null,
      );
      if (resultado.ocorrencia) setRecarga((n) => n + 1);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível mudar o status da tarefa."));
    } finally {
      setMovendoId(null);
    }
  }

  const infoLayout = usuarioLogado ? { nome: usuarioLogado.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Tarefas" detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`} />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Tarefas" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">Acompanhamento</div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Tarefas</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando tarefas..."
                : abaAtiva === "minhas"
                  ? `${tarefasDaPessoa.length} ${
                      tarefasDaPessoa.length === 1 ? "tarefa sua" : "tarefas suas"
                    } — como responsável ou compartilhadas com você`
                  : abaAtiva === "equipe"
                    ? "Andamento das tarefas da equipe"
                    : `${filtradas.length} ${filtradas.length === 1 ? "tarefa" : "tarefas"} ${
                        escopo === "minhas" ? "atribuídas a você" : "no sistema"
                      }`}
            </p>
          </div>
          <div className="self-start flex flex-wrap items-center gap-3">
            <SinoNotificacoes
              usuarioId={usuarioLogado?.id}
              recarga={recargaSino}
              onAbrirTarefa={abrirTarefaPorId}
            />

            {/* Alternância de visualização: a lista já existente ou o quadro Kanban. */}
            {abaAtiva === "geral" && (
              <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5" role="group" aria-label="Visualização">
                {[
                  { id: "lista", label: "Lista", icone: List },
                  { id: "quadro", label: "Quadro", icone: Columns3 },
                ].map((opcao) => {
                  const Icone = opcao.icone;
                  const ativa = visao === opcao.id;
                  return (
                    <button
                      key={opcao.id}
                      type="button"
                      onClick={() => setVisao(opcao.id)}
                      aria-pressed={ativa}
                      className={`flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-[7px] transition-colors ${
                        ativa ? "bg-[#0F2A44] text-white" : "text-[#0F2A44]/60 hover:bg-black/5"
                      }`}
                    >
                      <Icone size={15} />
                      {opcao.label}
                    </button>
                  );
                })}
              </div>
            )}

            {podeCadastrar && (
              <button
                type="button"
                onClick={() => setAbrirNova(true)}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
              >
                <Plus size={16} />
                Nova Tarefa
              </button>
            )}
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">{erro}</div>
        )}
        {aviso && (
          <div className="bg-[#FBF4DE] border border-[#C9A227]/40 text-[#8A7526] text-sm rounded-lg px-4 py-3 mb-5">
            {aviso}
          </div>
        )}

        {/* Abas da página: a visão que já existia continua sendo a primeira. */}
        <div className="flex gap-1 border-b border-black/10 mb-5 overflow-x-auto">
          {abasVisiveis.map((item) => {
            const Icone = item.icone;
            const ativa = abaAtiva === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAbaPagina(item.id)}
                aria-current={ativa ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  ativa
                    ? "border-[#C9A227] text-[#0F2A44] font-medium"
                    : "border-transparent text-[#0F2A44]/50 hover:text-[#0F2A44]/80"
                }`}
              >
                <Icone size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

        {abaAtiva === "geral" && (
          <>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
          {CONTADORES.map((c) => (
            <CardContador
              key={c.chave}
              chave={c.chave}
              label={c.label}
              quantidade={contagens[c.chave] ?? 0}
              ativo={filtroStatus === c.chave}
              onClick={() => alternarContador(c.chave)}
            />
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex items-center rounded-lg border border-black/10 overflow-hidden focus-within:border-[#0F2A44] flex-1">
              <div className="w-10 h-10 flex items-center justify-center text-[#0F2A44]/40">
                <Search size={16} />
              </div>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pelo título da tarefa..."
                className="flex-1 px-1 py-2 text-sm outline-none placeholder:text-[#0F2A44]/30"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  title="Limpar busca"
                  className="w-10 h-10 flex items-center justify-center text-[#0F2A44]/30 hover:text-[#0F2A44]/70"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={escopo}
                onChange={(e) => setEscopo(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44] bg-white sm:min-w-[180px]"
              >
                <option value="minhas">Minhas tarefas</option>
                <option value="todas">Todas as tarefas</option>
              </select>

              <select
                value={ordenacao}
                onChange={(e) => setOrdenacao(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44] bg-white sm:min-w-[200px]"
              >
                {ORDENACOES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>

              {temFiltro && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="px-3 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : visao === "quadro" ? (
          <QuadroTarefas
            tarefas={filtradas}
            podeMover={podeMoverTarefa}
            tarefaSalvandoId={movendoId}
            onAbrir={setTarefaAberta}
            onMover={moverTarefa}
          />
        ) : filtradas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
            <ClipboardList size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <div className="text-sm text-[#0F2A44]/40">
              {tarefas.length === 0
                ? "Nenhuma tarefa cadastrada ainda."
                : "Nenhuma tarefa encontrada com os filtros aplicados."}
            </div>
          </div>
        ) : (
          <>
            {/* Tabela — telas médias e grandes */}
            <div className="hidden lg:block bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
                    <th className="py-3 pl-5 pr-3 font-medium">Título</th>
                    <th className="py-3 px-3 font-medium">Responsável</th>
                    <th className="py-3 px-3 font-medium">Prioridade</th>
                    <th className="py-3 px-3 font-medium">Prazo</th>
                    <th className="py-3 px-3 font-medium">Status</th>
                    <th className="py-3 px-3 font-medium">Categoria</th>
                    <th className="py-3 pl-3 pr-5 font-medium">Secretaria</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((t) => {
                    const hora = formatarHora(t.horario_limite);
                    const prazoAviso = textoPrazo(t);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setTarefaAberta(t)}
                        className="border-t border-black/5 hover:bg-black/[0.02] cursor-pointer"
                      >
                        <td className="py-3 pl-5 pr-3 font-medium text-[#0F2A44] max-w-[280px]">
                          <span className="block truncate">{t.titulo}</span>
                        </td>
                        <td className="py-3 px-3 text-[#0F2A44]/70">
                          {t.responsavel?.nome_completo ?? "--"}
                        </td>
                        <td className="py-3 px-3">
                          <BadgePrioridade prioridade={t.prioridade} />
                        </td>
                        <td className="py-3 px-3 text-[#0F2A44]/70 whitespace-nowrap">
                          {formatarData(t.prazo)}
                          {hora && <span className="text-[#0F2A44]/45"> às {hora}</span>}
                          {prazoAviso && (
                            <span className="block text-[11px] text-[#0F2A44]/40">{prazoAviso}</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <BadgeStatus status={statusVisual(t)} />
                        </td>
                        <td className="py-3 px-3 text-[#0F2A44]/70">{categoriaLabel(t.categoria)}</td>
                        <td className="py-3 pl-3 pr-5 text-[#0F2A44]/70">{t.secretaria_relacionada || "--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards — telas pequenas */}
            <div className="lg:hidden space-y-3">
              {filtradas.map((t) => {
                const hora = formatarHora(t.horario_limite);
                return (
                  <div
                    key={t.id}
                    onClick={() => setTarefaAberta(t)}
                    className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-[#0F2A44] leading-snug">{t.titulo}</div>
                      <BadgePrioridade prioridade={t.prioridade} />
                    </div>
                    <div className="text-xs text-[#0F2A44]/55 mt-1">
                      {t.responsavel?.nome_completo ?? "Sem responsável"}
                      {t.secretaria_relacionada ? ` — ${t.secretaria_relacionada}` : ""}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-black/5">
                      <BadgeStatus status={statusVisual(t)} />
                      <span className="text-xs text-[#0F2A44]/55">
                        {formatarData(t.prazo)}
                        {hora ? ` às ${hora}` : ""}
                      </span>
                      <span className="text-xs text-[#0F2A44]/40">{categoriaLabel(t.categoria)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
          </>
        )}

        {abaAtiva === "minhas" &&
          (carregando ? (
            <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
          ) : (
            <MinhasTarefas
              tarefas={tarefasDaPessoa}
              usuarioId={usuarioLogado?.id}
              idsCompartilhadas={idsCompartilhadas}
              onAbrir={setTarefaAberta}
            />
          ))}

        {abaAtiva === "equipe" &&
          podeVerEquipe &&
          (carregando ? (
            <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
          ) : (
            <PainelEquipe tarefas={tarefas} usuarios={usuarios} />
          ))}
      </div>

      {abrirNova && (
        <ModalNovaTarefa
          usuarios={usuarios}
          secretarias={secretarias}
          usuarioId={usuarioLogado?.id}
          onFechar={() => setAbrirNova(false)}
          onCriada={(_tarefa, avisoHistorico) => {
            setAviso(
              avisoHistorico
                ? `A tarefa foi criada, mas o registro no histórico falhou: ${avisoHistorico}`
                : null,
            );
            setRecarga((n) => n + 1);
          }}
        />
      )}

      {tarefaAberta && (
        <ModalDetalheTarefa
          tarefa={tarefaAberta}
          usuarioLogado={usuarioLogado}
          permissao={permissao}
          usuarios={usuarios}
          onFechar={() => setTarefaAberta(null)}
          onAtualizada={aplicarAtualizacao}
          onListaMudou={() => setRecarga((n) => n + 1)}
        />
      )}
    </Layout>
  );
}
