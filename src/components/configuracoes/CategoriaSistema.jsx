import React from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Info,
  ServerCog,
  RefreshCw,
  Stethoscope,
  Users,
} from "lucide-react";
import { Cartao } from "./comuns";
import { carregarInformacoesSistema, VERSAO_SISTEMA } from "../../lib/informacoesSistema";

/**
 * Categoria SISTEMA: informações técnicas do ambiente, somente leitura.
 *
 * Nada aqui grava, altera ou apaga registro nenhum — é uma tela de conferência.
 * Os detalhes só são consultados quando alguém clica em "Ver Informações do
 * Sistema", para que abrir a categoria não dispare consultas ao banco à toa.
 */

/** Uma linha do painel: rótulo, valor em destaque e uma explicação curta. */
function Linha({ icone: Icone, rotulo, valor, detalhe, destaque }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 bg-white">
      <div className="w-9 h-9 rounded-xl bg-[#0F2A44]/5 flex items-center justify-center shrink-0">
        <Icone size={16} className="text-[#0F2A44]/70" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[#0F2A44]/40">{rotulo}</div>
        <div className="text-sm text-[#0F2A44] mt-0.5 flex items-center gap-2 flex-wrap">
          {valor}
          {destaque}
        </div>
        {detalhe && (
          <p className="text-[11px] text-[#0F2A44]/45 mt-1 leading-relaxed">{detalhe}</p>
        )}
      </div>
    </li>
  );
}

/** Etiqueta do estado da conexão: verde quando responde, vermelha quando não. */
function EtiquetaBanco({ conectado }) {
  const info = conectado
    ? { label: "Conectado", cor: "#16A34A", bg: "#EAFBF0" }
    : { label: "Indisponível", cor: "#DC2626", bg: "#FEF2F2" };
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.cor }} />
      {info.label}
    </span>
  );
}

export default function CategoriaSistema() {
  const [aberto, setAberto] = React.useState(false);
  const [informacoes, setInformacoes] = React.useState(null);
  const [carregando, setCarregando] = React.useState(false);

  const montado = React.useRef(true);
  React.useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  async function consultar() {
    setCarregando(true);
    // carregarInformacoesSistema já trata os próprios erros: uma falha de banco
    // é justamente a resposta que a tela precisa mostrar ("Indisponível").
    const dados = await carregarInformacoesSistema();
    if (!montado.current) return;
    setInformacoes(dados);
    setCarregando(false);
  }

  function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && !informacoes && !carregando) consultar();
  }

  const usuariosAtivos = informacoes?.usuariosAtivos;
  const publicacao = informacoes?.publicacao || "";
  const commit = informacoes?.commit || "";

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Informações do sistema"
        descricao="Versão publicada, estado da conexão com o banco e quantidade de acessos ativos."
        icone={ServerCog}
        rodape={
          aberto && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
              <p className="text-[11px] text-[#0F2A44]/45 leading-relaxed">
                Tela somente leitura: nenhuma informação desta categoria pode ser alterada aqui.
              </p>
              <button
                type="button"
                onClick={consultar}
                disabled={carregando}
                className="self-start sm:self-auto flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <RefreshCw size={13} className={carregando ? "animate-spin" : undefined} />
                {carregando ? "Verificando..." : "Verificar novamente"}
              </button>
            </div>
          )
        }
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={alternar}
            aria-expanded={aberto}
            className="w-full flex items-center gap-3 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5 hover:bg-[#F5F3EF] text-left"
          >
            <div className="w-9 h-9 rounded-xl bg-white border border-[#C9A227]/30 flex items-center justify-center shrink-0">
              <Info size={16} className="text-[#0F2A44]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#0F2A44]">Ver Informações do Sistema</div>
              <div className="text-[11px] text-[#0F2A44]/55 mt-0.5 leading-relaxed">
                {aberto
                  ? "Recolher os detalhes técnicos do ambiente."
                  : "Versão, data da última atualização, status do banco de dados e usuários ativos."}
              </div>
            </div>
            {aberto ? (
              <ChevronDown size={16} className="text-[#0F2A44]/25 ml-auto shrink-0" />
            ) : (
              <ChevronRight size={16} className="text-[#0F2A44]/25 ml-auto shrink-0" />
            )}
          </button>

          {aberto &&
            (carregando && !informacoes ? (
              <p className="text-sm text-[#0F2A44]/45 px-1">Consultando o sistema...</p>
            ) : (
              <ul className="divide-y divide-black/5 rounded-xl border border-black/5 overflow-hidden">
                <Linha
                  icone={ServerCog}
                  rotulo="Versão do sistema"
                  valor={informacoes?.versao ?? VERSAO_SISTEMA}
                  detalhe="Valor informativo, atualizado a cada entrega maior do sistema."
                />
                <Linha
                  icone={RefreshCw}
                  rotulo="Última atualização"
                  valor={publicacao || "Não disponível"}
                  detalhe={
                    publicacao
                      ? `Data em que esta versão foi publicada${
                          commit ? ` (commit ${commit})` : ""
                        }.`
                      : "A data de publicação não foi registrada nesta versão."
                  }
                />
                <Linha
                  icone={Database}
                  rotulo="Status do banco de dados"
                  valor=""
                  destaque={<EtiquetaBanco conectado={informacoes?.banco?.conectado === true} />}
                  detalhe={informacoes?.banco?.detalhe}
                />
                <Linha
                  icone={Users}
                  rotulo="Usuários ativos"
                  valor={
                    usuariosAtivos === null || usuariosAtivos === undefined
                      ? "Não disponível"
                      : `${usuariosAtivos} ${usuariosAtivos === 1 ? "usuário" : "usuários"}`
                  }
                  detalhe={
                    usuariosAtivos === null || usuariosAtivos === undefined
                      ? "A contagem de usuários não pôde ser lida agora."
                      : "Cadastros com situação ativa. Usuários bloqueados e inativos não entram na conta — a gestão continua em Configurações > Usuários e Segurança > Usuários."
                  }
                />
              </ul>
            ))}
        </div>
      </Cartao>

      <Cartao
        titulo="Conferência"
        descricao="Ferramenta de leitura para conferir registros antigos do sistema."
        icone={Stethoscope}
      >
        <Link
          to="/diagnostico-pagamentos"
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#F5F3EF]/60 px-4 py-3.5 hover:bg-[#F5F3EF]"
        >
          <div className="w-9 h-9 rounded-xl bg-white border border-[#C9A227]/30 flex items-center justify-center shrink-0">
            <Stethoscope size={16} className="text-[#0F2A44]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#0F2A44]">
              Diagnóstico de pagamentos antigos
            </div>
            <div className="text-[11px] text-[#0F2A44]/55 mt-0.5 leading-relaxed">
              Compara o débito registrado em cada conta com o débito correto pelo rateio. Somente
              leitura — nenhum valor é alterado.
            </div>
          </div>
          <ChevronRight size={16} className="text-[#0F2A44]/25 ml-auto shrink-0" />
        </Link>
      </Cartao>
    </div>
  );
}
