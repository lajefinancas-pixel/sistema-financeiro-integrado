import React from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import { usePermissaoModulo } from "../lib/permissoes";
import { mensagemAmigavel } from "../lib/erros";
import {
  acaoLabel,
  formatarDataHora,
  listarEventos,
  moduloLabel,
  nivelInfo,
  nomeDoAutor,
  resultadoLabel,
} from "../lib/auditoria";

const MODULO = "auditoria";

function BadgeNivel({ nivel }) {
  const info = nivelInfo(nivel);
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.ponto }} />
      {info.label}
    </span>
  );
}

function BadgeModulo({ modulo }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E7EDF5] text-[#0F2A44] whitespace-nowrap">
      {moduloLabel(modulo)}
    </span>
  );
}

/** "Falha" precisa saltar aos olhos; "Sucesso" fica discreto. */
function MarcaResultado({ resultado }) {
  if (resultado !== "falha") return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-50 text-red-600 uppercase tracking-wide">
      {resultadoLabel(resultado)}
    </span>
  );
}

export default function Auditoria() {
  const { carregando: verificando, usuario: usuarioLogado, permissao, erro: erroPermissao } =
    usePermissaoModulo(MODULO);

  const podeVisualizar = permissao?.pode_visualizar === true;

  const [eventos, setEventos] = React.useState([]);
  const [pagina, setPagina] = React.useState(0);
  const [temMais, setTemMais] = React.useState(false);
  const [carregando, setCarregando] = React.useState(true);
  const [carregandoMais, setCarregandoMais] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [recarga, setRecarga] = React.useState(0);

  // Primeiro lote (e recarga pelo botão "Atualizar").
  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const { eventos: lote, temMais: mais } = await listarEventos({ pagina: 0 });
        if (!ativo) return;
        setEventos(lote);
        setTemMais(mais);
        setPagina(0);
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar os eventos de auditoria."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar, recarga]);

  async function carregarMais() {
    if (carregandoMais) return;
    setCarregandoMais(true);
    setErro(null);
    try {
      const proxima = pagina + 1;
      const { eventos: lote, temMais: mais } = await listarEventos({ pagina: proxima });
      setEventos((atuais) => [...atuais, ...lote]);
      setTemMais(mais);
      setPagina(proxima);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar mais eventos."));
    } finally {
      setCarregandoMais(false);
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
        <AcessoNegado
          modulo="Auditoria"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Auditoria" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
              Gestão e controle
            </div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Auditoria</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando eventos..."
                : eventos.length === 0
                  ? "Nenhum evento registrado ainda."
                  : `${eventos.length} ${eventos.length === 1 ? "evento carregado" : "eventos carregados"}, do mais recente para o mais antigo`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRecarga((n) => n + 1)}
            disabled={carregando}
            className="self-start flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44] hover:bg-black/5 disabled:opacity-40"
          >
            <RefreshCw size={15} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : eventos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
            <ShieldCheck size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <div className="text-sm text-[#0F2A44]/40">
              A trilha de auditoria ainda não tem eventos. As próximas ações da equipe aparecem aqui.
            </div>
          </div>
        ) : (
          <>
            {/* Tabela — telas médias e grandes */}
            <div className="hidden md:block bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
                    <th className="py-3 pl-5 pr-3 font-medium whitespace-nowrap">Data/Hora</th>
                    <th className="py-3 px-3 font-medium">Usuário</th>
                    <th className="py-3 px-3 font-medium">Módulo</th>
                    <th className="py-3 px-3 font-medium">Ação</th>
                    <th className="py-3 px-3 font-medium">Registro afetado</th>
                    <th className="py-3 pl-3 pr-5 font-medium text-right">Nível</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((evento) => (
                    <tr key={evento.id} className="border-t border-black/5 hover:bg-black/[0.02]">
                      <td className="py-3 pl-5 pr-3 text-[#0F2A44]/70 whitespace-nowrap">
                        {formatarDataHora(evento.data_hora)}
                      </td>
                      <td className="py-3 px-3 font-medium text-[#0F2A44]">{nomeDoAutor(evento)}</td>
                      <td className="py-3 px-3">
                        <BadgeModulo modulo={evento.modulo} />
                      </td>
                      <td className="py-3 px-3 text-[#0F2A44]/70">
                        <div className="flex items-center gap-2">
                          {acaoLabel(evento.acao)}
                          <MarcaResultado resultado={evento.resultado} />
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[#0F2A44]/70">{evento.registro_afetado || "--"}</td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        <BadgeNivel nivel={evento.nivel} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards — telas pequenas */}
            <div className="md:hidden space-y-3">
              {eventos.map((evento) => (
                <div key={evento.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[#0F2A44] truncate">{nomeDoAutor(evento)}</div>
                      <div className="text-xs text-[#0F2A44]/50 mt-0.5">
                        {formatarDataHora(evento.data_hora)}
                      </div>
                    </div>
                    <BadgeNivel nivel={evento.nivel} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-black/5 flex items-center gap-2 flex-wrap">
                    <BadgeModulo modulo={evento.modulo} />
                    <span className="text-sm text-[#0F2A44]/70">{acaoLabel(evento.acao)}</span>
                    <MarcaResultado resultado={evento.resultado} />
                  </div>
                  {evento.registro_afetado && (
                    <div className="text-xs text-[#0F2A44]/60 mt-2 break-words">
                      {evento.registro_afetado}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {temMais && (
              <div className="flex justify-center mt-6">
                <button
                  type="button"
                  onClick={carregarMais}
                  disabled={carregandoMais}
                  className="text-sm px-5 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
                >
                  {carregandoMais ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            )}

            {!temMais && eventos.length > 0 && (
              <div className="text-center text-xs text-[#0F2A44]/40 mt-6">
                <div className="w-10 h-px bg-[#C9A227] mx-auto mb-3" />
                Fim da trilha de auditoria.
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
