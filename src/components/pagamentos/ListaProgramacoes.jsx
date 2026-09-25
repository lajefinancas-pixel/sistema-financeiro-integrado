import React from "react";
import { Archive, ArrowRight, CalendarDays, ListFilter, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatBRL } from "../../lib/moeda";
import { statusLabelExecucao } from "../../lib/execucaoProgramacao";
import { filtrarEOrdenarProgramacoes, listarHistoricoProgramacoes } from "../../lib/programacoesHistorico";
import { mensagemAmigavel } from "../../lib/erros";

const dataBR = (valor) => new Date(`${valor}T00:00:00`).toLocaleDateString("pt-BR");

function etiquetaStatus(item) {
  if (item.fechado) return { texto: "Histórica · saldo congelado", classe: "border-stone-300 bg-stone-100 text-stone-700" };
  if (item.status === "aprovada" && item.concluida) return { texto: "Concluída", classe: "border-violet-200 bg-violet-50 text-violet-800" };
  if (item.status === "aprovada") return { texto: "Confirmada / em execução", classe: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  if (item.status === "em_analise") return { texto: "Em análise", classe: "border-amber-200 bg-amber-50 text-amber-800" };
  return { texto: "Em montagem · editável", classe: "border-sky-200 bg-sky-50 text-sky-800" };
}

export default function ListaProgramacoes({ onAbrir }) {
  const [programacoes, setProgramacoes] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState("");
  const [filtros, setFiltros] = React.useState({ numero: "", dataDe: "", dataAte: "", secretaria: "", status: "", ordenacao: "data_desc" });

  React.useEffect(() => {
    let ativo = true;
    listarHistoricoProgramacoes(supabase)
      .then((itens) => { if (ativo) setProgramacoes(itens); })
      .catch((falha) => { if (ativo) setErro(mensagemAmigavel(falha, "Não foi possível carregar as programações.")); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  const secretarias = React.useMemo(() => [...new Map(programacoes.map((item) => [String(item.secretaria_id), item.secretaria_nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), [programacoes]);
  const visiveis = React.useMemo(() => filtrarEOrdenarProgramacoes(programacoes, filtros), [programacoes, filtros]);
  const mudar = (campo) => (evento) => setFiltros((atual) => ({ ...atual, [campo]: evento.target.value }));

  return (
    <section aria-labelledby="titulo-lista-programacoes" className="overflow-hidden rounded-2xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm">
      <div className="border-b border-black/5 bg-[var(--color-brand-navy)] px-5 py-5 text-white sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Arquivo operacional</p><h2 id="titulo-lista-programacoes" className="mt-1 font-serif text-2xl">Todas as programações</h2><p className="mt-1 text-sm text-white/65">Localize uma programação e abra o documento original, sem movimentar saldos.</p></div>
          {!carregando && !erro && <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-right"><strong className="block text-2xl tabular-nums">{programacoes.length}</strong><span className="text-[10px] uppercase tracking-[0.12em] text-white/60">registros encontrados</span></div>}
        </div>
      </div>

      <div className="grid gap-3 border-b border-black/5 bg-[#FAF9F5] p-4 md:grid-cols-2 xl:grid-cols-[.7fr_1.35fr_1.2fr_1fr_1fr]">
        <label className="relative text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Número<Search size={14} className="absolute bottom-2 left-2.5 text-[var(--color-brand-navy)]/35"/><input inputMode="numeric" value={filtros.numero} onChange={mudar("numero")} placeholder="Ex.: 41" className="mt-1 block w-full rounded-lg border border-black/10 bg-white py-1.5 pl-8 pr-2 text-[13px] font-normal normal-case tracking-normal"/></label>
        <fieldset className="min-w-0"><legend className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Período</legend><div className="mt-1 grid grid-cols-2 gap-2"><label className="sr-only" htmlFor="programacoes-data-de">De</label><div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[var(--color-brand-navy)]/45">De</span><input id="programacoes-data-de" aria-label="Data inicial" type="date" value={filtros.dataDe} onChange={mudar("dataDe")} className="block w-full rounded-lg border border-black/10 bg-white py-1.5 pl-7 pr-1 text-[12px] font-normal"/></div><label className="sr-only" htmlFor="programacoes-data-ate">Até</label><div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-[var(--color-brand-navy)]/45">Até</span><input id="programacoes-data-ate" aria-label="Data final" type="date" value={filtros.dataAte} onChange={mudar("dataAte")} className="block w-full rounded-lg border border-black/10 bg-white py-1.5 pl-8 pr-1 text-[12px] font-normal"/></div></div></fieldset>
        <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Secretaria<select value={filtros.secretaria} onChange={mudar("secretaria")} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal"><option value="">Todas</option>{secretarias.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
        <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Status<select value={filtros.status} onChange={mudar("status")} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal"><option value="">Todos</option><option value="em_elaboracao">Em montagem</option><option value="em_analise">Em análise</option><option value="aprovada">Confirmada / em execução</option><option value="concluida">Concluída</option><option value="historico">Histórica / fechada</option></select></label>
        <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-brand-navy)]/55">Ordenar<select value={filtros.ordenacao} onChange={mudar("ordenacao")} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal"><option value="data_desc">Data mais recente</option><option value="numero_desc">Maior número</option><option value="numero_asc">Menor número</option></select></label>
      </div>

      {carregando ? <div className="space-y-2 p-5" aria-label="Carregando programações">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--color-brand-navy)]/5"/>)}</div>
        : erro ? <p role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>
          : visiveis.length === 0 ? <div className="px-5 py-14 text-center text-[var(--color-brand-navy)]/55"><ListFilter size={30} className="mx-auto mb-3 opacity-35"/><p className="font-serif text-lg text-[var(--color-brand-navy)]">Nenhuma programação corresponde aos filtros</p><p className="mt-1 text-sm">Ajuste um ou mais campos para ampliar a busca.</p></div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-black/5 text-[10px] uppercase tracking-[0.11em] text-[var(--color-brand-navy)]/45"><th className="px-5 py-2.5">Número</th><th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Secretaria</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Total programado</th><th className="px-3 py-2.5 text-center">Fornecedores</th><th className="px-5 py-2.5 text-right"><span className="sr-only">Abrir</span></th></tr></thead><tbody>{visiveis.map((item) => { const status = etiquetaStatus(item); return <tr key={item.id} tabIndex={0} onClick={() => onAbrir(item)} onKeyDown={(evento) => { if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); onAbrir(item); } }} className={`group cursor-pointer border-b border-black/5 outline-none transition-colors last:border-0 hover:bg-[var(--color-brand-off-white)] focus-visible:bg-[var(--color-brand-off-white)] ${item.fechado ? "bg-stone-50/70" : ""}`}><td className="px-5 py-3"><strong className="font-serif text-lg tabular-nums text-[var(--color-brand-navy)]">#{item.id}</strong></td><td className="px-3 py-3 text-sm text-[var(--color-brand-navy)]"><span className="inline-flex items-center gap-1.5"><CalendarDays size={14} className="opacity-40"/>{dataBR(item.data_programacao)}</span></td><td className="max-w-[18rem] px-3 py-3 text-sm font-medium text-[var(--color-brand-navy)]"><span className="block truncate">{item.secretaria_nome}</span></td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.classe}`}>{item.fechado && <Archive size={12}/>} {status.texto}</span><span className="sr-only">{statusLabelExecucao(item.status, item.fechado)}</span></td><td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-[var(--color-brand-navy)]">{formatBRL(item.total_programado)}</td><td className="px-3 py-3 text-center text-sm tabular-nums text-[var(--color-brand-navy)]">{item.quantidade_fornecedores}</td><td className="px-5 py-3 text-right"><button type="button" onClick={(evento) => { evento.stopPropagation(); onAbrir(item); }} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-brand-navy)]/20 px-2.5 py-1.5 text-xs font-bold text-[var(--color-brand-navy)] group-hover:bg-[var(--color-brand-navy)] group-hover:text-white">Abrir <ArrowRight size={13}/></button></td></tr>; })}</tbody></table></div>}
      {!carregando && !erro && <p className="border-t border-black/5 bg-[#FAF9F5] px-5 py-2.5 text-xs text-[var(--color-brand-navy)]/50">Exibindo {visiveis.length} de {programacoes.length} programações. Esta lista é somente leitura.</p>}
    </section>
  );
}
