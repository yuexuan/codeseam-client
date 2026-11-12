import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { EnvironmentService } from '../../services/environment';
export function usePreflight(service: EnvironmentService) {
  const startup = useQuery({
    queryKey: ['startup'],
    queryFn: () => service.readStartup(),
  });
  const scan = useMutation({ mutationFn: () => service.scan() });
  const started = useRef(false);
  const startScan = scan.mutate;
  useEffect(() => {
    if (startup.isSuccess && !started.current) {
      started.current = true;
      startScan();
    }
  }, [startup.isSuccess, startScan]);
  return { startup, scan };
}
