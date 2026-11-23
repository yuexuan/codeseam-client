import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { EnvironmentService } from '../../services/environment';
export function usePreflight(service: EnvironmentService, enabled = true) {
  const startup = useQuery({
    queryKey: ['startup'],
    queryFn: () => service.readStartup(),
    enabled,
  });
  const scan = useMutation({ mutationFn: () => service.scan() });
  const started = useRef(false);
  const startScan = scan.mutate;
  useEffect(() => {
    if (enabled && startup.isSuccess && !started.current) {
      started.current = true;
      startScan();
    }
  }, [enabled, startup.isSuccess, startScan]);
  return { startup, scan };
}
