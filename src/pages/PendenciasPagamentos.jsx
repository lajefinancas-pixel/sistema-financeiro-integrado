import React from "react";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabaseClient";
import { formatBRL, FORMATO_MOEDA_PLANILHA } from "../lib/moeda";

const hoje = () => new Date().toISOString().slice(0, 10);
const pendente = (item) => Math.max(0, Number(item.valor_a_pagar || 0) - Number(item.valor_pago || 0));
const nome = (item) => item.fornecedores?.apelido || item.fornecedores?.razao_social || item.nome_avulso || "Fornecedor não identificado";

export default function PendenciasPagamentos() {
  const [modo, setModo] = React.useState("dia");
  const [filtros, setFiltros] = React.useState({ data: hoje(), inicio: "", fim: "", secretaria: "", ordem: "valor" });
  const [itens, setItens] = React.useState([]);
  const [secretarias, setSecretarias] = React.useState([]);
  const [erro, setErro] = React.useState("");
  const [carregando, setCarregando] = React.useState(true);

  React.useEffect(() => { supabase.from("secretarias").select("id,nome").order("nome").then(({data})=>setSecretarias(data || [])); }, []);
  React.useEffect(() => {
    let ativo = true; setCarregando(true); setErro("");
    let consulta = supabase.from("pagamentos").select("id,valor_a_pagar,valor_pago,situacao,nome_avulso,fornecedor_id,fornecedores(razao_social,apelido),programacoes_pagamento!inner(id,data_programacao,status,fechado,secretaria_id)").in("situacao", ["programado","parcialmente_pago","suspenso"]);
    if (modo === "dia" && filtros.data) consulta = consulta.eq("programacoes_pagamento.data_programacao", filtros.data);
    if (modo === "geral" && filtros.inicio) consulta = consulta.gte("programacoes_pagamento.data_programacao", filtros.inicio);
    if (modo === "geral" && filtros.fim) consulta = consulta.lte("programacoes_pagamento.data_programacao", filtros.fim);
    if (filtros.secretaria) consulta = consulta.eq("programacoes_pagamento.secretaria_id", filtros.secretaria);
    consulta.then(({data,error}) => { if (!ativo) return; if (error) setErro(error.message); else setItens(data || []); setCarregando(false); });
    return () => { ativo = false; };
  }, [modo, filtros]);

  const linhas = React.useMemo(() => {
    if (modo === "dia") return itens.map((item) => ({ fornecedor:nome(item), data:item.programacoes_pagamento.data_programacao, programado:Number(item.valor_a_pagar||0), pago:Number(item.valor_pago||0), pendente:pendente(item) }));
    const mapa = new Map();
    itens.forEach((item) => { const chave=String(item.fornecedor_id || nome(item)); const atual=mapa.get(chave)||{fornecedor:nome(item),programado:0,pago:0,pendente:0}; atual.programado+=Number(item.valor_a_pagar||0); atual.pago+=Number(item.valor_pago||0); atual.pendente+=pendente(item); mapa.set(chave,atual); });
    return [...mapa.values()].sort((a,b)=>filtros.ordem === "fornecedor" ? a.fornecedor.localeCompare(b.fornecedor,"pt-BR") : b.pendente-a.pendente);
  }, [itens, modo, filtros.ordem]);
  const total = linhas.reduce((soma,item)=>soma+item.pendente,0);
  const cabecalho = ["Fornecedor", ...(modo === "dia" ? ["Data"] : []), "Valor programado", "Valor pago", "Valor pendente"];
  const dados = linhas.map((item)=>[item.fornecedor,...(modo === "dia" ? [new Date(`${item.data}T00:00:00`).toLocaleDateString("pt-BR")] : []),item.programado,item.pago,item.pendente]);

  function imprimir() { window.print(); }
  function pdf() { const doc=new jsPDF({orientation:"landscape"}); doc.text("Relação de pendências de pagamentos",14,14); autoTable(doc,{startY:20,head:[cabecalho],body:dados.map((l)=>l.map((v,i)=>i >= cabecalho.length-3?formatBRL(v):v)),foot:[["Total",...Array(cabecalho.length-2).fill(""),formatBRL(total)]]}); doc.save("pendencias-pagamentos.pdf"); }
  function excel() { const planilha=XLSX.utils.aoa_to_sheet([cabecalho,...dados,["Total",...Array(cabecalho.length-2).fill(""),total]]); const inicio=modo === "dia"?2:1; for(let l=1;l<=dados.length+1;l++) for(let c=inicio;c<cabecalho.length;c++){ const celula=planilha[XLSX.utils.encode_cell({r:l,c})]; if(celula) celula.z=FORMATO_MOEDA_PLANILHA; } const livro=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(livro,planilha,"Pendências"); XLSX.writeFile(livro,"pendencias-pagamentos.xlsx"); }

  return <Layout titulo="Relação de Pendências" subtitulo="Pagamentos Diários · somente leitura">
    <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-black/5 bg-white p-3 print:hidden">
        <div className="flex gap-1 rounded-lg bg-[var(--color-brand-off-white)] p-1"><button onClick={()=>setModo("dia")} className={`rounded-md px-3 py-1.5 text-xs ${modo==="dia"?"bg-[var(--color-brand-navy)] text-white":""}`}>Por dia</button><button onClick={()=>setModo("geral")} className={`rounded-md px-3 py-1.5 text-xs ${modo==="geral"?"bg-[var(--color-brand-navy)] text-white":""}`}>Geral</button></div>
        <div className="flex flex-wrap items-end gap-2">{modo==="dia"?<label className="text-[10px] uppercase">Data<input type="date" value={filtros.data} onChange={(e)=>setFiltros({...filtros,data:e.target.value})} className="mt-1 block rounded-md border px-2 py-1 text-xs normal-case"/></label>:<><label className="text-[10px] uppercase">De<input type="date" value={filtros.inicio} onChange={(e)=>setFiltros({...filtros,inicio:e.target.value})} className="mt-1 block rounded-md border px-2 py-1 text-xs"/></label><label className="text-[10px] uppercase">Até<input type="date" value={filtros.fim} onChange={(e)=>setFiltros({...filtros,fim:e.target.value})} className="mt-1 block rounded-md border px-2 py-1 text-xs"/></label><select value={filtros.ordem} onChange={(e)=>setFiltros({...filtros,ordem:e.target.value})} className="rounded-md border px-2 py-1 text-xs"><option value="valor">Maior valor</option><option value="fornecedor">Fornecedor</option></select></>}
          <select value={filtros.secretaria} onChange={(e)=>setFiltros({...filtros,secretaria:e.target.value})} className="rounded-md border px-2 py-1 text-xs"><option value="">Todas as secretarias</option>{secretarias.map((s)=><option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          <button onClick={imprimir} className="rounded-md border p-2" title="Imprimir"><Printer size={14}/></button><button onClick={pdf} className="rounded-md border p-2" title="PDF"><FileText size={14}/></button><button onClick={excel} className="rounded-md border p-2" title="Excel"><FileSpreadsheet size={14}/></button>
        </div>
      </div>
      {erro&&<p className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{erro}</p>}
      <div className="overflow-hidden rounded-xl border border-black/5 bg-white"><table className="w-full text-xs"><thead className="bg-[var(--color-brand-off-white)] text-left uppercase text-[var(--color-brand-navy)]/55"><tr>{cabecalho.map((c,i)=><th key={c} className={`px-3 py-2 ${i>=cabecalho.length-3?"text-right":""}`}>{c}</th>)}</tr></thead><tbody>{!carregando&&linhas.map((item,i)=><tr key={`${item.fornecedor}-${i}`} className="border-t border-black/5"><td className="px-3 py-2 font-medium">{item.fornecedor}</td>{modo==="dia"&&<td className="px-3 py-2">{new Date(`${item.data}T00:00:00`).toLocaleDateString("pt-BR")}</td>}<td className="px-3 py-2 text-right">{formatBRL(item.programado)}</td><td className="px-3 py-2 text-right">{formatBRL(item.pago)}</td><td className="px-3 py-2 text-right font-bold">{formatBRL(item.pendente)}</td></tr>)}</tbody><tfoot><tr className="border-t-2 border-[var(--color-brand-navy)]/15"><th colSpan={cabecalho.length-1} className="px-3 py-2 text-right">Total pendente</th><th className="px-3 py-2 text-right text-base">{formatBRL(total)}</th></tr></tfoot></table>{carregando&&<p className="p-8 text-center text-xs">Carregando...</p>}{!carregando&&!linhas.length&&<p className="p-8 text-center text-xs text-[var(--color-brand-navy)]/45">Nenhuma pendência nos filtros informados.</p>}</div>
    </div>
  </Layout>;
}
