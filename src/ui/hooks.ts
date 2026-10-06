import { useEffect, useState, useSyncExternalStore } from 'react';
import { imageUrl } from '../store/imageStore';
import { repo } from '../store/repo';

export function useMaps() {
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot);
}

/** 이미지 해시 → object URL. 로딩 중이거나 없으면 null. */
export function useImageUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) imageUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}
