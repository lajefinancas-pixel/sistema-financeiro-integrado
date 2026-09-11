import React from "react";
import { CalendarClock, History, Image, Table2 } from "lucide-react";
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
  enviarBrasaoProcessos,
  limparCacheDoLogo,
  salvarIdentidadeProcessos,
} from "../../lib/processosIdentidadeDados";

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
  const { permissoes, carregando: verificando } = usePermissoesProcessos();
  const podeVerTabela = podeVerTabelaDeDiarias(permissoes);
  // Duas travas somadas: a desta tela (Administração) e a própria da tabela.
  const podeEditarTabela = podeEditar && podeEditarTabelaDeDiarias(permissoes);

  return (
    <>
      <BlocoTabelaDeDiarias
        podeVer={verificando ? false : podeVerTabela}
        podeEditar={podeEditarTabela}
        verificando={verificando}
      />
      <BlocoIdentidadeVisual podeEditar={podeEditar} />
    </>
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
function BlocoIdentidadeVisual({ podeEditar }) {
  const [vigente, setVigente] = React.useState(null);
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
                urlAtual={logoDoDocumento(pronta)}
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
              {usaBrasaoDoRepositorio(pronta)
                ? "Em uso: o brasão guardado no repositório do sistema — o documento não depende de link externo."
                : "Em uso: a imagem enviada. Remover devolve o brasão guardado no repositório."}
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
            <Campo label="Contato e CNPJ (rodapé)" obrigatorio>
              <input
                type="text"
                maxLength={LIMITE_TEXTO_IDENTIDADE}
                value={rascunho?.rodape_contato ?? ""}
                onChange={(e) => definir("rodape_contato", e.target.value)}
                disabled={!podeEditar}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
            <CalendarClock size={13} className="mt-0.5 shrink-0" />
            <span>
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
