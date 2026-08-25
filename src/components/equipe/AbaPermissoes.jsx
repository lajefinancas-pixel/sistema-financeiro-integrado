import React from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";
import {
  MODULOS,
  acoesDoModulo,
  carregarPermissoesDoUsuario,
  moduloTemExcecao,
  restaurarPadraoDoModulo,
  salvarPermissoesDoUsuario,
} from "../../lib/permissoesUsuario";
import { Alerta } from "./comuns";
import { mensagemAmigavel } from "../../lib/erros";
import { ACOES_ESPECIAIS, carregarPermissoesEspeciaisUsuario, salvarPermissoesEspeciaisUsuario } from "../../lib/permissoesEspeciais";

/** Ponto dourado que marca um valor diferente do padrão do perfil. */
function MarcaExcecao({ titulo = "Diferente do padrão do perfil" }) {
  return (
    <span
      title={titulo}
      aria-label={titulo}
      className="w-1.5 h-1.5 rounded-full bg-[#C9A227] shrink-0 ring-2 ring-[#C9A227]/20"
    />
  );
}

function CaixaPermissao({ label, marcado, excecao, desabilitado, onAlterar }) {
  return (
    <label
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${
        excecao ? "border-[#C9A227]/45 bg-[#FBF4DE]/60" : "border-transparent"
      } ${desabilitado ? "opacity-60" : "cursor-pointer hover:bg-black/[0.03]"}`}
    >
      <input
        type="checkbox"
        checked={marcado}
        disabled={desabilitado}
        onChange={(evento) => onAlterar(evento.target.checked)}
        className="w-4 h-4 rounded border-black/20 accent-[#0F2A44] shrink-0 disabled:cursor-not-allowed"
      />
      <span className="text-[13px] text-[#0F2A44] leading-tight">{label}</span>
      {excecao && <MarcaExcecao />}
    </label>
  );
}

export default function AbaPermissoes({ usuarioId, podeEditar }) {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [restaurando, setRestaurando] = React.useState(null);

  const [dados, setDados] = React.useState(null); // { perfil, padrao, excecoes }
  const [valores, setValores] = React.useState(null); // estado atual dos checkboxes
  const [base, setBase] = React.useState(null); // último estado salvo, para detectar alterações
  const [especiais, setEspeciais] = React.useState({});
  const [baseEspeciais, setBaseEspeciais] = React.useState({});

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await carregarPermissoesDoUsuario(usuarioId);
      const especiaisExplicitas = await carregarPermissoesEspeciaisUsuario(usuarioId);
      const fornecedor = resultado.valores.fornecedores ?? {};
      const pagamentos = resultado.valores.pagamentos ?? {};
      const especiaisPadrao = {
        visualizar_dados_bancarios: fornecedor.pode_visualizar === true,
        cadastrar_dados_bancarios: fornecedor.pode_cadastrar === true,
        editar_dados_bancarios: fornecedor.pode_editar === true,
        excluir_dados_bancarios: fornecedor.pode_excluir === true,
        visualizar_pix: fornecedor.pode_visualizar === true,
        cadastrar_pix: fornecedor.pode_cadastrar === true,
        editar_pix: fornecedor.pode_editar === true,
        executar_transferencia: pagamentos.pode_aprovar === true,
        estornar_transferencia: pagamentos.pode_excluir === true,
      };
      const especiaisCarregadas = { ...especiaisPadrao, ...especiaisExplicitas };
      setDados({ perfilId: resultado.perfilId, perfil: resultado.perfil, padrao: resultado.padrao, excecoes: resultado.excecoes });
      setValores(resultado.valores);
      setBase(resultado.valores);
      setEspeciais(especiaisCarregadas);
      setBaseEspeciais(especiaisCarregadas);
      return resultado;
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar as permissões deste usuário."));
      return null;
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const alterado = React.useMemo(() => {
    if (!valores || !base) return false;
    return JSON.stringify(valores) !== JSON.stringify(base) || JSON.stringify(especiais) !== JSON.stringify(baseEspeciais);
  }, [valores, base, especiais, baseEspeciais]);

  function alterar(modulo, campo, marcado) {
    setAviso(null);
    setValores((atual) => ({ ...atual, [modulo]: { ...atual[modulo], [campo]: marcado } }));
  }

  async function salvar() {
    if (salvando || !dados || !valores) return;
    const escolhidos = valores;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      await salvarPermissoesDoUsuario(usuarioId, {
        padrao: dados.padrao,
        valores: escolhidos,
        excecoes: dados.excecoes,
      });
      await salvarPermissoesEspeciaisUsuario(usuarioId, especiais, null);
      // Recarrega da view para exibir a permissão efetiva de verdade, e avisa
      // caso o banco tenha resolvido algum módulo de forma diferente da pedida.
      const recarregado = await carregar();
      if (recarregado && JSON.stringify(recarregado.valores) !== JSON.stringify(escolhidos)) {
        setAviso(
          "Permissões salvas. Os valores exibidos foram recarregados do banco e alguns módulos ficaram diferentes do que foi marcado."
        );
      } else {
        setAviso("Permissões salvas.");
      }
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar as permissões."));
    } finally {
      setSalvando(false);
    }
  }

  async function restaurar(modulo) {
    if (restaurando || !dados) return;
    setRestaurando(modulo);
    setErro(null);
    setAviso(null);
    try {
      if (dados.excecoes[modulo]) await restaurarPadraoDoModulo(usuarioId, modulo);
      const padraoModulo = { ...dados.padrao[modulo] };
      setDados((atual) => ({ ...atual, excecoes: { ...atual.excecoes, [modulo]: null } }));
      setValores((atual) => ({ ...atual, [modulo]: padraoModulo }));
      setBase((atual) => ({ ...atual, [modulo]: padraoModulo }));
      setAviso("Módulo restaurado para o padrão do perfil.");
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível restaurar o padrão do perfil."));
    } finally {
      setRestaurando(null);
    }
  }

  if (carregando) {
    return <div className="text-sm text-[#0F2A44]/50 py-6">Carregando permissões...</div>;
  }

  if (!dados || !valores) {
    return <Alerta>{erro ?? "Não foi possível carregar as permissões deste usuário."}</Alerta>;
  }

  const semPerfil = !dados.perfilId;

  return (
    <div className="space-y-4">
      {erro && <Alerta>{erro}</Alerta>}
      {aviso && <Alerta tipo="sucesso">{aviso}</Alerta>}

      <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/70 p-4">
        <div className="flex items-center gap-2 text-[#0F2A44]">
          <ShieldCheck size={16} className="text-[#C9A227]" />
          <span className="text-sm font-semibold">Perfil de acesso atual</span>
        </div>
        <div className="mt-3 text-sm text-[#0F2A44]">{dados.perfil?.nome ?? "Sem perfil atribuído"}</div>
        {dados.perfil?.descricao && <p className="text-xs text-[#0F2A44]/55 mt-1">{dados.perfil.descricao}</p>}
        <p className="text-xs text-[#0F2A44]/55 mt-3 flex items-center gap-1.5 flex-wrap">
          Os checkboxes já vêm marcados conforme o perfil. O
          <MarcaExcecao titulo="Exceção" />
          dourado indica uma exceção individual, gravada só para este usuário.
        </p>
      </div>

      {semPerfil && (
        <Alerta>
          Este usuário ainda não tem um perfil de acesso. Escolha um perfil na aba <strong>Dados</strong> para poder
          ajustar as permissões por módulo.
        </Alerta>
      )}

      <div className="space-y-3">
        {MODULOS.map(({ id, label }) => {
          const padraoModulo = dados.padrao[id];
          const valoresModulo = valores[id];
          const temExcecao = moduloTemExcecao(id, valoresModulo, padraoModulo);
          const podeRestaurar = temExcecao || Boolean(dados.excecoes[id]);

          return (
            <section key={id} className="rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#F5F3EF]/60 border-b border-black/5">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm font-semibold text-[#0F2A44] truncate">{label}</h3>
                  {temExcecao && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-[#8A7526] bg-[#FBF4DE] border border-[#C9A227]/35 whitespace-nowrap">
                      Exceção
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => restaurar(id)}
                  disabled={!podeEditar || semPerfil || !podeRestaurar || restaurando === id || salvando}
                  title="Apaga a exceção deste módulo e volta a usar o padrão do perfil"
                  className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-35 disabled:hover:bg-transparent whitespace-nowrap shrink-0"
                >
                  <RotateCcw size={13} />
                  {restaurando === id ? "Restaurando..." : "Restaurar padrão do perfil"}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1 px-2.5 py-2.5">
                {acoesDoModulo(id).map(({ campo, label: rotulo }) => (
                  <CaixaPermissao
                    key={campo}
                    label={rotulo}
                    marcado={valoresModulo[campo] === true}
                    excecao={valoresModulo[campo] !== padraoModulo[campo]}
                    desabilitado={!podeEditar || semPerfil || salvando || restaurando === id}
                    onAlterar={(marcado) => alterar(id, campo, marcado)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-xl border border-black/5 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-[#F5F3EF]/60 border-b border-black/5">
          <h3 className="text-sm font-semibold text-[#0F2A44]">Dados para pagamento e transferências</h3>
          <p className="mt-1 text-[11px] text-[#0F2A44]/50">Controles independentes para operações bancárias sensíveis.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 px-2.5 py-2.5">
          {ACOES_ESPECIAIS.map(({ id, label }) => (
            <CaixaPermissao key={id} label={label} marcado={especiais[id] === true} excecao={especiais[id] !== baseEspeciais[id]} desabilitado={!podeEditar || salvando} onAlterar={(marcado) => setEspeciais((atual) => ({ ...atual, [id]: marcado }))}/>
          ))}
        </div>
      </section>

      {podeEditar && !semPerfil && (
        <div className="sticky bottom-0 -mx-1 px-1 pt-3 pb-1 bg-gradient-to-t from-white via-white to-white/0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="text-[11px] text-[#0F2A44]/50">
              {alterado ? "Há alterações não salvas neste usuário." : "Nenhuma alteração pendente."}
            </span>
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !alterado}
              className="text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-40 disabled:hover:bg-[#0F2A44]"
            >
              {salvando ? "Salvando..." : "Salvar permissões"}
            </button>
          </div>
        </div>
      )}

      {!podeEditar && (
        <p className="text-xs text-[#0F2A44]/45">
          Você não tem permissão para alterar as permissões deste usuário.
        </p>
      )}
    </div>
  );
}
