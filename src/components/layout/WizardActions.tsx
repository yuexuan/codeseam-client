import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
export const WizardFooterContext = createContext<HTMLElement | null>(null);
export function WizardActions({ children }: { children: ReactNode }) {
  const host = useContext(WizardFooterContext);
  return host ? createPortal(children, host) : null;
}
