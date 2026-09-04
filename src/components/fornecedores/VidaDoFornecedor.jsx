import React from "react";
import {
  AlertTriangle,
  Banknote,
  Contact,
  FileCheck2,
  History,
  Landmark,
  Paperclip,
  Plus,
  Wallet,
} from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { BadgeSituacao, BadgeVigencia } from "../certidoes/badges";
import {
  formatarData as formatarDataCertidao,
  nomeDoAnexo,
  situacaoEfetiva,
  urlDeDownload,
} from "../../lib/certidoes";
import { anotarVigencia, ehVigenteNoTipo } from "../../lib/certidoesRegras";
import { resumoDocumental } from "../../lib/certidoesFornecedor";
import NotasDoFornecedor from "./NotasDoFornecedor";
import DadosParaPagamento from "./DadosParaPagamento";
import { Bloco, Campo, Indicador, Vazio, textoOuTraco } from "./blocos";

/**
 * "Vida do fornecedor": o que a listagem mostra quando um cadastro é aberto.
 *
 * É apresentação, não cálculo novo. Cada bloco apenas reorganiza dados que já
 * existem -- o cadastro do fornecedor, os lançamentos de valores em aberto e os
 * pagamentos já efetivados nas programações --, e as ações (mudar situação,
 * excluir lançamento, ver histórico) continuam sendo as da própria tela, com as
 * mesmas permissões de sempre.
 */

function soData(v) {
  return v ? String(v).slice(0, 10) : "";
}
function formatarData(iso) {
  const data = soData(iso);
  return data ? new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR") : "--";
}
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function percentual(v) {
  const n = numero(v);
  return n > 0 ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "";
}

/** Identificação do lançamento a partir dos campos já gravados nele. */
function descricaoDoLancamento(v, fornecedor) {
  const partes = [];
  if (v.numero_nota_fiscal) partes.push(`NF ${v.numero_nota_fiscal}`);
  if (v.parcela) partes.push(`Parcela ${v.parcela}`);
  if (v.numero_processo) partes.push(`Processo ${v.numero_processo}`);
  if (v.numero_empenho) partes.push(`Empenho ${v.numero_empenho}`);
  if (partes.length > 0) return partes.join(" · ");
  return textoOuTraco(fornecedor.descricao);
}

/** Lançamento fora do Simples, com alíquota informada e nenhuma retenção aplicada. */
function temPendenciaTributaria(v) {
  return (
    v.optante_simples === false &&
    (numero(v.aliquota_iss) > 0 || numero(v.aliquota_ir) > 0) &&
    numero(v.desconto_iss) <= 0 &&
    numero(v.desconto_ir) <= 0
  );
}

export default function VidaDoFornecedor({
  fornecedor,
  secretariaNome,
  tipo,
  bancario,
  situacoes,
  pagamentos,
  carregandoPagamentos,
  erroPagamentos,
  certidoes,
  carregandoCertidoes,
  erroCertidoes,
  podeVerCertidoes,
  podeCadastrarCertidao,
  onNovaCertidao,
  onMudarSituacao,
  onExcluirValor,
  onVerHistorico,
  permissoesPagamento,
  onDadosPagamentoChange,
}) {
  const valores = fornecedor.valores ?? [];
  const [periodoPagamentos, setPeriodoPagamentos] = React.useState({ inicio: "", fim: "" });
  const pagamentosFiltrados = (pagamentos ?? []).filter((pagamento) =>
    (!periodoPagamentos.inicio || pagamento.data >= periodoPagamentos.inicio) &&
    (!periodoPagamentos.fim || pagamento.data <= periodoPagamentos.fim)
  );

  const totalPago = pagamentosFiltrados.filter((pagamento) => pagamento.efetivada !== false).reduce((acc, p) => acc + numero(p.valor), 0);
  const totalAberto = numero(fornecedor.totalAberto);
  // Sem a leitura dos pagamentos, o que depende deles aparece como "--" em vez
  // de um total zerado que pareceria real.
  const pagamentosIndisponiveis = carregandoPagamentos || Boolean(erroPagamentos);

  const issRetido = valores.reduce((acc, v) => acc + numero(v.desconto_iss), 0);
  const irRetido = valores.reduce((acc, v) => acc + numero(v.desconto_ir), 0);
  const comRetencao = valores.filter((v) => numero(v.desconto_iss) > 0 || numero(v.desconto_ir) > 0);
  const pendencias = valores.filter(temPendenciaTributaria);
  const issFixo = percentual(fornecedor.aliquota_iss_fixa);
  const irFixo = percentual(fornecedor.aliquota_ir_fixa);
  const semTributario =
    comRetencao.length === 0 && pendencias.length === 0 && !issFixo && !irFixo;

  return (
    <div className="border-t border-black/5 px-4 py-4 space-y-3 bg-black/[0.01]">
      <Bloco icone={Contact} titulo="Identificação">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Nome" valor={fornecedor.razao_social || fornecedor.nome_fantasia} />
          <Campo rotulo="Razão social" valor={fornecedor.razao_social} />
          <Campo rotulo="Nome fantasia" valor={fornecedor.nome_fantasia} />
          <Campo rotulo="Apelido / Nome de exibição" valor={fornecedor.apelido} />
          <Campo rotulo="CNPJ/CPF" valor={fornecedor.cpf_cnpj} />
          <Campo rotulo="Secretaria" valor={secretariaNome} />
          <Campo rotulo="Tipo" valor={tipo} />
          <Campo rotulo="Telefone" valor={fornecedor.telefone} />
          <Campo rotulo="E-mail" valor={fornecedor.email} />
          <Campo rotulo="Situação cadastral" valor={fornecedor.ativo === false ? "Inativo" : "Ativo"} />
          {bancario?.texto ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Campo rotulo="Dados bancários" valor={bancario.texto} />
            </div>
          ) : (
            <>
              <Campo rotulo="Banco" valor={bancario?.banco} />
              <Campo rotulo="Agência" valor={bancario?.agencia} />
              <Campo rotulo="Conta" valor={bancario?.conta} />
            </>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <Campo rotulo="Descrição do serviço/fornecimento" valor={fornecedor.descricao} />
          </div>
        </div>
      </Bloco>

      <DadosParaPagamento
        fornecedorId={fornecedor.id}
        permissoes={permissoesPagamento}
        onChange={onDadosPagamentoChange}
      />

      <Bloco icone={Wallet} titulo="Financeiro">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador rotulo="Total em aberto" valor={formatBRL(totalAberto)} destaque />
          <Indicador rotulo="Total já pago" valor={pagamentosIndisponiveis ? "--" : formatBRL(totalPago)} />
          <Indicador
            rotulo="Total geral movimentado"
            valor={pagamentosIndisponiveis ? "--" : formatBRL(totalAberto + totalPago)}
          />
          <Indicador rotulo="Quantidade de lançamentos" valor={valores.length} />
        </div>
        <p className="mt-2 text-[11px] text-[#0F2A44]/40">
          Em aberto: lançamentos deste fornecedor ainda não quitados. Já pago: pagamentos efetivados
          nas programações e vinculados a este cadastro.
        </p>
      </Bloco>

      {/* Notas e lançamentos deste cadastro, em lista compacta: resumo em
          cima, filtros rápidos e o detalhamento abrindo na própria linha. */}
      <NotasDoFornecedor
        fornecedor={fornecedor}
        secretariaNome={secretariaNome}
        notas={valores}
        situacoes={situacoes}
        pagamentos={pagamentos}
        pagamentosIndisponiveis={pagamentosIndisponiveis}
        totalAberto={totalAberto}
        totalPago={totalPago}
        onMudarSituacao={onMudarSituacao}
        onExcluirValor={onExcluirValor}
        onVerHistorico={onVerHistorico}
      />

      <Bloco icone={Banknote} titulo="Pagamentos realizados">
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-[11px] text-[#0F2A44]/55">De<input type="date" value={periodoPagamentos.inicio} onChange={(e)=>setPeriodoPagamentos({...periodoPagamentos,inicio:e.target.value})} className="mt-1 block w-full rounded-lg border border-black/10 px-2 py-1.5 text-xs"/></label>
          <label className="text-[11px] text-[#0F2A44]/55">Até<input type="date" value={periodoPagamentos.fim} onChange={(e)=>setPeriodoPagamentos({...periodoPagamentos,fim:e.target.value})} className="mt-1 block w-full rounded-lg border border-black/10 px-2 py-1.5 text-xs"/></label>
          <div className="rounded-lg bg-[#F4F7F9] px-3 py-2 text-xs text-[#0F2A44]/60">Total pago no período<strong className="ml-2 text-[#0F2A44]">{formatBRL(totalPago)}</strong></div>
        </div>
        {carregandoPagamentos ? (
          <Vazio>Carregando pagamentos...</Vazio>
        ) : erroPagamentos ? (
          <div className="text-xs text-red-600">{erroPagamentos}</div>
        ) : pagamentosFiltrados.length === 0 ? (
          <Vazio>Nenhum pagamento efetivado para este fornecedor até agora.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Data</th>
                  <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Valor</th>
                  <th className="py-1.5 pr-3 font-medium">Conta utilizada</th>
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Secretaria</th>
                  <th className="py-1.5 font-medium whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {pagamentosFiltrados.map((p) => (
                  <tr key={p.id} className="border-t border-black/5">
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                      {formatarData(p.data)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium whitespace-nowrap">
                      {formatBRL(p.valor)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70">
                      {p.contas.length > 0 ? p.contas.join(" · ") : "--"}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                      {textoOuTraco(p.secretaria)}
                    </td>
                    <td className="py-2 text-xs text-[#0F2A44]/70 whitespace-nowrap">{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco icone={Landmark} titulo="Tributário">
        {semTributario ? (
          <Vazio>Nenhum dado tributário cadastrado para este fornecedor.</Vazio>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador
                rotulo={`ISS retido${issFixo ? ` (fixo: ${issFixo})` : ""}`}
                valor={formatBRL(issRetido)}
              />
              <Indicador
                rotulo={`IRPJ retido${irFixo ? ` (fixo: ${irFixo})` : ""}`}
                valor={formatBRL(irRetido)}
              />
              <Indicador rotulo="Lançamentos com retenção" valor={comRetencao.length} />
              <Indicador rotulo="Pendências tributárias" valor={pendencias.length} />
            </div>

            {comRetencao.length > 0 && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                      <th className="py-1.5 pr-3 font-medium">Lançamento</th>
                      <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Bruto</th>
                      <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Base de cálculo</th>
                      <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">ISS</th>
                      <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">IRPJ</th>
                      <th className="py-1.5 font-medium text-right whitespace-nowrap">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comRetencao.map((v) => (
                      <tr key={v.id} className="border-t border-black/5">
                        <td className="py-2 pr-3 text-xs text-[#0F2A44]/70">
                          {descricaoDoLancamento(v, fornecedor)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-xs">
                          {formatBRL(v.valor_bruto ?? v.valor)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-xs">
                          {v.base_calculo ? formatBRL(v.base_calculo) : "--"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-xs text-red-600">
                          {numero(v.desconto_iss) > 0
                            ? `${formatBRL(v.desconto_iss)}${percentual(v.aliquota_iss) ? ` (${percentual(v.aliquota_iss)})` : ""}`
                            : "--"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-xs text-red-600">
                          {numero(v.desconto_ir) > 0
                            ? `${formatBRL(v.desconto_ir)}${percentual(v.aliquota_ir) ? ` (${percentual(v.aliquota_ir)})` : ""}`
                            : "--"}
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs font-medium">
                          {formatBRL(v.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pendencias.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#FFF6E5] border border-[#EA9A1E]/20 px-3 py-2">
                <AlertTriangle size={14} className="text-[#EA9A1E] mt-0.5 shrink-0" />
                <div className="text-xs text-[#0F2A44]/70">
                  <span className="font-medium">
                    {pendencias.length === 1 ? "1 pendência tributária" : `${pendencias.length} pendências tributárias`}
                  </span>{" "}
                  -- lançamento fora do Simples, com alíquota informada e sem retenção aplicada:{" "}
                  {pendencias.map((v) => descricaoDoLancamento(v, fornecedor)).join(" · ")}
                </div>
              </div>
            )}
          </>
        )}
      </Bloco>

      {/* Documentação do fornecedor. Os dados vêm da mesma tabela do módulo de
          Certidões -- aqui só se lê e se mostra; cadastrar abre o modal de
          /certidoes já com este fornecedor escolhido. */}
      {podeVerCertidoes && (
        <CertidoesDoFornecedor
          certidoes={certidoes}
          carregando={carregandoCertidoes}
          erro={erroCertidoes}
          podeCadastrar={podeCadastrarCertidao}
          onNovaCertidao={onNovaCertidao}
        />
      )}

      {/* Atalho discreto para a trilha deste cadastro: abre as
          movimentações do fornecedor sem sair da tela. */}
      <div className="flex justify-end print:hidden">
        <button
          type="button"
          onClick={onVerHistorico}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 bg-white text-[#0F2A44]/60 hover:bg-black/5"
        >
          <History size={13} /> Ver Histórico
        </button>
      </div>
    </div>
  );
}

/**
 * Seção "Certidões e documentos" da vida do fornecedor.
 *
 * Lê a lista que a tela já carregou da tabela `certidoes` (a mesma do módulo)
 * e mostra tipo, emissão, vencimento, situação e o anexo. A situação segue a
 * mesma regra da tela de Certidões: a manual prevalece e o resto vem das datas.
 *
 * Havendo mais de uma emissão do mesmo tipo, TODAS continuam na lista: a mais
 * recente aparece marcada como "Vigente" e as anteriores como "Anterior". O
 * resumo do rodapé conta apenas as vigentes, que são as que definem a
 * regularidade do fornecedor.
 */
function CertidoesDoFornecedor({ certidoes, carregando, erro, podeCadastrar, onNovaCertidao }) {
  const lista = React.useMemo(() => anotarVigencia(certidoes ?? []), [certidoes]);
  const resumo = resumoDocumental(lista);

  const botaoNova = podeCadastrar ? (
    <button
      type="button"
      onClick={onNovaCertidao}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 whitespace-nowrap print:hidden"
    >
      <Plus size={13} /> Nova Certidão
    </button>
  ) : null;

  return (
    <Bloco icone={FileCheck2} titulo="Certidões e documentos" acao={botaoNova}>
      {carregando ? (
        <Vazio>Carregando certidões...</Vazio>
      ) : erro ? (
        <div className="text-xs text-red-600">{erro}</div>
      ) : lista.length === 0 ? (
        <Vazio>Nenhuma certidão cadastrada para este fornecedor.</Vazio>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                  <th className="py-1.5 pr-3 font-medium">Tipo</th>
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Emissão</th>
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Vencimento</th>
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Situação</th>
                  <th className="py-1.5 font-medium">Documento</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((certidao) => (
                  <tr
                    key={certidao.id}
                    className={`border-t border-black/5 ${
                      ehVigenteNoTipo(certidao) ? "" : "bg-black/[0.015]"
                    }`}
                  >
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {certidao.tipos_certidao?.nome ?? "--"}
                        <BadgeVigencia certidao={certidao} />
                      </span>
                      {certidao.numero_documento && (
                        <span className="block text-[11px] text-[#0F2A44]/40">
                          nº {certidao.numero_documento}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                      {formatarDataCertidao(certidao.data_emissao)}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                      {certidao.data_vencimento ? formatarDataCertidao(certidao.data_vencimento) : "--"}
                    </td>
                    <td className="py-2 pr-3">
                      <BadgeSituacao situacao={situacaoEfetiva(certidao)} />
                    </td>
                    <td className="py-2 text-xs">
                      {certidao.arquivo_url ? (
                        <a
                          href={urlDeDownload(certidao.arquivo_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[#0F2A44]/70 underline underline-offset-2 hover:text-[#0F2A44] break-all"
                        >
                          <Paperclip size={12} className="shrink-0" />
                          {nomeDoAnexo(certidao.arquivo_url)}
                        </a>
                      ) : (
                        <span className="text-[#0F2A44]/35">Sem anexo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-[#0F2A44]/45">
            {resumo.emoji} {resumo.texto}
            {resumo.anteriores > 0 && (
              <span className="text-[#0F2A44]/35">
                {" "}
                — {resumo.anteriores}{" "}
                {resumo.anteriores === 1 ? "emissão anterior" : "emissões anteriores"} fora da conta
                (vale a mais recente de cada tipo)
              </span>
            )}
          </p>
        </>
      )}
    </Bloco>
  );
}
