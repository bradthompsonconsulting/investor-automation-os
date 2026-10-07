/**
 * Pipeline property context -- B15-09 (INV-108), Walkthrough 2: "Property /
 * Opportunity showed a deal name without property address. Add
 * authoritative address."
 *
 * Pure. No I/O, no React, no GHL. The property address is the contact's own
 * contact.property_address custom field, as the existing contacts read
 * already returns it (ContactRow.propertyAddress -- the same read the
 * Dashboard joins to the pipeline). It is NEVER the contact's mailing
 * address: the index below accepts only `id` and `propertyAddress`, so
 * address1 / city / state / postalCode cannot reach a Pipeline row.
 *
 * Honest states. "Property address not recorded." is shown only when the
 * contact was read and its property_address is empty (or the opportunity has
 * no contact at all). A contacts read that failed, or a contact the list did
 * not return (the list endpoint can lag), says the address couldn't be
 * loaded -- it never claims the address is missing.
 */

export const PROPERTY_ADDRESS_NOT_RECORDED = "Property address not recorded.";
export const PROPERTY_ADDRESS_UNAVAILABLE = "Property address couldn't be loaded.";
export const PROPERTY_ADDRESS_LOADING = "Loading address…";

/** Only these two contact fields are accepted; a mailing address cannot be passed in. */
export type PropertyAddressContact = { id: string; propertyAddress: string };

export type PropertyAddressSource =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; byContactId: ReadonlyMap<string, string> };

export type PipelinePropertyCell = {
  kind: "address" | "not_recorded" | "unavailable" | "loading";
  text: string;
};

export function indexPropertyAddresses(contacts: readonly PropertyAddressContact[]): Map<string, string> {
  const byContactId = new Map<string, string>();
  for (const c of contacts) {
    if (c.id) byContactId.set(c.id, (c.propertyAddress ?? "").trim());
  }
  return byContactId;
}

export function pipelinePropertyCell(contactId: string, source: PropertyAddressSource): PipelinePropertyCell {
  if (!contactId) return { kind: "not_recorded", text: PROPERTY_ADDRESS_NOT_RECORDED };
  if (source.kind === "loading") return { kind: "loading", text: PROPERTY_ADDRESS_LOADING };
  if (source.kind === "failed") return { kind: "unavailable", text: PROPERTY_ADDRESS_UNAVAILABLE };
  const address = source.byContactId.get(contactId);
  if (address === undefined) return { kind: "unavailable", text: PROPERTY_ADDRESS_UNAVAILABLE };
  if (!address) return { kind: "not_recorded", text: PROPERTY_ADDRESS_NOT_RECORDED };
  return { kind: "address", text: address };
}
