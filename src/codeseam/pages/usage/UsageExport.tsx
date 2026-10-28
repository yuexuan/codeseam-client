import { useMemo, useState } from "react";
import { FileDown, FileJson, FileSpreadsheet } from "lucide-react";
import {
  download,
  exportKinds,
  exportRows,
  full,
  toCsv,
  type ExportKind,
} from "../../lib/usage";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { UsageViewProps } from "./UsageOverview";

type Format = "csv" | "json";

/** 导出报表：把当前区间的用量数据导出为 CSV / JSON，文件只在本机生成。 */
export function UsageExport({ report }: UsageViewProps) {
  const [kind, setKind] = useState<ExportKind>("sessions");
  const [format, setFormat] = useState<Format>("csv");
  const data = useMemo(() => exportRows(kind, report), [kind, report]);
  const label = exportKinds.find((k) => k.id === kind)?.label ?? "";

  const doExport = () => {
    const name = `codeseam-${kind}-${report.start}_${report.end}`;
    if (format === "csv") {
      download(`${name}.csv`, toCsv(data.header, data.rows), "text/csv;charset=utf-8");
    } else {
      const objs = data.rows.map((r) => Object.fromEntries(data.header.map((h, i) => [h, r[i]])));
      download(`${name}.json`, JSON.stringify(objs, null, 2), "application/json");
    }
  };

  return (
    <div className="usage-row usage-row--even">
      <Card title="选择导出内容" subtitle={`区间 ${report.start} 至 ${report.end}`}>
        <div className="export-kinds" role="radiogroup" aria-label="导出内容">
          {exportKinds.map((k) => (
            <button
              key={k.id}
              role="radio"
              aria-checked={kind === k.id}
              className={`export-kind${kind === k.id ? " on" : ""}`}
              onClick={() => setKind(k.id)}
            >
              <strong>{k.label}</strong>
              <small>{k.hint}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card title="导出设置" subtitle="文件在本机生成，不会上传。">
        <div className="export-formats" role="radiogroup" aria-label="文件格式">
          <button role="radio" aria-checked={format === "csv"} className={format === "csv" ? "on" : ""} onClick={() => setFormat("csv")}>
            <FileSpreadsheet size={16} />
            CSV（Excel 可直接打开）
          </button>
          <button role="radio" aria-checked={format === "json"} className={format === "json" ? "on" : ""} onClick={() => setFormat("json")}>
            <FileJson size={16} />
            JSON
          </button>
        </div>
        <dl className="usage-kv">
          <dt>内容</dt>
          <dd>{label}</dd>
          <dt>记录数</dt>
          <dd>{full(data.rows.length)} 行</dd>
          <dt>字段</dt>
          <dd>{data.header.join("、")}</dd>
        </dl>
        {report.truncated && kind !== "models" && kind !== "daily" && (
          <p className="usage-note usage-note--warn">
            区间内共有 {full(report.logs_total)} 条请求，明细只拉取了最近 {full(report.logs.length)} 条；
            缩小日期区间可获得完整记录。
          </p>
        )}
        <p className="usage-note">导出内容不含服务 Key、IP 地址与请求正文。</p>
        <div className="actions">
          <Button variant="primary" icon={<FileDown size={14} />} disabled={data.rows.length === 0} onClick={doExport}>
            导出{label}
          </Button>
          {data.rows.length === 0 && <small>当前区间没有可导出的数据。</small>}
        </div>
      </Card>
    </div>
  );
}
