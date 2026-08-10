import React from "react";
import { prioridadeInfo, statusInfo } from "../../lib/tarefas";

export function BadgeStatus({ status }) {
  const info = statusInfo(status);
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.ponto }} />
      {info.label}
    </span>
  );
}

export function BadgePrioridade({ prioridade }) {
  const info = prioridadeInfo(prioridade);
  return (
    <span
      style={{ color: info.cor, backgroundColor: info.bg }}
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      {info.label}
    </span>
  );
}
