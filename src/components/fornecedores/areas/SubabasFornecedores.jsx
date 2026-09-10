import React from "react";
import { NavLink } from "react-router-dom";
import { AREAS } from "../../../lib/areasFornecedores.js";

/**
 * As subabas do topo do módulo Fornecedores: Todos | Patrocínios | Aluguéis |
 * Bandas.
 *
 * "Todos" é a página de Fornecedores que já existia, inteira e sem mudança
 * nenhuma. As outras três são áreas operacionais próprias, cada uma com a sua
 * listagem — não são categorias nem tipo de fornecedor.
 *
 * Quem não tem permissão de visualizar uma área NÃO VÊ a subaba dela. Nenhum
 * item novo é criado no menu lateral: a navegação entre as áreas acontece aqui
 * dentro, por rota (`/fornecedores/patrocinios`), de forma que o link continua
 * podendo ser guardado e o item "Fornecedores" da lateral segue destacado.
 */
export default function SubabasFornecedores({ permissoes = {} }) {
  const visiveis = AREAS.filter((area) => permissoes?.[area.id]?.visualizar === true);

  const classe = ({ isActive }) =>
    [
      "px-3.5 py-2 rounded-lg text-sm whitespace-nowrap transition-colors",
      isActive
        ? "bg-[#0F2A44] text-white"
        : "text-[#0F2A44]/70 hover:bg-black/5 border border-transparent",
    ].join(" ");

  return (
    <nav
      aria-label="Áreas de Fornecedores"
      // Rolagem horizontal em tela estreita: no iPad as quatro subabas cabem,
      // e em telas menores a faixa desliza em vez de quebrar a linha.
      className="mb-5 flex items-center gap-1 overflow-x-auto rounded-xl border border-black/5 bg-white p-1 shadow-sm print:hidden"
    >
      <NavLink to="/fornecedores" end className={classe}>
        Todos
      </NavLink>
      {visiveis.map((area) => (
        <NavLink key={area.id} to={`/fornecedores/${area.rota}`} className={classe}>
          {area.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}
