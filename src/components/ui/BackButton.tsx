import type { ButtonHTMLAttributes } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';
export function BackButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button {...props} variant="back">
      <ArrowLeft size={23} />
      上一步
    </Button>
  );
}
