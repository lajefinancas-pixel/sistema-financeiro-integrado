import React from "react";
import { Landmark, Pencil, Plus } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao } from "./comuns";
import ListaRolavel from "../comuns/ListaRolavel";
import { mensagemAmigavel } from "../../lib/erros";
import {
  AVISO_MIGRATION_BANCOS,
  BANCOS_INICIAIS,
  SITUACOES_BANCO,
  bancoParaFormulario,
  bancoVazio,
  numeroDoBancoFormatado,
  ordenarBancos,
  rotuloDoBanco,
  validarBanco,
} from "../../lib/processosBancos";
import {
  alternarSituacaoDoBanco,
  carregarBancos,
  criarBanco,
  salvarBanco,
} from "../../lib/processosCadastrosDados";

/**
 * O cadastro de BANCOS: número e nome.
 *
 * ⚠️ ELE MUDOU DE LUGAR, e por um motivo simples: deixou de ser um cadastro só
 * dos documentos. Antes morava em Configurações → Processos, porque só a diária
 * imprimia "001 — Banco do Brasil". Agora a MESMA lista alimenta a escolha do
 * banco nos dados para pagamento do fornecedor e no cadastro da conta bancária,
 * então ela é CONFIGURAÇÃO GERAL, do sistema inteiro.
 *
 * Antes o banco era texto livre e cada pessoa escrevia de um jeito. Agora é uma
 * lista com busca, e o par NÚMERO + NOME é gravado junto. Banco novo entra por
 * aqui, sem deploy.
 *
 * ⚠️ NADA DE DADO JÁ CADASTRADO É CONVERTIDO OU APAGADO. O que foi digitado à
 * mão antes continua exatamente como está: o número e o nome são gravados COMO
 * TEXTO em quem os usa, e não há chave estrangeira para cá -- corrigir ou
 * inativar um banco nesta tela nunca reescreve registro nem documento já
 * emitido.
 *
 * ⚠️ Este cadastro NÃO é o card "Bancos utilizados" do módulo financeiro, que
 * continua sendo a leitura das contas bancárias cadastradas.
 *
 * ⚠️ A LISTA ROLA ATÉ O ÚLTIMO BANCO. Antes ela mostrava os primeiros itens,
 * cortava o próximo pela metade e não dava sinal nenhum de que havia mais --
 * quem usava não sabia que era possível rolar, e no iPad o gesto escapava para a
 * página de trás. Agora a rolagem é dentro da caixa (barra visível no
 * computador, toque no iPad) e, enquanto houver item abaixo, a lista avisa; o
 * fim dela é marcado pelo total de bancos.
 *
 * Cadastro de referência: nada aqui movimenta valor, dá baixa em nota ou toca em
 * conta.
 */
export default function BlocoBancos({ podeEditar }) {
  const [lista, setLista] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [faltaMigration, setFaltaMigration] = React.useState(false);
  const [formulario, setFormulario] = React.useState(null);
  const [busca, setBusca] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    try {
      // ⚠️ CADASTRO VAZIO NÃO É MIGRATION PENDENTE. A leitura devolve o estado
      // explícito, e só `estruturaAusente` liga o aviso vermelho: existindo a
      // estrutura e não havendo banco nenhum, a tela mostra "Nenhum cadastro" e
      // o botão de cadastrar, sem aviso de erro.
      const { registros, estruturaAusente } = await carregarBancos();
      setLista(registros);
      setFaltaMigration(estruturaAusente);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar o cadastro de bancos."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  function definir(campo, valor) {
    setFormulario((atual) => ({ ...(atual ?? {}), [campo]: valor }));
  }

  async function salvar(evento) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);

    const erros = validarBanco(formulario, { bancos: lista });
    const chaves = Object.keys(erros);
    if (chaves.length > 0) {
      setErro(erros[chaves[0]]);
      return;
    }

    setSalvando(true);
    try {
      const anterior = lista.find((b) => String(b.id) === String(formulario.id)) ?? null;
      if (formulario.id) await salvarBanco(formulario.id, formulario, { anterior });
      else await criarBanco(formulario);
      setFormulario(null);
      await carregar();
      setSucesso("Banco salvo. Ele já aparece na lista de escolha dos dados bancários.");
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar o banco."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(registro) {
    setErro(null);
    setSucesso(null);
    const destino = (registro?.situacao ?? "ativo") === "ativo" ? "inativo" : "ativo";
    try {
      await alternarSituacaoDoBanco(registro.id, destino, { anterior: registro });
      await carregar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar a situação do banco."));
    }
  }

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const ordenados = ordenarBancos(lista);
    if (termo === "") return ordenados;
    return ordenados.filter((b) => rotuloDoBanco(b).toLowerCase().includes(termo));
  }, [lista, busca]);

  return (
    <div className="mt-5">
      <Cartao
        titulo="Bancos"
        descricao={
          "Número e nome dos bancos usados em TODO o sistema: nos dados bancários dos documentos, nos "
          + "dados para pagamento do fornecedor e no cadastro das contas bancárias. O par sai sempre "
          + `junto — "001 — Banco do Brasil". Já vêm cadastrados os ${BANCOS_INICIAIS.length} mais usados; novos entram `
          + "por aqui, sem precisar de deploy. O que foi digitado à mão antes permanece como está."
        }
        icone={Landmark}
      >
        <div className="space-y-4">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}
          {faltaMigration && !carregando && <Alerta tipo="erro">{AVISO_MIGRATION_BANCOS}</Alerta>}

          {carregando ? (
            <p className="text-sm text-[#0F2A44]/45">Carregando o cadastro de bancos...</p>
          ) : (
            <>
              {lista.length > 0 && (
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por número ou nome..."
                  className={CLASSE_ENTRADA}
                />
              )}

              {visiveis.length === 0 ? (
                <p className="text-sm text-[#0F2A44]/45">
                  {lista.length === 0
                    ? "Nenhum cadastro. Cadastre o primeiro banco para que ele apareça na lista de escolha."
                    : "Nenhum banco encontrado com esse número ou nome."}
                </p>
              ) : (
                <ListaRolavel
                  rotulo="Bancos cadastrados"
                  altura="max-h-[60vh] sm:max-h-80"
                  className="divide-y divide-black/5 rounded-xl border border-black/10"
                >
                  {visiveis.map((registro) => {
                    const inativo = (registro.situacao ?? "ativo") !== "ativo";
                    return (
                      <li key={registro.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className={`min-w-0 flex-1 truncate text-sm ${inativo ? "text-[#0F2A44]/40 line-through" : "text-[#0F2A44]"}`}>
                          {rotuloDoBanco(registro)}
                        </span>
                        {podeEditar && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setErro(null); setSucesso(null); setFormulario(bancoParaFormulario(registro)); }}
                              className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => alternar(registro)}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                              title="Exclusão lógica: o número e o nome já gravados em documentos continuam intactos."
                            >
                              {inativo ? "Reativar" : "Inativar"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {/* O FIM DA LISTA, dito com letras: chegando aqui, não há mais
                      banco abaixo -- e o total confere com o cadastro. */}
                  <li className="px-3 py-2 text-center text-[11px] text-[#0F2A44]/40">
                    Fim da lista — {visiveis.length}
                    {visiveis.length === 1 ? " banco" : " bancos"}
                    {visiveis.length === lista.length ? "" : ` de ${lista.length}`}.
                  </li>
                </ListaRolavel>
              )}

              {podeEditar && formulario === null && (
                <button
                  type="button"
                  onClick={() => { setErro(null); setSucesso(null); setFormulario(bancoVazio()); }}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90"
                >
                  <Plus size={15} /> Novo banco
                </button>
              )}

              {formulario !== null && (
                <form onSubmit={salvar} noValidate className="rounded-xl border border-black/10 bg-[#F8FAFC] p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Campo label="Número do banco" obrigatorio dica="Três dígitos, como 001, 104 ou 237.">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formulario.numero}
                        onChange={(e) => definir("numero", e.target.value)}
                        onBlur={(e) => definir("numero", numeroDoBancoFormatado(e.target.value))}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    <Campo label="Nome do banco" obrigatorio>
                      <input
                        type="text"
                        value={formulario.nome}
                        onChange={(e) => definir("nome", e.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                    </Campo>
                    {formulario.id && (
                      <Campo label="Situação">
                        <select value={formulario.situacao} disabled className={CLASSE_ENTRADA}>
                          {SITUACOES_BANCO.map((situacao) => (
                            <option key={situacao.id} value={situacao.id}>{situacao.rotulo}</option>
                          ))}
                        </select>
                      </Campo>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={salvando}
                      className="rounded-lg bg-[#0F2A44] px-5 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
                    >
                      {salvando ? "Salvando..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormulario(null)}
                      className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </Cartao>
    </div>
  );
}
