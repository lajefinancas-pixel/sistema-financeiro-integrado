import React from "react";
import { Ban, CalendarPlus, Eye, Pencil, Plus, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PainelFiltros from "../../comuns/PainelFiltros.jsx";
import ModalRegistroArea from "./ModalRegistroArea.jsx";
import ModalNotasDoRegistro from "./ModalNotasDoRegistro.jsx";
import RelacaoDeValores from "../../relatorios/RelacaoDeValores.jsx";
import { formatBRL } from "../../../lib/moeda.js";
import { mensagemAmigavel } from "../../../lib/erros.js";
import {
  AVISO_MIGRATION_AREAS,
  SITUACOES_AREA,
  filtrarRegistros,
  filtrosVazios,
  nomeDoFornecedorDoRegistro,
  resumoFinanceiroDoRegistro,
  situacaoAreaInfo,
  situacaoPagamentoDoRegistro,
  textoDoCampo,
  totalFiltrosAtivos,
  totaisDaLista,
} from "../../../lib/areasFornecedores.js";
import {
  atualizarRegistro,
  carregarNotasDoFornecedor,
  carregarRegistrosDaArea,
  criarRegistro,
  definirAtivoRegistro,
  desvincularNota,
  estruturaDeAreasAusente,
  registrarEnvioParaProgramacao,
  vincularNota,
} from "../../../lib/areasFornecedoresDados.js";
import { envioParaProgramacao, guardarEnvio } from "../../../lib/programacaoDeAreas.js";
import { itensDaRelacaoDaArea, relacaoDaArea } from "../../../lib/relatoriosAreasFornecedores.js";
import { apelidoDoFornecedor, nomeOficialDoFornecedor } from "../../../lib/nomesFornecedor.js";

/**
 * A listagem de uma área específica de Fornecedores (Patrocínios, Aluguéis ou
 * Bandas). A mesma tela serve as três: o que muda entre elas — campos, colunas
 * e filtros — vem do descritor da área, em lib/areasFornecedores.js. Uma área
 * futura é um descritor novo, sem refazer este componente.
 *
 * Pago e Saldo de cada linha são CALCULADOS a partir das baixas das NFs
 * vinculadas ao registro. Nenhuma coluna de valor pago existe nestes registros,
 * e nenhuma baixa é feita, alterada ou estornada por aqui.
 */
export default function PaginaAreaFornecedores({
  area,
  permissao = {},
  fornecedores = [],
  secretarias = [],
  carregandoApoio = false,
  // Permissão de EDITAR o módulo 'pagamentos': sem ela, a ação de adicionar à
  // Programação Diária não aparece. A recusa que vale continua sendo a da
  // própria tela de programação e a do banco.
  podeProgramar = false,
  // Fornecedor vindo dos "Vínculos Específicos" da ficha
  // (/fornecedores/patrocinios?fornecedor=12): a lista abre mostrando só os
  // registros dele, com um chip para tirar o recorte.
  fornecedorInicial = "",
}) {
  const navigate = useNavigate();
  const [registros, setRegistros] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);

  const [busca, setBusca] = React.useState("");
  const [filtros, setFiltros] = React.useState(() => filtrosVazios(area));
  // Recorte por fornecedor: é o ID que filtra, nunca o nome -- dois
  // fornecedores podem ter nomes parecidos, e o vínculo do sistema é o id.
  const [fornecedorRecorte, setFornecedorRecorte] = React.useState(() => String(fornecedorInicial ?? ""));

  const [formAberto, setFormAberto] = React.useState(false);
  const [emEdicao, setEmEdicao] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const [erroForm, setErroForm] = React.useState(null);

  const [detalhe, setDetalhe] = React.useState(null);
  const [notasDoFornecedor, setNotasDoFornecedor] = React.useState([]);
  const [carregandoNotas, setCarregandoNotas] = React.useState(false);
  const [ocupadoDetalhe, setOcupadoDetalhe] = React.useState(false);
  const [erroDetalhe, setErroDetalhe] = React.useState(null);

  // Trocar de subaba recomeça a área do zero: busca, filtros e lista.
  React.useEffect(() => {
    setBusca("");
    setFiltros(filtrosVazios(area));
    setDetalhe(null);
    setFormAberto(false);
    setEmEdicao(null);
  }, [area]);

  React.useEffect(() => {
    setFornecedorRecorte(String(fornecedorInicial ?? ""));
  }, [fornecedorInicial]);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setFaltaMigration(false);
    try {
      setRegistros(await carregarRegistrosDaArea(area.id));
    } catch (falha) {
      if (estruturaDeAreasAusente(falha)) {
        setFaltaMigration(true);
        setRegistros([]);
      } else {
        setErro(mensagemAmigavel(falha, `Não foi possível carregar ${area.rotulo}.`));
      }
    } finally {
      setCarregando(false);
    }
  }, [area]);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const doFornecedorEscolhido = React.useMemo(
    () =>
      fornecedorRecorte === ""
        ? registros
        : registros.filter((registro) => String(registro.fornecedor_id) === fornecedorRecorte),
    [registros, fornecedorRecorte],
  );
  const visiveis = React.useMemo(
    () => filtrarRegistros(area, doFornecedorEscolhido, { busca, filtros }),
    [area, doFornecedorEscolhido, busca, filtros],
  );
  const totais = React.useMemo(() => totaisDaLista(visiveis), [visiveis]);
  // A relação de valores sai dos registros VISÍVEIS -- os mesmos que a tabela
  // mostra e que `totais` soma -- então o total impresso é o total da tela.
  const definicaoDaRelacao = React.useMemo(() => relacaoDaArea(area), [area]);
  const itensDaRelacao = React.useMemo(() => itensDaRelacaoDaArea(area, visiveis), [area, visiveis]);
  const ativos = totalFiltrosAtivos(area, filtros) + (fornecedorRecorte === "" ? 0 : 1);
  const nomeDoRecorte =
    fornecedorRecorte === ""
      ? ""
      : nomeOficialDoFornecedor(
          doFornecedorEscolhido[0]?.fornecedores ??
            fornecedores.find((f) => String(f.id) === fornecedorRecorte),
        );

  const chips = React.useMemo(
    () =>
      [
        // O recorte por fornecedor entra como chip para ficar evidente que a
        // lista está reduzida -- e removível, sem precisar voltar para a ficha.
        ...(fornecedorRecorte === ""
          ? []
          : [
              {
                chave: "fornecedorRecorte",
                rotulo: `Fornecedor: ${nomeDoRecorte || fornecedorRecorte}`,
                remover: () => setFornecedorRecorte(""),
              },
            ]),
      ].concat(
      area.filtros
        .flatMap((filtro) => {
          if (filtro.tipo === "faixaValor") {
            const minimo = filtros[`${filtro.chave}Min`];
            const maximo = filtros[`${filtro.chave}Max`];
            if (!minimo && !maximo) return [];
            const partes = [minimo ? `de ${formatBRL(minimo)}` : null, maximo ? `até ${formatBRL(maximo)}` : null]
              .filter(Boolean)
              .join(" ");
            return [
              {
                chave: filtro.chave,
                rotulo: `${filtro.rotulo}: ${partes}`,
                remover: () =>
                  setFiltros((atual) => ({
                    ...atual,
                    [`${filtro.chave}Min`]: "",
                    [`${filtro.chave}Max`]: "",
                  })),
              },
            ];
          }
          const valor = filtros[filtro.chave];
          if (!valor) return [];
          let rotulo = valor;
          if (filtro.tipo === "secretaria") {
            rotulo = secretarias.find((s) => String(s.id) === String(valor))?.nome ?? valor;
          }
          if (filtro.tipo === "situacao") rotulo = situacaoAreaInfo(valor).label;
          return [
            {
              chave: filtro.chave,
              rotulo: `${filtro.rotulo}: ${rotulo}`,
              remover: () => setFiltros((atual) => ({ ...atual, [filtro.chave]: "" })),
            },
          ];
        }),
      ),
    [area, filtros, secretarias, fornecedorRecorte, nomeDoRecorte],
  );

  async function salvar(formulario, fornecedorEscolhido) {
    setSalvando(true);
    setErroForm(null);
    try {
      if (emEdicao) {
        await atualizarRegistro(area.id, emEdicao, formulario);
        setAviso(`${maiuscula(area.singular)} atualizado.`);
      } else {
        await criarRegistro(area.id, { ...formulario, fornecedor: fornecedorEscolhido });
        setAviso(
          `${maiuscula(area.singular)} cadastrado para ${
            fornecedorEscolhido ? nomeCurto(fornecedorEscolhido) : "o fornecedor"
          }. O cadastro do fornecedor não foi alterado.`,
        );
      }
      setFormAberto(false);
      setEmEdicao(null);
      await carregar();
    } catch (falha) {
      setErroForm(mensagemAmigavel(falha, "Não foi possível salvar este registro."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(registro, ativo) {
    setAviso(null);
    setErro(null);
    try {
      await definirAtivoRegistro(area.id, registro, ativo);
      setAviso(
        ativo
          ? "Registro reativado."
          : "Registro inativado. Ele continua no banco, com o histórico e os vínculos preservados.",
      );
      await carregar();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível concluir esta ação."));
    }
  }

  /**
   * Manda o registro para a Programação Diária. NÃO paga nada: leva apenas o
   * fornecedor e o valor a programar para dentro do mesmo fluxo que já existe
   * na tela de Pagamentos, onde o valor continua editável e a gravação segue
   * sendo a de sempre. Nenhuma NF recebe baixa, nenhum saldo de conta é
   * movimentado e o cadastro do fornecedor não é alterado.
   */
  async function enviarParaProgramacao(registro) {
    setAviso(null);
    setErro(null);
    const envio = envioParaProgramacao(area, registro);
    if (!envio.fornecedor_id) {
      setErro("Este registro não tem fornecedor vinculado, então não há o que programar.");
      return;
    }
    if (!guardarEnvio(envio)) {
      setErro(
        "Não foi possível levar este registro para a programação neste navegador. " +
          "Abra a Programação Diária e escolha o fornecedor pela lista, como de costume.",
      );
      return;
    }
    // A auditoria é registrada aqui, no momento do envio, e nunca derruba a
    // ação: se falhar, o usuário segue para a programação do mesmo jeito.
    await registrarEnvioParaProgramacao(area.id, registro, envio);
    navigate("/pagamentos");
  }

  async function abrirDetalhe(registro) {
    setDetalhe(registro);
    setErroDetalhe(null);
    setCarregandoNotas(true);
    try {
      setNotasDoFornecedor(await carregarNotasDoFornecedor(registro.fornecedor_id));
    } catch (falha) {
      setNotasDoFornecedor([]);
      setErroDetalhe(mensagemAmigavel(falha, "Não foi possível carregar as NFs deste fornecedor."));
    } finally {
      setCarregandoNotas(false);
    }
  }

  async function mexerNoVinculo(acao, nota) {
    setOcupadoDetalhe(true);
    setErroDetalhe(null);
    try {
      await acao(area.id, detalhe, nota);
      const atualizados = await carregarRegistrosDaArea(area.id);
      setRegistros(atualizados);
      setDetalhe(atualizados.find((r) => String(r.id) === String(detalhe.id)) ?? null);
    } catch (falha) {
      setErroDetalhe(mensagemAmigavel(falha, "Não foi possível alterar o vínculo com a NF."));
    } finally {
      setOcupadoDetalhe(false);
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
            Fornecedores
          </div>
          <h1 className="mt-0.5 text-2xl font-semibold text-[#0F2A44]">{area.rotulo}</h1>
          <p className="mt-0.5 text-sm text-[#0F2A44]/60">
            {carregando
              ? "Carregando..."
              : `${totais.registros} ${totais.registros === 1 ? "registro" : "registros"} · Valor ${formatBRL(
                  totais.valor,
                )} · Pago ${formatBRL(totais.pago)} · Saldo ${formatBRL(totais.saldo)}`}
          </p>
        </div>
        {permissao.criar && !faltaMigration && (
          <button
            type="button"
            onClick={() => {
              setEmEdicao(null);
              setErroForm(null);
              setFormAberto(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm text-white hover:bg-[#0F2A44]/90"
          >
            <Plus size={16} /> {area.rotuloNovo}
          </button>
        )}
      </div>

      {faltaMigration && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {AVISO_MIGRATION_AREAS}
        </div>
      )}

      {erro && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {aviso && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {aviso}
        </div>
      )}

      <PainelFiltros
        className="mb-6"
        rotulo="Filtros avançados"
        chips={chips}
        totalAtivos={ativos}
        onLimpar={() => {
          setFiltros(filtrosVazios(area));
          setFornecedorRecorte("");
        }}
        topo={
          <>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`🔎 Buscar em ${area.rotulo.toLowerCase()}...`}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
            <p className="mt-1.5 text-[11px] text-[#0F2A44]/40">
              A busca filtra enquanto você digita, procurando ao mesmo tempo em{" "}
              {area.camposDeBusca
                .map((chave) => rotuloDoCampoDeBusca(area, chave).toLowerCase())
                .join(", ")}{" "}
              e no CPF/CNPJ do fornecedor.
            </p>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {area.filtros.map((filtro) => (
            <CampoDeFiltro
              key={filtro.chave}
              filtro={filtro}
              filtros={filtros}
              secretarias={secretarias}
              onChange={setFiltros}
            />
          ))}
        </div>
      </PainelFiltros>

      {!faltaMigration && !carregando && (
        <RelacaoDeValores
          className="mb-6"
          titulo={`Relação de valores · ${area.rotulo}`}
          rotuloNome={definicaoDaRelacao.rotuloNome}
          rotuloValor={definicaoDaRelacao.rotuloValor}
          itens={itensDaRelacao}
          arquivo={`relacao-de-valores-${area.id}`}
        />
      )}

      <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/50">
            <tr>
              {area.colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  className={`px-3 py-2.5 font-medium ${coluna.numerico ? "text-right" : ""}`}
                >
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {carregando || carregandoApoio ? (
              <tr>
                <td colSpan={area.colunas.length} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  Carregando...
                </td>
              </tr>
            ) : visiveis.length === 0 ? (
              <tr>
                <td colSpan={area.colunas.length} className="px-3 py-6 text-center text-[#0F2A44]/50">
                  {registros.length === 0
                    ? `Nenhum registro em ${area.rotulo}.`
                    : "Nenhum registro atende à busca ou aos filtros."}
                </td>
              </tr>
            ) : (
              visiveis.map((registro) => (
                <Linha
                  key={registro.id}
                  area={area}
                  registro={registro}
                  permissao={permissao}
                  onVer={() => abrirDetalhe(registro)}
                  onEditar={() => {
                    setEmEdicao(registro);
                    setErroForm(null);
                    setFormAberto(true);
                  }}
                  onAlternarAtivo={() => alternarAtivo(registro, registro.ativo === false)}
                  podeProgramar={podeProgramar}
                  onProgramar={() => enviarParaProgramacao(registro)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
        Pago e Saldo são calculados a partir das baixas das NFs vinculadas a cada registro — os
        mesmos valores que a aba de Baixas mostra. Sem NF vinculada, Pago fica em R$ 0,00 e o Saldo
        é o valor total.
      </p>

      {formAberto && (
        <ModalRegistroArea
          area={area}
          registro={emEdicao}
          fornecedores={fornecedores}
          secretarias={secretarias}
          salvando={salvando}
          erro={erroForm}
          onFechar={() => {
            setFormAberto(false);
            setEmEdicao(null);
          }}
          onSalvar={salvar}
        />
      )}

      {detalhe && (
        <ModalNotasDoRegistro
          area={area}
          registro={detalhe}
          notasDoFornecedor={notasDoFornecedor}
          carregandoNotas={carregandoNotas}
          podeEditar={permissao.editar === true}
          ocupado={ocupadoDetalhe}
          erro={erroDetalhe}
          onFechar={() => setDetalhe(null)}
          onVincular={(nota) => mexerNoVinculo(vincularNota, nota)}
          onDesvincular={(nota) => mexerNoVinculo(desvincularNota, nota)}
        />
      )}
    </>
  );
}

/** Uma linha da listagem, com Pago e Saldo calculados na hora de mostrar. */
function Linha({
  area,
  registro,
  permissao,
  onVer,
  onEditar,
  onAlternarAtivo,
  podeProgramar = false,
  onProgramar,
}) {
  const resumo = resumoFinanceiroDoRegistro(registro);
  const situacao = situacaoAreaInfo(registro.situacao);
  // Situação do pagamento: LIDA das baixas das NFs vinculadas, na mesma conta
  // que produz Pago e Saldo. Não existe coluna guardando isso.
  const pagamento = situacaoPagamentoDoRegistro(registro);
  const inativo = registro.ativo === false;

  const conteudo = {
    fornecedor: nomeDoFornecedorDoRegistro(registro),
    apelido: apelidoDoFornecedor(registro.fornecedores) || "--",
    secretaria: registro.secretarias?.nome ?? "--",
    objetoDescricao: [registro.objeto, registro.descricao].filter(Boolean).join(" — ") || "--",
  };

  return (
    <tr className={inativo ? "opacity-60" : undefined}>
      {area.colunas.map((coluna) => {
        if (coluna.chave === "valor") {
          return (
            <td key={coluna.chave} className="px-3 py-2.5 text-right text-[#0F2A44]">
              {formatBRL(resumo.valor)}
            </td>
          );
        }
        if (coluna.chave === "pago") {
          return (
            <td key={coluna.chave} className="px-3 py-2.5 text-right text-[#0F2A44]/70">
              {formatBRL(resumo.pago)}
            </td>
          );
        }
        if (coluna.chave === "saldo") {
          return (
            <td
              key={coluna.chave}
              className="px-3 py-2.5 text-right font-medium"
              style={{ color: resumo.saldo < 0 ? "#DC2626" : "#0F2A44" }}
            >
              {formatBRL(resumo.saldo)}
            </td>
          );
        }
        if (coluna.chave === "situacao") {
          return (
            <td key={coluna.chave} className="px-3 py-2.5">
              <span
                className="inline-flex rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: situacao.bg, color: situacao.cor }}
              >
                {situacao.label}
              </span>
              {inativo && <span className="ml-1.5 text-[11px] text-[#0F2A44]/45">inativo</span>}
            </td>
          );
        }
        if (coluna.chave === "situacaoPagamento") {
          return (
            <td key={coluna.chave} className="px-3 py-2.5">
              <span
                className="inline-flex rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: pagamento.bg, color: pagamento.cor }}
                title="Calculado pelas baixas das NFs vinculadas — os mesmos valores da aba de Baixas."
              >
                {pagamento.label}
              </span>
            </td>
          );
        }
        if (coluna.chave === "acoes") {
          return (
            <td key={coluna.chave} className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onVer}
                  title="Ver detalhes e NFs vinculadas"
                  className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                >
                  <Eye size={14} />
                </button>
                {permissao.editar && (
                  <button
                    type="button"
                    onClick={onEditar}
                    title="Editar"
                    className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {podeProgramar && !inativo && registro.fornecedor_id && (
                  <button
                    type="button"
                    onClick={onProgramar}
                    title={`Adicionar à Programação Diária (leva o fornecedor e o valor a programar — programar não é pagar)`}
                    className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    <CalendarPlus size={14} />
                  </button>
                )}
                {permissao.inativar && (
                  <button
                    type="button"
                    onClick={onAlternarAtivo}
                    title={inativo ? "Reativar" : "Inativar (o registro não é apagado)"}
                    className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    {inativo ? <RotateCcw size={14} /> : <Ban size={14} />}
                  </button>
                )}
              </div>
            </td>
          );
        }
        const texto = conteudo[coluna.chave] ?? textoDoCampo(registro, coluna.chave) ?? "";
        return (
          <td key={coluna.chave} className="px-3 py-2.5 text-[#0F2A44]">
            {texto === "" ? <span className="text-[#0F2A44]/40">--</span> : texto}
          </td>
        );
      })}
    </tr>
  );
}

/** Um campo do painel de filtros, do tipo declarado pela área. */
function CampoDeFiltro({ filtro, filtros, secretarias, onChange }) {
  const classe = "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm";
  const definir = (chave, valor) => onChange((atual) => ({ ...atual, [chave]: valor }));

  if (filtro.tipo === "faixaValor") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{filtro.rotulo}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            value={filtros[`${filtro.chave}Min`] ?? ""}
            onChange={(e) => definir(`${filtro.chave}Min`, e.target.value)}
            placeholder="De"
            className={classe}
          />
          <input
            type="number"
            step="0.01"
            value={filtros[`${filtro.chave}Max`] ?? ""}
            onChange={(e) => definir(`${filtro.chave}Max`, e.target.value)}
            placeholder="Até"
            className={classe}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{filtro.rotulo}</label>
      {filtro.tipo === "secretaria" ? (
        <select
          value={filtros[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        >
          <option value="">Todas</option>
          {secretarias.map((secretaria) => (
            <option key={secretaria.id} value={secretaria.id}>
              {secretaria.nome}
            </option>
          ))}
        </select>
      ) : filtro.tipo === "situacao" ? (
        <select
          value={filtros[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        >
          <option value="">Todas</option>
          {SITUACOES_AREA.map((situacao) => (
            <option key={situacao.value} value={situacao.value}>
              {situacao.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={filtros[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        />
      )}
    </div>
  );
}

function rotuloDoCampoDeBusca(area, chave) {
  if (chave === "fornecedor") return "fornecedor";
  if (chave === "apelido") return "apelido";
  if (chave === "secretaria") return "secretaria";
  return area.campos.find((campo) => campo.chave === chave)?.rotulo ?? chave;
}

function maiuscula(texto) {
  return String(texto).charAt(0).toUpperCase() + String(texto).slice(1);
}

function nomeCurto(fornecedor) {
  return apelidoDoFornecedor(fornecedor) || fornecedor?.razao_social || "o fornecedor";
}
