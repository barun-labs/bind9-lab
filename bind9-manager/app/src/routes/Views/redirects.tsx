import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';

/** Active view = `?view=` param (matched by id or name) if present, else the first view. */
function useActiveOrFirstViewId(configId: string): string | undefined {
  const store = useStore();
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view');

  const views = store.views.filter((v) => v.configurationId === configId);
  const active = viewParam ? views.find((v) => v.id === viewParam || v.name === viewParam) : undefined;
  return (active ?? views[0])?.id;
}

export function RedirectToFirstViewZones() {
  const { configId = 'dns-lab' } = useParams();
  const viewId = useActiveOrFirstViewId(configId);
  if (!viewId) return null;
  return <Navigate to={`/config/${configId}/views/${viewId}/zones`} replace />;
}

export function RedirectToFirstViewExternalHosts() {
  const { configId = 'dns-lab' } = useParams();
  const viewId = useActiveOrFirstViewId(configId);
  if (!viewId) return null;
  return <Navigate to={`/config/${configId}/views/${viewId}/external-hosts`} replace />;
}

export function RedirectToFirstViewRoles() {
  const { configId = 'dns-lab' } = useParams();
  const viewId = useActiveOrFirstViewId(configId);
  if (!viewId) return null;
  return <Navigate to={`/config/${configId}/views/${viewId}/roles`} replace />;
}

export function RedirectToFirstViewOptions() {
  const { configId = 'dns-lab' } = useParams();
  const viewId = useActiveOrFirstViewId(configId);
  if (!viewId) return null;
  return <Navigate to={`/config/${configId}/views/${viewId}/options`} replace />;
}

export function RedirectZoneRecordsToView() {
  const { configId = 'dns-lab', zoneId = '' } = useParams();
  const store = useStore();
  const zone = store.zones.find((z) => z.id === zoneId);
  const fallbackViewId = useActiveOrFirstViewId(configId);
  const viewId = zone?.viewId ?? fallbackViewId;
  if (!viewId) return null;
  return <Navigate to={`/config/${configId}/views/${viewId}/zones/${zoneId}/records`} replace />;
}
