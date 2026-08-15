# Validation rules

| Field / object | Rule | When it fires | Error message |
|---|---|---|---|
| Record name | Valid DNS label syntax (letters/digits/hyphen, no leading/trailing hyphen, ≤63 chars/label, `@` allowed for apex) | on-blur, on-submit | "Not a valid DNS label." |
| Record name + zone | Combined FQDN ≤ 253 characters | on-submit | "This record's full name is too long (over 253 characters)." |
| CNAME record | Cannot be created at the zone apex (`name = '@'`) | on-change (type=CNAME, name='@'), on-submit | "CNAME records can't be created at the zone apex." |
| Any record | No duplicate (same zone, name, type) unless editing that exact record | on-submit | "A {type} record named '{name}' already exists in this zone." |
| TTL | Integer, 0 ≤ ttl ≤ 2147483647 (RFC 2181); UI warns below 60 | on-blur | "TTL must be a whole number of seconds." / warning: "TTLs under 60s can cause excessive query load." |
| SOA refresh/retry/expire/minimum | Positive integers; `retry < refresh < expire` | on-submit (Edit SOA) | "Retry must be less than refresh, which must be less than expire." |
| SOA serial | Must increase on every deploy; if unchanged since last deploy, auto-increment offered | server-side, on deploy | "Serial has not increased since the last deploy — Bind9-Manager will bump it automatically." |
| CIDR (Network Block) | Valid IPv4/IPv6 CIDR notation | on-blur | "Not a valid CIDR block." |
| CIDR containment | A child block must be fully contained within its parent block | on-submit | "{cidr} is not contained within the parent block {parentCidr}." |
| Non-octet-aligned block | Prefix not a multiple of 8 (IPv4) triggers RFC 2317 classless delegation notice | on-change | info (not error): "This prefix isn't octet-aligned — the reverse zone will use RFC 2317 classless delegation." |
| CNAME/MX/SRV/NS/ALIAS target | If the target FQDN isn't in this zone or in External Hosts | on-change (debounced), on-submit | warning (not blocking): "Target not found in this zone or in External Hosts — this will create a dangling reference." |
| PTR record | Must have a matching reverse zone covering its address | on-submit | "No reverse zone covers this address — generate one from Network Blocks first, or this PTR will be orphaned." |
| Configuration delete | Typed name must exactly match | on-submit (button stays disabled until match) | "Type the Configuration's name to confirm." |
| Configuration name | Unique across all Configurations | on-submit | "A Configuration named '{name}' already exists." |
| Zone/View/Server delete | Typed name match + dependent-object count shown | on-submit | "Type '{name}' to confirm. This also removes {n} dependent objects." |
| SNMP v2c community string | Non-empty if v2c selected | on-submit | "A community string is required for SNMPv2c." |
| SNMP v3 passphrases | ≥ 8 characters if auth/priv protocol selected | on-blur | "Passphrase must be at least 8 characters." |
| Snapshot label (manual) | Non-empty, ≤ 120 characters | on-submit | "Give this snapshot a label." |
| Restore scope vs. target | Scope object must still exist in the target Configuration | on-submit (restore preview) | "{scope} no longer exists in this Configuration — restore would recreate it from the snapshot." (info, not blocking) |
| Deploy — pre-flight warning ack | Deploy button disabled until the warning-acknowledgment checkbox is checked, only when a checkzone WARN exists | on-submit | (button disabled; hint text) "Acknowledge the pre-flight warning to enable deploy." |
| Deploy — pre-flight hard failure | Deploy blocked entirely (no ack override) | server-only, after checkconf/checkzone | "Pre-flight failed — fix the reported error before deploying." |

## Addendum 2 additions

| Field / object | Rule | When it fires | Error message |
|---|---|---|---|
| ACL entry (address) | Valid IPv4/IPv6 address | on-blur | "Not a valid IP address." |
| ACL entry (CIDR) | Valid CIDR notation | on-blur | "Not a valid CIDR block." |
| ACL entry (ACL_REF) | Cannot reference itself, directly or transitively | on-submit | "This would create a circular ACL reference." |
| ACL entry (TSIG_KEY) | Key must exist in this Configuration | on-submit | "This TSIG key doesn't exist yet — create it first." |
| ACL delete/edit with references | Blocked without acknowledging the dependency panel | on-submit | "This ACL is used by {n} views, {m} zones and {k} servers — review them before continuing." |
| TSIG key rotation | New secret generated, old key stays valid for a grace window shown to the operator | on-submit | "Rotating generates a new secret. The old one keeps working until you redeploy the referencing objects." |
| SOA serial policy = manual, deploying without a bump | Warn, don't block | on pre-flight | "This zone's serial policy is manual and the serial hasn't changed since the last deploy." |
| PTR co-management checkbox | Checked by default when a matching reverse zone exists in this Configuration | on-change (A/AAAA form) | checkbox label: "Also create/update the PTR in {reverseZoneName}" — or, if none exists: "No reverse zone covers this address yet." (info, not blocking) |
| Fast record entry (parsed line) | Must parse as `name ttl IN type rdata`; falls back to showing the structured form with an inline parse error | on-paste/on-submit | "Couldn't parse this as a zone-file line: {detail}" |
| Bulk find-and-replace on RDATA | Preview required before commit; blocked if the replacement would produce a duplicate | on-submit (preview step) | "This replacement would create a duplicate {type} record named '{name}'." |
| Record template | All placeholder tokens in `produces[].nameExpr`/`rdataExpr` must be filled before creating | on-submit | "Fill in {token} to use this template." |
