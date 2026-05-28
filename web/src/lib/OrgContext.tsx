import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, type Org } from './api';

type OrgState = {
  org: Org | null;
  orgs: Org[];
  setOrg: (o: Org) => void;
  error: string | null;
  loading: boolean;
};

const OrgCtx = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .orgs()
      .then(({ orgs }) => {
        setOrgs(orgs);
        setOrg(orgs[0] ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <OrgCtx.Provider value={{ org, orgs, setOrg, error, loading }}>
      {children}
    </OrgCtx.Provider>
  );
}

export function useOrg(): OrgState {
  const v = useContext(OrgCtx);
  if (!v) throw new Error('useOrg outside provider');
  return v;
}
