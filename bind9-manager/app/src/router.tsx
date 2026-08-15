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
        element: <Navigate to="/config/dns-lab/zones" replace />,
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
        element: <Navigate to="zones" replace />,
      },
      {
        path: 'config/:configId/views',
        element: (
          <Placeholder
            title="Views"
            description="DNS views define distinct query contexts with independent ACLs and zones."
          />
        ),
      },
      {
        path: 'config/:configId/views/:viewId',
        element: (
          <Placeholder
            title="View Detail"
            description="View ACL editor and configuration ordering."
          />
        ),
      },
      {
        path: 'config/:configId/zones',
        element: (
          <Placeholder
            title="Zones"
            description="Forward, reverse, and stub zones managed in this configuration."
          />
        ),
      },
      {
        path: 'config/:configId/zones/:zoneId',
        element: (
          <Placeholder
            title="Zone Detail"
            description="Zone overview, SOA records, and zone settings."
          />
        ),
      },
      {
        path: 'config/:configId/zones/:zoneId/records',
        element: <ZoneRecords />,
      },
      {
        path: 'config/:configId/external-hosts',
        element: (
          <Placeholder
            title="External Hosts"
            description="Known target hosts outside the managed zones."
          />
        ),
      },
      {
        path: 'config/:configId/blocks',
        element: (
          <Placeholder
            title="Network Blocks & Reverse Zones"
            description="CIDR network blocks and reverse DNS hierarchy."
          />
        ),
      },
      {
        path: 'config/:configId/blocks/:blockId',
        element: (
          <Placeholder
            title="Block Detail"
            description="Network block IP assignments and reverse delegation."
          />
        ),
      },
      {
        path: 'config/:configId/roles',
        element: (
          <Placeholder
            title="Deployment Roles"
            description="Primary, secondary, and stealth role assignments across servers."
          />
        ),
      },
      {
        path: 'config/:configId/options',
        element: (
          <Placeholder
            title="Deployment Options"
            description="Inherited and overridden BIND options across configuration hierarchy."
          />
        ),
      },
      {
        path: 'config/:configId/servers',
        element: (
          <Placeholder
            title="Servers & Interfaces"
            description="Managed BIND instances, network interfaces, and containerlab nodes."
          />
        ),
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
        element: (
          <Placeholder
            title="Server Groups"
            description="Logical server clusters and deployment synchronization."
          />
        ),
      },
      {
        path: 'config/:configId/groups/:groupId',
        element: (
          <Placeholder
            title="Server Group Detail"
            description="Server group members and group-wide options."
          />
        ),
      },
      {
        path: 'config/:configId/acls',
        element: (
          <Placeholder
            title="ACLs"
            description="Named access control lists for queries, transfers, and recursive lookups."
          />
        ),
      },
      {
        path: 'config/:configId/acls/evaluate',
        element: (
          <Placeholder
            title="ACL Evaluator"
            description="Test client IP evaluation against access control chains."
          />
        ),
      },
      {
        path: 'config/:configId/acls/:aclId',
        element: (
          <Placeholder
            title="ACL Detail"
            description="ACL rules, negations, and nested ACL definitions."
          />
        ),
      },
      {
        path: 'config/:configId/keys',
        element: (
          <Placeholder
            title="TSIG Keys"
            description="Transaction signature secret keys for authentication and zone transfers."
          />
        ),
      },
      {
        path: 'config/:configId/templates',
        element: (
          <Placeholder
            title="Record Templates"
            description="Standardized DNS record sets for new zone provisioning."
          />
        ),
      },
      {
        path: 'config/:configId/health',
        element: (
          <Placeholder
            title="Zone Health"
            description="Automated linting and health checks across zones and records."
          />
        ),
      },
      {
        path: 'config/:configId/query',
        element: (
          <Placeholder
            title="Query Tool"
            description="Simulate DNS queries against live or staged server configs."
          />
        ),
      },
      {
        path: 'config/:configId/rpz',
        element: (
          <Placeholder
            title="RPZ"
            description="Response Policy Zones for DNS filtering and policy enforcement."
          />
        ),
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
        element: (
          <Placeholder
            title="Review & Deploy"
            description="Review staged change diffs and deploy to target servers."
          />
        ),
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
