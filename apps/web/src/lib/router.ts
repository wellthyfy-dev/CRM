import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** URL search params as state: `[params, setParams]`, where setParams writes the query string. */
export function useSearchParamsState(): [
  URLSearchParams,
  (next: URLSearchParams, opts?: { replace?: boolean }) => void,
] {
  const current = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const params = React.useMemo(() => new URLSearchParams(current.toString()), [current]);
  const setParams = React.useCallback(
    (next: URLSearchParams, opts: { replace?: boolean } = {}) => {
      const q = next.toString();
      const url = q ? `${pathname}?${q}` : pathname;
      if (opts.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [pathname, router],
  );
  return [params, setParams];
}
