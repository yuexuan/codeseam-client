import { useId, type ReactNode, type Ref } from 'react';
import { Radio } from '../../components/ui/Radio';
import { TextInput } from '../../components/ui/TextInput';
import type { ProxyProtocol } from '../../services/nodes';
import styles from './ProxyFields.module.css';

export type ProxyDraft = {
  protocol: ProxyProtocol;
  server: string;
  port: string;
  username: string;
  password: string;
};

export function ProxyFields({
  value,
  onChange,
  disabled,
  addressRef,
  action,
}: {
  value: ProxyDraft;
  onChange: (draft: ProxyDraft) => void;
  disabled: boolean;
  addressRef?: Ref<HTMLInputElement>;
  action: ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.form}>
      <fieldset className={styles.protocols} disabled={disabled}>
        <legend>代理协议</legend>
        {(['socks5', 'http', 'https'] as const).map((protocol) => (
          <label key={protocol}>
            <Radio
              name={`${id}-protocol`}
              checked={value.protocol === protocol}
              onChange={() => onChange({ ...value, protocol })}
            />
            {protocol.toUpperCase()}
          </label>
        ))}
      </fieldset>
      <div className={styles.fields}>
        <label>
          服务器地址
          <TextInput
            ref={addressRef}
            placeholder="IP 地址或域名"
            value={value.server}
            onChange={(e) => onChange({ ...value, server: e.target.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          端口
          <TextInput
            placeholder="1–65535"
            inputMode="numeric"
            value={value.port}
            onChange={(e) => onChange({ ...value, port: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
        <label>
          用户名（选填）
          <TextInput
            value={value.username}
            onChange={(e) => onChange({ ...value, username: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
        <label>
          密码（选填）
          <TextInput
            type="password"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            disabled={disabled}
            autoComplete="new-password"
          />
        </label>
        {action}
      </div>
    </div>
  );
}
