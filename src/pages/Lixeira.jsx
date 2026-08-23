import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import ModalConfirmarExclusao from "../components/comuns/ModalConfirmarExclusao";
import FiltrosLixeira from "../components/lixeira/FiltrosLixeira";
import ItemLixeira from "../components/lixeira/ItemLixeira";
import { Alerta } from "../components/equipe/comuns";
import { usePermissaoModulo } from "../lib/permissoes";
import { mensagemAmigavel } from "../lib/erros";
import {
  FILTROS_VAZIOS,
  MODULO,
  aplicarFiltros,
  excluirDefinitivamente,
  listarLixeira,
  podeExcluirDefinitivamente,
  podeGerenciarLixeira,
  restaurarRegistro,
  textoDoBloqueio,
  tipoInfo,
  usuariosDaLixeira,
  vinculosDaExclusaoDefinitiva,
} from "../lib/lixeira";

/**
 * Lixeira do sistema — Configurações > Sistema > Lixeira.
 *
 * Reúne, em um lugar só, tudo que foi excluído logicamente em Fornecedores,
 * Certidões e Pagamentos: o registro, quem o excluiu, quando e o motivo que foi
 * digitado na confirmação da exclusão.
 *
 * A tela não cria nenhuma forma nova de excluir — a exclusão continua sendo
 * feita nas telas de origem, do mesmo jeito. O que ela acrescenta são as duas
 * saídas que faltavam: restaurar (reversível, para quem administra o sistema) e
 * excluir definitivamente (irreversível, restrita ao perfil Administrador com
 * permissão de exclusão em Administração).
 */
export default function Lixeira() {
  const { carregando: verificando, usuario, permissao, erro: erroPermissao } = usePermissaoModulo(MODULO);

  const podeAbrir = podeGerenciarLixeira(permissao);
  const podeApagar = podeExcluirDefinitivamente(permissao, usuario);

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [itens, setItens] = React.useState([]);
  const [indisponiveis, setIndisponiveis] = React.useState([]);
  const [semSuporte, setSemSuporte] = React.useState([]);
  const [filtros, setFiltros] = React.useState(FILTROS_VAZIOS);
  const [restaurando, setRestaurando] = React.useState(null);
  const [exclusaoPendente, setExclusaoPendente] = React.useState(null);

  const montado = React.useRef(true);
  React.useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (podeAbrir) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeAbrir]);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const { itens: encontrados, indisponiveis: falharam, semSuporte: pendentes } = await listarLixeira();
      if (!montado.current) return;
      setItens(encontrados);
      setIndisponiveis(falharam);
      setSemSuporte(pendentes);
    } catch (e) {
      if (montado.current) setErro(mensagemAmigavel(e, "Não foi possível carregar a Lixeira do sistema."));
    } finally {
      if (montado.current) setCarregando(false);
    }
  }

  const visiveis = React.useMemo(() => aplicarFiltros(itens, filtros), [itens, filtros]);
  const usuarios = React.useMemo(() => usuariosDaLixeira(itens), [itens]);

  async function restaurar(item) {
    setRestaurando(item.chave);
    setErro(null);
    setAviso(null);
    try {
      await restaurarRegistro(item, { usuarioId: usuario?.id ?? null });
      if (!montado.current) return;
      setItens((atuais) => atuais.filter((i) => i.chave !== item.chave));
      setAviso(`${tipoInfo(item.tipo).label} "${item.titulo}" restaurado: voltou a aparecer nas listagens do sistema.`);
    } catch (e) {
      if (montado.current) setErro(mensagemAmigavel(e, "Não foi possível restaurar este registro."));
    } finally {
      if (montado.current) setRestaurando(null);
    }
  }

  /**
   * Abre a confirmação da exclusão definitiva e, em paralelo, confere os
   * vínculos do registro: havendo qualquer um, o modal já abre bloqueado e
   * explicando o motivo, como acontece na exclusão de fornecedores.
   */
  function pedirExclusaoDefinitiva(item) {
    setErro(null);
    setAviso(null);
    setExclusaoPendente({ item, verificando: true, bloqueio: null });

    vinculosDaExclusaoDefinitiva(item)
      .then((vinculos) => {
        if (!montado.current) return;
        setExclusaoPendente((atual) => {
          if (!atual || atual.item.chave !== item.chave) return atual;
          return { ...atual, verificando: false, bloqueio: textoDoBloqueio(item, vinculos) };
        });
      })
      .catch(() => {
        if (!montado.current) return;
        setExclusaoPendente((atual) =>
          atual && atual.item.chave === item.chave ? { ...atual, verificando: false } : atual,
        );
      });
  }

  async function confirmarExclusaoDefinitiva(motivo) {
    const pendente = exclusaoPendente;
    if (!pendente) return;

    await excluirDefinitivamente(pendente.item, { motivo, usuarioId: usuario?.id ?? null });

    if (!montado.current) return;
    setItens((atuais) => atuais.filter((i) => i.chave !== pendente.item.chave));
    setExclusaoPendente(null);
    setAviso(
      `${tipoInfo(pendente.item.tipo).label} "${pendente.item.titulo}" apagado permanentemente. ` +
        "O registro e a justificativa ficaram guardados na trilha de auditoria.",
    );
  }

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-5 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando suas permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Lixeira" detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`} />
      </Layout>
    );
  }

  if (!podeAbrir) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo="Lixeira"
          detalhe="A Lixeira do sistema é restrita a quem tem permissão de edição no módulo Administração. Fale com um administrador do sistema para solicitar acesso."
        />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0F2A44] flex items-center justify-center shrink-0">
              <Trash2 size={20} className="text-[#C9A227]" />
            </div>
            <div>
              <Link
                to="/configuracoes?categoria=sistema"
                className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[#C9A227] hover:text-[#0F2A44]"
              >
                <ArrowLeft size={12} /> Configurações · Sistema
              </Link>
              <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Lixeira</h1>
              <p className="text-sm text-[#0F2A44]/60 mt-0.5 max-w-3xl">
                Fornecedores, certidões e pagamentos que foram excluídos do sistema. Eles continuam no
                banco de dados e podem voltar às listagens a qualquer momento.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={carregar}
            disabled={carregando}
            className="self-start inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/[0.02] disabled:opacity-40"
          >
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar
          </button>
        </div>

        {podeApagar && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 mb-5 text-[#B91C1C]">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">
              Você tem permissão para <strong>excluir definitivamente</strong>. Essa ação apaga a linha do
              banco de dados e não pode ser desfeita: depois dela, o registro só existe na trilha de
              auditoria. Restaurar continua sendo a opção reversível.
            </p>
          </div>
        )}

        {erro && (
          <div className="mb-5">
            <Alerta>{erro}</Alerta>
          </div>
        )}
        {aviso && (
          <div className="mb-5">
            <Alerta tipo="sucesso">{aviso}</Alerta>
          </div>
        )}

        {semSuporte.length > 0 && (
          <div className="rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 mb-5 text-xs text-[#8A7526] leading-relaxed">
            A exclusão lógica ainda não está disponível no banco para{" "}
            {semSuporte.map((tipo) => tipoInfo(tipo).plural.toLowerCase()).join(", ")}. Enquanto a
            migration do sistema não for aplicada, esses registros não aparecem na Lixeira.
          </div>
        )}

        {indisponiveis.length > 0 && (
          <div className="rounded-xl border border-[#C9A227]/35 bg-[#FBF4DE] px-4 py-3 mb-5 text-xs text-[#8A7526] leading-relaxed">
            Não foi possível ler os registros excluídos de{" "}
            {indisponiveis.map((tipo) => tipoInfo(tipo).plural.toLowerCase()).join(", ")}. Confira se
            você tem permissão de visualização nesses módulos.
          </div>
        )}

        <FiltrosLixeira
          filtros={filtros}
          onAlterar={setFiltros}
          onLimpar={() => setFiltros(FILTROS_VAZIOS)}
          usuarios={usuarios}
          total={itens.length}
          exibidos={visiveis.length}
        />

        {carregando ? (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-10 text-sm text-[#0F2A44]/45">
            Carregando a Lixeira...
          </div>
        ) : visiveis.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-[#F5F3EF] border border-[#C9A227]/30 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-[#C9A227]" />
            </div>
            <h2 className="text-base font-semibold text-[#0F2A44]">
              {itens.length === 0 ? "A Lixeira está vazia" : "Nenhum registro com esses filtros"}
            </h2>
            <p className="text-sm text-[#0F2A44]/55 mt-1.5 max-w-md mx-auto leading-relaxed">
              {itens.length === 0
                ? "Nenhum fornecedor, certidão ou pagamento foi excluído do sistema até agora."
                : "Ajuste o tipo de registro, o usuário ou o período para encontrar o que procura."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visiveis.map((item) => (
              <ItemLixeira
                key={item.chave}
                item={item}
                podeRestaurar={podeAbrir}
                podeExcluirDefinitivo={podeApagar}
                restaurando={restaurando === item.chave}
                onRestaurar={restaurar}
                onExcluir={pedirExclusaoDefinitiva}
              />
            ))}
          </ul>
        )}
      </div>

      {exclusaoPendente && (
        <ModalConfirmarExclusao
          titulo="Excluir definitivamente"
          subtitulo="Última etapa da exclusão: o registro sai do banco de dados."
          registro={`${tipoInfo(exclusaoPendente.item.tipo).label.toLowerCase()} "${exclusaoPendente.item.titulo}"`}
          aviso="Esta ação é irreversível. O registro será apagado permanentemente do sistema."
          exigirMotivo
          verificando={exclusaoPendente.verificando}
          textoConfirmar="Excluir definitivamente"
          detalhes={exclusaoPendente.item.detalhes}
          bloqueio={exclusaoPendente.bloqueio ? { texto: exclusaoPendente.bloqueio } : null}
          onCancelar={() => setExclusaoPendente(null)}
          onConfirmar={confirmarExclusaoDefinitiva}
        />
      )}
    </Layout>
  );
}
