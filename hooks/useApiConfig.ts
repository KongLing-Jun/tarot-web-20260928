'use client';

import { useState, useEffect } from 'react';
import type { ApiConfig } from '@/lib/tarot/types';

// Compatibility value for existing reading hooks; no provider settings live here.
const config: ApiConfig = { endpoint: '', apiKey: '', model: '' };

export function useApiConfig() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [intentEnabled, setIntentEnabled] = useState(false);
  const [canUseApi, setCanUseApi] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          setCanUseApi(data?.available === true);
          setIntentEnabled(data?.intentEnabled === true);
        }
      })
      .catch(() => {
        if (!cancelled) setCanUseApi(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, isLoaded, canUseApi, intentEnabled };
}
