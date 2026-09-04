import React from "react";
import { formatarData, situacaoInfo } from "../../lib/certidoes";
import { ehVigenteNoTipo, temEmissoesConcorrentes } from "../../lib/certidoesRegras";

/** Etiqueta colorida da situação da certidão (válida, a vencer, vencida...). */
export function BadgeSituacao({ situacao }) {
  const info = situacaoInfo(situacao);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ color: info.cor, backgroundColor: info.bg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.ponto }} />
      {info.label}
    </span>
  );
}

/**
 * Marca de vigência: diz se a certidão é a que vale hoje para aquele tipo ou se
 * é uma emissão anterior, superada por outra mais nova.
 *
 * A marca aparece só quando o fornecedor tem mais de uma emissão do mesmo
 * documento — com uma única certidão do tipo não há o que distinguir. NENHUMA
 * certidão é escondida por causa dela: a anterior continua na lista, com o
 * anexo e o histórico, apenas sinalizada como fora da conta da regularidade.
 */
export function BadgeVigencia({ certidao }) {
  if (!temEmissoesConcorrentes(certidao)) return null;

  const vigente = ehVigenteNoTipo(certidao);
  const titulo = vigente
    ? "Emissão mais recente deste tipo — é ela que define a situação do fornecedor."
    : `Emissão anterior, substituída pela que vence em ${formatarData(
        certidao?.superadaPorVencimento,
      )}. Continua cadastrada, mas não entra na situação do fornecedor.`;

  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap border ${
        vigente
          ? "border-[#16A34A]/25 bg-[#EAFBF0] text-[#15803D]"
          : "border-black/10 bg-black/[0.04] text-[#0F2A44]/50"
      }`}
    >
      {vigente ? "Vigente" : "Anterior"}
    </span>
  );
}

/** Etiqueta neutra usada nos tipos de documento (Obrigatório, Sem vencimento...). */
export function Etiqueta({ tom = "neutro", children }) {
  const estilos = {
    neutro: "bg-black/[0.04] text-[#0F2A44]/60",
    dourado: "bg-[#FBF4DE] text-[#8A7526]",
    inativo: "bg-red-50 text-red-600",
  };
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ${estilos[tom]}`}>
      {children}
    </span>
  );
}
