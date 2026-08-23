import React from "react";
import { useSearchParams } from "react-router-dom";
import { Settings } from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import { usePermissaoModulo } from "../lib/permissoes";
import { mensagemAmigavel } from "../lib/erros";
import { Alerta } from "../components/equipe/comuns";
import { AvisoSomenteLeitura, EmBreve } from "../components/configuracoes/comuns";
import CategoriaGeral from "../components/configuracoes/CategoriaGeral";
import CategoriaUsuariosSeguranca from "../components/configuracoes/CategoriaUsuariosSeguranca";
import CategoriaFinanceiro from "../components/configuracoes/CategoriaFinanceiro";
import CategoriaFornecedores from "../components/configuracoes/CategoriaFornecedores";
import CategoriaTributario from "../components/configuracoes/CategoriaTributario";
import CategoriaNotificacoes from "../components/configuracoes/CategoriaNotificacoes";
import CategoriaBackup from "../components/configuracoes/CategoriaBackup";
import CategoriaAparencia from "../components/configuracoes/CategoriaAparencia";
import CategoriaSistema from "../components/configuracoes/CategoriaSistema";
import {
  APARENCIA_PADRAO,
  CATEGORIAS,
  CATEGORIA_PADRAO,
  carregarConfiguracoes,
  categoriaValida,
  GERAL_PADRAO,
  NOTIFICACOES_PADRAO,
  nomeExibidoDoSistema,
  SEGURANCA_PADRAO,
  TRIBUTARIO_PADRAO,
} from "../lib/configuracoesSistema";

// A tela inteira é do módulo 'administracao': abrir exige pode_visualizar e
// qualquer alteração exige pode_editar (a RLS da tabela repete essa regra no banco).
const MODULO = "administracao";

/** Navegação das categorias: coluna à esquerda no desktop, faixa rolável no mobile. */
function MenuCategorias({ atual, onEscolher }) {
  return (
    <>
      <nav className="hidden lg:block w-60 shrink-0 space-y-1">
        {CATEGORIAS.map((categoria) => {
          const ativa = categoria.id === atual;
          return (
            <button
              key={categoria.id}
              type="button"
              onClick={() => onEscolher(categoria.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                ativa
                  ? "bg-white border-[#C9A227]/40 shadow-sm"
                  : "bg-transparent border-transparent hover:bg-white/70"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`text-[11px] uppercase tracking-[0.14em] font-medium ${
                    ativa ? "text-[#C9A227]" : "text-[#0F2A44]/40"
                  }`}
                >
                  {categoria.label}
                </span>
                {!categoria.pronta && (
                  <span className="text-[9px] uppercase tracking-[0.1em] text-[#0F2A44]/30 shrink-0">
                    Em breve
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-[#0F2A44]/50 mt-1 leading-snug">
                {categoria.descricao}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="lg:hidden -mx-5 sm:-mx-8 px-5 sm:px-8 overflow-x-auto">
        <div className="flex gap-2 pb-1 w-max">
          {CATEGORIAS.map((categoria) => (
            <button
              key={categoria.id}
              type="button"
              onClick={() => onEscolher(categoria.id)}
              className={`whitespace-nowrap text-xs px-3.5 py-2 rounded-full border ${
                categoria.id === atual
                  ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                  : "bg-white text-[#0F2A44]/70 border-black/10"
              }`}
            >
              {categoria.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function Configuracoes() {
  const {
    carregando: verificando,
    usuario: usuarioLogado,
    permissao,
    erro: erroPermissao,
  } = usePermissaoModulo(MODULO);

  const podeVisualizar = permissao?.pode_visualizar === true;
  const podeEditar = permissao?.pode_editar === true;

  const [parametros, definirParametros] = useSearchParams();
  const categoriaAtual = categoriaValida(parametros.get("categoria") ?? CATEGORIA_PADRAO);
  const categoria = CATEGORIAS.find((c) => c.id === categoriaAtual);

  const [configuracoes, setConfiguracoes] = React.useState({
    geral: GERAL_PADRAO,
    seguranca: SEGURANCA_PADRAO,
    tributario: TRIBUTARIO_PADRAO,
    notificacoes: NOTIFICACOES_PADRAO,
    aparencia: APARENCIA_PADRAO,
    autoria: {},
  });
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    if (!podeVisualizar) return undefined;
    let ativo = true;
    (async () => {
      try {
        const dados = await carregarConfiguracoes();
        if (ativo) setConfiguracoes(dados);
      } catch (e) {
        if (ativo) setErro(mensagemAmigavel(e, "Não foi possível carregar as configurações do sistema."));
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [podeVisualizar]);

  function escolherCategoria(id) {
    definirParametros(id === CATEGORIA_PADRAO ? {} : { categoria: id }, { replace: true });
  }

  /** Depois de salvar, recarrega para trazer o "última alteração" gravado no banco. */
  async function recarregar() {
    try {
      const dados = await carregarConfiguracoes();
      setConfiguracoes(dados);
      setErro(null);
    } catch (e) {
      setErro(mensagemAmigavel(e, "As configurações foram salvas, mas a tela não pôde ser atualizada."));
    }
  }

  const infoLayout = usuarioLogado ? { nome: usuarioLogado.nome_completo } : undefined;

  // O nome escolhido em Aparência (ou, na falta dele, o nome do sistema definido
  // em Geral) aparece aqui — a única tela em que a preferência é aplicada nesta
  // etapa, para não mexer nas páginas já aprovadas.
  const nomeExibido = nomeExibidoDoSistema(configuracoes);

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
          modulo="Administração"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo="Administração"
          detalhe="As Configurações do sistema estão disponíveis apenas para quem tem permissão de visualização no módulo Administração. Fale com um administrador do sistema para solicitar acesso."
        />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-[#0F2A44] flex items-center justify-center shrink-0">
            <Settings size={20} className="text-[#C9A227]" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">Sistema</div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Configurações</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              Parâmetros gerais, acessos e regras de funcionamento do {nomeExibido}.
            </p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-5 lg:gap-7">
          <MenuCategorias atual={categoriaAtual} onEscolher={escolherCategoria} />

          <div className="flex-1 min-w-0 space-y-5">
            {!podeEditar && <AvisoSomenteLeitura />}
            {erro && <Alerta tipo="erro">{erro}</Alerta>}

            {carregando ? (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-10 text-sm text-[#0F2A44]/45">
                Carregando configurações...
              </div>
            ) : categoriaAtual === "geral" ? (
              <CategoriaGeral
                valores={configuracoes.geral}
                autoria={configuracoes.autoria?.geral}
                podeEditar={podeEditar}
                onSalvo={recarregar}
              />
            ) : categoriaAtual === "usuarios-seguranca" ? (
              <CategoriaUsuariosSeguranca
                valores={configuracoes.seguranca}
                autoria={configuracoes.autoria?.seguranca}
                podeEditar={podeEditar}
                onSalvo={recarregar}
              />
            ) : categoriaAtual === "financeiro" ? (
              <CategoriaFinanceiro podeEditar={podeEditar} />
            ) : categoriaAtual === "fornecedores" ? (
              <CategoriaFornecedores />
            ) : categoriaAtual === "tributario" ? (
              <CategoriaTributario
                valores={configuracoes.tributario}
                autoria={configuracoes.autoria?.tributario}
                podeEditar={podeEditar}
                onSalvo={recarregar}
              />
            ) : categoriaAtual === "notificacoes" ? (
              <CategoriaNotificacoes
                valores={configuracoes.notificacoes}
                autoria={configuracoes.autoria?.notificacoes}
                podeEditar={podeEditar}
                onSalvo={recarregar}
              />
            ) : categoriaAtual === "backup" ? (
              <CategoriaBackup podeEditar={podeEditar} usuarioId={usuarioLogado?.id} />
            ) : categoriaAtual === "aparencia" ? (
              <CategoriaAparencia
                valores={configuracoes.aparencia}
                geral={configuracoes.geral}
                autoria={configuracoes.autoria?.aparencia}
                podeEditar={podeEditar}
                onSalvo={recarregar}
              />
            ) : categoriaAtual === "sistema" ? (
              <CategoriaSistema podeGerenciarLixeira={podeEditar} />
            ) : (
              <EmBreve
                titulo={categoria?.label ?? "Categoria"}
                descricao={`${categoria?.descricao ?? "Esta categoria"} — esta parte das configurações será construída nas próximas etapas do sistema.`}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
