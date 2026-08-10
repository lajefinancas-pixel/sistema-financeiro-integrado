import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Stethoscope } from "lucide-react";
import Layout from "../components/Layout";
import { usePermissaoModulo } from "../lib/permissoes";

export default function Configuracoes() {
  const { usuario, permissao } = usePermissaoModulo("administracao");
  const perfil = usuario?.perfis_acesso?.nome ?? "";
  const ehAdministrador = /administrador/i.test(perfil) || permissao?.pode_visualizar === true;

  return (
    <Layout>
      <div className="px-8 py-7">
        <h1 className="text-2xl font-semibold text-[#0F2A44] mb-2">Configuracoes</h1>
        <p className="text-sm text-[#0F2A44]/60 mb-6">Esta tela ainda será construída -- próximo passo do desenvolvimento.</p>

        {ehAdministrador && (
          <div className="mb-6">
            <h2 className="text-xs uppercase tracking-wide text-[#0F2A44]/45 font-medium mb-2">Conferência</h2>
            <Link
              to="/diagnostico-pagamentos"
              className="flex items-center gap-3 bg-white rounded-2xl border border-black/5 shadow-sm px-5 py-4 hover:bg-black/[0.02]"
            >
              <div className="w-10 h-10 rounded-xl bg-[#0F2A44]/5 flex items-center justify-center shrink-0">
                <Stethoscope size={18} className="text-[#0F2A44]" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#0F2A44]">Diagnóstico de pagamentos antigos</div>
                <div className="text-xs text-[#0F2A44]/55 mt-0.5">
                  Compara o débito registrado em cada conta com o débito correto pelo rateio. Somente
                  leitura -- nenhum valor é alterado.
                </div>
              </div>
              <ChevronRight size={16} className="text-[#0F2A44]/30 ml-auto shrink-0" />
            </Link>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
          Em construção
        </div>
      </div>
    </Layout>
  );
}
