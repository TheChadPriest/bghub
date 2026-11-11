import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Engine } from './engine';
import type { EngineSnapshot } from './types';

const Ctx = createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: ReactNode }) {
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useEngine(): [EngineSnapshot, Engine] {
  const engine = useContext(Ctx);
  if (!engine) throw new Error('EngineProvider missing');
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return [snap, engine];
}
