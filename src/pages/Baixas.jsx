import React from "react";
import { FileSpreadsheet, Pencil, Plus, Printer, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Layout from "../components/Layout";
import ModalBaixaPagamento from "../components/pagamentos/ModalBaixaPagamento";
import PainelFiltros from "../components/comuns/PainelFiltros";
import { supabase } from "../lib/supabaseClient";
import { editarBaixa, estornarBaixa, listarBaixas } from "../lib/baixasPagamentos";
import { usePermissoesEspeciais } from "../lib/permissoesEspeciais";
import { buscarSaldoRealPorConta } from "../lib/saldosContasDados";
import { montarSaldosDasContas } from "../lib/saldosContas";
import { formatBRL, FORMATO_MOEDA_PLANILHA } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";

function formatarData(data) {
  if (!data) return "--";
  return new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR");
}

function formatarDataHora(data) {
  return data ? new Date(data).toLocaleString("pt-BR") : "--";
}

export default function Baixas() {
  const { carregando: carregandoPermissoes, valores: permissoes } = usePermissoesEspeciais();
  const [baixas, setBaixas] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [contas, setContas] = React.useState([]);
  const [usuarios, setUsuarios] = React.useState([]);
  const [filtros, setFiltros] = React.useState({ inicio: "", fim: "", fornecedorId: "", contaId: "", status: "" });
  const [modalAberto, setModalAberto] = React.useState(false);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  const carregar = React.useCallback(async () => {
    if (carregandoPermissoes || !permissoes.visualizar_baixas) return;
    setCarregando(true);
    setErro(null);
    try {
      const [resultadoBaixas, resultadoFornecedores, resultadoContas, resultadoUsuarios] = await Promise.all([
        listarBaixas(filtros),
        supabase.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social"),
        supabase.from("contas_bancarias").select("id,nome_conta,numero_conta,banco_id,secretaria_id,bancos(nome),secretarias(nome)").eq("ativo", true),
        supabase.from("usuarios").select("id,nome_completo"),
      ]);
      if (resultadoFornecedores.error) throw resultadoFornecedores.error;
      if (resultadoContas.error) throw resultadoContas.error;
      const saldos = await buscarSaldoRealPorConta({ contaIds: (resultadoContas.data ?? []).map((conta) => conta.id) });
      setBaixas(resultadoBaixas);
      setFornecedores(resultadoFornecedores.data ?? []);
      setContas(montarSaldosDasContas((resultadoContas.data ?? []).map((conta) => ({ id: conta.id, nome_conta: conta.nome_conta, numero_conta: conta.numero_conta, banco: conta.bancos?.nome ?? "--", secretaria: conta.secretarias?.nome ?? "--" })), { saldos }));
      setUsuarios(resultadoUsuarios.data ?? []);
    } catch (falha) {
      console.error("[Baixas] Erro ao carregar histórico.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as baixas."));
    } finally {
      setCarregando(false);
    }
  }, [carregandoPermissoes, permissoes.visualizar_baixas, filtros.inicio, filtros.fim, filtros.fornecedorId, filtros.contaId]);

  React.useEffect(() => { carregar(); }, [carregar]);

  const nomeFornecedor = React.useMemo(() => new Map(fornecedores.map((item) => [String(item.id), item.razao_social])), [fornecedores]);
  const nomeConta = React.useMemo(() => new Map(contas.map((item) => [String(item.id), `${item.nome_conta} · ${item.banco} · ${item.numero_conta || "sem número"}`])), [contas]);
  const nomeUsuario = React.useMemo(() => new Map(usuarios.map((item) => [String(item.id), item.nome_completo])), [usuarios]);
  const filtradas = baixas.filter((baixa) => !filtros.status || baixa.status === filtros.status);
  const totalEfetivado = filtradas.filter((baixa) => baixa.status === "efetivada").reduce((soma, baixa) => soma + Number(baixa.valor_pago || 0), 0);

  function linhasExportacao() {
    return filtradas.map((baixa) => ({
      "Data do pagamento": formatarData(baixa.data_pagamento),
      Fornecedor: nomeFornecedor.get(String(baixa.fornecedor_id)) ?? "--",
      Valor: Number(baixa.valor_pago || 0),
      Conta: nomeConta.get(String(baixa.conta_id)) ?? "--",
      Situação: baixa.status === "efetivada" ? "Efetivada" : "Estornada",
      "Pagamento programado": baixa.pagamento_id || "Avulsa",
      Usuário: nomeUsuario.get(String(baixa.usuario_id)) ?? "--",
      "Registrada em": formatarDataHora(baixa.criado_em),
      Documento: baixa.documento || "",
      Observação: baixa.observacao || "",
    }));
  }

  function exportarExcel() {
    const planilha = XLSX.utils.json_to_sheet(linhasExportacao());
    if (filtradas.length) planilha["C2"].z = FORMATO_MOEDA_PLANILHA;
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Baixas");
    XLSX.writeFile(livro, "baixas-pagamentos.xlsx");
  }

  function exportarPDF() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("Baixas de pagamentos a fornecedores", 14, 14);
    autoTable(doc, { startY: 20, head: [["Data", "Fornecedor", "Valor", "Conta", "Situação", "Usuário"]], body: filtradas.map((baixa) => [formatarData(baixa.data_pagamento), nomeFornecedor.get(String(baixa.fornecedor_id)) ?? "--", formatBRL(baixa.valor_pago), nomeConta.get(String(baixa.conta_id)) ?? "--", baixa.status === "efetivada" ? "Efetivada" : "Estornada", nomeUsuario.get(String(baixa.usuario_id)) ?? "--"]) });
    doc.save("baixas-pagamentos.pdf");
  }

  function imprimir() {
    const janela = window.open("", "_blank", "noopener,noreferrer");
    if (!janela) return;
    janela.document.write(`<html><head><title>Baixas</title><style>body{font-family:Arial;padding:24px;color:#0F2A44}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.valor{text-align:right}</style></head><body><h1>Baixas de pagamentos</h1><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Conta</th><th>Situação</th><th class="valor">Valor</th></tr></thead><tbody>${filtradas.map((baixa)=>`<tr><td>${formatarData(baixa.data_pagamento)}</td><td>${nomeFornecedor.get(String(baixa.fornecedor_id)) ?? "--"}</td><td>${nomeConta.get(String(baixa.conta_id)) ?? "--"}</td><td>${baixa.status === "efetivada" ? "Efetivada" : "Estornada"}</td><td class="valor">${formatBRL(baixa.valor_pago)}</td></tr>`).join("")}</tbody></table></body></html>`);
    janela.document.close(); janela.print();
  }

  async function estornar(baixa) {
    const motivo = prompt("Informe o motivo obrigatório do estorno:");
    if (!motivo?.trim()) return;
    if (!confirm(`Estornar a baixa de ${formatBRL(baixa.valor_pago)}? O valor volta para a conta.`)) return;
    try { await estornarBaixa(baixa.id, motivo.trim()); await carregar(); }
    catch (falha) { console.error("[Baixas] Erro ao estornar.", falha); setErro(mensagemAmigavel(falha, "Não foi possível estornar a baixa.")); }
  }

  async function editar(baixa) {
    const documento = prompt("Documento/comprovante:", baixa.documento || "");
    if (documento === null) return;
    const observacao = prompt("Observação:", baixa.observacao || "");
    if (observacao === null) return;
    try { await editarBaixa(baixa.id, documento, observacao); await carregar(); }
    catch (falha) { setErro(mensagemAmigavel(falha, "Não foi possível editar a baixa.")); }
  }

  if (!carregandoPermissoes && !permissoes.visualizar_baixas) return <Layout><div className="p-6 text-sm text-[#0F2A44]/60">Você não possui permissão para visualizar baixas.</div></Layout>;

  return <Layout><div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">Pagamentos realizados</div><h1 className="text-2xl font-semibold text-[#0F2A44]">Baixas de fornecedores</h1><p className="mt-1 text-sm text-[#0F2A44]/55">Registra a saída real no banco, inclusive pagamentos avulsos e parciais.</p></div><div className="flex flex-wrap gap-2"><button onClick={imprimir} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><Printer size={14}/>Imprimir</button><button onClick={exportarPDF} className="rounded-lg border px-3 py-2 text-xs">PDF</button><button onClick={exportarExcel} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><FileSpreadsheet size={14}/>Excel</button>{permissoes.registrar_baixa_avulsa && <button onClick={()=>setModalAberto(true)} className="flex items-center gap-1 rounded-lg bg-[#0F2A44] px-4 py-2 text-xs text-white"><Plus size={14}/>Baixa avulsa</button>}</div></div>
    {erro && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
    <PainelFiltros titulo="Filtros de baixas"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs">Início<input type="date" value={filtros.inicio} onChange={(e)=>setFiltros({...filtros,inicio:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="text-xs">Fim<input type="date" value={filtros.fim} onChange={(e)=>setFiltros({...filtros,fim:e.target.value})} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="text-xs">Fornecedor<select value={filtros.fornecedorId} onChange={(e)=>setFiltros({...filtros,fornecedorId:e.target.value})} className="mt-1 w-full rounded-lg border bg-white px-3 py-2"><option value="">Todos</option>{fornecedores.map((item)=><option key={item.id} value={item.id}>{item.razao_social}</option>)}</select></label><label className="text-xs">Conta<select value={filtros.contaId} onChange={(e)=>setFiltros({...filtros,contaId:e.target.value})} className="mt-1 w-full rounded-lg border bg-white px-3 py-2"><option value="">Todas</option>{contas.map((item)=><option key={item.id} value={item.id}>{item.nome_conta}</option>)}</select></label><label className="text-xs">Situação<select value={filtros.status} onChange={(e)=>setFiltros({...filtros,status:e.target.value})} className="mt-1 w-full rounded-lg border bg-white px-3 py-2"><option value="">Todas</option><option value="efetivada">Efetivada</option><option value="estornada">Estornada</option></select></label></div></PainelFiltros>
    <div className="my-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-white p-4"><span className="text-xs text-[#0F2A44]/50">Baixas encontradas</span><strong className="block text-xl text-[#0F2A44]">{filtradas.length}</strong></div><div className="rounded-xl border bg-white p-4"><span className="text-xs text-[#0F2A44]/50">Total pago no período</span><strong className="block text-xl text-[#0F2A44]">{formatBRL(totalEfetivado)}</strong></div><div className="rounded-xl border bg-white p-4"><span className="text-xs text-[#0F2A44]/50">Estornos preservados</span><strong className="block text-xl text-[#0F2A44]">{filtradas.filter((item)=>item.status==="estornada").length}</strong></div></div>
    <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-sm"><thead><tr className="border-b text-left text-[11px] uppercase text-[#0F2A44]/45"><th className="p-3">Pagamento</th><th className="p-3">Fornecedor</th><th className="p-3">Conta</th><th className="p-3">Registro</th><th className="p-3">Situação</th><th className="p-3 text-right">Valor</th><th className="p-3"></th></tr></thead><tbody>{carregando?<tr><td colSpan="7" className="p-8 text-center text-[#0F2A44]/40">Carregando...</td></tr>:filtradas.length===0?<tr><td colSpan="7" className="p-8 text-center text-[#0F2A44]/40">Nenhuma baixa encontrada.</td></tr>:filtradas.map((baixa)=><tr key={baixa.id} className="border-b border-black/5 align-top"><td className="p-3"><strong>{formatarData(baixa.data_pagamento)}</strong><div className="text-xs text-[#0F2A44]/45">{baixa.pagamento_id ? "Programada" : "Avulsa"}</div></td><td className="p-3">{nomeFornecedor.get(String(baixa.fornecedor_id)) ?? "--"}</td><td className="p-3 text-xs">{nomeConta.get(String(baixa.conta_id)) ?? "--"}</td><td className="p-3 text-xs">{nomeUsuario.get(String(baixa.usuario_id)) ?? "--"}<div className="text-[#0F2A44]/45">{formatarDataHora(baixa.criado_em)}</div></td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${baixa.status==="efetivada"?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-600"}`}>{baixa.status==="efetivada"?"Efetivada":"Estornada"}</span>{baixa.motivo_estorno&&<div className="mt-1 max-w-52 text-xs text-[#0F2A44]/50">{baixa.motivo_estorno}</div>}</td><td className="p-3 text-right font-semibold tabular-nums">{formatBRL(baixa.valor_pago)}</td><td className="p-3"><div className="flex justify-end gap-1">{permissoes.editar_baixa&&baixa.status==="efetivada"&&<button onClick={()=>editar(baixa)} title="Editar documento e observação" className="rounded p-2 hover:bg-black/5"><Pencil size={14}/></button>}{permissoes.estornar_baixa&&baixa.status==="efetivada"&&<button onClick={()=>estornar(baixa)} title="Estornar baixa" className="rounded p-2 text-red-600 hover:bg-red-50"><RotateCcw size={14}/></button>}</div></td></tr>)}</tbody></table></div>
    {modalAberto&&<ModalBaixaPagamento fornecedores={fornecedores} contas={contas} onFechar={()=>setModalAberto(false)} onConcluida={carregar}/>} 
  </div></Layout>;
}
