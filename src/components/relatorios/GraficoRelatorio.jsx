import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES, corDaSerie } from "../../lib/paletaGraficos";
import { formatarEixo, formatarValorGrafico, TIPOS_GRAFICO } from "../../lib/relatoriosGrafico";

// Gráfico gerencial do relatório: barras para comparar categorias, linhas para a
// evolução no tempo e rosca para a proporção do total.
//
// O gráfico é um resumo -- ele não substitui a tabela, que continua aberta logo
// abaixo com o valor exato de cada linha. Por isso os eixos usam valores curtos
// ("R$ 1,2 mi") e o número cheio aparece no ponteiro.
//
// A cor vem da posição declarada da série (paletaGraficos), nunca do ranking: um
// filtro que mude a quantidade de categorias não repinta as que ficaram.

const ALTURA_MINIMA = 260;
const ALTURA_POR_CATEGORIA = 34;

function Ponteiro({ active, payload, label, tipoValor }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-white border border-black/10 shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-[#0F2A44]">{label}</div>
      <div className="mt-1.5 space-y-1">
        {payload.map((item) => (
          <div key={item.dataKey ?? item.name} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color ?? item.payload?.cor }}
              aria-hidden="true"
            />
            <span className="text-[#0F2A44]/60">{item.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-[#0F2A44]">
              {formatarValorGrafico(item.value, tipoValor)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rótulo direto em cada fatia: a rosca nunca depende só da cor. */
function rotuloDaFatia({ nome, percentual }) {
  return `${nome} · ${percentual}`;
}

function Barras({ dados }) {
  const altura = Math.max(ALTURA_MINIMA, dados.categorias.length * ALTURA_POR_CATEGORIA + 60);
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart
        data={dados.categorias}
        layout="vertical"
        margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
        barGap={2}
        barCategoryGap="22%"
      >
        <CartesianGrid horizontal={false} stroke={CORES.grade} />
        <XAxis
          type="number"
          tickFormatter={(valor) => formatarEixo(valor, dados.tipoValor)}
          tick={{ fill: CORES.eixo, fontSize: 11 }}
          axisLine={{ stroke: CORES.grade }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="nome"
          width={150}
          tick={{ fill: CORES.eixo, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          content={<Ponteiro tipoValor={dados.tipoValor} />}
          cursor={{ fill: "rgba(15,42,68,0.04)" }}
        />
        {dados.series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 11, color: CORES.eixo, paddingLeft: 8 }}
          />
        )}
        {dados.series.map((serie, indice) => (
          <Bar
            key={serie.chave}
            dataKey={serie.chave}
            name={serie.rotulo}
            fill={corDaSerie(indice)}
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Linhas({ dados }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={dados.evolucao} margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid vertical={false} stroke={CORES.grade} />
        <XAxis
          dataKey="nome"
          tick={{ fill: CORES.eixo, fontSize: 11 }}
          axisLine={{ stroke: CORES.grade }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={(valor) => formatarEixo(valor, dados.tipoValor)}
          tick={{ fill: CORES.eixo, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <Tooltip
          content={<Ponteiro tipoValor={dados.tipoValor} />}
          cursor={{ stroke: CORES.eixo, strokeWidth: 1, strokeDasharray: "3 3" }}
        />
        {dados.series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="circle"
            iconSize={9}
            wrapperStyle={{ fontSize: 11, color: CORES.eixo, paddingLeft: 8 }}
          />
        )}
        {dados.series.map((serie, indice) => (
          <Line
            key={serie.chave}
            type="monotone"
            dataKey={serie.chave}
            name={serie.rotulo}
            stroke={corDaSerie(indice)}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: CORES.superficie }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: CORES.superficie }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function Rosca({ dados }) {
  const chave = dados.series[0].chave;
  const total = dados.rosca.reduce((soma, item) => soma + Math.abs(item[chave] ?? 0), 0);
  const fatias = dados.rosca.map((item, indice) => ({
    ...item,
    cor: corDaSerie(indice, item.nome),
    percentual:
      total === 0 ? "0%" : `${((Math.abs(item[chave] ?? 0) / total) * 100).toFixed(1).replace(".", ",")}%`,
  }));

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4 items-center">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={fatias}
            dataKey={chave}
            nameKey="nome"
            innerRadius="52%"
            outerRadius="78%"
            paddingAngle={1.5}
            stroke={CORES.superficie}
            strokeWidth={2}
            label={rotuloDaFatia}
            labelLine={{ stroke: CORES.grade }}
            isAnimationActive={false}
          >
            {fatias.map((fatia) => (
              <Cell key={fatia.nome} fill={fatia.cor} />
            ))}
          </Pie>
          <Tooltip content={<Ponteiro tipoValor={dados.tipoValor} />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Os valores da rosca também em texto: a proporção não fica só na cor. */}
      <ul className="space-y-1.5 text-xs px-2">
        {fatias.map((fatia) => (
          <li key={fatia.nome} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: fatia.cor }}
              aria-hidden="true"
            />
            <span className="text-[#0F2A44]/70 truncate" title={fatia.nome}>
              {fatia.nome}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-[#0F2A44] whitespace-nowrap">
              {formatarValorGrafico(fatia[chave], dados.tipoValor)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GraficoRelatorio({ dados, tipo, onTipo }) {
  if (!dados) return null;

  const disponiveis = TIPOS_GRAFICO.filter((t) => dados.tipos.includes(t.id));
  const ativo = dados.tipos.includes(tipo) ? tipo : dados.tipos[0];

  const nota =
    ativo === "rosca"
      ? dados.roscaAgrupadas > 0
        ? `As ${dados.roscaAgrupadas} menores categorias aparecem somadas em "Outros".`
        : ""
      : ativo === "barras" && dados.categoriasAgrupadas > 0
        ? `As ${dados.categoriasAgrupadas} menores categorias aparecem somadas em "Outros".`
        : "";

  return (
    <section className="px-5 sm:px-6 py-5 border-b border-black/5 bg-[#F5F3EF]/40 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#0F2A44]">
            {dados.rotuloValor} por {dados.rotuloCategoria.toLowerCase()}
          </h3>
          <p className="text-xs text-[#0F2A44]/50 mt-0.5">
            Resumo visual — os valores exatos continuam na tabela abaixo.
          </p>
        </div>

        {disponiveis.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1">
            {disponiveis.map((item) => (
              <button
                key={item.id}
                onClick={() => onTipo(item.id)}
                title={item.descricao}
                aria-pressed={ativo === item.id}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  ativo === item.id
                    ? "bg-[#0F2A44] text-white font-medium"
                    : "text-[#0F2A44]/60 hover:bg-black/5"
                }`}
              >
                {item.rotulo}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-white border border-black/5 p-3">
        {ativo === "barras" && <Barras dados={dados} />}
        {ativo === "linhas" && <Linhas dados={dados} />}
        {ativo === "rosca" && <Rosca dados={dados} />}
      </div>

      {nota && <p className="text-[11px] text-[#0F2A44]/45 mt-2">{nota}</p>}
    </section>
  );
}
