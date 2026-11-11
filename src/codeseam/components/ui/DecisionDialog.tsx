import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
export function DecisionDialog({title,children,confirm="确认并继续",busy=false,danger=false,onConfirm,onCancel}:{title:string;children:ReactNode;confirm?:string;busy?:boolean;danger?:boolean;onConfirm:()=>void;onCancel:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null); const id=useId();
  useEffect(()=>{ const el=ref.current; el?.showModal(); return ()=>el?.close(); },[]);
  return <dialog ref={ref} className="decision-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
    <div className="decision-heading"><h2 id={id}>{title}</h2><button className="icon-btn" disabled={busy} aria-label="关闭" onClick={onCancel}><X size={18}/></button></div>
    <div className="decision-body">{children}</div>
    <div className="actions"><Button disabled={busy} onClick={onCancel}>取消</Button><Button autoFocus className={danger?"decision-danger":""} variant="primary" disabled={busy} onClick={onConfirm}>{busy?"处理中…":confirm}</Button></div>
  </dialog>;
}
