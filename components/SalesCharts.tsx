import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, Platform } from 'react-native';
import Svg, { Circle, Path, Rect, Line, G, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import Colors from '@/constants/colors';

export function formatIndianNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 10000000) return (n / 10000000).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (abs >= 100000) return (n / 100000).toFixed(2).replace(/\.?0+$/, '') + ' L';
  if (abs >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

const safeNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const safeArr = (arr: unknown): number[] =>
  Array.isArray(arr) ? arr.map(safeNum) : [];

const niceCeil = (raw: number): number => {
  const r = Math.max(1, safeNum(raw));
  const exp = Math.pow(10, Math.floor(Math.log10(r)));
  const norm = r / exp;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
};

type DonutProps = {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
  centerLabel?: string;
  centerSubLabel?: string;
};

export function DonutChart({
  percent,
  size = 120,
  strokeWidth = 12,
  color,
  trackColor = '#EEF2F7',
  centerLabel,
  centerSubLabel,
}: DonutProps) {
  const safePct = Math.max(0, Math.min(100, safeNum(percent)));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - safePct / 100);
  const cx = size / 2;
  const a11y = `${centerSubLabel || 'value'} ${centerLabel ?? `${safePct}%`}`;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={cx}
          cy={cx}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill as any} pointerEvents="none">
        <View style={styles.donutCenter}>
          {centerLabel != null && <Text style={[styles.donutCenterLabel, { color }]}>{centerLabel}</Text>}
          {centerSubLabel != null && <Text style={styles.donutCenterSub}>{centerSubLabel}</Text>}
        </View>
      </View>
    </View>
  );
}

type LineSeries = {
  label: string;
  color: string;
  values: number[];
};

type LineChartProps = {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yTicks?: number;
  showArea?: boolean;
};

export function MultiLineChart({
  labels,
  series,
  height = 220,
  yTicks = 4,
  showArea = true,
}: LineChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  if (!series.length || !labels.length) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const chartW = Math.max(0, width - padL - padR);
  const chartH = Math.max(0, height - padT - padB);

  const cleanSeries = series.map(s => ({ ...s, values: safeArr(s.values) }));
  const allValues = cleanSeries.flatMap(s => s.values);
  const rawMax = allValues.length ? Math.max(1, ...allValues) : 1;
  const niceMax = niceCeil(rawMax);

  const n = labels.length;
  const stepX = n > 1 ? chartW / (n - 1) : 0;
  const x = (i: number) => padL + (n > 1 ? i * stepX : chartW / 2);
  const y = (v: number) => padT + chartH - (v / niceMax) * chartH;

  const ticks: number[] = [];
  for (let i = 0; i <= yTicks; i++) ticks.push((niceMax * i) / yTicks);

  // x-axis label thinning
  const maxXLabels = Math.max(2, Math.floor(chartW / 56));
  const labelStride = Math.max(1, Math.ceil(n / maxXLabels));

  const buildPath = (vals: number[]) => {
    if (!vals.length) return '';
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  };
  const buildArea = (vals: number[]) => {
    if (!vals.length) return '';
    const top = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const baseY = padT + chartH;
    return `${top} L ${x(vals.length - 1).toFixed(1)} ${baseY} L ${x(0).toFixed(1)} ${baseY} Z`;
  };

  const a11y =
    `Line chart with ${cleanSeries.length} series across ${n} points. ` +
    cleanSeries
      .map(s => `${s.label} total ${formatIndianNumber(s.values.reduce((a, b) => a + b, 0))}`)
      .join('; ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      onLayout={onLayout}
      style={{ width: '100%', height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            {cleanSeries.map((s, i) => (
              <LinearGradient key={`g-${i}`} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={s.color} stopOpacity={0.25} />
                <Stop offset="1" stopColor={s.color} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {/* Y gridlines + labels */}
          {ticks.map((t, i) => {
            const yy = y(t);
            return (
              <G key={`tick-${i}`}>
                <Line x1={padL} y1={yy} x2={padL + chartW} y2={yy} stroke="#EEF2F7" strokeWidth={1} />
                <SvgText x={padL - 6} y={yy + 3} fontSize="10" fill="#94A3B8" textAnchor="end">
                  {formatIndianNumber(t)}
                </SvgText>
              </G>
            );
          })}
          {/* X labels */}
          {labels.map((lab, i) => {
            if (i % labelStride !== 0 && i !== n - 1) return null;
            return (
              <SvgText
                key={`xl-${i}`}
                x={x(i)}
                y={padT + chartH + 16}
                fontSize="10"
                fill="#94A3B8"
                textAnchor="middle"
              >
                {lab}
              </SvgText>
            );
          })}
          {/* Series areas */}
          {showArea &&
            cleanSeries.map((s, i) => (
              <Path key={`area-${i}`} d={buildArea(s.values)} fill={`url(#grad-${i})`} />
            ))}
          {/* Series lines */}
          {cleanSeries.map((s, i) => (
            <Path
              key={`line-${i}`}
              d={buildPath(s.values)}
              stroke={s.color}
              strokeWidth={2.5}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Series points */}
          {cleanSeries.map((s, i) =>
            s.values.map((v, j) => (
              <Circle
                key={`pt-${i}-${j}`}
                cx={x(j)}
                cy={y(v)}
                r={n > 30 ? 1.5 : 3}
                fill="#fff"
                stroke={s.color}
                strokeWidth={1.5}
              />
            ))
          )}
        </Svg>
      )}
    </View>
  );
}

type HBarItem = {
  label: string;
  values: { value: number; color: string; legend?: string }[];
  trailing?: string;
};

type HBarProps = {
  items: HBarItem[];
  rowHeight?: number;
  max?: number;
};

export function GroupedBarChart({ items, rowHeight = 44, max }: HBarProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  if (!items.length) return null;

  const labelW = 110;
  const trailingW = 56;
  const padR = 8;
  const barAreaW = Math.max(40, width - labelW - trailingW - padR);
  const cleanItems = items.map(it => ({
    ...it,
    values: it.values.map(v => ({ ...v, value: Math.max(0, safeNum(v.value)) })),
  }));
  const computedMax = Math.max(
    1,
    safeNum(max) || Math.max(1, ...cleanItems.flatMap(it => it.values.map(v => v.value)))
  );

  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      {width > 0 &&
        cleanItems.map((it, idx) => {
          const groupCount = it.values.length;
          const barH = Math.max(6, (rowHeight - 16) / Math.max(1, groupCount));
          const totalDisplay = it.trailing ?? formatIndianNumber(it.values.reduce((a, b) => a + b.value, 0));
          const a11y = `${it.label}: ${it.values.map(v => `${v.legend || ''} ${formatIndianNumber(v.value)}`).join(', ')}, total ${totalDisplay}`;
          return (
            <View
              key={`${it.label}-${idx}`}
              accessible
              accessibilityLabel={a11y}
              style={[styles.hbarRow, { height: rowHeight }]}
            >
              <Text style={[styles.hbarLabel, { width: labelW }]} numberOfLines={1}>
                {it.label}
              </Text>
              <Svg width={barAreaW} height={rowHeight - 8}>
                {it.values.map((v, i) => {
                  const w = Math.max(0, (v.value / computedMax) * barAreaW);
                  const yy = i * (barH + 2) + 4;
                  return (
                    <G key={`bar-${i}`}>
                      <Rect x={0} y={yy} width={barAreaW} height={barH} rx={barH / 2} fill="#F1F5F9" />
                      <Rect x={0} y={yy} width={Math.max(2, w)} height={barH} rx={barH / 2} fill={v.color} />
                    </G>
                  );
                })}
              </Svg>
              <Text style={[styles.hbarTrailing, { width: trailingW }]}>{totalDisplay}</Text>
            </View>
          );
        })}
    </View>
  );
}

type StackedBarProps = {
  labels: string[];
  series: { label: string; color: string; values: number[] }[];
  height?: number;
};

export function StackedBarChart({ labels, series, height = 200 }: StackedBarProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  if (!labels.length || !series.length) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const chartW = Math.max(0, width - padL - padR);
  const chartH = Math.max(0, height - padT - padB);

  const cleanSeries = series.map(s => ({ ...s, values: safeArr(s.values) }));
  const totals = labels.map((_, i) => cleanSeries.reduce((a, s) => a + (s.values[i] || 0), 0));
  const rawMax = totals.length ? Math.max(1, ...totals) : 1;
  const niceMax = niceCeil(rawMax);

  const n = labels.length;
  const slot = chartW / n;
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const yTicks = 4;
  const ticks: number[] = [];
  for (let i = 0; i <= yTicks; i++) ticks.push((niceMax * i) / yTicks);

  const maxXLabels = Math.max(2, Math.floor(chartW / 56));
  const labelStride = Math.max(1, Math.ceil(n / maxXLabels));

  const a11y =
    `Stacked bar chart with ${cleanSeries.length} series across ${n} bars. ` +
    cleanSeries
      .map(s => `${s.label} total ${formatIndianNumber(s.values.reduce((a, b) => a + b, 0))}`)
      .join('; ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      onLayout={onLayout}
      style={{ width: '100%', height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((t, i) => {
            const yy = padT + chartH - (t / niceMax) * chartH;
            return (
              <G key={`tick-${i}`}>
                <Line x1={padL} y1={yy} x2={padL + chartW} y2={yy} stroke="#EEF2F7" strokeWidth={1} />
                <SvgText x={padL - 6} y={yy + 3} fontSize="10" fill="#94A3B8" textAnchor="end">
                  {formatIndianNumber(t)}
                </SvgText>
              </G>
            );
          })}
          {labels.map((lab, i) => {
            const cx = padL + slot * i + slot / 2;
            let stackTop = padT + chartH;
            const segs = cleanSeries.map((s, si) => {
              const v = s.values[i] || 0;
              const h = Math.max(0, (v / niceMax) * chartH);
              stackTop -= h;
              return <Rect key={`r-${si}`} x={cx - barW / 2} y={stackTop} width={barW} height={h} fill={s.color} />;
            });
            return (
              <G key={`bar-${i}`}>
                {segs}
                {(i % labelStride === 0 || i === n - 1) && (
                  <SvgText
                    x={cx}
                    y={padT + chartH + 16}
                    fontSize="10"
                    fill="#94A3B8"
                    textAnchor="middle"
                  >
                    {lab}
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legendRow}>
      {items.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  donutCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenterLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  donutCenterSub: {
    fontSize: 10,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  hbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  hbarLabel: {
    fontSize: 12,
    color: Colors.light.text,
    paddingRight: 8,
  },
  hbarTrailing: {
    fontSize: 12,
    color: Colors.light.text,
    fontWeight: '600',
    textAlign: 'right',
    paddingLeft: 4,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.light.textSecondary,
  },
});

// Suppress unused warning for Platform import on RN web shim
void Platform;
