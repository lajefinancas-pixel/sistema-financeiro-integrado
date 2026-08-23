import React from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Eraser,
  History,
  Paperclip,
  Receipt,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { formatBRL, paraNumeroMoeda } from "../../lib/moeda";
import CampoMoeda from "../CampoMoeda";
import { Bloco, Campo, Indicador, Vazio, textoOuTraco } from "./blocos";
import {
  FILTRO_VAZIO,
  competenciaDaNota,
  comprovanteDaNota,
  dataDaNota,
  descricaoDaNota,
  filtrarNotas,
  filtroAtivo,
  filtrosDeSituacao,
  formatarData,
  historicoDaNota,
  hojeISO,
  observacoesDaNota,
  ordenarNotas,
  pagamentosDaNota,
  resumoDasNotas,
  situacaoDaNota,
  tributosDaNota,
  valorBrutoDaNota,
} from "../../lib/notasFornecedor";

/**
 * Notas e lançamentos do fornecedor, dentro da "Vida do Fornecedor".
 *
 * A leitura é a mesma de sempre -- as linhas de `valores_em_aberto` deste
 * cadastro --, só que apresentada em lista compacta: uma linha por nota, com o
 * resumo em cima, filtros rápidos e o detalhamento completo abrindo na própria
 * linha, sem sair da tela. Mudar situação e excluir continuam sendo as ações da
 * tela, com as mesmas permissões; nada é recalculado aqui.
 */

function percentual(valor) {
  const n = paraNumeroMoeda(valor);
  return n > 0 ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "";
}

function Etiqueta({ situacao }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap"
      style={{ color: situacao.cor, backgroundColor: situacao.bg }}
    >
      {situacao.rotulo}
    </span>
  );
}

function Subtitulo({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#0F2A44]/40 mb-2">{children}</div>
  );
}

export default function NotasDoFornecedor({
  fornecedor,
  secretariaNome,
  notas,
  situacoes,
  pagamentos,
  pagamentosIndisponiveis,
  totalAberto,
  totalPago,
  onMudarSituacao,
  onExcluirValor,
  onVerHistorico,
}) {
  const hoje = React.useMemo(() => hojeISO(), []);
  const lista = notas ?? [];

  const [filtros, setFiltros] = React.useState(FILTRO_VAZIO);
  const [maisFiltros, setMaisFiltros] = React.useState(false);
  // Uma nota expandida por vez: abrir outra recolhe a anterior.
  const [expandida, setExpandida] = React.useState(null);

  const resumo = React.useMemo(
    () => resumoDasNotas({ notas: lista, totalAberto, totalPago, hoje }),
    [lista, totalAberto, totalPago, hoje]
  );
  const opcoesSituacao = React.useMemo(
    () => filtrosDeSituacao(lista, situacoes, hoje),
    [lista, situacoes, hoje]
  );
  const exibidas = React.useMemo(
    () => ordenarNotas(filtrarNotas(lista, filtros, hoje)),
    [lista, filtros, hoje]
  );

  // Colunas opcionais: só aparecem quando os dados existem nos lançamentos.
  const temCompetencia = lista.some((nota) => competenciaDaNota(nota) !== "");
  const temSecretaria = String(secretariaNome ?? "").trim() !== "";
  const temTributos = lista.some((nota) => tributosDaNota(nota).total > 0);
  const colunas = 7 + (temCompetencia ? 1 : 0) + (temSecretaria ? 1 : 0) + (temTributos ? 1 : 0);

  const temFiltro = filtroAtivo(filtros);
  const atualizar = (mudanca) => setFiltros((atual) => ({ ...atual, ...mudanca }));

  function alternar(id) {
    setExpandida((atual) => (atual === id ? null : id));
  }

  return (
    <Bloco
      icone={Receipt}
      titulo="Notas e lançamentos"
      acao={
        <span className="text-[11px] text-[#0F2A44]/45 whitespace-nowrap">
          {exibidas.length === lista.length
            ? `${lista.length} ${lista.length === 1 ? "nota" : "notas"}`
            : `${exibidas.length} de ${lista.length}`}
        </span>
      }
    >
      {/* Resumo compacto: os mesmos números do bloco financeiro, só que na
          altura da lista, para não precisar rolar para conferir. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador rotulo="Total em aberto" valor={formatBRL(resumo.totalAberto)} destaque />
        <Indicador
          rotulo="Total pago"
          valor={pagamentosIndisponiveis ? "--" : formatBRL(resumo.totalPago)}
        />
        <Indicador
          rotulo="Total movimentado"
          valor={pagamentosIndisponiveis ? "--" : formatBRL(resumo.totalMovimentado)}
        />
        <Indicador rotulo="Quantidade de notas" valor={resumo.quantidade} />
        <Indicador
          rotulo={resumo.proximoVencimentoEmAtraso ? "Vencimento em atraso" : "Próximo vencimento"}
          valor={resumo.proximoVencimento ? formatarData(resumo.proximoVencimento) : "--"}
        />
      </div>
      {resumo.quantidadeVencidas > 0 && (
        <p className="mt-2 text-[11px] text-[#B91C1C]">
          {resumo.quantidadeVencidas === 1
            ? "1 nota com vencimento em atraso."
            : `${resumo.quantidadeVencidas} notas com vencimento em atraso.`}
        </p>
      )}

      {/* Filtros da própria lista: não mexem nos filtros da listagem de
          fornecedores, valem só para as notas deste cadastro. */}
      {lista.length > 0 && (
        <div className="mt-3 print:hidden">
          <div className="flex flex-wrap items-center gap-1.5">
            {opcoesSituacao.map((opcao) => {
              const ativa = filtros.situacao === opcao.value;
              return (
                <button
                  key={opcao.value}
                  type="button"
                  onClick={() => atualizar({ situacao: opcao.value })}
                  className={`px-2.5 py-1 rounded-md text-[11px] border ${
                    ativa
                      ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                      : "border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
                  }`}
                >
                  {opcao.label}
                  <span className={ativa ? "ml-1 text-white/60" : "ml-1 text-[#0F2A44]/35"}>
                    {opcao.quantidade}
                  </span>
                </button>
              );
            })}

            <div className="relative ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0F2A44]/30" />
              <input
                type="text"
                value={filtros.numero}
                onChange={(e) => atualizar({ numero: e.target.value })}
                placeholder="Nº da nota"
                className="w-36 pl-7 pr-2 py-1.5 rounded-md border border-black/10 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => setMaisFiltros((atual) => !atual)}
              aria-expanded={maisFiltros}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] border ${
                maisFiltros || filtros.dataInicial || filtros.dataFinal || filtros.valorMin || filtros.valorMax
                  ? "border-[#0F2A44]/30 text-[#0F2A44] bg-black/[0.03]"
                  : "border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
              }`}
            >
              <SlidersHorizontal size={12} /> Período e valor
            </button>
            {temFiltro && (
              <button
                type="button"
                onClick={() => setFiltros(FILTRO_VAZIO)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
              >
                <Eraser size={12} /> Limpar
              </button>
            )}
          </div>

          {maisFiltros && (
            <div className="mt-2 grid gap-3 rounded-lg border border-black/5 bg-black/[0.015] p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-[11px] font-medium text-[#0F2A44]/60">Período por</label>
                <select
                  value={filtros.campoData}
                  onChange={(e) => atualizar({ campoData: e.target.value })}
                  className="w-full mt-1 px-2 py-1.5 rounded-md border border-black/10 text-xs bg-white"
                >
                  <option value="vencimento">Vencimento</option>
                  <option value="nota">Data da nota</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-[#0F2A44]/60">De</label>
                  <input
                    type="date"
                    value={filtros.dataInicial}
                    onChange={(e) => atualizar({ dataInicial: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 rounded-md border border-black/10 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[#0F2A44]/60">Até</label>
                  <input
                    type="date"
                    value={filtros.dataFinal}
                    onChange={(e) => atualizar({ dataFinal: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 rounded-md border border-black/10 text-xs bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-[#0F2A44]/60">Valor mínimo</label>
                <CampoMoeda
                  valor={filtros.valorMin === "" ? "" : filtros.valorMin}
                  onValorChange={(numero, texto) => atualizar({ valorMin: texto.trim() === "" ? "" : numero })}
                  placeholder="R$ 0,00"
                  className="w-full mt-1 px-2 py-1.5 rounded-md border border-black/10 text-xs bg-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[#0F2A44]/60">Valor máximo</label>
                <CampoMoeda
                  valor={filtros.valorMax === "" ? "" : filtros.valorMax}
                  onValorChange={(numero, texto) => atualizar({ valorMax: texto.trim() === "" ? "" : numero })}
                  placeholder="R$ 0,00"
                  className="w-full mt-1 px-2 py-1.5 rounded-md border border-black/10 text-xs bg-white"
                />
              </div>
              <p className="sm:col-span-2 lg:col-span-4 text-[10px] text-[#0F2A44]/40">
                O valor considerado é o líquido de cada nota, o mesmo que aparece na coluna Valor.
              </p>
            </div>
          )}
        </div>
      )}

      {lista.length === 0 ? (
        <Vazio>
          <span className="block mt-3">Nenhuma nota lançada para este fornecedor.</span>
        </Vazio>
      ) : exibidas.length === 0 ? (
        <Vazio>
          <span className="block mt-3">Nenhuma nota encontrada com os filtros aplicados.</span>
        </Vazio>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Data</th>
                <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Nº da nota</th>
                <th className="py-1.5 pr-3 font-medium">Descrição</th>
                {temCompetencia && (
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Competência</th>
                )}
                {temSecretaria && <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Secretaria</th>}
                <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Valor</th>
                {temTributos && (
                  <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">Tributos</th>
                )}
                <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Situação</th>
                <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Vencimento</th>
                <th className="py-1.5 font-medium text-right whitespace-nowrap print:hidden">Ações</th>
              </tr>
            </thead>
            <tbody>
              {exibidas.map((nota) => {
                const aberta = expandida === nota.id;
                const situacao = situacaoDaNota(nota, situacoes, hoje);
                const tributos = tributosDaNota(nota);
                return (
                  <React.Fragment key={nota.id}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={aberta}
                      onClick={() => alternar(nota.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          alternar(nota.id);
                        }
                      }}
                      title={aberta ? "Recolher a nota" : "Ver a nota completa"}
                      className={`border-t border-black/5 cursor-pointer ${
                        aberta ? "bg-black/[0.03]" : "hover:bg-black/[0.02]"
                      }`}
                    >
                      <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {aberta ? (
                            <ChevronDown size={13} className="text-[#0F2A44]/35 print:hidden" />
                          ) : (
                            <ChevronRight size={13} className="text-[#0F2A44]/25 print:hidden" />
                          )}
                          {formatarData(dataDaNota(nota))}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-[#0F2A44] whitespace-nowrap">
                        {textoOuTraco(nota.numero_nota_fiscal)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-[#0F2A44]/70">
                        {textoOuTraco(descricaoDaNota(nota, fornecedor))}
                      </td>
                      {temCompetencia && (
                        <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                          {textoOuTraco(competenciaDaNota(nota))}
                        </td>
                      )}
                      {temSecretaria && (
                        <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                          {textoOuTraco(secretariaNome)}
                        </td>
                      )}
                      <td className="py-2 pr-3 text-right tabular-nums font-medium whitespace-nowrap">
                        {formatBRL(nota.valor)}
                      </td>
                      {temTributos && (
                        <td className="py-2 pr-3 text-right tabular-nums text-xs text-[#0F2A44]/70 whitespace-nowrap">
                          {tributos.total > 0 ? formatBRL(tributos.total) : "--"}
                        </td>
                      )}
                      <td className="py-2 pr-3">
                        <Etiqueta situacao={situacao} />
                        {situacao.vencida && (
                          <span className="block text-[10px] text-[#0F2A44]/40 mt-0.5">
                            {situacao.rotuloGravado}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-[#0F2A44]/70 whitespace-nowrap">
                        {formatarData(nota.data_vencimento)}
                      </td>
                      <td className="py-2 text-right print:hidden">
                        {onExcluirValor && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onExcluirValor(nota.id);
                            }}
                            className="text-[#0F2A44]/30 hover:text-red-500"
                            title="Excluir lançamento"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>

                    {aberta && (
                      <tr className="border-t border-black/5 bg-black/[0.02]">
                        <td colSpan={colunas} className="px-3 py-3">
                          <DetalheDaNota
                            nota={nota}
                            fornecedor={fornecedor}
                            secretariaNome={secretariaNome}
                            situacao={situacao}
                            situacoes={situacoes}
                            pagamentos={pagamentos}
                            pagamentosIndisponiveis={pagamentosIndisponiveis}
                            hoje={hoje}
                            onMudarSituacao={onMudarSituacao}
                            onVerHistorico={onVerHistorico}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
}

/**
 * Detalhamento de uma nota, aberto na própria linha.
 *
 * Tudo aqui já estava gravado: os campos do lançamento, as retenções, os
 * pagamentos vinculados a ele e as datas. Campos que o cadastro não tem
 * (competência, comprovante, observações) simplesmente não aparecem.
 */
function DetalheDaNota({
  nota,
  fornecedor,
  secretariaNome,
  situacao,
  situacoes,
  pagamentos,
  pagamentosIndisponiveis,
  hoje,
  onMudarSituacao,
  onVerHistorico,
}) {
  const tributos = tributosDaNota(nota);
  const bruto = valorBrutoDaNota(nota);
  const liquido = paraNumeroMoeda(nota.valor);
  const pago = paraNumeroMoeda(nota.valor_pago);
  const vinculados = pagamentosDaNota(nota, pagamentos ?? []);
  const comprovante = comprovanteDaNota(nota, vinculados);
  const observacoes = observacoesDaNota(nota);
  const competencia = competenciaDaNota(nota);
  const historico = historicoDaNota(nota, vinculados, hoje);

  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      <div>
        <Subtitulo>Dados da nota</Subtitulo>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Nº da nota fiscal" valor={nota.numero_nota_fiscal} />
          <Campo rotulo="Parcela" valor={nota.parcela} />
          <Campo rotulo="Nº do processo" valor={nota.numero_processo} />
          <Campo rotulo="Nº do empenho" valor={nota.numero_empenho} />
          {competencia && <Campo rotulo="Competência" valor={competencia} />}
          <Campo rotulo="Secretaria" valor={secretariaNome} />
          <Campo rotulo="Descrição" valor={descricaoDaNota(nota, fornecedor)} />
          <Campo rotulo="Data da nota" valor={formatarData(nota.data_nota_fiscal)} />
          <Campo rotulo="Lançada em" valor={formatarData(nota.created_at)} />
          <Campo rotulo="Vencimento" valor={formatarData(nota.data_vencimento)} />
          <Campo rotulo="Situação" valor={situacao.vencida ? `Vencida (${situacao.rotuloGravado})` : situacao.rotulo} />
          {nota.optante_simples !== null && nota.optante_simples !== undefined && (
            <Campo rotulo="Optante do Simples" valor={nota.optante_simples ? "Sim" : "Não"} />
          )}
        </div>
      </div>

      <div>
        <Subtitulo>Valores e retenções</Subtitulo>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador rotulo="Valor bruto" valor={formatBRL(bruto)} />
          <Indicador rotulo="Base de cálculo" valor={nota.base_calculo ? formatBRL(nota.base_calculo) : "--"} />
          <Indicador
            rotulo={`ISS retido${percentual(nota.aliquota_iss) ? ` (${percentual(nota.aliquota_iss)})` : ""}`}
            valor={tributos.iss > 0 ? formatBRL(tributos.iss) : "--"}
          />
          <Indicador
            rotulo={`IRPJ retido${percentual(nota.aliquota_ir) ? ` (${percentual(nota.aliquota_ir)})` : ""}`}
            valor={tributos.ir > 0 ? formatBRL(tributos.ir) : "--"}
          />
          <Indicador rotulo="Total retido" valor={tributos.total > 0 ? formatBRL(tributos.total) : "--"} />
          <Indicador rotulo="Valor líquido" valor={formatBRL(liquido)} destaque />
          <Indicador rotulo="Valor já pago" valor={pago > 0 ? formatBRL(pago) : "--"} />
          <Indicador
            rotulo="Saldo do lançamento"
            valor={situacao.chaveGravada === "cancelado" ? "--" : formatBRL(Math.max(liquido - pago, 0))}
          />
        </div>
      </div>

      <div>
        <Subtitulo>Pagamento relacionado</Subtitulo>
        {pagamentosIndisponiveis ? (
          <Vazio>Pagamentos deste fornecedor ainda não disponíveis.</Vazio>
        ) : vinculados.length === 0 ? (
          <Vazio>Nenhum pagamento efetivado vinculado a esta nota.</Vazio>
        ) : (
          <div className="space-y-1.5">
            {vinculados.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-black/5 bg-white px-3 py-2 text-xs text-[#0F2A44]/70"
              >
                <span className="font-medium text-[#0F2A44] tabular-nums">{formatBRL(p.valor)}</span>
                <span>{formatarData(p.data)}</span>
                <span>Conta: {p.contas?.length > 0 ? p.contas.join(" · ") : "--"}</span>
                {p.secretaria && <span>Secretaria: {p.secretaria}</span>}
                <span className="ml-auto">{p.status}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          <div>
            <div className="text-[11px] text-[#0F2A44]/45">Comprovante</div>
            {comprovante ? (
              <a
                href={comprovante}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[#0F2A44]/70 underline underline-offset-2 hover:text-[#0F2A44] break-all"
              >
                <Paperclip size={12} className="shrink-0" /> Abrir comprovante
              </a>
            ) : (
              <div className="text-sm text-[#0F2A44]/45">Sem comprovante anexado</div>
            )}
          </div>
          <Campo rotulo="Observações" valor={observacoes} />
        </div>
      </div>

      <div>
        <Subtitulo>Histórico da nota</Subtitulo>
        {historico.length === 0 ? (
          <Vazio>Sem datas registradas neste lançamento.</Vazio>
        ) : (
          <ul className="space-y-1.5">
            {historico.map((item, indice) => (
              <li key={`${item.data}-${indice}`} className="flex items-start gap-2 text-xs text-[#0F2A44]/70">
                <CalendarClock size={13} className="mt-0.5 shrink-0 text-[#0F2A44]/30" />
                <span className="tabular-nums text-[#0F2A44]/50 whitespace-nowrap">
                  {formatarData(item.data)}
                </span>
                <span className="text-[#0F2A44]">
                  {item.titulo}
                  {item.valor ? ` -- ${formatBRL(item.valor)}` : ""}
                  {item.detalhe ? ` (${item.detalhe})` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* As ações continuam sendo as da tela: mudar a situação grava no mesmo
          lugar de antes e ver histórico abre a trilha do cadastro. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 print:hidden">
        {onMudarSituacao ? (
          <label className="flex items-center gap-2 text-[11px] text-[#0F2A44]/50">
            Situação do lançamento
            <select
              value={nota.situacao ?? ""}
              onChange={(e) => onMudarSituacao(nota.id, e.target.value)}
              style={{ color: situacao.cor, backgroundColor: situacao.bg }}
              className="text-xs font-medium px-2 py-1 rounded-md border-none"
            >
              {/* Situação gravada fora da lista da tela continua visível e
                  selecionada, em vez de a caixa parecer vazia. */}
              {!situacoes.some((s) => s.value === (nota.situacao ?? "")) && (
                <option value={nota.situacao ?? ""}>{situacao.rotuloGravado}</option>
              )}
              {situacoes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        {onVerHistorico && (
          <button
            type="button"
            onClick={onVerHistorico}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/60 hover:bg-black/5"
          >
            <History size={13} /> Ver histórico completo
          </button>
        )}
      </div>
    </div>
  );
}
