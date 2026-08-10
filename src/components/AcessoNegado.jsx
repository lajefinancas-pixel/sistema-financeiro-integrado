import React from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export default function AcessoNegado({ modulo, detalhe }) {
  return (
    <div className="px-6 sm:px-8 py-10 flex justify-center">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-black/5 shadow-sm px-6 sm:px-8 py-10 text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-5">
          <ShieldAlert size={28} className="text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-[#0F2A44]">Acesso negado</h1>
        <p className="text-sm text-[#0F2A44]/60 mt-2 leading-relaxed">
          {detalhe ??
            `Você não possui permissão de visualização no módulo ${modulo ?? "solicitado"}. Fale com um administrador do sistema para solicitar acesso.`}
        </p>
        <div className="w-14 h-px bg-[#C9A227] mx-auto my-6" />
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
        >
          <ArrowLeft size={16} />
          Voltar ao painel principal
        </Link>
      </div>
    </div>
  );
}
