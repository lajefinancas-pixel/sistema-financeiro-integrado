import React from "react";
import { formatBRL } from "../../lib/moeda.js";
import { FORMA_PAGAMENTO_BOLETO, FORMA_PAGAMENTO_PADRAO, boletoValido, formatarCodigoBoleto } from "../../lib/processosFormaPagamento.js";

const classe = "mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0F2A44]/40 disabled:bg-black/[0.03]";

export default function FormaPagamentoProcesso({ formulario, somenteLeitura, definir, dadosBancarios, beneficiarioSugerido = "", documentoSugerido = "", valorSugerido = 0, apenasSeletor = false, nomeCampo = "forma_pagamento" }) {
  const boleto = formulario.forma_pagamento === FORMA_PAGAMENTO_BOLETO;
  const campo = (chave, rotulo, tipo = "text") => (
    <label className="text-xs font-medium text-[#0F2A44]/70">{rotulo}
      <input type={tipo} value={formulario[chave] ?? ""} disabled={somenteLeitura}
        onChange={(e) => definir(chave, chave === "boleto_codigo" ? formatarCodigoBoleto(e.target.value) : e.target.value)} className={classe} />
    </label>
  );
  return <div className="space-y-4">
    <fieldset disabled={somenteLeitura} className="flex flex-wrap gap-2" aria-label="Forma de pagamento">
      {[ [FORMA_PAGAMENTO_PADRAO, "Dados bancários/PIX"], [FORMA_PAGAMENTO_BOLETO, "Boleto bancário"] ].map(([valor, rotulo]) =>
        <label key={valor} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${formulario.forma_pagamento === valor || (!formulario.forma_pagamento && valor === FORMA_PAGAMENTO_PADRAO) ? "border-[#0F2A44] bg-[#0F2A44]/5 font-medium text-[#0F2A44]" : "border-black/10 text-black/60"}`}>
          <input className="mr-2" type="radio" name={nomeCampo} value={valor} checked={(formulario.forma_pagamento || FORMA_PAGAMENTO_PADRAO) === valor} onChange={() => {
            definir("forma_pagamento", valor);
          }} />{rotulo}
        </label>)}
    </fieldset>
    {!apenasSeletor && (boleto ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium text-[#0F2A44]/70 sm:col-span-2">Linha digitável ou código de barras <span className="font-normal text-[#0F2A44]/45">(opcional)</span>
        <input inputMode="numeric" value={formulario.boleto_codigo ?? ""} disabled={somenteLeitura} onChange={(e) => definir("boleto_codigo", formatarCodigoBoleto(e.target.value))} className={classe} aria-invalid={Boolean(formulario.boleto_codigo) && !boletoValido(formulario.boleto_codigo)} />
        {formulario.boleto_codigo && !boletoValido(formulario.boleto_codigo) && <span className="mt-1 block text-[11px] text-red-600">Informe 44, 47 ou 48 dígitos.</span>}
      </label>
      <CampoConferencia rotulo="Beneficiário" valor={beneficiarioSugerido} />
      <CampoConferencia rotulo="CNPJ/CPF do beneficiário" valor={documentoSugerido} />
      {campo("boleto_vencimento", "Vencimento", "date")}
      <CampoConferencia rotulo="Valor do boleto" valor={formatBRL(valorSugerido)} />
    </div> : dadosBancarios)}
  </div>;
}

function CampoConferencia({ rotulo, valor }) {
  return <label className="text-xs font-medium text-[#0F2A44]/70">{rotulo}
    <input value={valor ?? ""} readOnly aria-readonly="true" className={classe} />
  </label>;
}
