import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import { Chrome } from './layout/Chrome/Chrome';
import { Placeholder } from './layout/Placeholder/Placeholder';
import { ZoneRecords } from './routes/ZoneRecords/ZoneRecords';
import { ApiKeys } from './routes/ApiKeys/ApiKeys';
import { Users } from './routes/Users/Users';
import { Login } from './routes/Login/Login';
import { Labs } from './routes/Labs/Labs';
import { LabEditor } from './routes/Labs/LabEditor';
import { Servers } from './routes/Servers/Servers';
import { Views } from './routes/Views/Views';
import { ViewHub } from './routes/Views/ViewHub';
import { ZonesInView } from './routes/Views/ZonesInView';
import { ViewOptionsPanel } from './routes/Views/ViewOptionsPanel';
import { ViewRolesPanel } from './routes/Views/ViewRolesPanel';
import { ZoneHub } from './routes/Views/ZoneHub';
import { ZoneOptionsPanel } from './routes/Views/ZoneOptionsPanel';
import { ZoneRolesPanel } from './routes/Views/ZoneRolesPanel';
import {
  RedirectToFirstViewZones,
  RedirectToFirstViewExternalHosts,
  RedirectToFirstViewRoles,
  RedirectToFirstViewOptions,
  RedirectZoneRecordsToView,
} from './routes/Views/redirects';
import { ExternalHosts } from './routes/ExternalHosts/ExternalHosts';
import { QueryTool } from './routes/QueryTool/QueryTool';
import { ZoneHealth } from './routes/ZoneHealth/ZoneHealth';
import { Acls } from './routes/Acls/Acls';
import { AclEditor } from './routes/Acls/AclEditor';
import { AclEvaluator } from './routes/Acls/AclEvaluator';
import { TsigKeys } from './routes/TsigKeys/TsigKeys';
import { ServerGroups } from './routes/ServerGroups/ServerGroups';
import { ServerGroupDetail } from './routes/ServerGroups/ServerGroupDetail';
import { Blocks } from './routes/Blocks/Blocks';
import { BlockDetail } from './routes/Blocks/BlockDetail';
import { RecordTemplates } from './routes/RecordTemplates/RecordTemplates';
import { RecordTemplateDetail } from './routes/RecordTemplates/RecordTemplateDetail';
import { RpzPolicies } from './routes/Rpz/RpzPolicies';
import { RpzPolicyDetail } from './routes/Rpz/RpzPolicyDetail';
import { ReviewDeploy } from './routes/ReviewDeploy/ReviewDeploy';
import { RequireAuth } from './auth/RequireAuth';

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Chrome />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/config/dns-lab/views" replace />,
      },
      {
        path: 'configurations',
        element: (
          <Placeholder
            title="Configurations"
            description="Each Configuration is a fully isolated DNS world — views, zones, records, blocks and servers don't cross between them."
          />
        ),
      },
      {
        path: 'config/:configId',
        element: <Navigate to="views" replace />,
      },
      {
        path: 'config/:configId/views',
        element: <Views />,
      },
      {
        path: 'config/:configId/views/:viewId',
        element: <ViewHub />,
        children: [
          {
            index: true,
            element: <Navigate to="zones" replace />,
          },
          {
            path: 'zones',
            element: <ZonesInView />,
          },
          {
            path: 'external-hosts',
            element: <ExternalHosts />,
          },
          {
            path: 'options',
            element: <ViewOptionsPanel />,
          },
          {
            path: 'roles',
            element: <ViewRolesPanel />,
          },
          {
            path: 'zones/:zoneId',
            element: <ZoneHub />,
            children: [
              {
                index: true,
                element: <Navigate to="records" replace />,
              },
              {
                path: 'records',
                element: <ZoneRecords />,
              },
              {
                path: 'options',
                element: <ZoneOptionsPanel />,
              },
              {
                path: 'roles',
                element: <ZoneRolesPanel />,
              },
            ],
          },
        ],
      },
      {
        // Old flat routes redirect to the nested view hub using the active-or-first view.
        path: 'config/:configId/zones',
        element: <RedirectToFirstViewZones />,
      },
      {
        path: 'config/:configId/zones/:zoneId/records',
        element: <RedirectZoneRecordsToView />,
      },
      {
        path: 'config/:configId/external-hosts',
        element: <RedirectToFirstViewExternalHosts />,
      },
      {
        path: 'config/:configId/blocks',
        element: <Blocks />,
      },
      {
        path: 'config/:configId/blocks/:blockId',
        element: <BlockDetail />,
      },
      {
        path: 'config/:configId/roles',
        element: <RedirectToFirstViewRoles />,
      },
      {
        path: 'config/:configId/options',
        element: <RedirectToFirstViewOptions />,
      },
      {
        path: 'config/:configId/servers',
        element: <Servers />,
      },
      {
        path: 'config/:configId/servers/:serverId',
        element: (
          <Placeholder
            title="Server Detail"
            description="Server status, interfaces, deployment roles, and live configs."
          />
        ),
      },
      {
        path: 'config/:configId/labs',
        element: <Labs />,
      },
      {
        path: 'config/:configId/labs/:labId',
        element: <LabEditor />,
      },
      {
        path: 'config/:configId/groups',
        element: <ServerGroups />,
      },
      {
        path: 'config/:configId/groups/:groupId',
        element: <ServerGroupDetail />,
      },
      {
        path: 'config/:configId/acls',
        element: <Acls />,
      },
      {
        path: 'config/:configId/acls/evaluate',
        element: <AclEvaluator />,
      },
      {
        path: 'config/:configId/acls/:aclId',
        element: <AclEditor />,
      },
      {
        path: 'config/:configId/keys',
        element: <TsigKeys />,
      },
      {
        path: 'config/:configId/templates',
        element: <RecordTemplates />,
      },
      {
        path: 'config/:configId/templates/:templateId',
        element: <RecordTemplateDetail />,
      },
      {
        path: 'config/:configId/health',
        element: <ZoneHealth />,
      },
      {
        path: 'config/:configId/query',
        element: <QueryTool />,
      },
      {
        path: 'config/:configId/rpz',
        element: <RpzPolicies />,
      },
      {
        path: 'config/:configId/rpz/:policyId',
        element: <RpzPolicyDetail />,
      },
      {
        path: 'config/:configId/config-review',
        element: (
          <Placeholder
            title="Config Review"
            description="Inspect generated named.conf and zone files across all servers."
          />
        ),
      },
      {
        path: 'config/:configId/review-deploy',
        element: <ReviewDeploy />,
      },
      {
        path: 'config/:configId/history',
        element: (
          <Placeholder
            title="Deployment History"
            description="Audit log and results of previous deployments."
          />
        ),
      },
      {
        path: 'config/:configId/backups',
        element: (
          <Placeholder
            title="Snapshots"
            description="Configuration snapshots and point-in-time restore points."
          />
        ),
      },
      {
        path: 'config/:configId/backups/adopt',
        element: (
          <Placeholder
            title="Import-from-server (adopt) flow"
            description="Import existing BIND9 zone files and server configuration into a new configuration."
          />
        ),
      },
      {
        path: 'config/:configId/backups/:snapshotId',
        element: (
          <Placeholder
            title="Snapshot Detail"
            description="Snapshot diff and restore preview."
          />
        ),
      },
      {
        path: 'settings/api-keys',
        element: <ApiKeys />,
      },
      {
        path: 'settings/users',
        element: <Users />,
      },
      {
        path: '*',
        element: (
          <Placeholder
            title="Page Not Found"
            description="The requested page could not be found."
          />
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
