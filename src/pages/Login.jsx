import React from "react";
import { useNavigate } from "react-router-dom";
import {
  User, Lock, Eye, EyeOff, ArrowRight, Landmark,
  ShieldCheck, RefreshCw, TrendingUp, Handshake,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function Shield() {
  return (
    <svg width="120" height="140" viewBox="0 0 120 140" fill="none">
      <g stroke="#C9A227" strokeWidth="2" fill="none" opacity="0.9">
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M ${10 + i * 2},${100 - i * 14} q -14,-6 -18,-18`} />
        ))}
      </g>
      <g stroke="#C9A227" strokeWidth="2" fill="none" opacity="0.9">
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M ${110 - i * 2},${100 - i * 14} q 14,-6 18,-18`} />
        ))}
      </g>
      <path d="M60 6 L63 15 L72 15 L65 21 L67 30 L60 25 L53 30 L55 21 L48 15 L57 15 Z" fill="#C9A227" />
      <path
        d="M60 22 L92 32 V70 C92 96 78 112 60 122 C42 112 28 96 28 70 V32 Z"
        fill="#FBFAF7" stroke="#0F2A44" strokeWidth="3.5"
      />
      <text x="60" y="82" textAnchor="middle" fontSize="46" fontStyle="italic" fontFamily="Georgia, 'Times New Roman', serif" fill="#0F2A44">F</text>
    </svg>
  );
}

export default function Login() {
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [mostrarSenha, setMostrarSenha] = React.useState(false);
  const [lembrar, setLembrar] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [carregando, setCarregando] = React.useState(false);
  const navigate = useNavigate();

  async function entrar(e) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro(error.message === "Invalid login credentials" ? "Usuário ou senha inválidos." : error.message);
      return;
    }
    navigate("/");
  }

  return (
    <div className="min-h-screen w-full flex">
      <div className="hidden md:flex flex-1 relative overflow-hidden bg-[#F7F5F0] items-center justify-center">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 1000" preserveAspectRatio="none">
          <path d="M0,300 C200,250 350,380 500,320 C650,260 700,150 800,180 L800,0 L0,0 Z" fill="#EFEBE1" opacity="0.7" />
          <path d="M0,650 C180,600 320,720 500,660 C650,610 700,700 800,650 L800,1000 L0,1000 Z" fill="#0F2A44" />
          <path d="M0,700 C180,660 320,760 520,700 C660,660 720,740 800,700" stroke="#C9A227" strokeWidth="2" fill="none" opacity="0.6" />
        </svg>
        <svg className="absolute bottom-24 right-10 opacity-[0.07]" width="220" height="260" viewBox="0 0 220 260" fill="#0F2A44">
          <rect x="30" y="60" width="160" height="200" />
          <rect x="90" y="10" width="40" height="60" />
          {Array.from({ length: 6 }).map((_, i) => (
            <rect key={i} x={45 + i * 22} y="80" width="10" height="160" fill="#F7F5F0" />
          ))}
        </svg>

        <div className="relative z-10 flex flex-col items-center text-center px-10">
          <Shield />
          <div className="uppercase tracking-[0.3em] text-sm text-[#0F2A44] mt-3">Secretaria de</div>
          <div className="text-6xl italic text-[#0F2A44] mt-1" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            Finanças
          </div>
          <div className="flex items-center gap-3 my-4 text-[#C9A227]">
            <span className="w-16 h-px bg-[#C9A227]" />
            <span className="text-xs">✦</span>
            <span className="w-16 h-px bg-[#C9A227]" />
          </div>
          <div className="uppercase tracking-[0.3em] text-xs text-[#C9A227]">Gestão que transforma</div>
        </div>
      </div>

      <div className="flex-1 bg-[#0F2A44] flex flex-col items-center justify-center px-6 py-10">
        <form onSubmit={entrar} className="w-full max-w-md bg-white rounded-2xl shadow-xl px-8 py-9">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-[#EAF1FF] flex items-center justify-center mb-4">
              <Lock size={26} className="text-[#0F2A44]" />
            </div>
            <h1 className="text-2xl font-bold text-[#0F2A44]">Bem-vindo(a)!</h1>
            <p className="text-sm text-[#0F2A44]/50 mt-1">Acesse o Sistema Financeiro Integrado</p>
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-4 text-center">
              {erro}
            </div>
          )}

          <div className="space-y-3 mb-2">
            <div className="flex items-center rounded-xl border border-black/10 overflow-hidden focus-within:border-[#0F2A44]">
              <div className="w-11 h-11 flex items-center justify-center bg-black/[0.03] text-[#0F2A44]/50">
                <User size={17} />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Usuário (e-mail)"
                className="flex-1 px-3 py-2.5 text-sm outline-none placeholder:text-[#0F2A44]/30"
              />
            </div>

            <div className="flex items-center rounded-xl border border-black/10 overflow-hidden focus-within:border-[#0F2A44]">
              <div className="w-11 h-11 flex items-center justify-center bg-black/[0.03] text-[#0F2A44]/50">
                <Lock size={17} />
              </div>
              <input
                type={mostrarSenha ? "text" : "password"}
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha"
                className="flex-1 px-3 py-2.5 text-sm outline-none placeholder:text-[#0F2A44]/30"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                className="w-11 h-11 flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44]/70"
              >
                {mostrarSenha ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm mb-5">
            <label className="flex items-center gap-2 text-[#0F2A44]/70 cursor-pointer">
              <input
                type="checkbox"
                checked={lembrar}
                onChange={(e) => setLembrar(e.target.checked)}
                className="w-4 h-4 rounded accent-[#0F2A44]"
              />
              Lembrar meu acesso
            </label>
            <button type="button" className="text-[#2563EB] hover:underline">Esqueci minha senha</button>
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="w-full flex items-center justify-center gap-2 bg-[#0F2A44] hover:bg-[#0F2A44]/90 text-white font-medium text-sm py-3 rounded-xl transition-colors disabled:opacity-50"
          >
            <ArrowRight size={17} />
            {carregando ? "Entrando..." : "Entrar no Sistema"}
          </button>

          <div className="flex items-center gap-3 my-5">
            <span className="flex-1 h-px bg-black/10" />
            <span className="text-xs text-[#0F2A44]/40">ou</span>
            <span className="flex-1 h-px bg-black/10" />
          </div>

          <button
            type="button"
            disabled
            title="Em breve"
            className="w-full flex items-center justify-center gap-2 border border-black/10 text-[#0F2A44]/40 text-sm font-medium py-3 rounded-xl cursor-not-allowed"
          >
            <Landmark size={16} />
            Acessar com Certificado Digital
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 mt-8 text-white">
          {[
            { icon: ShieldCheck, titulo: "Seguro", sub: "Dados protegidos" },
            { icon: RefreshCw, titulo: "Integrado", sub: "Informações em tempo real" },
            { icon: TrendingUp, titulo: "Inteligente", sub: "Gestão eficiente" },
            { icon: Handshake, titulo: "Confiável", sub: "Transparência e controle" },
          ].map((f) => (
            <div key={f.titulo} className="flex items-start gap-2 max-w-[130px]">
              <f.icon size={18} className="text-[#C9A227] mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium">{f.titulo}</div>
                <div className="text-[11px] text-white/50 leading-tight">{f.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-white/30 mt-8 text-center">
          © 2026 Secretaria de Finanças. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
}
