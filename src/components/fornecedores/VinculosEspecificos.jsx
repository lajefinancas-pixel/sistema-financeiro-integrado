import React from "react";
import { Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Bloco } from "./blocos.jsx";
import { AREAS } from "../../lib/areasFornecedores.js";
import { contagensDasAreasDoFornecedor } from "../../lib/areasFornecedoresDados.js";
import { usePermissoesAreasFornecedores } from "../../lib/permissoesAreasFornecedores.js";

/**
 * Seção "Vínculos Específicos" da ficha do fornecedor.
 *
 * Mostra, em uma linha, quantos registros este fornecedor tem em cada área
 * operacional — Patrocínios, Aluguéis, Bandas — e leva para a lista da área já
 * recortada por ele. Nada mais: não cadastra, não edita, não soma valor e não
 * altera o cadastro do fornecedor.
 *
 * A seção só aparece quando existe o que mostrar. Fornecedor sem registro
 * nenhum não ganha uma caixa vazia, e área que a pessoa não pode visualizar não
 * entra na conta — o número dela simplesmente não existe para quem não a vê,
 * porque a própria RLS das tabelas recusa a contagem.
 */
export default function VinculosEspecificos({ fornecedorId }) {
  const navigate = useNavigate();
  const { permissoes } = usePermissoesAreasFornecedores();
  const [contagens, setContagens] = React.useState({});
  const [carregado, setCarregado] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    setCarregado(false);
    setContagens({});
    if (!fornecedorId) return undefined;

    contagensDasAreasDoFornecedor(fornecedorId, { permissoes })
      .then((resultado) => {
        if (!ativo) return;
        setContagens(resultado.contagens);
        setCarregado(true);
      })
      // Falha aqui não estraga a ficha: a seção apenas não aparece.
      .catch(() => {
        if (ativo) setCarregado(true);
      });

    return () => {
      ativo = false;
    };
  }, [fornecedorId, permissoes]);

  const comRegistros = AREAS.filter((area) => Number(contagens[area.id] ?? 0) > 0);
  if (!carregado || comRegistros.length === 0) return null;

  return (
    <Bloco icone={Link2} titulo="Vínculos Específicos">
      <div className="flex flex-wrap items-center gap-2">
        {comRegistros.map((area) => (
          <button
            key={area.id}
            type="button"
            onClick={() => navigate(`/fornecedores/${area.rota}?fornecedor=${fornecedorId}`)}
            title={`Abrir ${area.rotulo} deste fornecedor`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5 print:hover:bg-white"
          >
            <span>{area.rotulo}</span>
            <span className="rounded-full bg-[#0F2A44]/5 px-1.5 text-[11px] font-semibold text-[#0F2A44]">
              {contagens[area.id]}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
        Registros ativos deste fornecedor nas áreas. Cada um tem os próprios valores e as próprias
        NFs vinculadas — este cadastro de fornecedor continua sendo um só.
      </p>
    </Bloco>
  );
}
